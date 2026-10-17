// Server-only. Premium purchases paid in USDC (Rewards v2): what points
// discounts are claimed against.
import { verifyAllieProPayment } from "@/lib/allie/verify-pro-payment";
import { platformFeeRecipient } from "@/lib/fees";
import { referralDb } from "@/lib/referral/db";
import { FEATURE_UNLOCK_COST, type OnePointsFeature } from "@/lib/referral/types";
import { USD_PER_POINT } from "@/lib/rewards/config";

export type PremiumProduct = OnePointsFeature | "ALLIE_PRO" | "ALLIE_OVERAGE";

export const premiumProductLabels: Record<PremiumProduct, string> = {
  ALLIE_OVERAGE: "ALLIE extra requests",
  ALLIE_PRO: "ALLIE Pro",
  EARN_AUTO_DEPOSIT: "Automatic deposits",
  PAYROLL_AUTO_SCHEDULE: "Automatic payroll",
};

/** A feature unlock's USDC price: the old points price at 100 points = $1. */
export function featureUnlockPriceUsdc(feature: OnePointsFeature) {
  return Number((FEATURE_UNLOCK_COST[feature] * USD_PER_POINT).toFixed(2));
}

export type PremiumPurchase = {
  amount_usdc: number;
  created_at: string;
  description: string;
  id: string;
  /** USDC given back by a creator partner's discount (CREATOR-PARTNERS-PLAN.md). */
  partner_rebate_usdc?: number;
  points_eligible: boolean;
  product: PremiumProduct;
  status: "CONFIRMED" | "REFUNDED";
  tx_hash: string;
  wallet_address: string;
};

/** What the buyer really paid: the price less any partner discount given back. */
export function paidUsdc(purchase: Pick<PremiumPurchase, "amount_usdc" | "partner_rebate_usdc">) {
  return Math.max(0, Number(purchase.amount_usdc) - Number(purchase.partner_rebate_usdc ?? 0));
}

export type PremiumPaymentResult =
  | { ok: true; purchase: PremiumPurchase }
  /** `retryable`: the payment may still confirm; the same hash can be sent again. */
  | { ok: false; reason: string; retryable?: boolean; status: number };

/**
 * Check a USDC payment for a premium product on Arc (from the owner's wallet
 * to the platform fee wallet, at least `amountUsdc`, recent) and record it.
 * The payment hash is unique, so one payment can never buy twice, even when
 * two requests race.
 */
export async function recordPremiumPayment(input: {
  amountUsdc: number;
  description: string;
  feeRecipient?: string;
  ownerWallet: string;
  product: PremiumProduct;
  txHash: string;
}): Promise<PremiumPaymentResult> {
  const txHash = input.txHash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return { ok: false, reason: "A payment transaction hash is required.", status: 400 };
  }
  const check = await verifyAllieProPayment({
    feeRecipient: input.feeRecipient ?? platformFeeRecipient(),
    feeUsdc: input.amountUsdc,
    ownerWallet: input.ownerWallet,
    txHash,
  });
  if (!check.ok) {
    return { ok: false, reason: check.reason, retryable: check.retryable, status: check.retryable ? 503 : 422 };
  }

  const { data, error } = await referralDb()
    .from("premium_purchases")
    .insert({
      amount_usdc: input.amountUsdc,
      description: input.description,
      product: input.product,
      tx_hash: txHash,
      wallet_address: input.ownerWallet.toLowerCase(),
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, reason: "That payment has already been used.", status: 409 };
    }
    throw new Error(`The purchase could not be recorded: ${error.message}`);
  }
  const purchase = data as PremiumPurchase;
  // A creator partner's welcome discount comes back as USDC to claim.
  const { applyPremiumDiscount } = await import("@/lib/partners/perks");
  const rebate = await applyPremiumDiscount({
    amountUsdc: input.amountUsdc,
    product: input.product,
    purchaseId: purchase.id,
    wallet: input.ownerWallet,
  });
  return { ok: true, purchase: { ...purchase, partner_rebate_usdc: rebate } };
}

/** Undo a recorded purchase when granting what it paid for failed, so it can be retried. */
export async function releasePremiumPayment(purchaseId: string) {
  await referralDb().from("premium_purchases").delete().eq("id", purchaseId);
}
