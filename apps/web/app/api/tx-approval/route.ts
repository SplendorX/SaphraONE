import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { after, NextResponse, type NextRequest } from "next/server";

import { appUnlockCookieName } from "@/lib/app-lock/cookie";
import { getPlatformFeeRecipientAddresses } from "@/lib/arcscan-history";
import {
  checkPin,
  findAppLock,
  isValidPin,
  listPasskeys,
  recordPasskeyUse,
  pinPausedMessage,
} from "@/lib/app-lock/server";
import { readJsonRecord } from "@/lib/http";
import { platformAccessCookieName } from "@/lib/platform-access";
import { consumeRateLimit } from "@/lib/rate-limit";
import { decodeCall, describeCall, hashCall, paymentsOf } from "@/lib/tx-approval/decode";
import {
  alertEmailFor,
  maskEmail,
  saveAlertEmail,
  validEmail,
  securityEmailConfigured,
  sendApprovalCode,
  sendApprovalNotice,
  type ApprovalEmailDetails,
} from "@/lib/tx-approval/email";
import {
  approve,
  createApproval,
  emailCodeMatches,
  findApproval,
  hashEmailCode,
  isLive,
  needsEmailCode,
  newEmailCode,
  recordWrongEmailCode,
  updateApproval,
  usdValue,
  type TxApprovalRow,
} from "@/lib/tx-approval/server";
import {
  pickTxCall,
  txApprovalActions,
  type TxApprovalMethod,
  type TxApprovalStart,
} from "@/lib/tx-approval/shared";
import { checkCode, findTwoFactor } from "@/lib/two-factor/server";
import {
  readWalletToken,
  sessionWallets,
  walletSessionCookieName,
} from "@/lib/wallet-session";

export const runtime = "nodejs";

/**
 * SaphraONE's own transaction confirmation (see lib/tx-approval):
 *   begin        describe the payment, run the risk checks, email a code if needed
 *   verify       Face ID / fingerprint, PIN or two-factor code
 *   verify-email the emailed code, when one was needed
 */

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { headers: noStore, status });
}

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ message, ...extra }, status);
}

function formatAmount(amount: number | null) {
  if (amount === null || !Number.isFinite(amount)) return null;
  return amount.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * Split SaphraONE's own fee wallets (set in this server's env, never taken from
 * the request) out of a payment's recipients, for describing it. This only
 * changes the wording: the approval still lists and enforces every recipient,
 * fee wallet included, so nothing can be paid that wasn't approved.
 */
function splitFeeWallets(addresses: readonly string[]) {
  const feeWallets = new Set(getPlatformFeeRecipientAddresses());
  const payees = addresses.filter((address) => !feeWallets.has(address.toLowerCase()));
  return { payees, paysFee: payees.length !== addresses.length };
}

function emailDetails(row: TxApprovalRow): ApprovalEmailDetails {
  const { payees, paysFee } = splitFeeWallets(row.recipients ?? []);
  return {
    amount: formatAmount(row.amount === null ? null : Number(row.amount)),
    destination:
      row.destination ??
      (payees.length
        ? `${payees.length} recipients: ${payees.slice(0, 5).join(", ")}${payees.length > 5 ? ", …" : ""}`
        : paysFee
          ? "SaphraONE (service fee)"
          : null),
    includesServiceFee: paysFee && payees.length > 0,
    title: row.title,
    token: row.token,
  };
}

async function readSession() {
  const cookieStore = await cookies();
  const session = readWalletToken(cookieStore.get(walletSessionCookieName)?.value, "session");
  if (!session) return null;
  const owner = session.ownerWallet.toLowerCase();
  return { owner, wallets: [owner, ...sessionWallets(session)] };
}

/** The passkey challenge, bound to this one approval. */
function passkeyChallengeFor(id: string) {
  return crypto
    .createHash("sha256")
    .update(`swiftpay-tx-approval:${id}:${crypto.randomBytes(16).toString("hex")}`)
    .digest("base64url");
}

