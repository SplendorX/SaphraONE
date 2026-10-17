/** What GET /api/rewards returns (lib/rewards/overview.ts). */
export type RewardsOverview = {
  activity: Array<{ createdAt: string; description: string; id: string; label: string; points: number }>;
  /** Spendable OnePoints. */
  balance: number;
  discountsClaimedUsd: number;
  month: {
    capPoints: number;
    pointsEarned: number;
    /** Each tier's own span and how much of it was spent this month. */
    tiers: Array<{ index: number; limitUsd: number; pointsPer10Usd: number; spentUsd: number }>;
    volumeUsd: number;
  };
  quests: Array<{
    audience: "all" | "personal" | "business";
    /** Completes on its own once done (not a follow claim or an admin award). */
    automatic: boolean;
    completed: boolean;
    description: string;
    endsAt: string | null;
    id: string;
    /** Only the first N people get it: places still open; null when unlimited. */
    placesLeft: number | null;
    /** Fixed points, or the cap of a percentage reward. */
    points: number;
    reward: { kind: "fixed" } | { kind: "percent"; percent: number };
    /** Automatic quests: how far along; null for ones SaphraONE awards by hand. */
    progress: { current: number; target: number; unit: string } | null;
    /** A "follow us" quest: the link to open, then the person claims it. */
    social: { platform: string; platformLabel: string; url: string } | null;
    title: string;
  }>;
  streak: {
    current: number;
    totalDays: number;
    week: Array<{ active: boolean; day: string; today: boolean }>;
  };
  worthUsd: number;
};
