import { referralDb, referralTables, readReferralDbError } from "@/lib/referral/db";
import { getOrCreateReferralProfile } from "@/lib/referral/attribution-service";
import { getOnePointsSummary } from "@/lib/referral/ledger-service";
import { getTierProgress } from "@/lib/referral/tier-service";
import { getReferralRewardPolicy } from "@/lib/referral/policy-service";
import { needsReferralSync, syncReferralProgressFromChain } from "@/lib/referral/progress-sync";
import { loadReferralVolumes, readLastSyncedAt } from "@/lib/referral/qualification-service";
import type {
  ReferralDashboardData,
  ReferralRecord,
} from "@/lib/referral/types";

/** Pending invitees reconciled against the chain per dashboard load. */
const maxSyncsPerLoad = 10;
/** Longest the dashboard waits on those reconciliations. */
const syncBudgetMs = 8_000;

/**
 * Load complete, high-performance referral dashboard data for an authenticated user.
 */
export async function getReferralDashboard(
  walletAddress: string,
  origin = "https://app.saphra.one",
): Promise<ReferralDashboardData> {
  const wallet = walletAddress.toLowerCase();
  const supabase = referralDb();

  // 1. Fetch user's profile username
  const userProfile = await supabase
    .from(referralTables.userProfiles)
    .select("username")
    .eq("wallet_address", wallet)
    .maybeSingle();

  // 2. Fetch referrals list created by this referrer
  const loadReferrals = async () => {
    const { data: referrals, error } = await supabase
      .from(referralTables.referrals)
      .select("*")
      .eq("referrer_wallet", wallet)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(readReferralDbError(error, "Could not load referral dashboard."));
    }
    return (referrals ?? []) as ReferralRecord[];
  };

  let list = await loadReferrals();

  // Bring pending invitees up to date with the chain before showing progress.
  // Bounded so a slow explorer or RPC never blocks the dashboard for long.
  const stale = list.filter((ref) => needsReferralSync(ref)).slice(0, maxSyncsPerLoad);
  if (stale.length > 0) {
    await Promise.race([
      Promise.allSettled(stale.map((ref) => syncReferralProgressFromChain(ref))),
      new Promise((resolve) => setTimeout(resolve, syncBudgetMs)),
    ]);
    list = await loadReferrals();
  }

  // 3. Profile and points, read after the sync: a qualification it triggered moves the counters.
  const [profile, onePoints] = await Promise.all([
    getOrCreateReferralProfile(wallet),
    getOnePointsSummary(wallet),
  ]);
  const handle = userProfile.data?.username || profile.referral_token;
  const referralLink = `${origin.replace(/\/$/, "")}/r/${handle}`;

  // 4. Aggregate metrics
  let joinedCount = 0;
  let activeCount = 0;
  let pendingCount = 0;
  let qualifiedCount = 0;

  for (const r of list) {
    if (r.status === "QUALIFIED" || r.status === "REWARDED") {
      qualifiedCount++;
    } else if (r.status === "ACTIVATED" || r.status === "PENDING_QUALIFICATION") {
      activeCount++;
      pendingCount++;
    } else {
      joinedCount++;
    }
  }

  // 5. Calculate tier progress
  const tierProgress = getTierProgress(profile.total_successful_referrals);

  // 6. Format activity list with qualification volume progress
  const volumes = await loadReferralVolumes(list.map((ref) => ref.id));
  const activity = list.map((ref) => {
    const policy = getReferralRewardPolicy(profile.current_tier, ref.referred_account_type);
    const counted = volumes.get(ref.id);

    return {
      id: ref.id,
      referredUserOrBusiness: ref.referred_username_snapshot
        ? `${ref.referred_username_snapshot}.one`
        : `${ref.referred_wallet.slice(0, 6)}…${ref.referred_wallet.slice(-4)}`,
      accountType: ref.referred_account_type,
      status: ref.status,
      joinedDate: ref.created_at,
      qualifiedDate: ref.qualified_at,
      rewardEarnedPoints: ref.direct_reward_amount,
      activityCashbackGeneratedPoints: 0, // aggregate from activity rewards
      progress: {
        qualifyingVolume: Number((counted?.volumeUsd ?? 0).toFixed(2)),
        targetVolume: policy.transactionVolumeRequirement,
        paymentCount: counted?.paymentCount ?? 0,
        lastSyncedAt: readLastSyncedAt(ref.metadata),
      },
    };
  });

  return {
    referralLink,
    referralToken: profile.referral_token,
    currentTier: profile.current_tier,
    totalSuccessfulReferrals: profile.total_successful_referrals,
    successfulPersonalReferrals: profile.successful_personal_referrals,
    successfulBusinessReferrals: profile.successful_business_referrals,
    metrics: {
      invited: list.length,
      joined: joinedCount,
      active: activeCount,
      pending: pendingCount,
      qualified: qualifiedCount,
    },
    onePoints,
    tierProgress,
    activity,
  };
}

