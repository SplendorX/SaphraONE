import { secureCookieFor } from "@/lib/secure-cookie";
import { cookies } from "next/headers";
import { after, NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  circleUserIdForSupabaseUser,
  createEmailSessionToken,
  emailSessionCookieName,
  emailSessionTtlMs,
  issueCircleUserToken,
  legacyGoogleWalletForEmail,
  listCircleUserWalletAddresses,
  normalizeEmail,
  readEmailSession,
  sendEmailCode,
  unifiedGoogleSignInEnabled,
  circleGoogleUserHasWallet,
  supabaseUserIdForEmail,
  verifyEmailCode,
  verifyGoogleIdToken,
} from "@/lib/email-auth-server";
import { readJsonRecord } from "@/lib/http";
import { sessionControlsWallet } from "@/lib/recurring-auth";
import { platformAccessCookieName } from "@/lib/platform-access";
import { walletAuthSessionTtlMs } from "@/lib/wallet-auth";
import {
  createWalletSession,
  createWalletToken,
  readWalletToken,
  sessionWallets,
  walletSessionCookieName,
} from "@/lib/wallet-session";
import { appLockForSession, setUnlockCookie } from "@/lib/app-lock/server";
import { mfaPendingForSignIn } from "@/lib/two-factor/server";
import { notifySignIn, saveVerifiedContactEmail } from "@/lib/security/sign-in-alert";

export const runtime = "nodejs";


const noStore = { "Cache-Control": "no-store" };

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { headers: noStore, status });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Open the email account's wallet: a Circle user token for the browser's PIN
 * screen, and the short-lived cookie `complete` turns into a wallet session.
 */
async function openEmailWallet(circleUserId: string, email: string) {
  const circle = await issueCircleUserToken(circleUserId);
  const response = NextResponse.json({ circleUserId, email, ...circle }, { headers: noStore });
  response.cookies.set(emailSessionCookieName, createEmailSessionToken({ circleUserId, email }), {
    httpOnly: true,
    maxAge: Math.floor(emailSessionTtlMs / 1000),
    path: "/",
    sameSite: "lax",
    secure: await secureCookieFor(),
  });
  return response;
}

/**
 * Email sign-in for SaphraONE, backed by Supabase Auth and a Circle
 * user-controlled wallet:
 *   start    → Supabase emails a 6-digit code
 *   verify   → code checked; a Circle user token is issued for the PIN wallet
 *   complete → the wallet is checked against that Circle user, then the same
 *              wallet session an external wallet signature earns is issued
 *   google   → with unified Google sign-in on: after Circle's Google login,
 *              a new Google user opens the same wallet as the emailed code
 *              for that address instead of a Google-only one (see
 *              unifiedGoogleSignInEnabled)
 */
