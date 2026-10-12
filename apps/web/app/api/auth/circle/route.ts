import { after, NextResponse, type NextRequest } from "next/server";

import {
  createCircleWalletSession,
  setWalletSessionCookies,
} from "@/lib/circle-wallet-session";
import { setUnlockCookie } from "@/lib/app-lock/server";
import { readJsonRecord } from "@/lib/http";
import { sessionWallets } from "@/lib/wallet-session";
import { consumeRateLimit } from "@/lib/rate-limit";
import { notifySignIn } from "@/lib/security/sign-in-alert";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

// Each call costs a Circle round trip; limited per IP across all instances.
const windowSeconds = 60;
const maxPerWindow = 20;

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { headers: noStore, status });
}

/** Browsers always send Origin on POST; refuse other sites' pages. */
function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

/**
 * Exchange the Circle user token held by a Google or email user for the
 * signed wallet session, so server checks never have to trust a Circle
 * identity string sent by the browser.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return jsonError("Cross-site requests are not allowed.", 403);
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!(await consumeRateLimit(`auth-circle:${ip}`, maxPerWindow, windowSeconds))) {
    return jsonError("Too many session requests. Try again in a minute.", 429);
  }

  const body = await readJsonRecord(request);
  const userToken =
    typeof body?.userToken === "string" ? body.userToken.trim() : "";
  if (!userToken) {
    return jsonError("A Circle user token is required.", 400);
  }

  try {
    const issued = await createCircleWalletSession(userToken);
    if (!issued) {
      return jsonError("Your Circle session expired. Sign in again.", 401);
    }
    const response = NextResponse.json(
      {
        authenticated: true,
        authMethod: "circle_user_token",
        expiresAt: issued.session.expiresAt,
        ownerWallet: issued.session.ownerWallet,
        wallets: sessionWallets(issued.session),
      },
      { headers: noStore },
    );
    await setWalletSessionCookies(response, issued.token);
    if (issued.lock && issued.freshSignIn) {
      await setUnlockCookie(response, issued.lock.owner_wallet, issued.lock.timeout_minutes);
    }
    // Never opens the lock on an account switch: this endpoint also runs on
    // page load with a stored token. The email is safe either way.
    if (issued.newAccount) {
      // "You signed in" email, after the response so signing in never waits.
      const ownerWallet = issued.session.ownerWallet;
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
    return response;
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Circle session could not be verified.",
      502,
    );
  }
}
