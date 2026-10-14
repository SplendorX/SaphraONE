"use client";

import { clearCircleSession } from "@/lib/circle-session";
import { platformAccessCookieName, clearActivatedExternalProfile } from "@/lib/platform-access";
import { endWalletSession } from "@/lib/wallet-auth-client";

/** Payment security: whether a PIN is set, and how many Face ID / fingerprint devices. */
export type AppLockStatus = {
  enabled: boolean;
  passkeys?: number;
  pausedUntil?: string | null;
  signedIn: boolean;
};

export class AppLockError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: {
      attemptsLeft?: number;
      pausedUntil?: string;
      signedOut?: boolean;
    } = {},
  ) {
    super(message);
  }
}

export function hasSignedInCookie() {
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(`${platformAccessCookieName}=`));
}

export async function fetchAppLockStatus(): Promise<AppLockStatus> {
  const response = await fetch("/api/app-lock", { cache: "no-store", credentials: "include" });
  if (!response.ok) throw new AppLockError("Payment security couldn't be checked.", response.status);
  return (await response.json()) as AppLockStatus;
}

export async function postAppLock<T = Record<string, unknown>>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/api/app-lock", {
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new AppLockError(
      typeof payload.message === "string" ? payload.message : "Something went wrong.",
      response.status,
      {
        attemptsLeft: typeof payload.attemptsLeft === "number" ? payload.attemptsLeft : undefined,
        pausedUntil: typeof payload.pausedUntil === "string" ? payload.pausedUntil : undefined,
        signedOut: payload.signedOut === true,
      },
    );
  }
  return payload as T;
}

/** What the device calls its biometrics, for button labels. */
export function biometricLabel() {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent)) return "Face ID or Touch ID";
  if (/Macintosh/.test(agent)) return "Touch ID";
  if (/Android/.test(agent)) return "fingerprint or face unlock";
  if (/Windows/.test(agent)) return "Windows Hello";
  return "Face ID or fingerprint";
}

/** Sign out completely, like the profile menu: the way past a forgotten PIN. */
export async function signOutForAppLock(disconnect?: () => void) {
  clearCircleSession({ clearDevice: true });
  clearActivatedExternalProfile();
  try {
    window.localStorage.removeItem("saphra.activeWorkspaceId");
    window.localStorage.removeItem("saphra.preferredWalletMode");
    window.localStorage.removeItem("saphra.greetingName");
    window.localStorage.removeItem("saphra.profileCache");
    window.localStorage.removeItem("saphra.accountCache");
  } catch {}
  await endWalletSession().catch(() => undefined);
  try {
    disconnect?.();
  } catch {}
  window.location.assign("/");
}
