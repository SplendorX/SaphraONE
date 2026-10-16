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
    completed: boolean;
    description: string;
    endsAt: string | null;
    id: string;
    points: number;
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
