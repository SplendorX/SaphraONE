import { readCircleLogin } from "@/lib/circle-session";

/**
 * Authorization contexts SaphraONE can execute under. "agent" is ALLIE's
 * Agent Wallet — a separate context, never a primary wallet the user picks.
 */
export type WalletMode = "circle" | "external" | "agent";

/** The subset a person can select as their own primary wallet. */
export type PlatformWalletMode = Exclude<WalletMode, "agent">;

export const agentWalletModeKey = "saphra.wallet.agentActive";

export const walletModeEventName = "saphra:wallet-mode";
export const preferredWalletModeKey = "saphra.wallet.preferredMode";

function notifyWalletModeChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.queueMicrotask(() => {
    window.dispatchEvent(new CustomEvent(walletModeEventName));
  });
}

/**
 * One wallet per profile. The wallet follows how the person signed in: a
 * Google or email session always runs on its Circle wallet, anyone else on
 * their connected wallet. There is no switching between the two.
 */
export function readPreferredWalletMode(): PlatformWalletMode | null {
  if (typeof window === "undefined") {
    return null;
  }

  return resolvePlatformWalletMode();
}

export function writePreferredWalletMode(mode: PlatformWalletMode) {
  if (typeof window === "undefined") {
    return;
  }

  const previous = window.localStorage.getItem(preferredWalletModeKey);
  window.localStorage.setItem(preferredWalletModeKey, mode);

  if (previous !== mode) {
    notifyWalletModeChanged();
  }
}

export function resolvePlatformWalletMode(): PlatformWalletMode {
  return readCircleLogin() ? "circle" : "external";
}

/**
 * ALLIE's Agent Wallet is a separate authorization context, not a user wallet.
 * It is only the active mode while an agent wallet is marked active for the
 * session — never as a fallback for the primary wallet.
 */
export function markAgentWalletActive(active: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  const previous = window.localStorage.getItem(agentWalletModeKey);
  const next = active ? "1" : "0";
  window.localStorage.setItem(agentWalletModeKey, next);

  if (previous !== next) {
    notifyWalletModeChanged();
  }
}


