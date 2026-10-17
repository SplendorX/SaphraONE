// Server-only. A partner's bounty for each member who becomes active: paid
// once per member, as an Invite & Earn earning, so it's claimed (and held for
// review) like the rest of their commission.
import { creatorPartnersEnabled } from "@/lib/partners/config";
import { loadMember, partnersDb, partnerTables } from "@/lib/partners/db";
import { BOUNTY_SOURCE } from "@/lib/partners/report";
import type { PartnerRow } from "@/lib/partners/types";
import { getReferralForUser } from "@/lib/referral/attribution-service";
import { referralDb } from "@/lib/referral/db";
import { loadTierPolicy } from "@/lib/referral/usdc-commission";

const ACTIVE_WINDOW_MS = 30 * 86_400_000;

function monthStartIso(at = new Date()) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
}

function bountyLive(partner: PartnerRow, now: Date) {
  if (partner.status !== "ACTIVE" || !(Number(partner.bounty_usdc) > 0)) return false;
  if (partner.contract_starts_at && Date.parse(partner.contract_starts_at) > now.getTime()) return false;
  if (partner.contract_ends_at && Date.parse(partner.contract_ends_at) <= now.getTime()) return false;
  return true;
}

/**
 * Check whether this member just became active (the referral tiers' rule:
 * enough fee-paying payments in 30 days) and, if so, accrue their partner's
 * bounty, within the partner's monthly cap (0 = no cap). Never throws.
 */
export async function accruePartnerBounty(memberWallet: string, now = new Date()) {
  const wallet = memberWallet.toLowerCase();
  try {
    if (!creatorPartnersEnabled()) return null;
    const member = await loadMember(wallet);
    if (!member || member.bounty_paid_at || member.perks_status === "HELD" || member.perks_status === "REVOKED") return null;

    const { data: partnerRow } = await partnersDb()
      .from(partnerTables.partners)
      .select("*")
      .eq("id", member.partner_id)
      .maybeSingle();
    const partner = partnerRow as PartnerRow | null;
    if (!partner || !bountyLive(partner, now)) return null;

    const referral = await getReferralForUser(wallet);
    if (!referral || referral.status === "REJECTED" || referral.status === "REVERSED" || referral.fraud_status === "BLOCKED") {
      return null;
    }

    const policy = await loadTierPolicy();
    const activeMin = policy[0]?.activeMinTransactions ?? 5;
    const db = referralDb();
    const { count: recent } = await db
      .from("referral_fee_earnings")
      .select("id", { count: "exact", head: true })
      .eq("referred_wallet", wallet)
      .neq("source", BOUNTY_SOURCE)
      .neq("status", "REVERSED")
      .gte("created_at", new Date(now.getTime() - ACTIVE_WINDOW_MS).toISOString());
    if ((recent ?? 0) < activeMin) return null;

    if (partner.bounty_monthly_cap > 0) {
      const { count: thisMonth } = await db
        .from("referral_fee_earnings")
        .select("id", { count: "exact", head: true })
        .eq("referrer_wallet", partner.wallet_address)
        .eq("source", BOUNTY_SOURCE)
        .neq("status", "REVERSED")
        .gte("created_at", monthStartIso(now));
      if ((thisMonth ?? 0) >= partner.bounty_monthly_cap) return null;
    }

    // Claim the member's bounty first, so it's paid once even when two payments race.
    const { data: claimed } = await partnersDb()
      .from(partnerTables.members)
      .update({ bounty_paid_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("wallet_address", wallet)
      .is("bounty_paid_at", null)
      .select("wallet_address");
    if (!claimed?.length) return null;

    const held =
      referral.status === "FRAUD_REVIEW" || referral.fraud_status === "HIGH_RISK" || referral.fraud_status === "REVIEW_REQUIRED";
    const { error } = await db.from("referral_fee_earnings").insert({
      amount_usdc: Number(partner.bounty_usdc),
      commission_bps: 0,
      fee_usd: 0,
      referred_wallet: wallet,
      referrer_wallet: partner.wallet_address,
      source: BOUNTY_SOURCE,
      status: held ? "HELD" : "ACCRUED",
      tier: "PARTNER",
      tx_hash: `bounty:${wallet}`,
      volume_usd: 0,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
    return { amountUsdc: Number(partner.bounty_usdc), held };
  } catch (cause) {
    console.error("[partners] bounty", cause instanceof Error ? cause.message : cause);
    return null;
  }
}
