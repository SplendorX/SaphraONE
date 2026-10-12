"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { useOptionalWorkspace } from "@/components/business/workspace-provider";
import { activeCircleWallet } from "@/lib/business/provision-wallet";
import {
  circleSessionEventName,
  getCircleLoginIdentity,
  readCircleLogin,
  readCircleWallets,
  type CircleLoginResult,
  type CircleWallet,
} from "@/lib/circle-session";
import {
  readPreferredWalletMode,
  walletModeEventName,
  type WalletMode,
} from "@/lib/wallet-mode";
import { ensureProfile } from "@/lib/profile";
import { ensureCircleWalletSession } from "@/lib/wallet-auth-client";

export function usePlatformWallet() {
  const { address: wagmiAddress, isConnected } = useAccount();
  const workspaceContext = useOptionalWorkspace();
  const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(
    null,
  );
  const [circleWallets, setCircleWallets] = useState<CircleWallet[]>([]);
  const [preferredMode, setPreferredMode] = useState<WalletMode | null>(null);

  const refreshCircleState = useCallback(() => {
    setCircleLogin(readCircleLogin());
    setCircleWallets(readCircleWallets());
    setPreferredMode(readPreferredWalletMode());
  }, []);

  useEffect(() => {
    refreshCircleState();
    window.addEventListener(circleSessionEventName, refreshCircleState);
    window.addEventListener(walletModeEventName, refreshCircleState);
    return () => {
      window.removeEventListener(circleSessionEventName, refreshCircleState);
      window.removeEventListener(walletModeEventName, refreshCircleState);
    };
  }, [refreshCircleState]);

  const isBusinessWorkspace = workspaceContext?.workspace?.kind === "business";
  const circleWallet = useMemo(
    () =>
      activeCircleWallet(
        workspaceContext?.workspace ?? null,
        circleWallets,
        workspaceContext?.ownerWallet,
      ),
    [
      circleWallets,
      workspaceContext?.ownerWallet,
      workspaceContext?.workspace,
    ],
  );
  const circleWalletAddress = circleWallet?.address ?? "";

  const ensuredWalletRef = useRef<string | null>(null);
  useEffect(() => {
    if (!circleLogin || !circleWalletAddress) return;
    if (ensuredWalletRef.current === circleWalletAddress) return;
    ensuredWalletRef.current = circleWalletAddress;
    const identity = getCircleLoginIdentity(circleLogin);
    // Session first: the profile link below is proven by it.
    void ensureCircleWalletSession(circleLogin.userToken)
      .then(() =>
        ensureProfile({
          // "Email": the older PIN wallet; "EmailOtp": Circle's email login.
          authProvider: identity.provider === "Email" || identity.provider === "EmailOtp" ? "email" : "google",
          circleSocialUuid: identity.socialUserUUID,
          displayName: identity.name,
          walletAddress: circleWalletAddress,
        }),
      )
      .catch(() => undefined);
  }, [circleLogin, circleWalletAddress]);

  const circleReady = Boolean(
    circleLogin && circleWalletAddress && isAddress(circleWalletAddress),
  );
  // One wallet per profile: a Google/email session never runs on an external
  // wallet, even one connected to fund a deposit.
  const externalReady = Boolean(
    !circleLogin && isConnected && wagmiAddress && isAddress(wagmiAddress),
  );

  const fallbackOwnerAddress = useMemo(() => {
    const owner = workspaceContext?.ownerWallet;
    if (owner && isAddress(owner)) {
      return getAddress(owner).toLowerCase() as Address;
    }
    return undefined;
  }, [workspaceContext?.ownerWallet]);

  const address = useMemo((): Address | undefined => {
    const circleAddress =
      circleReady && circleWalletAddress
        ? (getAddress(circleWalletAddress).toLowerCase() as Address)
        : undefined;
    const externalAddress =
      externalReady && wagmiAddress
        ? (getAddress(wagmiAddress).toLowerCase() as Address)
        : undefined;

    if (isBusinessWorkspace) {
      return circleAddress ?? fallbackOwnerAddress ?? externalAddress;
    }

    if (preferredMode === "external" && externalAddress) {
      return externalAddress;
    }

    if (preferredMode === "circle" && circleAddress) {
      return circleAddress;
    }

    return circleAddress ?? fallbackOwnerAddress ?? externalAddress;
  }, [
    circleReady,
    circleWalletAddress,
    externalReady,
    fallbackOwnerAddress,
    isBusinessWorkspace,
    preferredMode,
    wagmiAddress,
  ]);

  const source = useMemo(() => {
    if (isBusinessWorkspace) {
      return circleReady ? ("embedded" as const) : null;
    }

    if (preferredMode === "external" && externalReady) {
      return "external" as const;
    }

    if (preferredMode === "circle" && circleReady) {
      return "embedded" as const;
    }

    if (circleReady) {
      return "embedded" as const;
    }

    if (externalReady) {
      return "external" as const;
    }

    return null;
  }, [circleReady, externalReady, isBusinessWorkspace, preferredMode]);

  const circleSocialUuid = useMemo(
    () =>
      getCircleLoginIdentity(circleLogin)?.socialUserUUID ??
      workspaceContext?.circleSocialUuid ??
      undefined,
    [circleLogin, workspaceContext?.circleSocialUuid],
  );

  return {
    address,
    circleSocialUuid,
    circleWallet,
    isBusinessWorkspace,
    isConnected: Boolean(address || workspaceContext?.ownerWallet),
    needsBusinessWallet: isBusinessWorkspace && !circleWallet,
    source,
  };
}
