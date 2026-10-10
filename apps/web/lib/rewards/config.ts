/**
 * Rewards v2 (REWARDS-PLAN.md): every rate and limit in one place. Shared by
 * the browser (to explain the rules) and the server (to apply them).
 */

/** Live everywhere. NEXT_PUBLIC_REWARDS_V2=false is only an emergency off switch. */
export function rewardsV2Enabled() {
  return process.env.NEXT_PUBLIC_REWARDS_V2?.trim() !== "false";
}

/** What a point is worth, in USD, for display ("Worth ~$0.00"). */
export const USD_PER_POINT = 0.01;

/** Monthly transaction cashback tiers. Volume is in USD; limits are cumulative. */
export const CASHBACK_TIERS = [
  /** 1 point per 10 USD, for the first 500 USD in the month. */
  { limitUsd: 500, pointsPer10Usd: 1 },
  /** 0.5 points per 10 USD, up to 50,000 USD in the month. */
  { limitUsd: 50_000, pointsPer10Usd: 0.5 },
] as const;

/** Most transaction cashback a wallet can earn in a month: $5 of points. */
export const MONTHLY_CASHBACK_CAP_POINTS = 500;

/** Points for every streak day. */
export const STREAK_DAILY_POINTS = 0.5;

/** Extra points the day a streak reaches these lengths (the cycle repeats after 30). */
export const STREAK_MILESTONES = [
  { days: 3, points: 4 },
  { days: 7, points: 25 },
  { days: 30, points: 75 },
] as const;


/** Points for streak day `cycleDay` (1..30): the daily points plus any milestone. */
export function streakPointsForDay(cycleDay: number) {
  const milestone = STREAK_MILESTONES.find((entry) => entry.days === cycleDay);
  return STREAK_DAILY_POINTS + (milestone?.points ?? 0);
}

/** Claiming a discount: points per 1 USDC refunded, by how much of the purchase. */
export const DISCOUNT_OPTIONS = [
  { percent: 25, pointsPerUsd: 100 },
  { percent: 50, pointsPerUsd: 100 },
  { percent: 75, pointsPerUsd: 112 },
  { percent: 100, pointsPerUsd: 125 },
] as const;

export type DiscountPercent = (typeof DISCOUNT_OPTIONS)[number]["percent"];

/** The smallest refund a discount can be. */
export const MIN_DISCOUNT_USDC = 0.5;

/** Points a discount costs, rounded up to 1/100 of a point. */
export function discountCost(purchaseUsdc: number, percent: DiscountPercent) {
  const option = DISCOUNT_OPTIONS.find((entry) => entry.percent === percent);
  if (!option) throw new Error("Choose 25%, 50%, 75% or 100%.");
  const refundUsdc = Math.floor(purchaseUsdc * percent) / 100;
  const points = Math.ceil(refundUsdc * option.pointsPerUsd * 100) / 100;
  return { points, refundUsdc };
}

/**
 * Cashback for one transaction given what the month has used so far. The
 * same math as rewards_award_cashback in rewards-v2.sql (which is what really
 * pays, atomically); here for previews and tests.
 */
export function cashbackPointsFor(input: {
  /** Points this transaction may earn at most (its fee's worth). */
  feeCapPoints?: number;
  monthPoints: number;
  monthVolumeUsd: number;
  volumeUsd: number;
}) {
  const [tier1, tier2] = CASHBACK_TIERS;
  const volume = Math.max(0, input.volumeUsd);
  const t1 = Math.max(0, Math.min(volume, tier1.limitUsd - input.monthVolumeUsd));
  const t2 = Math.max(0, Math.min(volume - t1, tier2.limitUsd - Math.max(input.monthVolumeUsd, tier1.limitUsd)));
  let points = (t1 * tier1.pointsPer10Usd) / 10 + (t2 * tier2.pointsPer10Usd) / 10;
  points = Math.min(
    points,
    Math.max(input.feeCapPoints ?? Number.POSITIVE_INFINITY, 0),
    Math.max(MONTHLY_CASHBACK_CAP_POINTS - input.monthPoints, 0),
  );
  return Math.floor(points * 100 + 1e-9) / 100;
}
