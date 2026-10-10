import { referralDb, referralTables, readReferralDbError } from "@/lib/referral/db";
import { recordLedgerEntry } from "@/lib/referral/ledger-service";
import { getReferralRewardPolicy } from "@/lib/referral/policy-service";
import { getTier, getTierForPosition } from "@/lib/referral/tier-service";
import { getOrCreateReferralProfile } from "@/lib/referral/attribution-service";
import type {
  QualificationMethod,
  ReferralQualificationRecord,
  ReferralRecord,
} from "@/lib/referral/types";
import { createSavingsNotificationResult } from "@/lib/save/notifications";
import { stablecoinUsdValue } from "@/lib/referral/fx";
import type { VerifiedOutflow } from "@/lib/referral/verify-activity";

/**
 * Atomically qualify a referral and issue the double-sided reward.
 * Strictly guarantees:
 * - One-time qualification
 * - Atomic tier evaluation
 * - Idempotent ledger entry minting
 * - Double-sided reward: Tier-based for Referrer, 20 OnePoints for Referred
 */
export async function qualifyReferral(input: {
  referralId: string;
  qualificationMethod: QualificationMethod;
  qualifyingTransactionCount: number;
  qualifyingTransactionVolume: number;
  activationBalance: number;
  metadata?: Record<string, unknown>;
}): Promise<{
  referral: ReferralRecord;
  qualification: ReferralQualificationRecord;
  tierUpgraded: boolean;
}> {
  const supabase = referralDb();

  // 1. Fetch referral record
  const { data: referralRow, error: referralErr } = await supabase
    .from(referralTables.referrals)
    .select("*")
    .eq("id", input.referralId)
    .single();

  if (referralErr || !referralRow) {
    throw new Error("Referral not found.");
  }

  const referral = referralRow as ReferralRecord;

  // Idempotency: If already qualified, return existing record
  if (referral.status === "QUALIFIED" || referral.status === "REWARDED") {
    const { data: qual } = await supabase
      .from(referralTables.qualifications)
      .select("*")
      .eq("referral_id", referral.id)
      .single();

    return {
      referral,
      qualification: qual as ReferralQualificationRecord,
      tierUpgraded: false,
    };
  }

  // 2. Fetch Referrer Profile & Lock position
  const referrerProfile = await getOrCreateReferralProfile(referral.referrer_wallet);
  const currentCount = referrerProfile.total_successful_referrals;
  const newPosition = currentCount + 1;
  const tierAtQualification = getTierForPosition(newPosition);

  // 3. Load applicable policy for this tier and account type
  const policy = getReferralRewardPolicy(tierAtQualification, referral.referred_account_type);

  // 4. Record Qualification Snapshot
  const qualInsert = await supabase
    .from(referralTables.qualifications)
    .insert({
      referral_id: referral.id,
      referred_wallet: referral.referred_wallet,
      referrer_wallet: referral.referrer_wallet,
      account_type: referral.referred_account_type,
      tier_at_qualification: tierAtQualification,
      qualification_method: input.qualificationMethod,
      qualifying_transaction_count: input.qualifyingTransactionCount,
      qualifying_transaction_volume: input.qualifyingTransactionVolume,
      activation_balance: input.activationBalance,
      policy_version: policy.policyVersion,
      qualification_snapshot: {
        ...input.metadata,
        policy,
        newPosition,
        evaluatedAt: new Date().toISOString(),
      },
      referrer_reward_points: policy.referrerDirectRewardPoints,
      referred_reward_points: policy.referredAccountRewardPoints,
    })
    .select("*")
    .single();

  if (qualInsert.error) {
    if (qualInsert.error.code === "23505") {
      const existing = await supabase
        .from(referralTables.qualifications)
        .select("*")
        .eq("referral_id", referral.id)
        .single();
      return {
        referral,
        qualification: existing.data as ReferralQualificationRecord,
        tierUpgraded: false,
      };
    }
    throw new Error(readReferralDbError(qualInsert.error, "Could not save qualification snapshot."));
  }

  // 5. Update Referral Status
  const refUpdate = await supabase
    .from(referralTables.referrals)
    .update({
      status: "REWARDED",
      tier_at_qualification: tierAtQualification,
      successful_referral_position: newPosition,
      direct_reward_amount: policy.referrerDirectRewardPoints,
      qualified_at: new Date().toISOString(),
      rewarded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", referral.id)
    .select("*")
    .single();

  if (refUpdate.error) {
    throw new Error(readReferralDbError(refUpdate.error, "Could not update referral status."));
  }

  // 6. Double-Sided Reward Issuance:
  // 6a. Referrer Direct Reward
  const referrerEntryType =
    referral.referred_account_type === "BUSINESS"
      ? "REFERRER_BUSINESS_QUALIFICATION_REWARD"
      : "REFERRER_PERSONAL_QUALIFICATION_REWARD";

  await recordLedgerEntry({
    walletAddress: referral.referrer_wallet,
    entryType: referrerEntryType,
    points: policy.referrerDirectRewardPoints,
    idempotencyKey: `referral:${referral.id}:referrer_reward`,
    description: `Referral reward for qualifying ${
      referral.referred_account_type === "BUSINESS" ? "Business" : "friend"
    } (#${newPosition})`,
    referralId: referral.id,
    policyVersion: policy.policyVersion,
    metadata: {
      tier: tierAtQualification,
      position: newPosition,
      accountType: referral.referred_account_type,
    },
  });

  // 6b. Referred Account Reward (20 OnePoints once)
  const referredEntryType =
    referral.referred_account_type === "BUSINESS"
      ? "REFERRED_BUSINESS_QUALIFICATION_REWARD"
      : "REFERRED_PERSONAL_QUALIFICATION_REWARD";

  await recordLedgerEntry({
    walletAddress: referral.referred_wallet,
    entryType: referredEntryType,
    points: policy.referredAccountRewardPoints, // 20 OnePoints
    idempotencyKey: `referral:${referral.id}:referred_reward`,
    description: "Welcome reward for completing qualifying activation",
    referralId: referral.id,
    policyVersion: policy.policyVersion,
  });

  const nextTotal = currentCount + 1;

  const newTier = getTier(nextTotal);
  const tierUpgraded = newTier !== referrerProfile.current_tier;

  if (tierUpgraded) {
    // Log tier crossing
    await supabase.from(referralTables.tierHistory).insert({
      wallet_address: referral.referrer_wallet,
      previous_tier: referrerProfile.current_tier,
      new_tier: newTier,
      total_successful_referrals: nextTotal,
      referral_id: referral.id,
    });

    // Notify referrer of tier upgrade
    void createSavingsNotificationResult({
      ownerWallet: referral.referrer_wallet,
      kind: "payment_received",
      title: `Tier Upgraded: You're now a ${newTier}!`,
      body: `Congratulations! With ${nextTotal} successful referrals, your account now earns higher rewards and cashback as an official ${newTier}.`,
      metadata: { newTier, totalReferrals: nextTotal },
    });
  }

  // 8. Notifications
  void createSavingsNotificationResult({
    ownerWallet: referral.referrer_wallet,
    kind: "payment_received",
    title: `Referral Qualified (+${policy.referrerDirectRewardPoints} OnePoints)`,
    body: `Your referral has successfully qualified! +${policy.referrerDirectRewardPoints} OnePoints have been credited to your rewards ledger.`,
    metadata: { referralId: referral.id, points: policy.referrerDirectRewardPoints },
  });

  void createSavingsNotificationResult({
    ownerWallet: referral.referred_wallet,
    kind: "payment_received",
    title: `Welcome Reward Unlocked (+${policy.referredAccountRewardPoints} OnePoints)`,
    body: `Congratulations on activating your SaphraONE account! +${policy.referredAccountRewardPoints} OnePoints have been credited to your rewards wallet.`,
    metadata: { referralId: referral.id, points: policy.referredAccountRewardPoints },
  });

  return {
    referral: refUpdate.data as ReferralRecord,
    qualification: qualInsert.data as ReferralQualificationRecord,
    tierUpgraded,
  };
}

/** One verified outgoing payment counted toward a referral milestone. */
export type ReferralProgressContribution = {
  /** On-chain hash; each transaction counts once however often it is reported. */
  txHash: string;
  amountUsd: number;
  /**
   * USD sent to each recipient (lowercase address), from the receipt. Required
   * so the part paid to the invitee's own referrer can be left out.
   */
  payeesUsd: Record<string, number>;
};

/**
 * A referral contribution from a receipt-verified outflow. Only payments that
 * went through SaphraONE and paid its fee count: a plain token transfer costs
 * nothing, so otherwise a new wallet could reach a milestone by moving the
 * same money between its owner's own wallets.
 */
export async function referralContribution(
  txHash: string,
  outflow: VerifiedOutflow,
): Promise<ReferralProgressContribution> {
  if (!(outflow.feePaid > 0)) {
    return { txHash, amountUsd: 0, payeesUsd: {} };
  }
  const payeesUsd: Record<string, number> = {};
  for (const [to, amount] of Object.entries(outflow.payees)) {
    payeesUsd[to] = await stablecoinUsdValue(amount, outflow.token);
  }
  return {
    txHash,
    amountUsd: await stablecoinUsdValue(outflow.amount, outflow.token),
    payeesUsd,
  };
}

/** Counted volume per referral, summed from the payments table. */
export async function loadReferralVolumes(referralIds: string[]) {
  const volumes = new Map<string, { volumeUsd: number; paymentCount: number; hashes: Set<string> }>();
  if (referralIds.length === 0) return volumes;

  const { data, error } = await referralDb()
    .from(referralTables.progressPayments)
    .select("referral_id, tx_hash, amount_usd")
    .in("referral_id", referralIds);
  if (error) {
    throw new Error(readReferralDbError(error, "Could not load referral progress."));
  }

  for (const row of data ?? []) {
    const entry = volumes.get(row.referral_id) ?? { volumeUsd: 0, paymentCount: 0, hashes: new Set() };
    entry.volumeUsd += Number(row.amount_usd);
    entry.paymentCount += 1;
    entry.hashes.add(String(row.tx_hash).toLowerCase());
    volumes.set(row.referral_id, entry);
  }
  return volumes;
}

export function readLastSyncedAt(metadata: Record<string, unknown> | null | undefined) {
  return typeof metadata?.last_synced_at === "string" ? metadata.last_synced_at : null;
}

/**
 * Evaluates a referred user's qualification after a payment or a chain sync.
 *
 * Qualification is volume only: the invitee's verified payments since sign-up,
 * excluding anything paid to the referrer, reach the Referrer's tier target —
 *    - Personal: 250 / 500 / 750 / 1250 USD (Starter → Ambassador)
 *    - Business: 1000 / 2000 / 3000 / 5000 USD
 *
 * Each payment is a row in `referral_progress_payments`, unique per
 * transaction, and volume is the sum of those rows. Concurrent reports of the
 * same payment (live activity + dashboard sync) therefore count it once, and
 * whichever writer finishes last sees the full total.
 *
 * Upon qualifying:
 * - Direct reward issued to Referrer (tier-based OnePoints)
 * - Welcome reward issued to Referred user (20 OnePoints across ALL tiers)
 */
export async function evaluateReferralProgressAndQualify(input: {
  referredWallet: string;
  contributions?: ReferralProgressContribution[];
  /** Where the contributions came from, for auditing. */
  source?: "activity" | "recurring" | "payroll" | "chain_sync";
  /** Stamp the referral as freshly reconciled against the chain. */
  markSynced?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<{
  isReferred: boolean;
  qualified: boolean;
  rewardAwarded: boolean;
  volumeUsd?: number;
  qualificationResult?: {
    referral: ReferralRecord;
    qualification: ReferralQualificationRecord;
    tierUpgraded: boolean;
  };
}> {
  const wallet = input.referredWallet.toLowerCase();
  const supabase = referralDb();

  // 1. Check if user was referred
  const { data: referralRow } = await supabase
    .from(referralTables.referrals)
    .select("*")
    .eq("referred_wallet", wallet)
    .maybeSingle();

  if (!referralRow) {
    return { isReferred: false, qualified: false, rewardAwarded: false };
  }

  const referral = referralRow as ReferralRecord;

  if (referral.status === "QUALIFIED" || referral.status === "REWARDED") {
    return { isReferred: true, qualified: true, rewardAwarded: true };
  }

  // Referrals held for review or reversed never progress on their own.
  if (
    referral.status === "FRAUD_REVIEW" ||
    referral.status === "REJECTED" ||
    referral.status === "REVERSED"
  ) {
    return { isReferred: true, qualified: false, rewardAwarded: false };
  }

  // 2. Record new payments; the unique key drops any already counted.
  // Money sent to the referrer never counts: otherwise the pair could cycle
  // the same funds back and forth to farm both rewards.
  const referrer = referral.referrer_wallet.toLowerCase();
  const rows = (input.contributions ?? [])
    .map((contribution) => ({
      referral_id: referral.id,
      tx_hash: contribution.txHash.toLowerCase(),
      amount_usd: Number(
        Math.max(0, contribution.amountUsd - (contribution.payeesUsd[referrer] ?? 0)).toFixed(6),
      ),
      source: input.source ?? "activity",
    }))
    .filter((row) => row.amount_usd > 0);
  if (rows.length > 0) {
    const { error } = await supabase
      .from(referralTables.progressPayments)
      .upsert(rows, { onConflict: "referral_id,tx_hash", ignoreDuplicates: true });
    if (error) {
      throw new Error(readReferralDbError(error, "Could not record referral progress."));
    }
  }

  // 3. Volume is the sum of counted payments, read after our own write.
  const counted = (await loadReferralVolumes([referral.id])).get(referral.id);
  const volumeUsd = counted?.volumeUsd ?? 0;
  const referrerProfile = await getOrCreateReferralProfile(referral.referrer_wallet);
  const policy = getReferralRewardPolicy(referrerProfile.current_tier, referral.referred_account_type);
  const qualified = volumeUsd >= policy.transactionVolumeRequirement;

  const now = new Date().toISOString();
  if (!qualified && (volumeUsd > 0 || input.markSynced)) {
    await supabase
      .from(referralTables.referrals)
      .update({
        ...(volumeUsd > 0 && referral.status !== "PENDING_QUALIFICATION"
          ? { status: "PENDING_QUALIFICATION" }
          : {}),
        ...(input.markSynced
          ? { metadata: { ...referral.metadata, last_synced_at: now } }
          : {}),
        updated_at: now,
      })
      .eq("id", referral.id);
  }

  // 4. Qualification is idempotent: concurrent winners resolve to one reward.
  if (qualified) {
    const qualificationResult = await qualifyReferral({
      referralId: referral.id,
      qualificationMethod:
        referral.referred_account_type === "BUSINESS" ? "BUSINESS_VOLUME" : "TRANSACTION_VOLUME",
      qualifyingTransactionCount: counted?.paymentCount ?? 0,
      qualifyingTransactionVolume: volumeUsd,
      activationBalance: 0,
      metadata: input.metadata,
    });

    return { isReferred: true, qualified: true, rewardAwarded: true, volumeUsd, qualificationResult };
  }

  return { isReferred: true, qualified: false, rewardAwarded: false, volumeUsd };
}
