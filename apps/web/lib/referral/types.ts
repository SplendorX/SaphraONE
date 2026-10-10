/**
 * Core Types and Constants for SaphraONE Referral & OnePoints System.
 * Enforces all fintech rules from the build specification.
 */

export type ReferralTier = "STARTER" | "BUILDER" | "ARCHITECT" | "AMBASSADOR";

export type ReferredAccountType = "PERSONAL" | "BUSINESS";

export type ReferralStatus =
  | "CLICKED"
  | "SIGNED_UP"
  | "VERIFIED"
  | "ACTIVATED"
  | "PENDING_QUALIFICATION"
  | "QUALIFIED"
  | "REWARDED"
  | "FRAUD_REVIEW"
  | "REJECTED"
  | "REVERSED";

export type ReferralFraudStatus =
  | "LOW_RISK"
  | "MEDIUM_RISK"
  | "HIGH_RISK"
  | "REVIEW_REQUIRED"
  | "BLOCKED";

export type QualificationMethod =
  | "TRANSACTION_COUNT"
  | "TRANSACTION_VOLUME"
  | "BUSINESS_VOLUME";

export type OnePointsEntryType =
  | "REFERRER_PERSONAL_QUALIFICATION_REWARD"
  | "REFERRER_BUSINESS_QUALIFICATION_REWARD"
  | "REFERRED_PERSONAL_QUALIFICATION_REWARD"
  | "REFERRED_BUSINESS_QUALIFICATION_REWARD"
  | "REFERRER_PERSONAL_ACTIVITY_CASHBACK"
  | "REFERRER_BUSINESS_ACTIVITY_CASHBACK"
  | "TRANSACTION_CASHBACK"
  | "STREAK_REWARD"
  | "QUEST_REWARD"
  | "DISCOUNT_CLAIM"
  | "REDEMPTION"
  | "PURCHASE"
  | "GIFT_SENT"
  | "GIFT_RECEIVED"
  | "ENTITLEMENT_UNLOCK"
  | "ADMIN_ADJUSTMENT"
  | "REVERSAL";

/** Features that can be unlocked by spending OnePoints. */
export type OnePointsFeature =
  | "EARN_AUTO_DEPOSIT"
  | "PAYROLL_AUTO_SCHEDULE";

/** Unlock prices, in OnePoints. Each purchase covers one term. */
export const FEATURE_UNLOCK_COST: Record<OnePointsFeature, number> = {
  EARN_AUTO_DEPOSIT: 500,
  PAYROLL_AUTO_SCHEDULE: 1_500,
};



/** How long one paid unlock lasts, per feature. */
export const FEATURE_UNLOCK_TERM_MONTHS: Record<OnePointsFeature, number> = {
  EARN_AUTO_DEPOSIT: 2,
  PAYROLL_AUTO_SCHEDULE: 3,
};

export const FEATURE_UNLOCK_TERM_LABEL: Record<OnePointsFeature, string> = {
  EARN_AUTO_DEPOSIT: "2 months",
  PAYROLL_AUTO_SCHEDULE: "3 months",
};

export type OnePointsEntitlementRecord = {
  id: string;
  wallet_address: string;
  feature: OnePointsFeature;
  points_spent: number;
  ledger_entry_id: string | null;
  granted_at: string;
  renewed_at: string | null;
  /** Access is active while now < expires_at. */
  expires_at: string;
};

export type OnePointsGiftRecord = {
  id: string;
  sender_wallet: string;
  recipient_wallet: string;
  points: number;
  note: string | null;
  idempotency_key: string;
  created_at: string;
};

export type OnePointsPurchaseRecord = {
  id: string;
  wallet_address: string;
  points: number;
  usdc_amount: number;
  chain_id: number;
  tx_hash: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  created_at: string;
};

export type RedemptionStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REVERSED";

export const ONE_POINTS_UNITS_PER_POINT = 100n; // 100 internal units = 1 ONE Point
export const ONE_POINTS_USD_PER_POINT = 0.01; // 1 ONE Point = 0.01 USDC
export const MINIMUM_REDEMPTION_ONE_POINTS = 100;

// Double-sided Welcome Reward for referred account upon qualification
export const REFERRED_QUALIFICATION_REWARD_POINTS = 20;

