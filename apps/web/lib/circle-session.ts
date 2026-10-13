"use client";

import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

import { isArcMainnet } from "@/lib/network";
import { type ArcTokenSymbol } from "@/lib/tokens";
import { withApproval } from "@/lib/tx-approval/client";
import {
  clearPlatformProfileConnected,
  markPlatformProfileConnected,
} from "@/lib/platform-access";

export type CircleOAuthInfo = {
  provider?: string;
  scope?: string[];
  socialUserInfo?: {
    email?: string;
    name?: string;
    phone?: string;
  };
  socialUserUUID?: string;
};

export type CircleLoginResult = {
  encryptionKey: string;
  oAuthInfo?: CircleOAuthInfo;
  refreshToken?: string;
  userToken: string;
};

export type CircleWallet = {
  address?: string;
  blockchain?: string;
  id: string;
  state?: string;
};

export function isArcCircleWallet(wallet: CircleWallet) {
  const chain = wallet.blockchain?.trim().toUpperCase() ?? "";
  return chain === "ARC-TESTNET" || chain === "ARC" || chain.startsWith("ARC");
}

export function preferArcCircleWallets(wallets: CircleWallet[]) {
  const valid = wallets.filter(
    (wallet): wallet is CircleWallet =>
      typeof wallet?.id === "string" && wallet.id.trim().length > 0,
  );
  const arc = valid.filter(isArcCircleWallet);
  const rest = valid.filter((wallet) => !isArcCircleWallet(wallet));
  return [...arc, ...rest];
}

export type CircleTokenBalance = {
  amount?: string;
  token?: {
    id?: string;
    name?: string;
    symbol?: string;
  };
};

export type CircleClientErrorPayload = {
  code?: number | string;
  error?: string;
  message?: string;
};

export class CircleClientError extends Error {
  code?: number | string;

  constructor(payload: CircleClientErrorPayload, fallback: string) {
    super(payload.message ?? payload.error ?? fallback);
    this.code = payload.code;
  }
}

export const circleSessionEventName = "saphra:circle-session";

// Circle's test and live environments issue separate device tokens, logins
// and wallets, so each network keeps its own. A testnet session saved in the
// browser must never be replayed against Circle's live environment. Testnet
// keeps the original key names so existing testnet sessions carry on.
const circleKeyPrefix = isArcMainnet() ? "saphra.circle.mainnet" : "saphra.circle";

export const circleStorageKeys = {
  deviceEncryptionKey: `${circleKeyPrefix}.deviceEncryptionKey`,
  deviceId: `${circleKeyPrefix}.deviceId`,
  deviceToken: `${circleKeyPrefix}.deviceToken`,
  login: `${circleKeyPrefix}.login`,
  setupIntent: `${circleKeyPrefix}.setupIntent`,
  enterApp: `${circleKeyPrefix}.enterApp`,
  wallets: `${circleKeyPrefix}.wallets`,
};

const circleOAuthStorageKeys = ["socialLoginProvider", "state", "nonce"];

function notifyCircleSessionChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(circleSessionEventName));
}

