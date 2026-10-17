// Server-only. Invite & Earn v2 (REWARDS-PLAN.md): referrers earn a share of
// the service fees their direct referrals actually pay, in USDC, then claim it.
import { loadPartnerByWallet } from "@/lib/partners/db";
import { effectiveCommissionBps } from "@/lib/partners/rules";
import { getOrCreateReferralProfile, getReferralForUser } from "@/lib/referral/attribution-service";
import { readReferralDbError, referralDb, referralTables } from "@/lib/referral/db";
import { maxAutomaticPayoutUsdc, payUsdcFromTreasury, TreasuryError } from "@/lib/referral/treasury";
import type { ReferralTier } from "@/lib/referral/types";

/** Smallest claim; below it earnings keep accruing. */
export const MIN_REFERRAL_CLAIM_USDC = 1;

/** The rolling window that decides whether a referral is active. */
const ACTIVE_WINDOW_DAYS = 30;

export type TierPolicy = {
  activeMinTransactions: number;
  commissionBps: number;
  minActiveReferrals: number;
  minMonthlyVolumeUsd: number;
  sort: number;
  tier: ReferralTier;
};

/** Built-in policy, used if the config table can't be read. */
const fallbackPolicy: TierPolicy[] = [
  { activeMinTransactions: 5, commissionBps: 1000, minActiveReferrals: 0, minMonthlyVolumeUsd: 0, sort: 1, tier: "STARTER" },
  { activeMinTransactions: 5, commissionBps: 1500, minActiveReferrals: 10, minMonthlyVolumeUsd: 5000, sort: 2, tier: "BUILDER" },
  { activeMinTransactions: 5, commissionBps: 2000, minActiveReferrals: 50, minMonthlyVolumeUsd: 35000, sort: 3, tier: "ARCHITECT" },
  { activeMinTransactions: 5, commissionBps: 2500, minActiveReferrals: 200, minMonthlyVolumeUsd: 100000, sort: 4, tier: "AMBASSADOR" },
];

export class ReferralClaimError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ReferralClaimError";
  }
}

/** The tier ladder, from the config table (thresholds change without a deploy). */
export async function loadTierPolicy(): Promise<TierPolicy[]> {
  const { data, error } = await referralDb().from("referral_tier_policy").select("*").order("sort");
  if (error || !data?.length) return fallbackPolicy;
  return (data as Array<Record<string, unknown>>).map((row) => ({
    activeMinTransactions: Number(row.active_min_transactions),
    commissionBps: Number(row.commission_bps),
    minActiveReferrals: Number(row.min_active_referrals),
    minMonthlyVolumeUsd: Number(row.min_monthly_volume_usd),
    sort: Number(row.sort),
    tier: row.tier as ReferralTier,
  }));
}

function monthStartIso(at = new Date()) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
}

/**
 * A referrer's standing: active referrals (enough transactions in the last 30
 * days) and this month's eligible volume across all their referrals, and the
 * highest tier both clear. Tier changes only ever apply to new transactions.
 */
export async function referrerStanding(referrerWallet: string, policy?: TierPolicy[]) {
  const ladder = policy ?? (await loadTierPolicy());
  const referrer = referrerWallet.toLowerCase();
  const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000).toISOString();
  const db = referralDb();
  const [recent, month] = await Promise.all([
    db
      .from("referral_fee_earnings")
      .select("referred_wallet")
      .eq("referrer_wallet", referrer)
      .neq("status", "REVERSED")
      .gte("created_at", since),
    db
      .from("referral_fee_earnings")
      .select("volume_usd")
      .eq("referrer_wallet", referrer)
      .neq("status", "REVERSED")
      .gte("created_at", monthStartIso()),
  ]);
  const perReferral = new Map<string, number>();
  for (const row of (recent.data ?? []) as Array<{ referred_wallet: string }>) {
    perReferral.set(row.referred_wallet, (perReferral.get(row.referred_wallet) ?? 0) + 1);
  }
  const monthlyVolumeUsd = ((month.data ?? []) as Array<{ volume_usd: number }>).reduce(
    (sum, row) => sum + Number(row.volume_usd),
    0,
  );
  const activeFor = (minTransactions: number) =>
    [...perReferral.values()].filter((count) => count >= minTransactions).length;

  const sorted = [...ladder].sort((a, b) => a.sort - b.sort);
  let current = sorted[0];
  for (const step of sorted) {
    if (activeFor(step.activeMinTransactions) >= step.minActiveReferrals && monthlyVolumeUsd >= step.minMonthlyVolumeUsd) {
      current = step;
    }
  }
  const next = sorted.find((step) => step.sort > current.sort) ?? null;
  return {
    activeReferrals: activeFor(current.activeMinTransactions),
    monthlyVolumeUsd,
    next,
    tier: current,
  };
}

