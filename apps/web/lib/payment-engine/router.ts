import { sendFeeUnits } from "@/lib/fees";

import type { PaymentIntent, PaymentIntentRail } from "@/lib/payment-engine/intent";

export type RouteRail = PaymentIntentRail | "not-yet-available";

export type RouteExecutor =
  | "external-wallet"
  | "circle-user-wallet"
  | "agent-wallet";

export type RouterWalletMode = "external" | "circle" | "agent";

export type RouteDecision = {
  rail: RouteRail;
  executor: RouteExecutor;
  estimatedFeeUnits: bigint;
  reason: string;
};

export type RouterContext = {
  initiatorType: "human" | "business" | "agent";
  /** When present and different from intent.chainId, the route becomes CCTP. */
  targetChainId?: number;
  isBatch?: boolean;
  isRecurring?: boolean;
  walletMode: RouterWalletMode;
  /**
   * Reserved for Phase F (Gateway) and Phase G (x402 / Nanopayments).
   * Setting it today yields a 'not-yet-available' decision rather than an
   * unexpected fallback onto a live rail.
   */
  requestedRail?: "gateway" | "x402" | "nanopayment";
};

/** Rough per-rail settlement time, surfaced on ALLIE's confirmation card. */
export const railEstimatedSeconds: Record<RouteRail, number> = {
  "arc-native": 5,
  "agent-direct": 5,
  batch: 15,
  recurring: 5,
  // FAST CCTP with the Forwarding Service: burn on Arc, delivered in about 30s.
  cctp: 30,
  "not-yet-available": 0,
};

function executorForWalletMode(mode: RouterWalletMode): RouteExecutor {
  switch (mode) {
    case "agent":
      return "agent-wallet";
    case "circle":
      return "circle-user-wallet";
    case "external":
    default:
      return "external-wallet";
  }
}

/**
 * Phase F / Phase G rails are designed in but not implemented. They resolve
 * here so the signature never has to change when they are filled in.
 */
function routeFutureRail(requestedRail: NonNullable<RouterContext["requestedRail"]>) {
  switch (requestedRail) {
    // PHASE F: Circle Gateway unified balance routing.
    case "gateway":
      return "Gateway rail is not yet available on SaphraONE.";
    // PHASE G: x402 payment gate / Gateway Nanopayments.
    case "x402":
    case "nanopayment":
      return "x402 nanopayment rail is not yet available on SaphraONE.";
    default:
      return "Requested rail is not yet available on SaphraONE.";
  }
}

/**
 * The application never hard-codes a rail — it asks the router.
 * Rules are evaluated in order; the first match wins.
 */
export function routeIntent(
  intent: PaymentIntent,
  context: RouterContext,
): RouteDecision {
  const executor = executorForWalletMode(context.walletMode);
  const estimatedFeeUnits = sendFeeUnits(intent.amountUnits);

  if (context.requestedRail) {
    return {
      rail: "not-yet-available",
      executor,
      estimatedFeeUnits: 0n,
      reason: routeFutureRail(context.requestedRail),
    };
  }

  if (context.isBatch === true) {
    return {
      rail: "batch",
      executor,
      estimatedFeeUnits,
      reason: "Batch payout routed through BulkPay.",
    };
  }

  if (context.isRecurring === true) {
    return {
      rail: "recurring",
      executor,
      estimatedFeeUnits,
      reason: "Scheduled payment routed through RecurePay.",
    };
  }

  if (
    typeof context.targetChainId === "number" &&
    context.targetChainId !== intent.chainId
  ) {
    return {
      rail: "cctp",
      executor,
      estimatedFeeUnits,
      reason: `Cross-chain settlement to chain ${context.targetChainId} routed through CCTP.`,
    };
  }

  if (context.initiatorType === "agent") {
    return {
      rail: "agent-direct",
      executor: "agent-wallet",
      estimatedFeeUnits,
      reason: "Agent-initiated payment settles directly from the Agent Wallet.",
    };
  }

  return {
    rail: "arc-native",
    executor,
    estimatedFeeUnits,
    reason: "Same-chain Arc settlement.",
  };
}