/**
 * Admin Overview Analytics.
 */
export async function getAdminReferralOverview() {
  const supabase = referralDb();

  const [referralsCount, pointsIssuedResult, pointsRedeemedResult] = await Promise.all([
    supabase.from(referralTables.referrals).select("status, referred_account_type", { count: "exact" }),
    supabase.from(referralTables.ledger).select("amount_units").gt("amount_units", 0),
    supabase.from(referralTables.ledger).select("amount_units").eq("entry_type", "REDEMPTION"),
  ]);

  let totalIssuedUnits = 0n;
  for (const row of pointsIssuedResult.data ?? []) {
    totalIssuedUnits += BigInt(row.amount_units);
  }

  let totalRedeemedUnits = 0n;
  for (const row of pointsRedeemedResult.data ?? []) {
    totalRedeemedUnits += -BigInt(row.amount_units);
  }

  const issuedPoints = Number(totalIssuedUnits) / 100;
  const redeemedPoints = Number(totalRedeemedUnits) / 100;
  const currentLiabilityUsdc = Number(((issuedPoints - redeemedPoints) * 0.01).toFixed(2));

  return {
    totalReferrals: referralsCount.count ?? 0,
    totalOnePointsIssued: issuedPoints,
    totalOnePointsRedeemed: redeemedPoints,
    currentRewardLiabilityUsdc: currentLiabilityUsdc,
  };
}

/**
 * Detailed Admin Analytics & Economics.
 */