/**
 * Accrue the referrer's share of a confirmed referral transaction's fee. One
 * row per transaction (unique on hash), so a retry never pays twice. Flagged
 * referrals accrue as HELD until reviewed; blocked or reversed ones earn
 * nothing. Direct referrals only: the referrer's own referrer gets nothing.
 */
export async function accrueReferralCommission(input: {
  feeUsd: number;
  referredWallet: string;
  source: string;
  txHash: string;
  volumeUsd: number;
}) {
  if (!Number.isFinite(input.feeUsd) || input.feeUsd <= 0) return null;
  const referral = await getReferralForUser(input.referredWallet);
  if (!referral) return null;
  if (referral.status === "REJECTED" || referral.status === "REVERSED" || referral.fraud_status === "BLOCKED") {
    return null;
  }
  const held =
    referral.status === "FRAUD_REVIEW" ||
    referral.fraud_status === "HIGH_RISK" ||
    referral.fraud_status === "REVIEW_REQUIRED";

  const standing = await referrerStanding(referral.referrer_wallet);
  // A creator partner earns their contract rate while it runs (CREATOR-PARTNERS-PLAN.md).
  const commissionBps = effectiveCommissionBps(
    await loadPartnerByWallet(referral.referrer_wallet),
    standing.tier.commissionBps,
  );
  const amount = Math.floor(input.feeUsd * commissionBps * 100) / 1_000_000; // 6 decimals
  const { data, error } = await referralDb()
    .from("referral_fee_earnings")
    .insert({
      amount_usdc: amount,
      commission_bps: commissionBps,
      fee_usd: input.feeUsd,
      referred_wallet: input.referredWallet.toLowerCase(),
      referrer_wallet: referral.referrer_wallet.toLowerCase(),
      source: input.source,
      status: held ? "HELD" : "ACCRUED",
      tier: standing.tier.tier,
      tx_hash: input.txHash.toLowerCase(),
      volume_usd: Math.max(0, input.volumeUsd),
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return null; // already counted
    throw new Error(readReferralDbError(error, "Referral earnings could not be recorded."));
  }
  return data as { amount_usdc: number; referrer_wallet: string; status: string; tier: string };
}

/** Everything the Invite & Earn page shows. */
export async function loadReferralEarnings(walletAddress: string, origin: string) {
  const wallet = walletAddress.toLowerCase();
  const db = referralDb();
  const policy = await loadTierPolicy();
  const [profile, username, standing, earnings, referrals, claims] = await Promise.all([
    getOrCreateReferralProfile(wallet),
    db.from(referralTables.userProfiles).select("username").eq("wallet_address", wallet).maybeSingle(),
    referrerStanding(wallet, policy),
    db
      .from("referral_fee_earnings")
      .select("amount_usdc,status,created_at,referred_wallet,source")
      .eq("referrer_wallet", wallet)
      .order("created_at", { ascending: false })
      .limit(500),
    db.from(referralTables.referrals).select("referred_wallet,referred_username_snapshot,status").eq("referrer_wallet", wallet),
    db
      .from("referral_usdc_claims")
      .select("id,amount_usdc,status,payout_tx_hash,created_at")
      .eq("referrer_wallet", wallet)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const rows = (earnings.data ?? []) as Array<{
    amount_usdc: number;
    created_at: string;
    referred_wallet: string;
    source: string;
    status: string;
  }>;
  const sum = (status: string) =>
    rows.filter((row) => row.status === status).reduce((total, row) => total + Number(row.amount_usdc), 0);
  const handle = (username.data as { username?: string } | null)?.username || profile.referral_token;

  return {
    accruedUsdc: sum("ACCRUED"),
    activeReferrals: standing.activeReferrals,
    claimedUsdc: sum("CLAIMED"),
    claims: (claims.data ?? []) as Array<{
      amount_usdc: number;
      created_at: string;
      id: string;
      payout_tx_hash: string | null;
      status: string;
    }>,
    heldUsdc: sum("HELD"),
    minClaimUsdc: MIN_REFERRAL_CLAIM_USDC,
    monthlyVolumeUsd: standing.monthlyVolumeUsd,
    nextTier: standing.next,
    policy,
    recent: rows.slice(0, 20).map((row) => ({
      amountUsdc: Number(row.amount_usdc),
      createdAt: row.created_at,
      referredWallet: row.referred_wallet,
      source: row.source,
      status: row.status,
    })),
    // The username is the code people type at sign-up; the token is the fallback.
    referralCode: handle,
    referralLink: `${origin.replace(/\/$/, "")}/r/${handle}`,
    tier: standing.tier,
    totalReferrals: ((referrals.data ?? []) as Array<{ status: string }>).filter(
      (row) => row.status !== "REJECTED" && row.status !== "REVERSED",
    ).length,
  };
}

/**
 * Pay out everything accrued, once it reaches the minimum. Earnings are
 * locked to the claim first (only ACCRUED rows can move), so two claims can
 * never pay the same earnings. Above the automatic payout cap the claim waits
 * for review; a payout that fails before sending puts the earnings back.
 */
export async function claimReferralEarnings(walletAddress: string) {
  const wallet = walletAddress.toLowerCase();
  const db = referralDb();
  const { data: open, error } = await db
    .from("referral_fee_earnings")
    .select("id,amount_usdc")
    .eq("referrer_wallet", wallet)
    .eq("status", "ACCRUED");
  if (error) throw new Error(error.message);
  const rows = (open ?? []) as Array<{ amount_usdc: number; id: string }>;
  const total = rows.reduce((sum, row) => sum + Number(row.amount_usdc), 0);
  if (total < MIN_REFERRAL_CLAIM_USDC) {
    throw new ReferralClaimError(`You can claim once you've earned at least $${MIN_REFERRAL_CLAIM_USDC.toFixed(2)}.`);
  }

  const { data: claim, error: claimError } = await db
    .from("referral_usdc_claims")
    .insert({ amount_usdc: total, referrer_wallet: wallet })
    .select("id")
    .single();
  if (claimError) throw new Error(claimError.message);
  const claimId = (claim as { id: string }).id;

  const { data: locked, error: lockError } = await db
    .from("referral_fee_earnings")
    .update({ claim_id: claimId, status: "CLAIMED" })
    .in("id", rows.map((row) => row.id))
    .eq("status", "ACCRUED")
    .select("id,amount_usdc");
  if (lockError) throw new Error(lockError.message);
  const amount =
    Math.floor(((locked ?? []) as Array<{ amount_usdc: number }>).reduce((sum, row) => sum + Number(row.amount_usdc), 0) * 1e6) / 1e6;
  if (amount < MIN_REFERRAL_CLAIM_USDC) {
    // Another claim took them first: put back anything this one locked.
    await db.from("referral_fee_earnings").update({ claim_id: null, status: "ACCRUED" }).eq("claim_id", claimId);
    await db.from("referral_usdc_claims").delete().eq("id", claimId);
    throw new ReferralClaimError("Those earnings are already being claimed.", 409);
  }
  await db.from("referral_usdc_claims").update({ amount_usdc: amount }).eq("id", claimId);

  if (amount > maxAutomaticPayoutUsdc()) {
    await db
      .from("referral_usdc_claims")
      .update({ status: "REVIEW", updated_at: new Date().toISOString() })
      .eq("id", claimId);
    return { amountUsdc: amount, claimId, review: true as const, txHash: null };
  }

  try {
    const txHash = await payUsdcFromTreasury({ to: wallet, usdcAmount: amount });
    await db
      .from("referral_usdc_claims")
      .update({ payout_tx_hash: txHash, status: "PAID", updated_at: new Date().toISOString() })
      .eq("id", claimId);
    return { amountUsdc: amount, claimId, review: false as const, txHash };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The payout failed.";
    if (cause instanceof TreasuryError) {
      // Nothing was sent: the earnings go back to claimable.
      await db.from("referral_fee_earnings").update({ claim_id: null, status: "ACCRUED" }).eq("claim_id", claimId);
      await db
        .from("referral_usdc_claims")
        .update({ last_error: message, status: "FAILED", updated_at: new Date().toISOString() })
        .eq("id", claimId);
      throw new ReferralClaimError(`${message} Your earnings are still there to claim.`, 503);
    }
    // The transfer may have gone out: keep it for review rather than pay twice.
    await db
      .from("referral_usdc_claims")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", claimId);
    throw new ReferralClaimError("We couldn't confirm the payout yet. It's being checked; don't claim again.", 502);
  }
}
