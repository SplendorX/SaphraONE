// Server-only. Everything the Rewards page shows, in one read.
import { getOnePointsSummary, listOnePointsLedger } from "@/lib/referral/ledger-service";
import { referralDb } from "@/lib/referral/db";
import {
  CASHBACK_TIERS,
  MONTHLY_CASHBACK_CAP_POINTS,
  USD_PER_POINT,
} from "@/lib/rewards/config";
import type { RewardsOverview } from "@/lib/rewards/types";
import { loadAccount } from "@/lib/account/auth";
import {
  describeQuestRule,
  isAutomaticQuest,
  questFitsAccount,
  readQuestAudience,
  readQuestReward,
  readQuestRule,
  SOCIAL_PLATFORMS,
} from "@/lib/rewards/quest-rules";
import { checkQuestsForWallet, type QuestRow } from "@/lib/rewards/quests";

function monthStart(at = new Date()) {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** Monday..Sunday (UTC) of the current week, as YYYY-MM-DD. */
function currentWeek(at = new Date()) {
  const day = (at.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - day));
  return Array.from({ length: 7 }, (_, index) =>
    new Date(monday.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}

/** How a ledger entry reads in Rewards activity. */
const activityLabels: Record<string, string> = {
  DISCOUNT_CLAIM: "Discount claimed",
  ENTITLEMENT_UNLOCK: "Feature unlock",
  GIFT_RECEIVED: "Gift received",
  GIFT_SENT: "Gift sent",
  PARTNER_CASHBACK_BOOST: "Cashback boost",
  PARTNER_WELCOME_POINTS: "Welcome points",
  PURCHASE: "Points bought",
  QUEST_REWARD: "Quest reward",
  REDEMPTION: "Redeemed",
  STREAK_REWARD: "Streak",
  TRANSACTION_CASHBACK: "Cashback",
};

export async function loadRewardsOverview(walletAddress: string): Promise<RewardsOverview> {
  const wallet = walletAddress.toLowerCase();
  const db = referralDb();
  const week = currentWeek();
  const nowIso = new Date().toISOString();

  // Opening Rewards completes anything already done (a quest finished by
  // saving, invoicing or turning on 2FA has no payment to trigger it).
  const account = await loadAccount(wallet).catch(() => null);
  const accountType: "BUSINESS" | "PERSONAL" = account?.account_type === "BUSINESS" ? "BUSINESS" : "PERSONAL";
  const questAccount = account ? { account_type: accountType, avatar_url: account.avatar_url } : null;
  const check = await checkQuestsForWallet(wallet, { account: questAccount }).catch((cause) => {
    console.warn("[rewards] quest check", cause instanceof Error ? cause.message : cause);
    return null;
  });

  const [summary, ledger, usage, streak, days, quests, completions, claims] = await Promise.all([
    getOnePointsSummary(wallet),
    listOnePointsLedger(wallet, 20),
    db
      .from("rewards_monthly_usage")
      .select("eligible_volume_usd,points_earned")
      .eq("wallet_address", wallet)
      .eq("month", monthStart())
      .maybeSingle(),
    db
      .from("rewards_streaks")
      .select("current_streak,last_day,total_days")
      .eq("wallet_address", wallet)
      .maybeSingle(),
    db
      .from("rewards_activity_days")
      .select("day")
      .eq("wallet_address", wallet)
      .gte("day", week[0])
      .lte("day", week[6]),
    db
      .from("rewards_quests")
      .select("*")
      .eq("active", true)
      .lte("starts_at", nowIso)
      .order("starts_at", { ascending: false }),
    db.from("rewards_quest_completions").select("quest_id").eq("wallet_address", wallet),
    db
      .from("rewards_discount_claims")
      .select("refund_usdc,status")
      .eq("wallet_address", wallet)
      .eq("status", "PAID"),
  ]);

  const volume = Number(usage.data?.eligible_volume_usd ?? 0);
  const earned = Number(usage.data?.points_earned ?? 0);

  // A streak only counts if its last day was today or yesterday.
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const lastDay = (streak.data?.last_day as string | null | undefined) ?? null;
  const current = lastDay === today || lastDay === yesterday ? Number(streak.data?.current_streak ?? 0) : 0;
  const activeDays = new Set(((days.data ?? []) as Array<{ day: string }>).map((row) => row.day));
  const completed = new Set(((completions.data ?? []) as Array<{ quest_id: string }>).map((row) => row.quest_id));

  const liveQuests = ((quests.data ?? []) as QuestRow[]).filter(
    (quest) =>
      (!quest.ends_at || quest.ends_at > nowIso) && questFitsAccount(quest.audience, accountType),
  );
  const progress = check?.progress ?? new Map();

  // Places left on quests limited to the first N people.
  const limited = liveQuests.filter((quest) => quest.max_completions && !completed.has(quest.id));
  const taken = new Map<string, number>();
  await Promise.all(
    limited.map(async (quest) => {
      const { count } = await db
        .from("rewards_quest_completions")
        .select("quest_id", { count: "exact", head: true })
        .eq("quest_id", quest.id);
      taken.set(quest.id, count ?? 0);
    }),
  );

  let previousLimit = 0;
  return {
    balance: summary.available,
    discountsClaimedUsd: ((claims.data ?? []) as Array<{ refund_usdc: number }>).reduce(
      (sum, row) => sum + Number(row.refund_usdc),
      0,
    ),
    month: {
      capPoints: MONTHLY_CASHBACK_CAP_POINTS,
      pointsEarned: earned,
      tiers: CASHBACK_TIERS.map((tier, index) => {
        const span = tier.limitUsd - previousLimit;
        const spent = Math.min(Math.max(volume - previousLimit, 0), span);
        previousLimit = tier.limitUsd;
        return { index: index + 1, limitUsd: span, pointsPer10Usd: tier.pointsPer10Usd, spentUsd: spent };
      }),
      volumeUsd: volume,
    },
    activity: ledger.map((entry) => ({
      createdAt: entry.created_at,
      description: entry.description,
      id: entry.id,
      label: activityLabels[entry.entry_type] ?? "Points",
      points: Number(entry.display_amount),
    })),
    quests: liveQuests.flatMap((quest) => {
      const rule = readQuestRule(quest.rule);
      const reward = readQuestReward(quest.rule, Number(quest.points));
      const done = completed.has(quest.id);
      const placesLeft = quest.max_completions
        ? Math.max(0, quest.max_completions - (taken.get(quest.id) ?? 0))
        : null;
      // A full quest disappears for everyone who didn't make it.
      if (!done && placesLeft === 0) return [];
      const state = progress.get(quest.id) ?? null;
      return [{
        audience: readQuestAudience(quest.audience),
        automatic: isAutomaticQuest(rule),
        completed: done,
        description: quest.description || describeQuestRule(rule),
        endsAt: quest.ends_at,
        id: quest.id,
        placesLeft,
        points: Number(quest.points),
        progress: state ? { current: state.current, target: state.target, unit: state.unit } : null,
        reward: reward.kind === "percent" ? { kind: "percent" as const, percent: reward.percent } : { kind: "fixed" as const },
        social:
          rule.type === "social"
            ? { platform: rule.platform, platformLabel: SOCIAL_PLATFORMS[rule.platform], url: rule.url }
            : null,
        title: quest.title,
      }];
    }),
    streak: {
      current,
      totalDays: Number(streak.data?.total_days ?? 0),
      week: week.map((day) => ({ active: activeDays.has(day), day, today: day === today })),
    },
    worthUsd: Number((summary.available * USD_PER_POINT).toFixed(2)),
  };
}
