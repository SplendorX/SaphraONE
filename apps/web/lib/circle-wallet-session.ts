import { secureCookieFor } from "@/lib/secure-cookie";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { appLockForSession } from "@/lib/app-lock/server";
import { listWalletAddressesForUserToken } from "@/lib/circle-user-server";
import { mfaPendingForSignIn } from "@/lib/two-factor/server";
import { platformAccessCookieName } from "@/lib/platform-access";
import { walletAuthSessionTtlMs } from "@/lib/wallet-auth";
import {
  createWalletSession,
  createWalletToken,
  readWalletToken,
  sessionWallets,
  walletSessionCookieName,
} from "@/lib/wallet-session";



/**
 * Exchange a Circle user token for SaphraONE's signed wallet session.
 *
 * Only wallets Circle itself reports for the token are added, never an
 * address the browser names, so the session proves control of each wallet.
 * An existing session keeps its wallets and its owner (the wallet the user
 * signed in with) only when the token is for the same account; a different
 * account replaces the session. Returns null when the token controls no
 * wallet, e.g. it expired, so callers can treat the exchange as best-effort.
 *
 * `freshSignIn` is true only when the browser had no session: a Circle token
 * is kept in the browser, so exchanging it again must never open an app
 * lock. Opening one takes the PIN, a passkey, or signing out and back in.
 */
export async function createCircleWalletSession(userToken: string) {
  const wallets = await listWalletAddressesForUserToken(userToken);
  if (wallets.length === 0) {
    return null;
  }

  const cookieStore = await cookies();
  const previous = readWalletToken(
    cookieStore.get(walletSessionCookieName)?.value,
    "session",
  );
  // Only the same account carries its session forward. A different account
  // signing in on this device starts a new one: keeping the previous owner
  // made the app lock greet, and unlock, the wrong account.
  const lowerWallets = wallets.map((wallet) => wallet.toLowerCase());
  const carried =
    previous &&
    [previous.ownerWallet.toLowerCase(), ...sessionWallets(previous)].some((wallet) =>
      lowerWallets.includes(wallet),
    )
      ? previous
      : null;
  const appLock = await appLockForSession([
    ...(carried ? [carried.ownerWallet, ...sessionWallets(carried)] : []),
    ...wallets,
  ]);
  const session = createWalletSession(
    wallets[0],
    { connectorName: "Circle" },
    {
      additionalWallets: wallets.slice(1),
      ...(appLock.known ? { appLock: Boolean(appLock.lock) } : {}),
      keepPreviousOwner: true,
      mfaPending: await mfaPendingForSignIn(carried, wallets),
      previous: carried,
    },
  );
  return {
    freshSignIn: !previous,
    /** A different account than the session held (or none): worth a sign-in email. */
    newAccount: !carried,
    lock: appLock.lock,
    session,
    token: createWalletToken(session),
    wallets,
  };
}

export async function setWalletSessionCookies(response: NextResponse, token: string) {
  const secure = await secureCookieFor();
  response.cookies.set(walletSessionCookieName, token, {
    httpOnly: true,
    maxAge: Math.floor(walletAuthSessionTtlMs / 1000),
    path: "/",
    sameSite: "lax",
    secure,
  });
  response.cookies.set(platformAccessCookieName, "1", {
    httpOnly: false,
    maxAge: Math.floor(walletAuthSessionTtlMs / 1000),
    path: "/",
    sameSite: "lax",
    secure,
  });
}