export async function getAdminDetailedAnalytics() {
  const supabase = referralDb();

  const [
    attributionsCount,
    referralsResult,
    pointsIssuedResult,
    pointsRedeemedResult,
    activityRewardsResult,
    qualificationsResult,
    profilesResult,
    tierBreakdownResult,
    redemptionsResult,
    riskAssessmentsResult,
  ] = await Promise.all([
    supabase.from(referralTables.attributions).select("id", { count: "exact", head: true }),
    supabase.from(referralTables.referrals).select("status, referred_account_type, direct_reward_amount"),
    supabase.from(referralTables.ledger).select("amount_units").gt("amount_units", 0),
    supabase.from(referralTables.ledger).select("amount_units").eq("entry_type", "REDEMPTION"),
    supabase.from(referralTables.activityRewards).select("transaction_volume, referrer_reward_points"),
    supabase.from(referralTables.qualifications).select("qualifying_transaction_volume, referrer_reward_points, referred_reward_points"),
    supabase.from(referralTables.profiles).select("wallet_address, referral_token, total_successful_referrals, successful_personal_referrals, successful_business_referrals, current_tier").order("total_successful_referrals", { ascending: false }).limit(10),
    supabase.from(referralTables.profiles).select("current_tier"),
    supabase.from(referralTables.redemptions).select("status, amount_points, amount_usdc"),
    supabase.from(referralTables.riskAssessments).select("risk_level, action_taken"),
  ]);

  // Funnel calculations
  const totalClicks = attributionsCount.count ?? 0;
  const referrals = referralsResult.data ?? [];
  const totalSignups = referrals.length;

  let activeCount = 0;
  let qualifiedCount = 0;
  let personalCount = 0;
  let businessCount = 0;

  for (const r of referrals) {
    if (r.referred_account_type === "BUSINESS") {
      businessCount++;
    } else {
      personalCount++;
    }

    if (r.status === "QUALIFIED" || r.status === "REWARDED") {
      qualifiedCount++;
      activeCount++;
    } else if (r.status === "ACTIVATED" || r.status === "PENDING_QUALIFICATION") {
      activeCount++;
    }
  }

  // Ledger & Economics
  let totalIssuedUnits = 0n;
  for (const row of pointsIssuedResult.data ?? []) {
    totalIssuedUnits += BigInt(row.amount_units);
  }

  let totalRedeemedUnits = 0n;
  for (const row of pointsRedeemedResult.data ?? []) {
    totalRedeemedUnits += -BigInt(row.amount_units);
  }

  const issuedPoints = Number(totalIssuedUnits) / 100;
  const redeemedPoints = Number(totalRedeemedUnits) / 100;
  const liabilityPoints = Math.max(0, issuedPoints - redeemedPoints);

  const issuedUsdc = Number((issuedPoints * 0.01).toFixed(2));
  const redeemedUsdc = Number((redeemedPoints * 0.01).toFixed(2));
  const liabilityUsdc = Number((liabilityPoints * 0.01).toFixed(2));

  // Facilitated Volume
  let qualifyingVolume = 0;
  for (const q of qualificationsResult.data ?? []) {
    qualifyingVolume += Number(q.qualifying_transaction_volume || 0);
  }

  let activityVolume = 0;
  for (const a of activityRewardsResult.data ?? []) {
    activityVolume += Number(a.transaction_volume || 0);
  }

  const totalVolumeUsdc = Number((qualifyingVolume + activityVolume).toFixed(2));

  // Customer Acquisition Cost (CAC)
  const cacPoints = qualifiedCount > 0 ? Number((issuedPoints / qualifiedCount).toFixed(1)) : 0;
  const cacUsdc = qualifiedCount > 0 ? Number((issuedUsdc / qualifiedCount).toFixed(2)) : 0;
  const volumeToRewardRatio = issuedUsdc > 0 ? Number((totalVolumeUsdc / issuedUsdc).toFixed(2)) : 0;

  // Tier distribution
  const tierDistribution: Record<string, number> = {
    STARTER: 0,
    BUILDER: 0,
    ARCHITECT: 0,
    AMBASSADOR: 0,
  };
  for (const row of tierBreakdownResult.data ?? []) {
    if (row.current_tier && tierDistribution[row.current_tier] !== undefined) {
      tierDistribution[row.current_tier]++;
    }
  }

  // Redemptions breakdown
  let pendingRedemptionsCount = 0;
  let pendingRedemptionsUsdc = 0;
  let completedRedemptionsCount = 0;
  let completedRedemptionsUsdc = 0;

  for (const red of redemptionsResult.data ?? []) {
    const usdc = Number(red.amount_usdc || 0);
    if (red.status === "REQUESTED" || red.status === "PROCESSING") {
      pendingRedemptionsCount++;
      pendingRedemptionsUsdc += usdc;
    } else if (red.status === "COMPLETED") {
      completedRedemptionsCount++;
      completedRedemptionsUsdc += usdc;
    }
  }

  // Risk summary
  let lowRiskCount = 0;
  let mediumRiskCount = 0;
  let highRiskCount = 0;
  let blockedCount = 0;

  for (const risk of riskAssessmentsResult.data ?? []) {
    if (risk.risk_level === "LOW") lowRiskCount++;
    else if (risk.risk_level === "MEDIUM") mediumRiskCount++;
    else if (risk.risk_level === "HIGH") highRiskCount++;
    if (risk.action_taken === "BLOCK" || risk.action_taken === "HOLD") blockedCount++;
  }

  return {
    funnel: {
      clicks: totalClicks,
      signups: totalSignups,
      active: activeCount,
      qualified: qualifiedCount,
      personalSignups: personalCount,
      businessSignups: businessCount,
      conversionRates: {
        clickToSignupPct: totalClicks > 0 ? Number(((totalSignups / totalClicks) * 100).toFixed(2)) : 0,
        signupToActivePct: totalSignups > 0 ? Number(((activeCount / totalSignups) * 100).toFixed(2)) : 0,
        activeToQualifiedPct: activeCount > 0 ? Number(((qualifiedCount / activeCount) * 100).toFixed(2)) : 0,
        overallConversionPct: totalClicks > 0 ? Number(((qualifiedCount / totalClicks) * 100).toFixed(2)) : 0,
      },
    },
    economics: {
      totalOnePointsIssued: issuedPoints,
      totalOnePointsRedeemed: redeemedPoints,
      currentRewardLiabilityPoints: liabilityPoints,
      totalRewardsIssuedUsdc: issuedUsdc,
      totalRewardsRedeemedUsdc: redeemedUsdc,
      currentRewardLiabilityUsdc: liabilityUsdc,
      totalFacilitatedVolumeUsdc: totalVolumeUsdc,
      cacOnePoints: cacPoints,
      cacUsdc,
      volumeToRewardRatio,
    },
    tierDistribution,
    topReferrers: profilesResult.data ?? [],
    redemptions: {
      pendingCount: pendingRedemptionsCount,
      pendingUsdc: Number(pendingRedemptionsUsdc.toFixed(2)),
      completedCount: completedRedemptionsCount,
      completedUsdc: Number(completedRedemptionsUsdc.toFixed(2)),
    },
    riskOverview: {
      lowRiskCount,
      mediumRiskCount,
      highRiskCount,
      blockedCount,
    },
  };
}
