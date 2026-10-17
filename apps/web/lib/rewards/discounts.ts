// Server-only. Claiming a discount: OnePoints for a USDC refund on a
// premium purchase (Rewards v2, REWARDS-PLAN.md).
import { getOnePointsSummary, recordLedgerEntry } from "@/lib/referral/ledger-service";
import { referralDb } from "@/lib/referral/db";
import { payUsdcFromTreasury, TreasuryError } from "@/lib/referral/treasury";
import {
  DISCOUNT_OPTIONS,
  discountCost,
  MIN_DISCOUNT_USDC,
  type DiscountPercent,
} from "@/lib/rewards/config";
import { paidUsdc, premiumProductLabels, type PremiumPurchase } from "@/lib/rewards/premium";

export type ClaimablePurchase = {
  amountUsdc: number;
  createdAt: string;
  description: string;
  id: string;
  label: string;
  options: Array<{ eligible: boolean; percent: DiscountPercent; points: number; refundUsdc: number }>;
};

export class DiscountError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DiscountError";
  }
}

type ClaimRow = { id: string; purchase_id: string; status: string };

/** The wallet's premium purchases that can still be claimed against. */
export async function listClaimablePurchases(walletAddress: string): Promise<ClaimablePurchase[]> {
  const wallet = walletAddress.toLowerCase();
  const db = referralDb();
  const [purchases, claims] = await Promise.all([
    db
      .from("premium_purchases")
      .select("*")
      .eq("wallet_address", wallet)
      .eq("status", "CONFIRMED")
      .eq("points_eligible", true)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("rewards_discount_claims").select("id,purchase_id,status").eq("wallet_address", wallet),
  ]);
  if (purchases.error) throw new Error(purchases.error.message);
  // A failed claim (nothing paid, points given back) doesn't block another try.
  const claimed = new Set(
    ((claims.data ?? []) as ClaimRow[]).filter((row) => row.status !== "FAILED").map((row) => row.purchase_id),
  );

  return ((purchases.data ?? []) as PremiumPurchase[])
    .filter((purchase) => !claimed.has(purchase.id))
    .map((purchase) => {
      // Only what was really paid: a partner discount already gave some back.
      const amountUsdc = paidUsdc(purchase);
      const options = DISCOUNT_OPTIONS.map((option) => {
        const cost = discountCost(amountUsdc, option.percent);
        return {
          eligible: cost.refundUsdc >= MIN_DISCOUNT_USDC,
          percent: option.percent,
          points: cost.points,
          refundUsdc: cost.refundUsdc,
        };
      });
      return {
        amountUsdc,
        createdAt: purchase.created_at,
        description: purchase.description || premiumProductLabels[purchase.product],
        id: purchase.id,
        label: premiumProductLabels[purchase.product],
        options,
      };
    })
    .filter((purchase) => purchase.options.some((option) => option.eligible));
}

/**
 * Spend points for a USDC refund on one purchase. Order: claim the purchase
 * (unique row, so a double tap can't claim twice), debit the points, pay from
 * the treasury. A payout that fails before sending gives the points back; one
 * whose outcome is unknown stays PENDING for review, so it's never paid twice.
 */
export async function claimDiscount(input: {
  percent: number;
  purchaseId: string;
  walletAddress: string;
}) {
  const wallet = input.walletAddress.toLowerCase();
  const option = DISCOUNT_OPTIONS.find((entry) => entry.percent === input.percent);
  if (!option) throw new DiscountError("Choose 25%, 50%, 75% or 100%.");
  const db = referralDb();

  const { data: purchase, error: purchaseError } = await db
    .from("premium_purchases")
    .select("*")
    .eq("id", input.purchaseId)
    .maybeSingle();
  if (purchaseError) throw new Error(purchaseError.message);
  const row = purchase as PremiumPurchase | null;
  if (!row || row.wallet_address !== wallet) throw new DiscountError("Purchase not found.", 404);
  if (row.status !== "CONFIRMED") throw new DiscountError("This purchase was refunded.");
  if (!row.points_eligible) throw new DiscountError("This purchase can't be claimed against.");

  const cost = discountCost(paidUsdc(row), option.percent);
  if (cost.refundUsdc < MIN_DISCOUNT_USDC) {
    throw new DiscountError(`A discount has to be at least ${MIN_DISCOUNT_USDC.toFixed(2)} USDC.`);
  }
  const balance = (await getOnePointsSummary(wallet)).available;
  if (balance < cost.points) {
    throw new DiscountError(`This discount costs ${cost.points} points. You have ${balance}.`);
  }

  // A failed earlier attempt (nothing paid, points returned) can be retried.
  await db.from("rewards_discount_claims").delete().eq("purchase_id", row.id).eq("status", "FAILED");
  const { data: claim, error: claimError } = await db
    .from("rewards_discount_claims")
    .insert({
      points_spent: cost.points,
      purchase_id: row.id,
      refund_percent: option.percent,
      refund_usdc: cost.refundUsdc,
      wallet_address: wallet,
    })
    .select("id")
    .single();
  if (claimError) {
    if (claimError.code === "23505") throw new DiscountError("This purchase has already been claimed.", 409);
    throw new Error(claimError.message);
  }
  const claimId = (claim as { id: string }).id;

  const label = premiumProductLabels[row.product];
  let debitId: string;
  try {
    const debit = await recordLedgerEntry({
      description: `${option.percent}% discount on ${label}`,
      entryType: "DISCOUNT_CLAIM",
      idempotencyKey: `discount_${claimId}`,
      metadata: { claimId, percent: option.percent, purchaseId: row.id, refundUsdc: cost.refundUsdc },
      points: -cost.points,
      walletAddress: wallet,
    });
    debitId = debit.entry.id;
  } catch (cause) {
    await db.from("rewards_discount_claims").delete().eq("id", claimId);
    throw new DiscountError(cause instanceof Error ? cause.message : "Points could not be spent.");
  }
  await db.from("rewards_discount_claims").update({ ledger_entry_id: debitId }).eq("id", claimId);

  try {
    const txHash = await payUsdcFromTreasury({ to: wallet, usdcAmount: cost.refundUsdc });
    await db
      .from("rewards_discount_claims")
      .update({ payout_tx_hash: txHash, status: "PAID", updated_at: new Date().toISOString() })
      .eq("id", claimId);
    return { claimId, points: cost.points, refundUsdc: cost.refundUsdc, txHash };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The refund could not be paid.";
    if (cause instanceof TreasuryError) {
      // Nothing was sent: give the points back and let it be tried again.
      await recordLedgerEntry({
        description: "Discount refund failed; points returned",
        entryType: "REVERSAL",
        idempotencyKey: `discount_${claimId}_reversal`,
        metadata: { claimId },
        originalLedgerEntryId: debitId,
        points: cost.points,
        walletAddress: wallet,
      });
      await db
        .from("rewards_discount_claims")
        .update({ last_error: message, status: "FAILED", updated_at: new Date().toISOString() })
        .eq("id", claimId);
      throw new DiscountError(`${message} Your points were returned.`, 503);
    }
    // The transfer may have gone out: leave it for review rather than risk paying twice.
    await db
      .from("rewards_discount_claims")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", claimId);
    throw new DiscountError("We couldn't confirm the refund yet. It's being checked; don't claim again.", 502);
  }
}
