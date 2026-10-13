"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

import { activeCircleWallet } from "@/lib/business/provision-wallet";
import {
  circleSessionEventName,
  readCircleAppId,
  readCircleLogin,
  readCircleWallets,
  type CircleLoginResult,
  type CircleWallet,
} from "@/lib/circle-session";
import { createCircleWalletProvider } from "@/lib/circle-eip1193";
import { onchainFacts } from "@/lib/onchain-facts";

export type SigningWalletKind = "circle" | "external" | null;

export type SigningWallet = {
  address: string | null;
  /** Ready to sign a vault transaction. */
  canSign: boolean;
  /** The Circle wallet id, for one-tap confirmation of multi-step actions (lib/tx-approval). */
  circleWalletId: string | null;
  currentChainId?: number;
  kind: SigningWalletKind;
  /** Why signing is unavailable, when it is. */
  reason: string | null;
  resolveProvider: (() => Promise<unknown>) | null;
  switchChainAsync?: (args: { chainId: number }) => Promise<unknown>;
};

/**
 * Resolve whichever wallet this session can sign with.
 *
 * Google sessions hold a Circle user-controlled wallet and are wrapped in an
 * EIP-1193 shim; everyone else uses their connected wallet's own provider.
 * Callers then treat both the same way.
 */
export function useSigningWallet(): SigningWallet {
  const { address: externalAddress, chainId, connector, status } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(null);
  const [circleWallets, setCircleWallets] = useState<CircleWallet[]>([]);
  const sdkRef = useRef<W3SSdk | null>(null);

  const syncCircle = useCallback(() => {
    setCircleLogin(readCircleLogin());
    setCircleWallets(readCircleWallets());
  }, []);

  useEffect(() => {
    syncCircle();
    window.addEventListener(circleSessionEventName, syncCircle);
    return () => {
      window.removeEventListener(circleSessionEventName, syncCircle);
    };
  }, [syncCircle]);

  const circleWallet = useMemo(
    () => activeCircleWallet(null, circleWallets, undefined),
    [circleWallets],
  );

  // Built lazily and only once: constructing it pulls in the W3S bundle.
  const getSdk = useCallback(async () => {
    if (sdkRef.current) return sdkRef.current;
    if (!circleLogin) return null;

    const appId = readCircleAppId();
    if (!appId) return null;

    const { W3SSdk: CircleW3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
    sdkRef.current = new CircleW3SSdk({
      appSettings: { appId },
      authentication: {
        encryptionKey: circleLogin.encryptionKey,
        userToken: circleLogin.userToken,
      },
    });
    return sdkRef.current;
  }, [circleLogin]);

  return useMemo<SigningWallet>(() => {
    // A Circle session is preferred: it is where a Google user's funds are.
    const circleAddress = circleWallet?.address;
    if (circleLogin && circleAddress) {
      const appId = readCircleAppId();
      if (!appId) {
        return {
          address: circleAddress,
          canSign: false,
          circleWalletId: null,
          kind: "circle",
          reason:
            "Circle wallet confirmation is not configured on this deployment.",
          resolveProvider: null,
        };
      }

      return {
        address: circleAddress,
        canSign: true,
        circleWalletId: circleWallet.id ?? null,
        // The shim is always on Arc, so no chain switch is ever needed.
        currentChainId: onchainFacts.chainId,
        kind: "circle",
        reason: null,
        resolveProvider: async () =>
          createCircleWalletProvider({
            address: circleAddress,
            encryptionKey: circleLogin.encryptionKey,
            getSdk,
            userToken: circleLogin.userToken,
            walletId: circleWallet.id,
          }),
      };
    }

    // While wagmi reconnects, `connector` is rehydrated from storage and is a
    // plain object without its methods. Callers that run on mount would hit
    // `connector.getProvider is not a function`, so wait for a live connection
    // before claiming this wallet can sign.
    const connectorReady =
      status === "connected" && typeof connector?.getProvider === "function";

    if (connectorReady && connector && externalAddress) {
      return {
        address: externalAddress,
        canSign: true,
        circleWalletId: null,
        currentChainId: chainId,
        kind: "external",
        reason: null,
        resolveProvider: async () => {
          if (typeof connector.getProvider !== "function") {
            throw new Error(
              "Your wallet is still connecting. Try again in a moment.",
            );
          }
          return connector.getProvider();
        },
        switchChainAsync,
      };
    }

    if (externalAddress) {
      // Connected address, connector not usable yet: report the address so the
      // UI can render, but do not offer signing.
      return {
        address: externalAddress,
        canSign: false,
        circleWalletId: null,
        currentChainId: chainId,
        kind: "external",
        reason: "Your wallet is still connecting.",
        resolveProvider: null,
      };
    }

    return {
      address: null,
      canSign: false,
      circleWalletId: null,
      kind: null,
      reason: "Sign in with Google or connect a wallet to continue.",
      resolveProvider: null,
    };
  }, [
    chainId,
    circleLogin,
    circleWallet,
    status,
    connector,
    externalAddress,
    getSdk,
    switchChainAsync,
  ]);
}
