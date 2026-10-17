import "@/lib/env-compat";
import crypto from "node:crypto";

import {
  walletAuthChallengeTtlMs,
  walletAuthSessionTtlMs,
} from "@/lib/wallet-auth";

export const walletChallengeCookieName = "saphra_wallet_challenge";
export const walletSessionCookieName = "saphra_wallet_session";

type WalletTokenType = "challenge" | "session";

export type WalletTokenPayload = {
  /** From when the app locked itself on opening; still read, no longer written or enforced. */
  appLock?: boolean;
  connectorName?: string;
  /**
   * Signed in, but two-factor authentication still needs a code: the API
   * refuses everything but /api/two-factor and /api/auth until it's entered.
   * See lib/two-factor.
   */
  mfaPending?: boolean;
  expiresAt: string;
  issuedAt: string;
  nonce: string;
  ownerWallet: string;
  type: WalletTokenType;
  /**
   * Every wallet this browser has proven control of (lowercased address →
   * expiry), including `ownerWallet`. Lets one session cover e.g. an external
   * wallet and a Circle wallet at once. Absent on sessions issued before
   * multi-wallet support; those cover `ownerWallet` alone.
   */
  wallets?: Record<string, string>;
};

/** Upper bound on wallets one session may carry. */
const maxSessionWallets = 12;

/**
 * Sessions are signed with their own secret. Reusing the Supabase service key
 * or Circle entity secret meant anyone holding either could mint sessions,
 * and rotating them silently signed everyone out. Local `next dev` may still
 * fall back so a fresh checkout runs; every other build refuses.
 */
function getSessionSecret() {
  const secret = process.env.SAPHRA_SESSION_SECRET?.trim();
  if (secret && secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === "development") {
    const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (fallback) return fallback;
  }

  throw new Error(
    "Set SAPHRA_SESSION_SECRET (at least 32 characters, e.g. `openssl rand -hex 32`) for wallet sessions.",
  );
}

function signPayload(encodedPayload: string) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return (
    firstBuffer.length === secondBuffer.length &&
    crypto.timingSafeEqual(firstBuffer, secondBuffer)
  );
}

function isWalletTokenPayload(value: unknown): value is WalletTokenPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.expiresAt === "string" &&
    typeof payload.issuedAt === "string" &&
    typeof payload.nonce === "string" &&
    typeof payload.ownerWallet === "string" &&
    (payload.connectorName === undefined ||
      typeof payload.connectorName === "string") &&
    (payload.appLock === undefined || typeof payload.appLock === "boolean") &&
    (payload.mfaPending === undefined || typeof payload.mfaPending === "boolean") &&
    (payload.wallets === undefined ||
      (typeof payload.wallets === "object" &&
        payload.wallets !== null &&
        Object.values(payload.wallets).every((value) => typeof value === "string"))) &&
    (payload.type === "challenge" || payload.type === "session")
  );
}

export function createWalletToken(payload: WalletTokenPayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function readWalletToken(token: string | undefined, type: WalletTokenType) {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature, ...rest] = token.split(".");

  if (!encodedPayload || !signature || rest.length > 0) {
    return null;
  }

  if (!safeEqual(signPayload(encodedPayload), signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;

    if (!isWalletTokenPayload(payload) || payload.type !== type) {
      return null;
    }

    if (Date.parse(payload.expiresAt) <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

type WalletSessionMetadata = {
  connectorName?: string;
};

export function createWalletChallenge(
  ownerWallet: string,
  metadata: WalletSessionMetadata = {},
) {
  const now = Date.now();

  return {
    ...metadata,
    expiresAt: new Date(now + walletAuthChallengeTtlMs).toISOString(),
    issuedAt: new Date(now).toISOString(),
    nonce: crypto.randomBytes(16).toString("hex"),
    ownerWallet,
    type: "challenge" as const,
  };
}

/** Wallets a session still vouches for, lowercased. */
export function sessionWallets(session: WalletTokenPayload | null) {
  if (!session || session.type !== "session") {
    return [];
  }
  if (!session.wallets) {
    return Date.parse(session.expiresAt) > Date.now()
      ? [session.ownerWallet.toLowerCase()]
      : [];
  }
  const now = Date.now();
  return Object.entries(session.wallets)
    .filter(([, expiresAt]) => Date.parse(expiresAt) > now)
    .map(([wallet]) => wallet.toLowerCase());
}

/**
 * Issue a session for newly proven wallets. When the browser already holds a
 * valid session, its wallets (and owner) are kept and the new ones added, so
 * signing in a second wallet never signs the first one out. Each wallet
 * keeps its own expiry: re-proving one does not extend the others.
 */
export function createWalletSession(
  ownerWallet: string,
  metadata: WalletSessionMetadata = {},
  options: {
    additionalWallets?: string[];
    /** Set the two-factor flag; otherwise it is carried from `previous`. */
    mfaPending?: boolean;
    /** Background renewals keep the wallet the user explicitly signed in with. */
    keepPreviousOwner?: boolean;
    previous?: WalletTokenPayload | null;
  } = {},
) {
  const now = Date.now();
  const expiresAt = new Date(now + walletAuthSessionTtlMs).toISOString();
  const wallets: Record<string, string> = {};

  const previous = options.previous;
  const carried = sessionWallets(previous ?? null);
  if (previous) {
    for (const wallet of carried) {
      wallets[wallet] =
        previous.wallets?.[wallet] ?? previous.expiresAt;
    }
  }
  for (const wallet of [ownerWallet, ...(options.additionalWallets ?? [])]) {
    wallets[wallet.toLowerCase()] = expiresAt;
  }

  // Keep the freshest wallets if a session somehow accumulates too many.
  const trimmed = Object.fromEntries(
    Object.entries(wallets)
      .sort(([, a], [, b]) => Date.parse(b) - Date.parse(a))
      .slice(0, maxSessionWallets),
  );
  const owner =
    options.keepPreviousOwner &&
    previous &&
    trimmed[previous.ownerWallet.toLowerCase()]
      ? previous.ownerWallet
      : ownerWallet;

  const mfaPending = options.mfaPending ?? previous?.mfaPending ?? false;

  return {
    ...metadata,
    ...(mfaPending ? { mfaPending: true } : {}),
    expiresAt: Object.values(trimmed).sort().at(-1) ?? expiresAt,
    issuedAt: new Date(now).toISOString(),
    nonce: crypto.randomBytes(16).toString("hex"),
    ownerWallet: owner,
    type: "session" as const,
    wallets: trimmed,
  };
}

/** Sign any JSON payload with the session secret (for non-wallet cookies). */
export function createSignedToken(payload: unknown) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

/** Verify a token from `createSignedToken`; returns its payload or null. */
export function readSignedToken(token: string | undefined): unknown {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature, ...rest] = token.split(".");

  if (
    !encodedPayload ||
    !signature ||
    rest.length > 0 ||
    !safeEqual(signPayload(encodedPayload), signature)
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
