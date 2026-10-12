export type WalletSessionStatus = {
  authenticated: boolean;
  authMethod?: string;
  connectorName?: string;
  expiresAt?: string;
  ownerWallet?: string;
  /** Every wallet the session covers (lowercased), including ownerWallet. */
  wallets?: string[];
};

const walletSignInRequests = new Map<string, Promise<WalletSessionStatus>>();

function walletSignInRequestKey(ownerWallet: string) {
  return ownerWallet.toLowerCase();
}

/** Fired on window when the server wallet session cookie is cleared or replaced. */
export const walletSessionChangedEventName = "saphra:wallet-session-changed";

export function notifyWalletSessionChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(walletSessionChangedEventName));
}

export async function fetchWalletSession() {
  const response = await fetch("/api/auth/wallet", { cache: "no-store" });
  const payload = (await response.json()) as WalletSessionStatus & {
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.message ?? "Wallet session could not be loaded.");
  }

  return payload;
}

export async function endWalletSession() {
  const response = await fetch("/api/auth/wallet", { method: "DELETE" });
  const payload = (await response.json()) as { message?: string };

  if (!response.ok) {
    throw new Error(payload.message ?? "Wallet session could not be ended.");
  }

  notifyWalletSessionChanged();
  return payload;
}

export type WalletSessionSyncResult = WalletSessionStatus & {
  /** True when an existing session cookie was for a different wallet and was cleared. */
  clearedStaleSession?: boolean;
  previousOwnerWallet?: string;
};

/**
 * Load the server session. If a connected wallet is provided and it does not
 * match the session owner, clear the stale cookie and return unauthenticated.
 */
export async function fetchWalletSessionForAddress(
  connectedWallet?: string | null,
): Promise<WalletSessionSyncResult> {
  const session = await fetchWalletSession();

  if (!session.authenticated || !session.ownerWallet) {
    return { authenticated: false };
  }

  if (!connectedWallet) {
    return session;
  }

  const connected = connectedWallet.toLowerCase();
  const covered = session.wallets ?? [session.ownerWallet.toLowerCase()];

  if (covered.includes(connected)) {
    return { ...session, ownerWallet: connectedWallet };
  }

  const previousOwnerWallet = session.ownerWallet;

  // The session also vouches for other wallets (e.g. the Circle wallet), so
  // keep it; this wallet simply is not signed in yet.
  if (covered.length > 1) {
    return { authenticated: false, previousOwnerWallet };
  }

  // Connected wallet changed — drop the previous wallet's session cookie.
  try {
    await endWalletSession();
  } catch {
    // Still treat as signed out for the new wallet.
  }

  return {
    authenticated: false,
    clearedStaleSession: true,
    previousOwnerWallet,
  };
}

export async function signInWalletSession(input: {
  connectorName?: string;
  ownerWallet: string;
  signMessage: (message: string) => Promise<string>;
}) {
  const key = walletSignInRequestKey(input.ownerWallet);
  const pendingRequest = walletSignInRequests.get(key);

  if (pendingRequest) {
    return pendingRequest;
  }

  const request = signInWalletSessionOnce(input);
  walletSignInRequests.set(key, request);

  try {
    return await request;
  } finally {
    if (walletSignInRequests.get(key) === request) {
      walletSignInRequests.delete(key);
    }
  }
}

async function signInWalletSessionOnce(input: {
  connectorName?: string;
  ownerWallet: string;
  signMessage: (message: string) => Promise<string>;
}) {
  // Drop any previous wallet session before starting a new challenge.
  try {
    const existing = await fetchWalletSession();
    if (
      existing.authenticated &&
      existing.ownerWallet &&
      existing.ownerWallet.toLowerCase() === input.ownerWallet.toLowerCase()
    ) {
      return existing;
    }

    if (
      existing.authenticated &&
      existing.ownerWallet &&
      existing.ownerWallet.toLowerCase() !== input.ownerWallet.toLowerCase()
    ) {
      await endWalletSession();
    }
  } catch {
    // Continue with challenge even if cleanup fails.
  }

  const challengeResponse = await fetch("/api/auth/wallet", {
    body: JSON.stringify({
      action: "challenge",
      connectorName: input.connectorName,
      ownerWallet: input.ownerWallet,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const challengePayload = (await challengeResponse.json()) as {
    message?: string;
    signingMessage?: string;
  };

  if (!challengeResponse.ok || !challengePayload.signingMessage) {
    throw new Error(
      challengePayload.message ?? "Wallet sign-in could not start.",
    );
  }

  const signature = await input.signMessage(challengePayload.signingMessage);
  const verifyResponse = await fetch("/api/auth/wallet", {
    body: JSON.stringify({
      action: "verify",
      signature,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const verifyPayload = (await verifyResponse.json()) as WalletSessionStatus & {
    message?: string;
  };

  if (!verifyResponse.ok || !verifyPayload.authenticated) {
    throw new Error(verifyPayload.message ?? "Wallet sign-in failed.");
  }

  notifyWalletSessionChanged();
  return verifyPayload;
}

const circleSessionRequests = new Map<string, Promise<boolean>>();

/**
 * Turn the stored Circle user token (Google / email users) into the signed
 * wallet session the server checks. Runs once per token per page load; a
 * failure is non-fatal because payments renew the session again themselves.
 */
export function ensureCircleWalletSession(userToken?: string | null) {
  if (!userToken) {
    return Promise.resolve(false);
  }

  const existing = circleSessionRequests.get(userToken);
  if (existing) {
    return existing;
  }

  // The Google/email address the user signed in with: saved as the
  // profile's contact email when it has none, so security alerts reach them.
  const request = import("@/lib/circle-session")
    .then(({ readSignInEmail }) => readSignInEmail())
    .catch(() => null)
    .then((email) =>
      fetch("/api/auth/circle", {
        body: JSON.stringify({ email, userToken }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    )
    .then((response) => {
      if (response.ok) {
        notifyWalletSessionChanged();
      } else {
        // Let a later call retry, e.g. after the user signs in again.
        circleSessionRequests.delete(userToken);
      }
      return response.ok;
    })
    .catch(() => {
      circleSessionRequests.delete(userToken);
      return false;
    });

  circleSessionRequests.set(userToken, request);
  return request;
}