function parseAmount(value: unknown) {
  if (typeof value !== "string" || !/^\d+(\.\d*)?$/.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export async function POST(request: NextRequest) {
  const session = await readSession();
  if (!session) return jsonError("Sign in to confirm transactions.", 401);

  if (!(await consumeRateLimit(`tx-approval:${session.owner}`, 30, 60))) {
    return jsonError("Too many attempts. Wait a minute and try again.", 429);
  }

  const body = (await readJsonRecord(request)) ?? {};
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "begin") return begin(request, session, body);

  const row = await findApproval(body.id).catch(() => null);
  if (!row || row.owner_wallet !== session.owner) {
    return jsonError("This confirmation has expired. Try again.", 404);
  }
  if (!isLive(row)) return jsonError("This confirmation has expired. Try again.", 410);
  if (row.status === "approved") return json({ approved: true });

  if (action === "verify") return verify(request, session, row, body);
  if (action === "verify-email") return verifyEmail(row, body);
  if (action === "email-setup") return emailSetup(row, body);
  return jsonError("Unknown action.", 400);
}

async function begin(
  request: NextRequest,
  session: { owner: string; wallets: string[] },
  body: Record<string, unknown>,
) {
  let kind: TxApprovalRow["kind"];
  let title: string;
  let amount: number | null;
  let token: string | null;
  let destination: string | null;
  let callHashes: string[] = [];
  let recipients: string[] = [];
  let maxUses = 1;
  let walletId: string;

  const group = body.group as Record<string, unknown> | undefined;
  const rawCall = body.call as Record<string, unknown> | undefined;

  if (group && typeof group === "object") {
    if (group.kind !== "send" && group.kind !== "swap" && group.kind !== "flow") {
      return jsonError("Unknown payment type.", 400);
    }
    walletId = typeof group.walletId === "string" ? group.walletId : "";
    amount = parseAmount(group.amount);
    token = typeof group.token === "string" ? group.token.toUpperCase().slice(0, 12) : null;
    destination =
      typeof group.destination === "string" && /^0x[0-9a-fA-F]{40}$/.test(group.destination)
        ? group.destination.toLowerCase()
        : null;
    if (amount === null) return jsonError("Enter a valid amount.", 400);
    if (group.kind === "send" && !destination) return jsonError("Missing recipient.", 400);
    if (group.kind === "flow") {
      const listed = Array.isArray(group.recipients) ? group.recipients : [];
      if (listed.length > 250) return jsonError("Too many recipients.", 400);
      if (listed.some((value) => typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))) {
        return jsonError("A recipient address isn't valid.", 400);
      }
      recipients = [...new Set((listed as string[]).map((value) => value.toLowerCase()))];
      // Who is being paid, for the sheet and the email: the fee wallet is
      // described as a fee, not as a recipient (it stays in `recipients`).
      const { payees } = splitFeeWallets(recipients);
      destination = payees.length === 1 ? payees[0] : null;
    }
    kind = group.kind;
    title =
      typeof group.title === "string" && group.title.trim()
        ? group.title.trim()
        : kind === "send"
          ? "Send money"
          : kind === "swap"
            ? "Swap"
            : "Confirm transaction";
    maxUses = typeof group.maxUses === "number" ? group.maxUses : 2;
  } else if (rawCall && typeof rawCall === "object" && typeof rawCall.action === "string") {
    if (!txApprovalActions.has(rawCall.action)) return jsonError("Nothing to confirm.", 400);
    const call = pickTxCall(rawCall.action, rawCall);
    walletId = call.walletId;
    const decoded = decodeCall(call);
    const described = describeCall(decoded);
    recipients = paymentsOf(decoded).map((payment) => payment.destination);
    kind = call.action === "signTypedData" ? "sign" : "call";
    title = described.title;
    amount = described.amount;
    token = described.token;
    destination = described.destination;
    callHashes = [hashCall(call)];
  } else {
    return jsonError("Nothing to confirm.", 400);
  }
  if (!walletId) return jsonError("Missing wallet.", 400);

  let lock: Awaited<ReturnType<typeof findAppLock>>;
  let twoFactor: Awaited<ReturnType<typeof findTwoFactor>>;
  try {
    [lock, twoFactor] = await Promise.all([
      findAppLock(session.wallets),
      findTwoFactor(session.wallets).catch(() => null),
    ]);
  } catch (error) {
    console.error("[tx-approval] failed reading the PIN/2FA setup:", error);
    return jsonError("Confirmation isn't available right now.", 503);
  }
  const passkeys = lock ? await listPasskeys(lock.owner_wallet).catch(() => []) : [];
  const methods: TxApprovalMethod[] = [];
  if (passkeys.length > 0) methods.push("passkey");
  if (lock) methods.push("pin");
  if (twoFactor) methods.push("totp");

  const amountUsd = usdValue(amount, token);
  let emailNeeded = false;
  let email: string | null = null;
  try {
    emailNeeded = await needsEmailCode({
      amountUsd,
      destinations: recipients.length > 0 ? recipients : destination ? [destination] : [],
      ownerWallet: session.owner,
    });
  } catch (error) {
    console.error("[tx-approval] failed checking whether an emailed code is needed:", error);
    return jsonError("Confirmation isn't available right now.", 503);
  }
  if (emailNeeded) {
    email = securityEmailConfigured() ? await alertEmailFor(session.owner) : null;
    if (!email) {
      // No address on file, or email isn't configured here: the PIN, passkey
      // or 2FA check still applies. Logged so production can't miss it.
      console.warn("[tx-approval] emailed code skipped: no alert email or Resend config.");
      emailNeeded = false;
    }
  }

  let row: TxApprovalRow;
  try {
    row = await createApproval({
      amount,
      amountUsd,
      callHashes,
      destination,
      kind,
      maxUses,
      needsEmailCode: emailNeeded,
      ownerWallet: session.owner,
      recipients,
      title,
      token,
      walletId,
    });
  } catch (error) {
    console.error("[tx-approval] failed saving the approval:", error);
    return jsonError("Confirmation isn't available right now.", 503);
  }

  if (emailNeeded && email) {
    const code = newEmailCode();
    await updateApproval(row.id, { email_code_hash: hashEmailCode(row.id, code) });
    const sent = await sendApprovalCode(email, code, emailDetails(row), row.id);
    if (!sent) return jsonError("We couldn't email your confirmation code. Try again.", 502);
  }

  let passkeyOptions: unknown = null;
  if (passkeys.length > 0) {
    const challenge = passkeyChallengeFor(row.id);
    passkeyOptions = await generateAuthenticationOptions({
      allowCredentials: passkeys.map((key) => ({
        id: key.credential_id,
        transports: key.transports ?? undefined,
      })),
      challenge: new Uint8Array(Buffer.from(challenge, "base64url")),
      rpID: request.nextUrl.hostname,
      userVerification: "required",
    });
    await updateApproval(row.id, {
      passkey_challenge: (passkeyOptions as { challenge: string }).challenge,
    });
  }

  const start: TxApprovalStart = {
    amount: formatAmount(amount),
    destination,
    emailHint: email ? maskEmail(email) : null,
    expiresAt: row.expires_at,
    id: row.id,
    methods,
    needsEmailCode: emailNeeded,
    needsSetup: methods.length === 0,
    passkeyOptions,
    title,
    token,
  };
  return json(start);
}