export function readCircleSessionStorage(key: string) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const sessionVal = window.sessionStorage.getItem(key);
    if (sessionVal) return sessionVal;
  } catch {}

  try {
    const localVal = window.localStorage.getItem(key);
    if (localVal) return localVal;
  } catch {}

  try {
    const cookieMatch = document.cookie.match(
      new RegExp(`(?:^|; )${encodeURIComponent(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
    );
    if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
  } catch {}

  return "";
}

export function writeCircleSessionStorage(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(key, value);
  } catch {}

  try {
    window.localStorage.setItem(key, value);
  } catch {}

  try {
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; max-age=86400; SameSite=Lax`;
  } catch {}
}

export function removeCircleSessionStorage(key: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(key);
  } catch {}

  try {
    window.localStorage.removeItem(key);
  } catch {}

  try {
    document.cookie = `${encodeURIComponent(key)}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  } catch {}
}

export function readCircleLogin() {
  const raw = readCircleSessionStorage(circleStorageKeys.login);

  if (!raw) {
    return null;
  }

  try {
    const login = JSON.parse(raw) as Partial<CircleLoginResult>;

    return login.userToken && login.encryptionKey
      ? ({
          ...login,
          encryptionKey: login.encryptionKey,
          userToken: login.userToken,
        } satisfies CircleLoginResult)
      : null;
  } catch {
    return null;
  }
}

export function writeCircleLogin(login: CircleLoginResult) {
  writeCircleSessionStorage(circleStorageKeys.login, JSON.stringify(login));
  markPlatformProfileConnected();
  notifyCircleSessionChanged();
}

export function readCircleWallets() {
  const raw = readCircleSessionStorage(circleStorageKeys.wallets);

  if (!raw) {
    return [];
  }

  try {
    const wallets = JSON.parse(raw) as CircleWallet[];

    return Array.isArray(wallets) ? preferArcCircleWallets(wallets) : [];
  } catch {
    return [];
  }
}

export function writeCircleWallets(wallets: CircleWallet[]) {
  writeCircleSessionStorage(
    circleStorageKeys.wallets,
    JSON.stringify(preferArcCircleWallets(wallets)),
  );
  notifyCircleSessionChanged();
}

export function clearCircleSession(options: { clearDevice?: boolean } = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const clearDevice = options.clearDevice ?? true;
  removeCircleSessionStorage(circleStorageKeys.login);
  removeCircleSessionStorage(circleStorageKeys.setupIntent);
  removeCircleSessionStorage(circleStorageKeys.enterApp);
  removeCircleSessionStorage(circleStorageKeys.wallets);

  if (clearDevice) {
    removeCircleSessionStorage(circleStorageKeys.deviceEncryptionKey);
    removeCircleSessionStorage(circleStorageKeys.deviceId);
    removeCircleSessionStorage(circleStorageKeys.deviceToken);
  }

  circleOAuthStorageKeys.forEach((key) => {
    removeCircleSessionStorage(key);
  });

  try {
    window.localStorage.removeItem("saphra.activeWorkspaceId");
    window.localStorage.removeItem("saphra.preferredWalletMode");
    window.localStorage.removeItem("saphra.greetingName");
    window.localStorage.removeItem("saphra.profileCache");
    window.localStorage.removeItem("saphra.accountCache");
  } catch {}

  clearPlatformProfileConnected();
  notifyCircleSessionChanged();
}

export function getCircleLoginIdentity(login?: CircleLoginResult | null) {
  const userInfo = login?.oAuthInfo?.socialUserInfo;

  return {
    email: userInfo?.email,
    name: userInfo?.name,
    provider: login?.oAuthInfo?.provider ?? "Google",
    socialUserUUID: login?.oAuthInfo?.socialUserUUID,
  };
}

/**
 * The email a Google or email sign-in was made with, or null for external
 * wallets. Used to pre-fill a business's contact email.
 */
export function readSignInEmail() {
  if (typeof window === "undefined") return null;
  const email = getCircleLoginIdentity(readCircleLogin()).email?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function shortenCircleAddress(value?: string, fallback = "Not connected") {
  if (!value) {
    return fallback;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/**
 * Circle PIN SDK codes whose own text ("Network error") does not tell the
 * user what happened. The challenge failed before signing, so nothing moved.
 */
const circleSdkMessages: Record<string, string> = {
  "155701": "You cancelled in your wallet — nothing was sent.",
  "155706":
    "Couldn't reach Circle to confirm this payment. Nothing was sent. Check your connection and try again.",
};

export function friendlyCircleSdkMessage(error: unknown) {
  const code =
    typeof error === "object" && error !== null
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return circleSdkMessages[code] ?? null;
}

/** The raw text of an error, whatever shape it arrived in. */
function rawErrorMessage(error: unknown) {
  if (error instanceof Error) {
    // viem errors carry a dump ("Request Arguments: … Version: viem@…") in
    // .message; the human part is in .details, or deepest in the cause chain.
    const viem = error as Error & { details?: unknown; cause?: unknown };
    if (typeof viem.details === "string" && viem.details.trim()) return viem.details;
    let cause = viem.cause;
    for (let depth = 0; depth < 5 && cause instanceof Error; depth += 1) {
      const next = (cause as Error & { cause?: unknown }).cause;
      if (!(next instanceof Error)) return cause.message;
      cause = next;
    }
    return error.message;
  }
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const payload = error as CircleClientErrorPayload;
    return payload.message ?? payload.error ?? "";
  }
  return "";
}

/** Messages that are for developers, not people: never shown as-is. */
function looksTechnical(message: string) {
  return (
    message.length > 220 ||
    /[{}[\]]|\bat \w+ \(|0x[0-9a-f]{16,}|\b(?:undefined|null|NaN|TypeError|ReferenceError|stack|payload|RPC|ECONN\w*|ETIMEDOUT)\b/i.test(message) ||
    /^\s*\d{3,}\b/.test(message)
  );
}

/**
 * Turns any wallet or Circle error into something a person can act on.
 * Error codes ("[155701]") never reach the screen: a cancel reads as a
 * cancel, a network blip as a network blip, and anything technical falls
 * back to the caller's plain message.
 */
export function userFacingErrorMessage(error: unknown, fallback: string) {
  const friendly = friendlyCircleSdkMessage(error);
  if (friendly) return friendly;
  if (isCircleDeviceIdError(error)) {
    markCircleSessionStale();
    return circleDeviceIdHelp;
  }
  // Already worded for the person (e.g. how to add Arc to a wallet).
  if (error instanceof Error && error.name === "ArcNetworkError") return error.message;

  // Strip "[155701]" / "Error:" prefixes and keep the first line only.
  const message = rawErrorMessage(error)
    .split("\n")[0]
    .replace(/^\s*\[\w+\]\s*/, "")
    .replace(/^\s*(?:Error|CircleError|Uncaught)\s*:\s*/i, "")
    .trim();

  if (/still confirming|did not return a hash in time/i.test(message)) {
    return "Your transfer was submitted and is still confirming. Your balance will update shortly — no need to send it again.";
  }
  if (/\b(?:user\s+)?(?:cancel+ed|canceled|rejected|denied|dismissed|closed)\b|user rejected|request rejected/i.test(message)) {
    return "You cancelled in your wallet — nothing was sent.";
  }
  if (/\b(?:network|failed to fetch|timeout|timed out|offline|connection)\b/i.test(message)) {
    return "Couldn't reach the network. Check your connection and try again — nothing was sent.";
  }
  if (/insufficient (?:funds|balance)|exceeds balance/i.test(message)) {
    return "There isn't enough balance for this, including fees.";
  }
  if (/\b(?:gas|fee)\b.*\b(?:too low|insufficient|estimate)/i.test(message)) {
    return "The network fee couldn't be covered. Add a little USDC for gas and try again.";
  }
  if (/(?:session|token)\b.*\b(?:expired|invalid)\b|\b(?:expired|invalid)\b.*(?:session|login|token)/i.test(message)) {
    return "Your session expired. Sign in again to continue.";
  }
  if (!message || looksTechnical(message)) return fallback;
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function getCircleErrorMessage(error: unknown, fallback: string) {
  return userFacingErrorMessage(error, fallback);
}



/** Circle's answer when its device record doesn't match this browser. */
export function isCircleDeviceIdError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown } | null)?.message ?? error ?? "");
  return /device id is not found|device ?id.*not found/i.test(message);
}

export const circleDeviceIdHelp =
  "Circle needs to verify this device again. Nothing was sent. You'll be signed out the next time you open SaphraONE; sign back in and try again.";

const staleSessionKey = "saphra.circleSessionStale";
/** Set just before the automatic sign-out, so sign-in can say why. */
export const circleSignedOutNoticeKey = "saphra.signedOutNotice";

/**
 * Circle can no longer use this sign-in on this device (its device record is
 * gone, or the session couldn't be renewed). Signing in again is the only
 * fix, so the next time the app opens it signs out (see StaleCircleSessionGuard).
 */
export function markCircleSessionStale() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(staleSessionKey, String(Date.now()));
  } catch {}
}

export function isCircleSessionStale() {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(staleSessionKey));
  } catch {
    return false;
  }
}

export function clearCircleSessionStale() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(staleSessionKey);
  } catch {}
}

export function currentCircleAuth(fallback: { encryptionKey: string; userToken: string }) {
  const stored = readCircleLogin();
  return {
    encryptionKey: stored?.encryptionKey ?? fallback.encryptionKey,
    userToken: stored?.userToken ?? fallback.userToken,
  };
}

/** Circle's "user token expired" error code. */
export const circleUserTokenExpiredCode = "155104";

/**
 * Circle rejected the user token itself: expired (155104), invalid (155105),
 * or a plain 401 "Invalid credentials." (e.g. an older token after renewal).
 */
function isCircleUserTokenRejected(error: unknown) {
  const payload = error as { code?: number | string; message?: string } | null;
  const code = String(payload?.code ?? "");
  return (
    code === "155104" ||
    code === "155105" ||
    code === "401" ||
    /userToken (had expired|is invalid)|invalid credentials/i.test(payload?.message ?? "")
  );
}

export function isCircleUserTokenExpired(error: unknown) {
  const payload = error as { code?: number | string; message?: string } | null;
  return (
    String(payload?.code ?? "") === circleUserTokenExpiredCode ||
    /userToken had expired/i.test(payload?.message ?? "")
  );
}

let refreshInFlight: Promise<CircleLoginResult | null> | null = null;
/**
 * Tokens this page replaced by renewing them. A request that still carries
 * one may be retried with the current stored token; any other token (e.g. a
 * brand-new login not stored yet) is never swapped for someone else's.
 */
const supersededUserTokens = new Set<string>();

/**
 * Renew an expired Circle user token (they last about an hour) and store the
 * new login, so the user is not sent back to sign in. Google logins use
 * Circle's refresh token; email logins ask the server, which re-issues the
 * token only to a browser whose signed session covers that user's wallet.
 * Concurrent callers share one refresh. Resolves null if it cannot renew.
 */
/**
 * Why the last renewal failed: Circle (or our server) refused it, or there is
 * nothing to renew with, versus a network blip. Only a refusal means the
 * person must sign in again.
 */
let lastRefreshRefused = false;

/**
 * Renew a login. Email logins ask the server; Google logins trade their
 * refresh token with Circle for the given device. Sets lastRefreshRefused.
 */
async function renewCircleLogin(
  login: CircleLoginResult,
  deviceId: string,
): Promise<CircleLoginResult | null> {
  try {
    const circleUserId = login.oAuthInfo?.socialUserUUID;
    if (login.oAuthInfo?.provider === "Email" && circleUserId) {
      const response = await fetch("/api/auth/email", {
        body: JSON.stringify({ action: "refresh", circleUserId }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        lastRefreshRefused = response.status >= 400 && response.status < 500;
        return null;
      }
      const next = (await response.json()) as { encryptionKey?: string; userToken?: string };
      if (!next.userToken || !next.encryptionKey) return null;
      const renewed = { ...login, encryptionKey: next.encryptionKey, userToken: next.userToken };
      supersededUserTokens.add(login.userToken);
      writeCircleLogin(renewed);
      return renewed;
    }

    if (!login.refreshToken || !deviceId) {
      lastRefreshRefused = true;
      return null;
    }
    const next = await callCircleWalletApiOnce<{
      encryptionKey?: string;
      refreshToken?: string;
      userToken?: string;
    }>("refreshUserToken", {
      deviceId,
      refreshToken: login.refreshToken,
      userToken: login.userToken,
    });
    if (!next.userToken || !next.encryptionKey) return null;
    const renewed: CircleLoginResult = {
      ...login,
      encryptionKey: next.encryptionKey,
      refreshToken: next.refreshToken ?? login.refreshToken,
      userToken: next.userToken,
    };
    supersededUserTokens.add(login.userToken);
    writeCircleLogin(renewed);
    return renewed;
  } catch (error) {
    // A network error (TypeError) is a blip; anything else is Circle's no.
    lastRefreshRefused = !(error instanceof TypeError);
    return null;
  }
}

export function refreshCircleLogin(): Promise<CircleLoginResult | null> {
  if (refreshInFlight) return refreshInFlight;

  lastRefreshRefused = false;
  refreshInFlight = (async () => {
    const login = readCircleLogin();
    if (!login) return null;

    const storedDeviceId = readCircleSessionStorage(circleStorageKeys.deviceId);
    const renewed = await renewCircleLogin(login, storedDeviceId);
    if (renewed || !lastRefreshRefused) return renewed;

    // Circle refused the device this page remembers. Its frame may hold a
    // different one by now (phones lose it when the app restarts): try that.
    const currentDeviceId = await readCircleDeviceId();
    if (!currentDeviceId || currentDeviceId === storedDeviceId) return null;
    lastRefreshRefused = false;
    const rebound = await renewCircleLogin(login, currentDeviceId);
    if (rebound) writeCircleSessionStorage(circleStorageKeys.deviceId, currentDeviceId);
    return rebound;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/**
 * The device ID Circle's frame holds right now, or null if it cannot be
 * asked. The SDK is one instance per page, so this reaches the page's own.
 */
export async function readCircleDeviceId(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim();
  if (!appId) return null;
  try {
    const { W3SSdk: CircleW3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
    const sdk = new CircleW3SSdk({ appSettings: { appId } });
    // The SDK only times out its own request while its frame has never
    // answered; after that a silent frame would hang it forever.
    const deviceId = await Promise.race([
      sdk.getDeviceId(),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 15_000)),
    ]);
    return deviceId || null;
  } catch {
    return null;
  }
}

/**
 * Circle no longer recognises this device: its frame's device ID is not the
 * one the login was made on (phones drop it when the app restarts). Renew the
 * login on the device ID the frame holds now. Resolves the renewed login, or
 * null when Circle refuses, in which case signing in again is the only way.
 */
export async function rebindCircleLoginToDevice(): Promise<CircleLoginResult | null> {
  const login = readCircleLogin();
  if (!login) return null;
  const deviceId = await readCircleDeviceId();
  if (!deviceId) return null;
  const renewed = await renewCircleLogin(login, deviceId);
  if (renewed) writeCircleSessionStorage(circleStorageKeys.deviceId, deviceId);
  return renewed;
}

/**
 * Run a Circle challenge (PIN or confirmation screen) for a login. If Circle
 * answers "device ID is not found", the login is renewed on the device ID
 * the frame holds now and the challenge is asked once more; if that is
 * refused, the session is marked stale (signed out on the next open) and the
 * original error is thrown. Any other error is thrown as the SDK gave it.
 */
export async function executeCircleChallenge(
  sdk: W3SSdk,
  login: { encryptionKey: string; userToken: string },
  challengeId: string,
): Promise<unknown> {
  const run = (auth: { encryptionKey: string; userToken: string }) =>
    new Promise<unknown>((resolve, reject) => {
      sdk.setAuthentication(auth);
      sdk.execute(challengeId, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });

  try {
    return await run(currentCircleAuth(login));
  } catch (error) {
    if (!isCircleDeviceIdError(error)) throw error;
    // The SDK leaves its frame up after an error; a retry re-adds it.
    document.getElementById("sdkIframe")?.remove();
    const renewed = await rebindCircleLoginToDevice();
    if (!renewed) {
      markCircleSessionStale();
      throw error;
    }
    return run({ encryptionKey: renewed.encryptionKey, userToken: renewed.userToken });
  }
}

/**
 * Call the Circle user-wallets API. If the user token has expired, renew it
 * once and retry with the new token, so long sessions keep working.
 */
export async function callCircleWalletApi<T>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T & CircleClientErrorPayload> {
  // Money-moving calls carry SaphraONE's own confirmation (lib/tx-approval).
  params = await withApproval(action, params);
  try {
    return await callCircleWalletApiOnce<T>(action, params);
  } catch (error) {
    if (!isCircleUserTokenRejected(error) || typeof params.userToken !== "string") {
      throw error;
    }
    // The page passed a token captured earlier, but the stored login has
    // since been renewed: use the current one.
    const stored = readCircleLogin();
    if (
      stored?.userToken &&
      stored.userToken !== params.userToken &&
      supersededUserTokens.has(params.userToken)
    ) {
      return callCircleWalletApiOnce<T>(action, { ...params, userToken: stored.userToken });
    }
    if (!isCircleUserTokenExpired(error)) {
      throw error;
    }
    const renewed = await refreshCircleLogin();
    if (!renewed) {
      // Circle refused to renew it: sign in again on the next open.
      if (lastRefreshRefused) markCircleSessionStale();
      throw new CircleClientError(
        { code: circleUserTokenExpiredCode, message: "Your Circle session expired. Sign in again to continue." },
        "Your Circle session expired.",
      );
    }
    return callCircleWalletApiOnce<T>(action, { ...params, userToken: renewed.userToken });
  }
}

async function callCircleWalletApiOnce<T>(
  action: string,
  params: Record<string, unknown> = {},
) {
  const response = await fetch("/api/circle/user-wallets", {
    body: JSON.stringify({
      action,
      ...params,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const text = await response.text();
  let payload: T & CircleClientErrorPayload;

  try {
    payload = text
      ? (JSON.parse(text) as T & CircleClientErrorPayload)
      : ({} as T & CircleClientErrorPayload);
  } catch {
    payload = {
      message: text || "Circle wallet request returned a non-JSON response.",
    } as T & CircleClientErrorPayload;
  }

  if (!response.ok) {
    throw new CircleClientError(
      { ...payload, code: payload.code ?? response.status },
      "Circle wallet request failed.",
    );
  }

  return payload;
}

export function findCircleTokenBalance(
  balances: CircleTokenBalance[],
  symbol: ArcTokenSymbol,
) {
  return balances.find((balance) => {
    const tokenSymbol = balance.token?.symbol?.toUpperCase();
    const tokenName = balance.token?.name?.toUpperCase();

    return tokenSymbol === symbol || tokenName?.includes(symbol);
  });
}
