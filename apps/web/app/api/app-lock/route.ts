import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  appUnlockCookieName,
  isSessionLocked,
  readUnlockToken,
} from "@/lib/app-lock/cookie";
import {
  checkPin,
  deleteAppLock,
  deletePasskeys,
  findAppLock,
  isValidPin,
  listPasskeys,
  normalizeTimeout,
  recordPasskeyUse,
  saveAppLock,
  savePasskey,
  setAppLockTimeout,
  setUnlockCookie,
  type AppLockRow,
} from "@/lib/app-lock/server";
import { setWalletSessionCookies } from "@/lib/circle-wallet-session";
import { readJsonRecord } from "@/lib/http";
import { platformAccessCookieName } from "@/lib/platform-access";
import { consumeRateLimit } from "@/lib/rate-limit";
import { secureCookieFor } from "@/lib/secure-cookie";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  createSignedToken,
  createWalletToken,
  readSignedToken,
  readWalletToken,
  sessionWallets,
  walletSessionCookieName,
  type WalletTokenPayload,
} from "@/lib/wallet-session";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
const passkeyChallengeCookieName = "saphra_app_lock_challenge";
const passkeyChallengeTtlMs = 5 * 60_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { headers: noStore, status });
}

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ message, ...extra }, status);
}

async function readContext() {
  const cookieStore = await cookies();
  const session = readWalletToken(cookieStore.get(walletSessionCookieName)?.value, "session");
  const unlockToken = cookieStore.get(appUnlockCookieName)?.value;
  return {
    challengeToken: cookieStore.get(passkeyChallengeCookieName)?.value,
    locked: isSessionLocked(session, unlockToken),
    session,
    unlock: readUnlockToken(unlockToken),
    wallets: session ? [session.ownerWallet.toLowerCase(), ...sessionWallets(session)] : [],
  };
}

/** Re-sign the current session with the lock flag set or cleared. */
async function setSessionLockFlag(
  response: NextResponse,
  session: WalletTokenPayload,
  appLock: boolean,
) {
  const next: WalletTokenPayload = { ...session };
  if (appLock) next.appLock = true;
  else delete next.appLock;
  await setWalletSessionCookies(response, createWalletToken(next));
}

/** Where passkeys live: this site's host, checked against the page's origin. */
function relyingParty(request: NextRequest) {
  const origin = request.nextUrl.origin;
  return { origin, rpID: request.nextUrl.hostname };
}

async function setChallengeCookie(
  response: NextResponse,
  payload: { challenge: string; kind: "register" | "unlock"; wallet: string },
) {
  response.cookies.set(
    passkeyChallengeCookieName,
    createSignedToken({ ...payload, expiresAt: Date.now() + passkeyChallengeTtlMs }),
    {
      httpOnly: true,
      maxAge: passkeyChallengeTtlMs / 1000,
      path: "/",
      sameSite: "strict",
      secure: await secureCookieFor(),
    },
  );
}