function signedOutResponse(message: string) {
  const response = jsonError(message, 401, { signedOut: true });
  response.cookies.delete(walletSessionCookieName);
  response.cookies.delete(platformAccessCookieName);
  response.cookies.delete(appUnlockCookieName);
  return response;
}

async function verify(
  request: NextRequest,
  session: { owner: string; wallets: string[] },
  row: TxApprovalRow,
  body: Record<string, unknown>,
) {
  const method = body.method;

  if (method === "pin") {
    const lock = await findAppLock(session.wallets).catch(() => null);
    if (!lock) return jsonError("Set up a PIN first.", 404);
    if (!isValidPin(body.pin)) return jsonError("Enter your 6-digit PIN.", 400);
    const result = await checkPin(lock, body.pin);
    if (!result.ok) {
      if (result.reason === "paused") {
        return jsonError(pinPausedMessage(result.until), 429, { pausedUntil: result.until });
      }
      if (result.reason === "sign-out") {
        return signedOutResponse("Too many wrong PINs. Sign in again to continue.");
      }
      return jsonError("That PIN isn't right.", 401, { attemptsLeft: result.attemptsLeft });
    }
  } else if (method === "totp") {
    const twoFactor = await findTwoFactor(session.wallets).catch(() => null);
    if (!twoFactor) return jsonError("Two-factor authentication isn't on.", 404);
    const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
    const backupCode = typeof body.backupCode === "string" ? body.backupCode : "";
    if (!/^\d{6}$/.test(code) && !backupCode) return jsonError("Enter the 6-digit code.", 400);
    const result = await checkCode(twoFactor, code ? { code } : { backupCode });
    if (!result.ok) {
      return result.reason === "paused"
        ? jsonError("Too many wrong codes. Try again later.", 429, { pausedUntil: result.until })
        : jsonError("That code isn't right.", 401, { attemptsLeft: result.attemptsLeft });
    }
  } else if (method === "passkey") {
    const lock = await findAppLock(session.wallets).catch(() => null);
    const credential = body.response as AuthenticationResponseJSON | undefined;
    if (!lock || !row.passkey_challenge || !credential?.id) {
      return jsonError("Face ID or fingerprint timed out. Try again.", 400);
    }
    const passkey = (await listPasskeys(lock.owner_wallet)).find(
      (key) => key.credential_id === credential.id,
    );
    if (!passkey) return jsonError("This device's Face ID or fingerprint isn't set up.", 401);
    try {
      const verification = await verifyAuthenticationResponse({
        credential: {
          counter: Number(passkey.counter),
          id: passkey.credential_id,
          publicKey: new Uint8Array(Buffer.from(passkey.public_key, "base64url")),
          transports: passkey.transports ?? undefined,
        },
        expectedChallenge: row.passkey_challenge,
        expectedOrigin: request.nextUrl.origin,
        expectedRPID: request.nextUrl.hostname,
        requireUserVerification: true,
        response: credential,
      });
      if (!verification.verified) throw new Error("not verified");
      await recordPasskeyUse(passkey.credential_id, verification.authenticationInfo.newCounter);
    } catch {
      return jsonError("Face ID or fingerprint couldn't be verified.", 401);
    }
    // One assertion per challenge.
    await updateApproval(row.id, { passkey_challenge: null });
  } else {
    return jsonError("Choose how to confirm.", 400);
  }

  if (row.needs_email_code) {
    await updateApproval(row.id, { method: String(method), method_verified: true });
    return json({ approved: false, needsEmailCode: true });
  }

  // A PIN alone isn't enough: unlike Face ID / Touch ID it can be watched or
  // guessed, so every PIN confirmation also needs a code emailed now.
  if (method === "pin") {
    const email = securityEmailConfigured() ? await alertEmailFor(session.owner).catch(() => null) : null;
    if (email) {
      const code = newEmailCode();
      await updateApproval(row.id, {
        email_code_hash: hashEmailCode(row.id, code),
        method: "pin",
        method_verified: true,
        needs_email_code: true,
      });
      const sent = await sendApprovalCode(email, code, emailDetails(row), row.id);
      if (!sent) return jsonError("We couldn't email your confirmation code. Try again.", 502);
      return json({ approved: false, emailHint: maskEmail(email), needsEmailCode: true });
    }
    if (securityEmailConfigured()) {
      // No security email yet (Google / email sign-ins don't give the server
      // one): ask for it now. The code sent there confirms this payment and
      // proves the address, which is then kept for every later code.
      await updateApproval(row.id, { method: "pin", method_verified: true, needs_email_code: true });
      return json({ approved: false, needsEmailCode: true, needsEmailSetup: true });
    }
    // Email isn't configured on this deployment: the PIN still applies.
    console.warn("[tx-approval] PIN email code skipped: no Resend config.");
  }

  await approve(row, String(method));
  after(() => notify(row));
  return json({ approved: true });
}

