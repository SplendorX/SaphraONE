// Server-only. Paying a member's USDC rebates (fee rebates and premium
// discounts) out of the treasury, the same way referral earnings are claimed.
import { AUTO_PAYOUT_MIN_USDC, MIN_PERK_CLAIM_USDC } from "@/lib/partners/config";
import { loadMember, partnersDb, partnerTables } from "@/lib/partners/db";
import { floorUsdc, PartnerError } from "@/lib/partners/rules";
import { maxAutomaticPayoutUsdc, payUsdcFromTreasury, TreasuryError } from "@/lib/referral/treasury";

/** Perk kinds paid in USDC. */
export const usdcPerkKinds = ["FEE_REBATE", "PREMIUM_DISCOUNT"] as const;

/**
 * Pay everything claimable, once it reaches the minimum (or, `automatic` at
 * the end of the welcome period, the small-balance minimum). Rebates are
 * locked to the claim first, so two claims can never pay the same ones;
 * a payout that fails before sending puts them back.
 */
export async function claimPerkRebates(walletAddress: string, options: { automatic?: boolean } = {}) {
  const wallet = walletAddress.toLowerCase();
  const db = partnersDb();
  const member = await loadMember(wallet);
  if (!member) throw new PartnerError("You don't have welcome perks.", 404);
  if (member.perks_status === "HELD") {
    throw new PartnerError("Your welcome perks are being reviewed. You can claim once that's done.", 409);
  }
  if (member.perks_status === "REVOKED") throw new PartnerError("Your welcome perks were cancelled.", 409);

  const minimum = options.automatic ? AUTO_PAYOUT_MIN_USDC : MIN_PERK_CLAIM_USDC;
  const { data: open, error } = await db
    .from(partnerTables.events)
    .select("id,amount_usdc")
    .eq("wallet_address", wallet)
    .eq("status", "CLAIMABLE")
    .in("kind", [...usdcPerkKinds]);
  if (error) throw new Error(error.message);
  const rows = (open ?? []) as Array<{ amount_usdc: number; id: string }>;
  const total = floorUsdc(rows.reduce((sum, row) => sum + Number(row.amount_usdc), 0));
  if (total < minimum) {
    throw new PartnerError(`You can claim once you have at least $${minimum.toFixed(2)} back.`);
  }

  const { data: claim, error: claimError } = await db
    .from(partnerTables.claims)
    .insert({ amount_usdc: total, automatic: Boolean(options.automatic), wallet_address: wallet })
    .select("id")
    .single();
  if (claimError) throw new Error(claimError.message);
  const claimId = (claim as { id: string }).id;

  const { data: locked, error: lockError } = await db
    .from(partnerTables.events)
    .update({ claim_id: claimId, status: "CLAIMED" })
    .in("id", rows.map((row) => row.id))
    .eq("status", "CLAIMABLE")
    .select("amount_usdc");
  if (lockError) throw new Error(lockError.message);
  const amount = floorUsdc(((locked ?? []) as Array<{ amount_usdc: number }>).reduce((sum, row) => sum + Number(row.amount_usdc), 0));
  if (amount < minimum) {
    await db.from(partnerTables.events).update({ claim_id: null, status: "CLAIMABLE" }).eq("claim_id", claimId);
    await db.from(partnerTables.claims).delete().eq("id", claimId);
    throw new PartnerError("Those rebates are already being claimed.", 409);
  }
  await db.from(partnerTables.claims).update({ amount_usdc: amount }).eq("id", claimId);

  if (amount > maxAutomaticPayoutUsdc()) {
    await db
      .from(partnerTables.claims)
      .update({ status: "REVIEW", updated_at: new Date().toISOString() })
      .eq("id", claimId);
    return { amountUsdc: amount, claimId, review: true as const, txHash: null };
  }

  try {
    const txHash = await payUsdcFromTreasury({ to: wallet, usdcAmount: amount });
    const at = new Date().toISOString();
    await db
      .from(partnerTables.claims)
      .update({ paid_at: at, payout_tx_hash: txHash, status: "PAID", updated_at: at })
      .eq("id", claimId);
    return { amountUsdc: amount, claimId, review: false as const, txHash };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The payout failed.";
    if (cause instanceof TreasuryError) {
      await db.from(partnerTables.events).update({ claim_id: null, status: "CLAIMABLE" }).eq("claim_id", claimId);
      await db
        .from(partnerTables.claims)
        .update({ last_error: message, status: "FAILED", updated_at: new Date().toISOString() })
        .eq("id", claimId);
      throw new PartnerError(`${message} Your rebates are still there to claim.`, 503);
    }
    // The transfer may have gone out: keep it for review rather than pay twice.
    await db
      .from(partnerTables.claims)
      .update({ last_error: message, status: "REVIEW", updated_at: new Date().toISOString() })
      .eq("id", claimId);
    throw new PartnerError("We couldn't confirm the payout yet. It's being checked; don't claim again.", 502);
  }
}
