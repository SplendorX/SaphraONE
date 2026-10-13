// Server-only. Shared by the chat route (what the card promises) and the
// execute route (what actually leaves the wallet) so the two cannot drift.
import { isAddress, getAddress, type Address } from "viem";

import { platformFeeRecipient, sendFeeUnits, usesLegacySendFee } from "@/lib/fees";

import {
  alliePerPaymentFeeUnits,
  allieProFeeRecipient,
  type AllieTier,
} from "@/lib/allie/monetization";
import type { AgentBatchLeg } from "@/lib/agent-wallet/client";

export type AgentFee = {
  kind: "platform" | "allie";
  label: string;
  units: bigint;
  /** null when the router holds the recipient on-chain. */
  recipient: Address | null;
  /**
   * "router" — taken on-chain inside the SwiftPaySend call, no extra transfer.
   * "transfer" — its own transfer from the Agent Wallet.
   */
  via: "router" | "transfer";
};

export type AgentFeeBreakdown = {
  fees: AgentFee[];
  totalFeeUnits: bigint;
  /** Payment + fees — what the Agent Wallet must actually hold. */
  totalDebitUnits: bigint;
  /** Fees that were skipped because their recipient is not configured. */
  skipped: string[];
};

function readRecipient(value: string): Address | null {
  const trimmed = value.trim();
  return isAddress(trimmed) ? (getAddress(trimmed).toLowerCase() as Address) : null;
}

/**
 * Fees on an agent payment.
 *
 * Agent payments settle through SwiftPaySend, which takes the 0.1% platform
 * fee on-chain in the same call — so that fee needs no transfer of its own,
 * and the contract's own fee recipient is the authority on where it goes.
 *
 * ALLIE's per-payment fee is SaphraONE-specific and the router knows nothing
 * about it, so it stays a separate transfer. A fee whose recipient is
 * unconfigured is skipped rather than silently folded into the payment.
 */
export function computeAgentFees(
  paymentUnits: bigint,
  tier: AllieTier,
): AgentFeeBreakdown {
  const fees: AgentFee[] = [];
  const skipped: string[] = [];

  // Platform send fee (the router's band fee), taken in the same transaction.
  // It needs no recipient here: SwiftPaySend holds its own on-chain, so this
  // cannot be skipped by a missing env var the way a transfer could.
  const platformUnits = sendFeeUnits(paymentUnits);

  if (platformUnits > 0n) {
    fees.push({
      kind: "platform",
      label: usesLegacySendFee() ? "Service fee (0.1%)" : "Service fee",
      recipient: readRecipient(platformFeeRecipient()),
      units: platformUnits,
      via: "router",
    });
  }

  // ALLIE's per-payment fee — free tier only; Pro has already paid monthly.
  if (tier === "free") {
    const units = alliePerPaymentFeeUnits();

    if (units > 0n) {
      const recipient = readRecipient(allieProFeeRecipient());

      if (recipient) {
        fees.push({
          kind: "allie",
          label: "ALLIE fee",
          recipient,
          units,
          via: "transfer",
        });
      } else {
        skipped.push("allie");
      }
    }
  }

  const totalFeeUnits = fees.reduce((sum, fee) => sum + fee.units, 0n);

  return {
    fees,
    skipped,
    totalDebitUnits: paymentUnits + totalFeeUnits,
    totalFeeUnits,
  };
}

/**
 * The fees that need a transfer of their own. Router-collected fees are
 * excluded — adding a leg for one would charge it twice.
 */
export function feeLegs(breakdown: AgentFeeBreakdown): AgentBatchLeg[] {
  return breakdown.fees
    .filter((fee): fee is AgentFee & { recipient: Address } =>
      fee.via === "transfer" && fee.recipient !== null,
    )
    .map((fee) => ({
      amountUnits: fee.units,
      kind: "fee" as const,
      label: fee.label,
      recipient: fee.recipient,
    }));
}

export function serializeFees(breakdown: AgentFeeBreakdown) {
  return {
    fees: breakdown.fees.map((fee) => ({
      kind: fee.kind,
      label: fee.label,
      recipient: fee.recipient,
      units: fee.units.toString(),
      via: fee.via,
    })),
    skipped: breakdown.skipped,
    totalDebitUnits: breakdown.totalDebitUnits.toString(),
    totalFeeUnits: breakdown.totalFeeUnits.toString(),
  };
}