function readChallenge(token: string | undefined, kind: "register" | "unlock", wallet: string) {
  const payload = readSignedToken(token) as {
    challenge?: string;
    expiresAt?: number;
    kind?: string;
    wallet?: string;
  } | null;
  if (
    !payload?.challenge ||
    payload.kind !== kind ||
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
    return jsonError("Too many wrong PINs. Try again later.", 429, { pausedUntil: response.until });
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

/**
 * Who the lock screen greets: the signed-in profile's name and picture (a
 * business's logo for a business account). The lock is keyed by the wallet
 * the session started with, which for a Google or email account with several
 * wallets often isn't the one the profile lives on, so every session wallet
 * is tried, the lock's own first. The device already holds this session, so
 * it reveals nothing new. Never fatal.
 */
async function lockProfile(wallets: string[]) {
  const ordered = [...new Set(wallets.map((wallet) => wallet.toLowerCase()))];
  if (ordered.length === 0) return null;
  try {
    const supabase = createSupabaseAdminClient();
    const table = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";
    const withType = await supabase
      .from(table)
      .select("wallet_address, display_name, username, avatar_url, account_type")
      .in("wallet_address", ordered);
    // A deployment without account types: personal profiles only.
    const data: unknown[] | null = withType.error
      ? (
          await supabase
            .from(table)
            .select("wallet_address, display_name, username, avatar_url")
            .in("wallet_address", ordered)
        ).data
      : withType.data;
    const rows = (data ?? []) as Array<{
      account_type?: string | null;
      avatar_url: string | null;
      display_name: string | null;
      username: string | null;
      wallet_address: string;
    }>;
    const byWallet = ordered.map((wallet) => rows.find((row) => row.wallet_address === wallet)).filter(Boolean);
    const row = byWallet.find((profile) => profile?.avatar_url) ?? byWallet[0];
    if (!row) return null;

    if (row.account_type === "BUSINESS") {
      const { data: business } = await supabase
        .from("business_account_profiles")
        .select("business_name, logo_url")
        .eq("wallet_address", row.wallet_address)
        .maybeSingle();
      if (business) {
        return {
          avatarUrl: (business.logo_url as string | null) ?? row.avatar_url ?? null,
          displayName: (business.business_name as string | null) ?? row.display_name ?? null,
          username: row.username ?? null,
        };
      }
    }
    return {
      avatarUrl: row.avatar_url ?? null,
      displayName: row.display_name ?? null,
      username: row.username ?? null,
    };
  } catch {
    return null;
  }
}

/** The lock's state for this browser. Also re-syncs the session's flag. */
export async function GET() {
  const { locked, session, wallets } = await readContext();
  if (!session) {
    return json({ enabled: false, locked: false, signedIn: false });
  }

  let lock: AppLockRow | null;
  try {
    lock = await findAppLock(wallets);
  } catch {
    // Table missing or unreachable: report the session's own flag.
    return json({ enabled: Boolean(session.appLock), locked, signedIn: true });
  }

  const [passkeys, profile] = await Promise.all([
    lock ? listPasskeys(lock.owner_wallet).catch(() => []) : Promise.resolve([]),
    // The account whose lock this is, so the greeting and the passkey asked
    // for always match.
    lock ? lockProfile([lock.owner_wallet, ...wallets]) : Promise.resolve(null),
  ]);
  const response = json({
    enabled: Boolean(lock),
    // Turned off on another device: open this one too.
    locked: lock ? locked || !session.appLock : false,
    passkeys: passkeys.length,
    pausedUntil:
      lock?.locked_until && Date.parse(lock.locked_until) > Date.now() ? lock.locked_until : null,
    profile,
    signedIn: true,
    timeoutMinutes: lock?.timeout_minutes ?? 1,
  });
  if (Boolean(lock) !== Boolean(session.appLock)) {
    await setSessionLockFlag(response, session, Boolean(lock));
  }
  return response;
}

export async function POST(request: NextRequest) {
  const context = await readContext();
  const { session, wallets } = context;
  if (!session) {
    return jsonError("Sign in to use the app lock.", 401);
  }
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
    return jsonError("The app lock isn't available right now.", 503);
  }

  // Things that open the app.
  if (action === "unlock") {
    if (!lock) {
      // No lock for this session's wallets: the session flag is stale (the
      // lock was turned off elsewhere, or the session moved wallets). Clear
      // it, and say so, instead of "accepting" whatever PIN was typed.
      const response = json({ enabled: false, unlocked: true });
      if (session.appLock) await setSessionLockFlag(response, session, false);
      return response;
    }
    if (!isValidPin(body.pin)) return jsonError("Enter your 6-digit PIN.", 400);
    const result = await checkPin(lock, body.pin);
    const failure = pinFailure(result);
    if (failure) return failure;
    const response = json({ unlocked: true });
    await setUnlockCookie(response, lock.owner_wallet, lock.timeout_minutes);
    if (!session.appLock) await setSessionLockFlag(response, session, true);
    return response;
  }

  if (action === "passkey-unlock-options") {
    if (!lock) return jsonError("The app lock is off.", 404);
    const passkeys = await listPasskeys(lock.owner_wallet);
    if (passkeys.length === 0) return jsonError("Face ID or fingerprint isn't set up.", 404);
    const options = await generateAuthenticationOptions({
      allowCredentials: passkeys.map((key) => ({
        id: key.credential_id,
        transports: key.transports ?? undefined,
      })),
      rpID: relyingParty(request).rpID,
      userVerification: "required",
    });
    const response = json({ options });
    await setChallengeCookie(response, {
      challenge: options.challenge,
      kind: "unlock",
      wallet: lock.owner_wallet,
    });
    return response;
  }

  if (action === "passkey-unlock") {
    if (!lock) return jsonError("The app lock is off.", 404);
    if (lock.locked_until && Date.parse(lock.locked_until) > Date.now()) {
      return jsonError("Too many wrong PINs. Try again later.", 429, {
        pausedUntil: lock.locked_until,
      });
    }
    const challenge = readChallenge(context.challengeToken, "unlock", lock.owner_wallet);
    const credential = body.response as AuthenticationResponseJSON | undefined;
    if (!challenge || !credential?.id) {
      return jsonError("Face ID or fingerprint timed out. Try again.", 400);
    }
    const passkey = (await listPasskeys(lock.owner_wallet)).find(
      (key) => key.credential_id === credential.id,
    );
    if (!passkey) return jsonError("This device's Face ID or fingerprint isn't set up.", 401);

    const { origin, rpID } = relyingParty(request);
    try {
      const verification = await verifyAuthenticationResponse({
        credential: {
          counter: Number(passkey.counter),
          id: passkey.credential_id,
          publicKey: new Uint8Array(Buffer.from(passkey.public_key, "base64url")),
          transports: passkey.transports ?? undefined,
        },
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        response: credential,
      });
      if (!verification.verified) throw new Error("not verified");
      await recordPasskeyUse(passkey.credential_id, verification.authenticationInfo.newCounter);
    } catch {
      return jsonError("Face ID or fingerprint couldn't be verified.", 401);
    }
    const response = json({ unlocked: true });
    response.cookies.delete(passkeyChallengeCookieName);
    await setUnlockCookie(response, lock.owner_wallet, lock.timeout_minutes);
    if (!session.appLock) await setSessionLockFlag(response, session, true);
    return response;
  }

  if (action === "lock") {
    const response = json({ locked: Boolean(lock) });
    response.cookies.delete(appUnlockCookieName);
    return response;
  }

  // Turning the lock on needs a signed-in session that isn't locked.
  if (action === "setup") {
    if (lock) return jsonError("The app lock is already on.", 409);
    if (!isValidPin(body.pin)) return jsonError("Choose a 6-digit PIN.", 400);
    const timeout = normalizeTimeout(body.timeoutMinutes);
    try {
      await saveAppLock(owner, body.pin, timeout);
    } catch {
      return jsonError("The app lock couldn't be turned on.", 503);
    }
    const response = json({ enabled: true, timeoutMinutes: timeout });
    await setSessionLockFlag(response, session, true);
    await setUnlockCookie(response, owner, timeout);
    return response;
  }

  // Everything else changes an existing lock and needs it open.
  if (!lock) return jsonError("The app lock is off.", 404);
  if (context.locked) return jsonError("Unlock SaphraONE first.", 423, { locked: true });

  if (action === "touch") {
    const response = json({ unlocked: true });
    await setUnlockCookie(
      response,
      lock.owner_wallet,
      context.unlock?.timeoutMinutes ?? lock.timeout_minutes,
    );
    return response;
  }

  if (action === "timeout") {
    const timeout = normalizeTimeout(body.timeoutMinutes);
    await setAppLockTimeout(lock.owner_wallet, timeout);
    const response = json({ timeoutMinutes: timeout });
    await setUnlockCookie(response, lock.owner_wallet, timeout);
    return response;
  }

  if (action === "change") {
    if (!isValidPin(body.currentPin) || !isValidPin(body.pin)) {
      return jsonError("Enter your current PIN and a new 6-digit PIN.", 400);
    }
    const failure = pinFailure(await checkPin(lock, body.currentPin));
    if (failure) return failure;
    await saveAppLock(lock.owner_wallet, body.pin, normalizeTimeout(lock.timeout_minutes));
    return json({ changed: true });
  }

  if (action === "disable") {
    if (!isValidPin(body.pin)) return jsonError("Enter your 6-digit PIN.", 400);
    const failure = pinFailure(await checkPin(lock, body.pin));
    if (failure) return failure;
    await deleteAppLock(lock.owner_wallet);
    const response = json({ enabled: false });
    await setSessionLockFlag(response, session, false);
    response.cookies.delete(appUnlockCookieName);
    return response;
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
      userDisplayName: "SaphraONE app lock",
      userID: new TextEncoder().encode(lock.owner_wallet),
      userName: `SaphraONE ${lock.owner_wallet.slice(0, 6)}…${lock.owner_wallet.slice(-4)}`,
    });
    const response = json({ options });
    await setChallengeCookie(response, {
      challenge: options.challenge,
      kind: "register",
      wallet: lock.owner_wallet,
    });
    return response;
  }

  if (action === "passkey-register") {
    const challenge = readChallenge(context.challengeToken, "register", lock.owner_wallet);
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
