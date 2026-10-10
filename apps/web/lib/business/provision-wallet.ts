"use client";

import type { WorkspaceSummary } from "@/lib/business/types";
import { preferArcCircleWallets, type CircleWallet } from "@/lib/circle-session";

export function personalCircleWallet(wallets: CircleWallet[]) {
  return preferArcCircleWallets(wallets)[0] ?? null;
}

export function dedicatedBusinessWallet(
  workspace: WorkspaceSummary | null,
  wallets: CircleWallet[],
  ownerWallet?: string | null,
) {
  if (!workspace || workspace.kind !== "business") return null;
  const personal = personalCircleWallet(wallets);
  if (workspace.circleWalletId && workspace.circleWalletId !== personal?.id) {
    const byId = wallets.find((wallet) => wallet.id === workspace.circleWalletId);
    if (byId?.address) return byId;
  }
  const payment = workspace.paymentWallet?.toLowerCase();
  const owner = ownerWallet?.toLowerCase();
  const personalAddress = personal?.address?.toLowerCase();
  if (
    payment &&
    payment !== owner &&
    payment !== personalAddress
  ) {
    return (
      wallets.find((wallet) => wallet.address?.toLowerCase() === payment) ?? null
    );
  }
  return null;
}

export function activeCircleWallet(
  workspace: WorkspaceSummary | null,
  wallets: CircleWallet[],
  ownerWallet?: string | null,
) {
  if (workspace?.kind === "business") {
    return (
      dedicatedBusinessWallet(workspace, wallets, ownerWallet) ??
      (ownerWallet
        ? wallets.find((wallet) => wallet.address?.toLowerCase() === ownerWallet.toLowerCase())
        : null) ??
      personalCircleWallet(wallets)
    );
  }
  return personalCircleWallet(wallets);
}

