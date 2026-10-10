import { referralDb, referralTables } from "@/lib/referral/db";
import { pointsToInternalUnits, recordLedgerEntry } from "@/lib/referral/ledger-service";
import { getReferralRewardPolicy } from "@/lib/referral/policy-service";
import { getOrCreateReferralProfile } from "@/lib/referral/attribution-service";
import type { ReferralRecord } from "@/lib/referral/types";

/**
 * Evaluate an eligible settled transaction made by a user and award activity cashback
 * to the referrer if the user was referred and qualified.
 *
 * Enforces:
 * 1. Referral must be in 'QUALIFIED' or 'REWARDED' status.
 * 2. Only the REFERRER earns ongoing activity cashback. Referred account receives 0.
 * 3. Uses Referrer's CURRENT universal tier at the time of the transaction.
 * 4. Idempotent per transaction ID.
 */
export async function processReferralActivityCashback(input: {
  transactionId: string;
  userWallet: string;
  amountUsdc: number;
  currency?: string;
  /**
   * USD value of the platform fee the transaction paid. When given, the
   * referrer's cashback is capped at it (1 point = $0.01), so a referred
   * wallet can't generate points for its referrer with free transfers.
   */
  feePaidUsd?: number;
}): Promise<{
  cashbackAwarded: boolean;
  pointsAwarded?: number;
  referrerWallet?: string;
  reason?: string;
}> {
  const wallet = input.userWallet.toLowerCase();
  const supabase = referralDb();

  // 1. Check if user was referred
  const { data: referralRow } = await supabase
    .from(referralTables.referrals)
    .select("*")
    .eq("referred_wallet", wallet)
    .maybeSingle();

  if (!referralRow) {
    return { cashbackAwarded: false, reason: "User not referred." };
  }

  const referral = referralRow as ReferralRecord;

  // 2. Only qualified referrals generate activity cashback
  if (referral.status !== "QUALIFIED" && referral.status !== "REWARDED") {
    return { cashbackAwarded: false, reason: "Referral not yet qualified." };
  }

  // 3. Prevent duplicate cashback for the same transaction
  const existingReward = await supabase
    .from(referralTables.activityRewards)
    .select("id")
    .eq("transaction_id", input.transactionId)
    .eq("referrer_wallet", referral.referrer_wallet)
    .maybeSingle();

  if (existingReward.data) {
    return { cashbackAwarded: false, reason: "Cashback already awarded for this transaction." };
  }

  // 4. Fetch Referrer's CURRENT universal tier
  const referrerProfile = await getOrCreateReferralProfile(referral.referrer_wallet);
  const currentTier = referrerProfile.current_tier;

  // 5. Load applicable policy for this tier and account type
  const policy = getReferralRewardPolicy(currentTier, referral.referred_account_type);

  // 6. Check transaction threshold (> 10 USDC for Personal, > 50 USDC for Business)
  if (input.amountUsdc <= policy.activityTransactionMinAmount) {
    return {
      cashbackAwarded: false,
      reason: `Transaction amount (${input.amountUsdc}) does not exceed threshold (${policy.activityTransactionMinAmount}).`,
    };
  }

  const cashbackPoints =
    input.feePaidUsd === undefined
      ? policy.activityCashbackPoints
      : Math.min(
          policy.activityCashbackPoints,
          Math.floor(Math.max(0, input.feePaidUsd) * 100 * 100) / 100,
        );
  if (cashbackPoints <= 0) {
    return { cashbackAwarded: false, reason: "No SaphraONE fee was paid on this transaction." };
  }
  const deltaUnits = pointsToInternalUnits(cashbackPoints);
  const idempotencyKey = `referral:${referral.id}:transaction:${input.transactionId}:activity_cashback`;

  // 7. Credit OnePoints ledger (Referrer ONLY)
  const entryType =
    referral.referred_account_type === "BUSINESS"
      ? "REFERRER_BUSINESS_ACTIVITY_CASHBACK"
      : "REFERRER_PERSONAL_ACTIVITY_CASHBACK";

  const ledgerResult = await recordLedgerEntry({
    walletAddress: referral.referrer_wallet,
    entryType,
    points: cashbackPoints,
    idempotencyKey,
    description: `Activity cashback for ${
      referral.referred_account_type === "BUSINESS" ? "Business" : "Personal"
    } transaction ($${input.amountUsdc})`,
    referralId: referral.id,
    transactionId: input.transactionId,
    policyVersion: policy.policyVersion,
    metadata: {
      amountUsdc: input.amountUsdc,
      tier: currentTier,
      accountType: referral.referred_account_type,
    },
  });

  // 8. Record in activity rewards log
  await supabase.from(referralTables.activityRewards).insert({
    referral_id: referral.id,
    referrer_wallet: referral.referrer_wallet,
    referred_wallet: wallet,
    transaction_id: input.transactionId,
    transaction_amount: input.amountUsdc,
    transaction_currency: input.currency ?? "USDC",
    account_type: referral.referred_account_type,
    referrer_tier: currentTier,
    cashback_points: cashbackPoints,
    amount_units: Number(deltaUnits),
    usdc_equivalent: Number((cashbackPoints * 0.01).toFixed(4)),
    ledger_entry_id: ledgerResult.entry.id,
    policy_version: policy.policyVersion,
  });

  return {
    cashbackAwarded: true,
    pointsAwarded: cashbackPoints,
    referrerWallet: referral.referrer_wallet,
  };
}
