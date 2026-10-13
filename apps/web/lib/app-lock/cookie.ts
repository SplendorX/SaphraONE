import {
  createSignedToken,
  readSignedToken,
  sessionWallets,
  type WalletTokenPayload,
} from "@/lib/wallet-session";

/**
 * The app-lock pass. A session whose token carries `appLock` can only call
 * the API while this signed cookie is valid for one of its wallets. It lasts
 * the user's auto-lock time and the open app renews it while it is on screen,
 * so leaving the app for longer locks it. No database access here: the proxy
 * checks it on every API call.
 */
export const appUnlockCookieName = "saphra_app_unlock";

export const appLockTimeouts = [1, 5, 15] as const;
/**
 * Extra life on the pass past the auto-lock time. The app itself locks on
 * time when it comes back (and drops the pass); this only keeps a renewal
 * that was late or lost (a frozen phone tab, a network blip) from locking an
 * app that is open and in use.
 */
export const appUnlockGraceMs = 2 * 60_000;
export type AppLockTimeout = (typeof appLockTimeouts)[number];

type UnlockPayload = {
  expiresAt: string;
  timeoutMinutes: number;
  type: "app-unlock";
  wallet: string;
};

export function createUnlockToken(wallet: string, timeoutMinutes: number) {
  const payload: UnlockPayload = {
    expiresAt: new Date(Date.now() + timeoutMinutes * 60_000 + appUnlockGraceMs).toISOString(),
    timeoutMinutes,
    type: "app-unlock",
    wallet: wallet.toLowerCase(),
  };
  return createSignedToken(payload);
}

export function readUnlockToken(token: string | undefined) {
  const payload = readSignedToken(token) as Partial<UnlockPayload> | null;
  if (
    !payload ||
    payload.type !== "app-unlock" ||
    typeof payload.wallet !== "string" ||
    typeof payload.expiresAt !== "string" ||
    typeof payload.timeoutMinutes !== "number" ||
    Date.parse(payload.expiresAt) <= Date.now()
  ) {
    return null;
  }
  return payload as UnlockPayload;
}

/** True when the session needs an unlock and the pass is missing or stale. */
export function isSessionLocked(
  session: WalletTokenPayload | null,
  unlockToken: string | undefined,
) {
  if (!session?.appLock) return false;
  const unlock = readUnlockToken(unlockToken);
  return !unlock || !sessionWallets(session).includes(unlock.wallet);
}