/**
 * A PIN confirmation with no security email on file: send a code to the
 * address the user gives. Typing it back both confirms the payment and
 * proves the address (see verifyEmail).
 */
async function emailSetup(row: TxApprovalRow, body: Record<string, unknown>) {
  if (!row.needs_email_code || !row.method_verified || row.method !== "pin") {
    return jsonError("Confirm with your PIN first.", 400);
  }
  if (await alertEmailFor(row.owner_wallet)) return jsonError("Your security email is already set.", 409);
  const email = validEmail(body.email);
  if (!email) return jsonError("Enter a valid email address.", 400);
  if (row.email_attempts >= 4) return jsonError("Too many tries. Start the payment again.", 429);

  const code = newEmailCode();
  await updateApproval(row.id, {
    email_attempts: row.email_attempts + 1,
    email_code_hash: hashEmailCode(`${row.id}:${email}`, code),
  });
  const sent = await sendApprovalCode(email, code, emailDetails(row), row.id);
  if (!sent) return jsonError("We couldn't email your confirmation code. Check the address and try again.", 502);
  return json({ emailHint: maskEmail(email) });
}

async function verifyEmail(row: TxApprovalRow, body: Record<string, unknown>) {
  if (!row.needs_email_code) return jsonError("No emailed code is needed.", 400);
  if (!row.method_verified || !row.method) {
    return jsonError("Confirm with Face ID, your PIN or your code first.", 400);
  }
  const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
  // Adding a security email: the code was sent to (and is bound to) this one.
  const setupEmail = body.email === undefined ? null : validEmail(body.email);
  if (body.email !== undefined && !setupEmail) return jsonError("Enter a valid email address.", 400);
  if (setupEmail && (await alertEmailFor(row.owner_wallet))) {
    return jsonError("Your security email is already set.", 409);
  }
  if (!emailCodeMatches(row, code, setupEmail ?? undefined)) {
    const left = await recordWrongEmailCode(row);
    return left > 0
      ? jsonError("That code isn't right.", 401, { attemptsLeft: left })
      : jsonError("Too many wrong codes. Start the payment again.", 410);
  }
  if (setupEmail) await saveAlertEmail(row.owner_wallet, setupEmail);
  await approve(row, row.method);
  // The code email already showed the details: no separate notice.
  return json({ approved: true });
}

async function notify(row: TxApprovalRow) {
  if (process.env.TX_APPROVAL_NOTICE_EMAILS?.trim() === "false") return;
  if (!securityEmailConfigured()) return;
  try {
    const email = await alertEmailFor(row.owner_wallet);
    if (email) await sendApprovalNotice(email, emailDetails(row), row.id);
  } catch {
    // A notice never blocks a payment.
  }
}