export async function POST(request: NextRequest) {
  const body = await readJsonRecord(request);
  if (!body) {
    return jsonError("A valid JSON body is required.", 400);
  }

  if (body.action === "start") {
    const email = normalizeEmail(body.email);
    if (!email) {
      return jsonError("Enter a valid email address.", 400);
    }
    try {
      await sendEmailCode(email);
      return NextResponse.json({ sent: true }, { headers: noStore });
    } catch (error) {
      return jsonError(errorMessage(error, "The sign-in code could not be sent."), 400);
    }
  }

  if (body.action === "verify") {
    const email = normalizeEmail(body.email);
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    if (!email || !/^\d{6,10}$/.test(code)) {
      return jsonError("Enter the code from your email.", 400);
    }

    let circleUserId: string;
    try {
      circleUserId = circleUserIdForSupabaseUser(await verifyEmailCode(email, code));
    } catch (error) {
      return jsonError(errorMessage(error, "That code could not be verified."), 401);
    }

    try {
      // No second account for an address that signed up with the old Google
      // login: send them there, unless this email account already has a wallet.
      if (unifiedGoogleSignInEnabled() && (await legacyGoogleWalletForEmail(email))) {
        const owned = await listCircleUserWalletAddresses(circleUserId);
        if (owned.length === 0) {
          return NextResponse.json(
            {
              message: "This email already has a SaphraONE account that signs in with Google. Continue with Google to open it.",
              useGoogle: true,
            },
            { headers: noStore, status: 409 },
          );
        }
      }
      return await openEmailWallet(circleUserId, email);
    } catch (error) {
      return jsonError(errorMessage(error, "Your wallet could not be opened."), 502);
    }
  }

  if (body.action === "google") {
    if (!unifiedGoogleSignInEnabled()) {
      return jsonError("Unified Google sign-in isn't turned on.", 404);
    }
    const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
    const circleUserToken = typeof body.circleUserToken === "string" ? body.circleUserToken.trim() : "";
    if (!idToken || !circleUserToken) {
      return jsonError("Your Google sign-in couldn't be verified. Try again.", 400);
    }

    let email: string;
    try {
      email = await verifyGoogleIdToken(idToken, typeof body.nonce === "string" ? body.nonce : null);
    } catch (error) {
      return jsonError(errorMessage(error, "Your Google sign-in couldn't be verified."), 401);
    }

    try {
      // Made with the old Google sign-in: keep opening that wallet.
      if (await circleGoogleUserHasWallet(circleUserToken)) {
        return NextResponse.json({ email, legacyGoogle: true }, { headers: noStore });
      }
      return await openEmailWallet(circleUserIdForSupabaseUser(await supabaseUserIdForEmail(email)), email);
    } catch (error) {
      return jsonError(errorMessage(error, "Your wallet could not be opened."), 502);
    }
  }

  if (body.action === "complete") {
    const cookieStore = await cookies();
    const session = readEmailSession(cookieStore.get(emailSessionCookieName)?.value);
    if (!session) {
      return jsonError("Your email sign-in expired. Enter your email again.", 401);
    }
    if (typeof body.walletAddress !== "string" || !isAddress(body.walletAddress)) {
      return jsonError("A valid wallet address is required.", 400);
    }
    const ownerWallet = getAddress(body.walletAddress);

    try {
      const owned = await listCircleUserWalletAddresses(session.circleUserId);
      if (!owned.includes(ownerWallet.toLowerCase())) {
        return jsonError("That wallet does not belong to this email account.", 403);
      }
    } catch (error) {
      return jsonError(errorMessage(error, "Your wallet could not be verified."), 502);
    }

    await saveVerifiedContactEmail(ownerWallet, session.email);

    const previous = readWalletToken(
      cookieStore.get(walletSessionCookieName)?.value,
      "session",
    );
    if (!previous) {
      // "You signed in" email, after the response so signing in never waits.
      const headers = new Headers(request.headers);
      after(() =>
        notifySignIn({
          headers,
          host: request.nextUrl.host,
          origin: request.nextUrl.origin,
          ownerWallet,
        }),
      );
    }
    const appLock = await appLockForSession([
      ownerWallet,
      ...(previous ? sessionWallets(previous) : []),
    ]);
    const walletSession = createWalletSession(
      ownerWallet,
      { connectorName: "Email" },
      {
        ...(appLock.known ? { appLock: Boolean(appLock.lock) } : {}),
        mfaPending: await mfaPendingForSignIn(previous, [ownerWallet]),
        previous,
      },
    );
    const response = NextResponse.json(
      { authenticated: true, email: session.email, ownerWallet },
      { headers: noStore },
    );
    response.cookies.set(walletSessionCookieName, createWalletToken(walletSession), {
      httpOnly: true,
      maxAge: Math.floor(walletAuthSessionTtlMs / 1000),
      path: "/",
      sameSite: "lax",
      secure: await secureCookieFor(),
    });
    response.cookies.set(platformAccessCookieName, "1", {
      httpOnly: false,
      maxAge: Math.floor(walletAuthSessionTtlMs / 1000),
      path: "/",
      sameSite: "lax",
      secure: await secureCookieFor(),
    });
    response.cookies.delete(emailSessionCookieName);
    if (appLock.lock) {
      await setUnlockCookie(response, appLock.lock.owner_wallet, appLock.lock.timeout_minutes);
    }
    return response;
  }

  // An email user's Circle token expires after about an hour, and there is no
  // Circle refresh token for server-issued tokens. Re-issue it, but only to a
  // browser whose signed session already covers one of that user's wallets.
  if (body.action === "refresh") {
    const circleUserId =
      typeof body.circleUserId === "string" ? body.circleUserId.trim() : "";
    if (!/^sp-email-[0-9a-f-]{36}$/i.test(circleUserId)) {
      return jsonError("A valid email wallet id is required.", 400);
    }
    try {
      const owned = await listCircleUserWalletAddresses(circleUserId);
      const covered = await Promise.all(owned.map((wallet) => sessionControlsWallet(wallet)));
      if (!covered.some(Boolean)) {
        return jsonError("Sign in again to continue.", 401);
      }
      const circle = await issueCircleUserToken(circleUserId);
      return NextResponse.json({ circleUserId, ...circle }, { headers: noStore });
    } catch (error) {
      return jsonError(errorMessage(error, "Your wallet session could not be renewed."), 502);
    }
  }

  return jsonError("Unsupported email sign-in action.", 400);
}
