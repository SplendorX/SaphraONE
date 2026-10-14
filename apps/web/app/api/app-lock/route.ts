import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { appUnlockCookieName } from "@/lib/app-lock/cookie";
import {
  checkPin,
  deleteAppLock,
  deletePasskeys,
  findAppLock,
  isValidPin,
  listPasskeys,
  pinPausedMessage,
  saveAppLock,
  savePasskey,
  type AppLockRow,
} from "@/lib/app-lock/server";
import { readJsonRecord } from "@/lib/http";
import { platformAccessCookieName } from "@/lib/platform-access";
import { consumeRateLimit } from "@/lib/rate-limit";
import { secureCookieFor } from "@/lib/secure-cookie";
import {
  createSignedToken,
  readSignedToken,
  readWalletToken,
  sessionWallets,
  walletSessionCookieName,
} from "@/lib/wallet-session";

export const runtime = "nodejs";

/**
 * Payment security: the 6-digit PIN and Face ID / fingerprint (passkeys)
 * that confirm payments (see /api/tx-approval), alongside an authenticator
 * code. Stored as before in app_locks / app_lock_passkeys; the app itself no
 * longer locks when it is opened.
 */

const noStore = { "Cache-Control": "no-store" };
const passkeyChallengeCookieName = "saphra_app_lock_challenge";
const passkeyChallengeTtlMs = 5 * 60_000;
/** Kept in the stored row; nothing reads it now that the app doesn't lock. */
const storedTimeoutMinutes = 15;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { headers: noStore, status });
}

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ message, ...extra }, status);
}

async function readContext() {
  const cookieStore = await cookies();
  const session = readWalletToken(cookieStore.get(walletSessionCookieName)?.value, "session");
  return {
    challengeToken: cookieStore.get(passkeyChallengeCookieName)?.value,
    session,
    wallets: session ? [session.ownerWallet.toLowerCase(), ...sessionWallets(session)] : [],
  };
}

/** Where passkeys live: this site's host, checked against the page's origin. */
function relyingParty(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return { origin, rpID: request.nextUrl.hostname };
}

async function setChallengeCookie(response: NextResponse, payload: { challenge: string; wallet: string }) {
  response.cookies.set(
    passkeyChallengeCookieName,
    createSignedToken({ ...payload, expiresAt: Date.now() + passkeyChallengeTtlMs, kind: "register" }),
    {
      httpOnly: true,
      maxAge: passkeyChallengeTtlMs / 1000,
      path: "/",
      sameSite: "strict",
      secure: await secureCookieFor(),
    },
  );
}

function readChallenge(token: string | undefined, wallet: string) {
  const payload = readSignedToken(token) as {
    challenge?: string;
    expiresAt?: number;
    kind?: string;
    wallet?: string;
  } | null;
  if (
    !payload?.challenge ||
    payload.kind !== "register" ||
    payload.wallet !== wallet ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt < Date.now()
  ) {
    return null;
  }
  return payload.challenge;
}

function pinFailure(response: Awaited<ReturnType<typeof checkPin>>) {
  if (response.ok) return null;
  if (response.reason === "paused") {
    return jsonError(pinPausedMessage(response.until), 429, { pausedUntil: response.until });
  }
  if (response.reason === "sign-out") {
    const signedOut = jsonError("Too many wrong PINs. Sign in again to continue.", 401, {
      signedOut: true,
    });
    signedOut.cookies.delete(walletSessionCookieName);
    signedOut.cookies.delete(platformAccessCookieName);
    signedOut.cookies.delete(appUnlockCookieName);
    return signedOut;
  }
  return jsonError("That PIN isn't right.", 401, { attemptsLeft: response.attemptsLeft });
}

/** Whether this account has a PIN, and how many Face ID / fingerprint devices. */
export async function GET() {
  const { session, wallets } = await readContext();
  if (!session) return json({ enabled: false, signedIn: false });

  let lock: AppLockRow | null;
  try {
    lock = await findAppLock(wallets);
  } catch {
    return json({ enabled: false, signedIn: true, unavailable: true });
  }
  const passkeys = lock ? await listPasskeys(lock.owner_wallet).catch(() => []) : [];
  const response = json({
    enabled: Boolean(lock),
    passkeys: passkeys.length,
    pausedUntil:
      lock?.locked_until && Date.parse(lock.locked_until) > Date.now() ? lock.locked_until : null,
    signedIn: true,
  });
  // A pass from when the app used to lock: no longer needed.
  response.cookies.delete(appUnlockCookieName);
  return response;
}