export type ReferralProfileRecord = {
  id: string;
  wallet_address: string;
  referral_token: string;
  total_successful_referrals: number;
  successful_personal_referrals: number;
  successful_business_referrals: number;
  current_tier: ReferralTier;
  tier_upgraded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReferralRecord = {
  id: string;
  referrer_wallet: string;
  referred_wallet: string;
  referral_token: string;
  referred_username_snapshot: string | null;
  referrer_username_snapshot: string | null;
  referred_account_type: ReferredAccountType;
  status: ReferralStatus;
  fraud_status: ReferralFraudStatus;
  tier_at_qualification: ReferralTier | null;
  successful_referral_position: number | null;
  direct_reward_amount: number;
  clicked_at: string | null;
  signed_up_at: string | null;
  verified_at: string | null;
  activated_at: string | null;
  qualified_at: string | null;
  rewarded_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ReferralQualificationRecord = {
  id: string;
  referral_id: string;
  referred_wallet: string;
  referrer_wallet: string;
  account_type: ReferredAccountType;
  tier_at_qualification: ReferralTier;
  qualification_method: QualificationMethod;
  qualifying_transaction_count: number;
  qualifying_transaction_volume: number;
  activation_balance: number;
  policy_version: string;
  qualification_snapshot: Record<string, unknown>;
  referrer_reward_points: number;
  referred_reward_points: number;
  created_at: string;
};

export type OnePointsAccountRecord = {
  id: string;
  wallet_address: string;
  available_balance_units: string | number | bigint;
  pending_balance_units: string | number | bigint;
  lifetime_earned_units: string | number | bigint;
  lifetime_redeemed_units: string | number | bigint;
  created_at: string;
  updated_at: string;
};

export type OnePointsLedgerEntryRecord = {
  id: string;
  account_id: string;
  wallet_address: string;
  entry_type: OnePointsEntryType;
  amount_units: string | number | bigint;
  display_amount: number;
  usdc_equivalent: number;
  status: string;
  idempotency_key: string;
  referral_id: string | null;
  transaction_id: string | null;
  campaign_id: string | null;
  original_ledger_entry_id: string | null;
  description: string;
  metadata: Record<string, unknown>;
  policy_version: string;
  created_at: string;
  created_by: string;
};

export type OnePointsRedemptionRecord = {
  id: string;
  wallet_address: string;
  points_redeemed: number;
  amount_units: string | number | bigint;
  usdc_amount: number;
  destination_wallet: string;
  status: RedemptionStatus;
  idempotency_key: string;
  ledger_entry_id: string | null;
  tx_hash: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type ReferralRewardPolicy = {
  tier: ReferralTier;
  referredAccountType: ReferredAccountType;
  activationBalanceThreshold: number; // e.g. 50 USDC for Personal, 500 USDC for Business
  // Personal either/or
  transactionCountRequirement: number;
  transactionMinAmount: number;
  transactionVolumeRequirement: number;
  // Direct rewards
  referrerDirectRewardPoints: number;
  referredAccountRewardPoints: number;
  // Activity cashback (Referrer only)
  activityCashbackPoints: number;
  activityTransactionMinAmount: number;
  policyVersion: string;
};

export type ReferralDashboardData = {
  referralLink: string;
  referralToken: string;
  currentTier: ReferralTier;
  totalSuccessfulReferrals: number;
  successfulPersonalReferrals: number;
  successfulBusinessReferrals: number;
  metrics: {
    invited: number;
    joined: number;
    active: number;
    pending: number;
    qualified: number;
  };
  onePoints: {
    available: number;
    pending: number;
    lifetimeEarned: number;
    redeemed: number;
    usdcEquivalent: number;
  };
  tierProgress: {
    currentTier: ReferralTier;
    nextTier: ReferralTier | null;
    currentCount: number;
    targetCount: number;
    progressPercentage: number;
  };
  activity: Array<{
    id: string;
    referredUserOrBusiness: string;
    accountType: ReferredAccountType;
    status: ReferralStatus;
    joinedDate: string;
    qualifiedDate: string | null;
    rewardEarnedPoints: number;
    activityCashbackGeneratedPoints: number;
    progress: {
      /** USD of verified payments counted since sign-up. */
      qualifyingVolume: number;
      /** USD volume that qualifies at the referrer's current tier. */
      targetVolume: number;
      /** Payments counted toward the volume. */
      paymentCount: number;
      /** Last reconciliation against the chain; null if never synced. */
      lastSyncedAt: string | null;
    };
  }>;
};

export type TierProgress = ReferralDashboardData["tierProgress"];
export type OnePointsLedgerEntry = OnePointsLedgerEntryRecord;
export type ReferralActivityType =
  | "TRANSFER"
  | "INVOICE_PAYMENT"
  | "PAYROLL_DISBURSEMENT"
  | "SWAP"
  | "POCKET_DEPOSIT"
  | "BATCH_PAYMENT";