export async function POST(request: NextRequest) {
  const context = await readContext();
  const { session, wallets } = context;
  if (!session) return jsonError("Sign in to set up payment security.", 401);
  const owner = session.ownerWallet.toLowerCase();

  const body = (await readJsonRecord(request)) ?? {};
  const action = typeof body.action === "string" ? body.action : "";

  if (!(await consumeRateLimit(`app-lock:${owner}`, 40, 60))) {
    return jsonError("Too many attempts. Wait a minute and try again.", 429);
  }

  let lock: AppLockRow | null;
  try {
    lock = await findAppLock(wallets);
  } catch {
    return jsonError("Payment security isn't available right now.", 503);
  }

  if (action === "setup") {
    if (lock) return jsonError("Your payment PIN is already set.", 409);
    if (!isValidPin(body.pin)) return jsonError("Choose a 6-digit PIN.", 400);
    try {
      await saveAppLock(owner, body.pin, storedTimeoutMinutes);
    } catch {
      return jsonError("Your PIN couldn't be saved.", 503);
    }
    return json({ enabled: true });
  }

  // Everything else changes an existing PIN.
  if (!lock) return jsonError("Set a payment PIN first.", 404);

  if (action === "change") {
    if (!isValidPin(body.currentPin) || !isValidPin(body.pin)) {
      return jsonError("Enter your current PIN and a new 6-digit PIN.", 400);
    }
    const failure = pinFailure(await checkPin(lock, body.currentPin));
    if (failure) return failure;
    await saveAppLock(lock.owner_wallet, body.pin, storedTimeoutMinutes);
    return json({ changed: true });
  }

  if (action === "disable") {
    if (!isValidPin(body.pin)) return jsonError("Enter your 6-digit PIN.", 400);
    const failure = pinFailure(await checkPin(lock, body.pin));
    if (failure) return failure;
    // Removes its Face ID / fingerprint devices too.
    await deleteAppLock(lock.owner_wallet);
    return json({ enabled: false });
  }

  if (action === "passkey-register-options") {
    const existing = await listPasskeys(lock.owner_wallet);
    const options = await generateRegistrationOptions({
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: existing.map((key) => ({
        id: key.credential_id,
        transports: key.transports ?? undefined,
      })),
      preferredAuthenticatorType: "localDevice",
      rpID: relyingParty(request).rpID,
      rpName: "SaphraONE",
      userDisplayName: "SaphraONE payments",
      userID: new TextEncoder().encode(lock.owner_wallet),
      userName: `SaphraONE ${lock.owner_wallet.slice(0, 6)}…${lock.owner_wallet.slice(-4)}`,
    });
    const response = json({ options });
    await setChallengeCookie(response, { challenge: options.challenge, wallet: lock.owner_wallet });
    return response;
  }

  if (action === "passkey-register") {
    const challenge = readChallenge(context.challengeToken, lock.owner_wallet);
    const credential = body.response as RegistrationResponseJSON | undefined;
    if (!challenge || !credential) {
      return jsonError("Setting up Face ID or fingerprint timed out. Try again.", 400);
    }
    const { origin, rpID } = relyingParty(request);
    try {
      const verification = await verifyRegistrationResponse({
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        response: credential,
      });
      if (!verification.verified) throw new Error("not verified");
      const saved = verification.registrationInfo.credential;
      await savePasskey({
        counter: saved.counter,
        credential_id: saved.id,
        owner_wallet: lock.owner_wallet,
        public_key: Buffer.from(saved.publicKey).toString("base64url"),
        transports: saved.transports ?? null,
      });
    } catch {
      return jsonError("Face ID or fingerprint couldn't be set up.", 400);
    }
    const response = json({ registered: true });
    response.cookies.delete(passkeyChallengeCookieName);
    return response;
  }

  if (action === "passkey-remove") {
    await deletePasskeys(lock.owner_wallet);
    return json({ removed: true });
  }

  return jsonError("Unknown action.", 400);
}
