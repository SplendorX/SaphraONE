/**
 * Quest rules: what a quest asks for, who it is for, what it pays, and how
 * far a wallet is. Pure, so the server, the admin form and the tests all use
 * the same definitions. The server (lib/rewards/quests.ts) measures the facts
 * from verified records; everything here only reads them.
 */
import { USD_PER_POINT } from "@/lib/rewards/config";

/** Social accounts a "follow us" quest can point at. */
export const SOCIAL_PLATFORMS = {
  discord: "Discord",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  telegram: "Telegram",
  threads: "Threads",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
} as const;

export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;

/** Who sees a quest and can complete it. */
export type QuestAudience = "all" | "personal" | "business";

export const QUEST_AUDIENCES: Array<[QuestAudience, string]> = [
  ["all", "Everyone"],
  ["personal", "Personal accounts"],
  ["business", "Business accounts"],
];

export function readQuestAudience(value: unknown): QuestAudience {
  return value === "personal" || value === "business" ? value : "all";
}

/** Whether an account of `accountType` can see and complete a quest for `audience`. */
export function questFitsAccount(audience: unknown, accountType: "PERSONAL" | "BUSINESS") {
  const fit = readQuestAudience(audience);
  if (fit === "all") return true;
  return fit === (accountType === "BUSINESS" ? "business" : "personal");
}

/**
 * What a wallet has to do. "manual" quests are awarded by an admin. "social"
 * quests are claimed by the person after opening the link: a follow can't be
 * checked without each platform's own API. Everything else completes on its
 * own, from records SaphraONE verified (payments read back from Arc).
 */
export type QuestRule =
  | { type: "payments"; count: number; minUsd?: number }
  | { type: "volume"; usd: number }
  | { type: "single_payment"; usd: number }
  | { type: "unique_payees"; count: number }
  | { type: "receive"; count: number; minUsd?: number }
  | { type: "streak"; days: number }
  | { type: "referrals"; count: number }
  | { type: "save"; count: number }
  | { type: "earn"; count: number }
  | { type: "swap"; count: number }
  | { type: "bulkpay"; count: number }
  | { type: "recurepay"; count: number }
  | { type: "two_factor" }
  | { type: "profile_photo" }
  | { type: "invoices_sent"; count: number }
  | { type: "invoices_paid"; count: number }
  | { type: "checkout_payments"; count: number }
  | { type: "payroll_runs"; count: number }
  | { type: "business_verified" }
  | { type: "social"; platform: SocialPlatform; url: string }
  | { type: "manual" };

export type QuestRuleType = QuestRule["type"];

type QuestTypeInfo = {
  label: string;
  group: "Payments" | "Activity" | "Features" | "Business" | "Other";
  /** The number the admin sets, if any. */
  param: "count" | "usd" | "days" | null;
  /** Payments-style rules can also require a minimum per transaction. */
  minUsd?: boolean;
  /** Only Business accounts can do it, so the quest is for them only. */
  businessOnly?: boolean;
  /** "10% back, up to N points": paid on the payments that completed it. */
  percent?: boolean;
};

/** Every quest type, in the order the admin form lists them. */
export const QUEST_TYPES: Record<QuestRuleType, QuestTypeInfo> = {
  payments: { group: "Payments", label: "Number of payments", minUsd: true, param: "count", percent: true },
  volume: { group: "Payments", label: "Total paid (USD)", param: "usd", percent: true },
  single_payment: { group: "Payments", label: "One payment of at least (USD)", param: "usd", percent: true },
  unique_payees: { group: "Payments", label: "Pay different people", param: "count" },
  receive: { group: "Payments", label: "Receive or add money", minUsd: true, param: "count" },
  streak: { group: "Activity", label: "Streak length (days)", param: "days" },
  referrals: { group: "Activity", label: "Invite friends who join", param: "count" },
  save: { group: "Features", label: "Save into a pocket", param: "count" },
  earn: { group: "Features", label: "Invest in Earn", param: "count" },
  swap: { group: "Features", label: "Make a swap", param: "count" },
  bulkpay: { group: "Features", label: "Send a BulkPay batch", param: "count" },
  recurepay: { group: "Features", label: "Set up a RecurePay schedule", param: "count" },
  two_factor: { group: "Features", label: "Turn on two-factor authentication", param: null },
  profile_photo: { group: "Features", label: "Add a profile photo", param: null },
  invoices_sent: { businessOnly: true, group: "Business", label: "Send invoices", param: "count" },
  invoices_paid: { businessOnly: true, group: "Business", label: "Get invoices paid", param: "count" },
  checkout_payments: { businessOnly: true, group: "Business", label: "Take Checkout payments", param: "count" },
  payroll_runs: { businessOnly: true, group: "Business", label: "Run payroll", param: "count" },
  business_verified: { businessOnly: true, group: "Business", label: "Get the business verified", param: null },
  social: { group: "Other", label: "Follow on social media", param: null },
  manual: { group: "Other", label: "Awarded by hand", param: null },
};

/** Rules a person finishes by doing it: no claim button, no admin. */
export function isAutomaticQuest(rule: QuestRule) {
  return rule.type !== "manual" && rule.type !== "social";
}

/** An https link, or null. */
export function readSocialUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A stored rule, checked: anything unknown or malformed counts as manual. */
export function readQuestRule(value: unknown): QuestRule {
  const rule = (value ?? {}) as Record<string, unknown>;
  const positive = (key: string) => {
    const number = Number(rule[key]);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  const whole = (key: string) => {
    const number = positive(key);
    return number === null ? null : Math.floor(number);
  };
  const minUsd = () => {
    const number = positive("minUsd");
    return number === null ? {} : { minUsd: number };
  };
  const type = String(rule.type ?? "") as QuestRuleType;
  const info = Object.prototype.hasOwnProperty.call(QUEST_TYPES, type) ? QUEST_TYPES[type] : undefined;
  if (!info) return { type: "manual" };

  if (type === "social") {
    const platform = String(rule.platform ?? "").toLowerCase();
    const url = readSocialUrl(rule.url);
    if (platform in SOCIAL_PLATFORMS && url) return { platform: platform as SocialPlatform, type: "social", url };
    return { type: "manual" };
  }
  if (info.param === null) return { type } as QuestRule;
  if (info.param === "usd") {
    const usd = positive("usd");
    return usd === null ? { type: "manual" } : ({ type, usd } as QuestRule);
  }
  if (info.param === "days") {
    const days = whole("days");
    return days === null ? { type: "manual" } : ({ days, type } as QuestRule);
  }
  const count = whole("count");
  if (count === null) return { type: "manual" };
  return ({ count, type, ...(info.minUsd ? minUsd() : {}) }) as QuestRule;
}

function times(count: number, one: string, many: string) {
  return count === 1 ? one : many.replace("{n}", String(count));
}

function money(usd: number) {
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** "Make 3 payments", for the admin list and the Rewards page. */
export function describeQuestRule(rule: QuestRule) {
  switch (rule.type) {
    case "payments":
      return `Make ${rule.count} payment${rule.count === 1 ? "" : "s"}${rule.minUsd ? ` of at least ${money(rule.minUsd)}` : ""}`;
    case "volume":
      return `Pay ${money(rule.usd)} in total`;
    case "single_payment":
      return `Make a single payment of at least ${money(rule.usd)}`;
    case "unique_payees":
      return `Pay ${rule.count} different ${rule.count === 1 ? "person" : "people"}`;
    case "receive":
      return `${times(rule.count, "Receive or add money", "Receive or add money {n} times")}${rule.minUsd ? ` (at least ${money(rule.minUsd)} each)` : ""}`;
    case "streak":
      return `Reach a ${rule.days}-day streak`;
    case "referrals":
      return `Invite ${times(rule.count, "a friend who joins", "{n} friends who join")} SaphraONE`;
    case "save":
      return times(rule.count, "Save into a pocket", "Save into a pocket {n} times");
    case "earn":
      return times(rule.count, "Invest in Earn", "Invest in Earn {n} times");
    case "swap":
      return times(rule.count, "Make a swap", "Make {n} swaps");
    case "bulkpay":
      return times(rule.count, "Send a BulkPay batch", "Send {n} BulkPay batches");
    case "recurepay":
      return times(rule.count, "Set up a RecurePay schedule", "Set up {n} RecurePay schedules");
    case "two_factor":
      return "Turn on two-factor authentication";
    case "profile_photo":
      return "Add a profile photo";
    case "invoices_sent":
      return times(rule.count, "Send an invoice", "Send {n} invoices");
    case "invoices_paid":
      return times(rule.count, "Get an invoice paid", "Get {n} invoices paid");
    case "checkout_payments":
      return times(rule.count, "Take a Checkout payment", "Take {n} Checkout payments");
    case "payroll_runs":
      return times(rule.count, "Run payroll", "Run payroll {n} times");
    case "business_verified":
      return "Get your business verified";
    case "social":
      return `Follow SaphraONE on ${SOCIAL_PLATFORMS[rule.platform]}`;
    default:
      return "Awarded by SaphraONE";
  }
}

// ── Reward ──────────────────────────────────────────────────────────────────

export type QuestReward =
  | { kind: "fixed"; points: number }
  /** A share of the qualifying payments' USD value, in points, up to `maxPoints`. */
  | { kind: "percent"; percent: number; maxPoints: number };

/**
 * A quest's reward. The percentage lives in the stored rule as
 * `rewardPercent`; the quest's `points` is then the cap.
 */
export function readQuestReward(storedRule: unknown, points: number): QuestReward {
  const raw = Number((storedRule as Record<string, unknown> | null)?.rewardPercent);
  const rule = readQuestRule(storedRule);
  if (QUEST_TYPES[rule.type].percent && Number.isFinite(raw) && raw > 0 && raw <= 100) {
    return { kind: "percent", maxPoints: points, percent: raw };
  }
  return { kind: "fixed", points };
}

/** Points to pay for a completion; a percentage reward never pays less than 1. */
export function questRewardPoints(reward: QuestReward, basisUsd: number) {
  if (reward.kind === "fixed") return reward.points;
  const raw = (Math.max(0, basisUsd) * reward.percent) / 100 / USD_PER_POINT;
  return Math.min(reward.maxPoints, Math.max(1, Math.floor(raw * 100) / 100));
}

export function describeQuestReward(reward: QuestReward) {
  return reward.kind === "fixed"
    ? `${reward.points.toLocaleString("en-US")} points`
    : `${reward.percent}% back, up to ${reward.maxPoints.toLocaleString("en-US")} points`;
}

// ── Progress ────────────────────────────────────────────────────────────────

/** A verified outgoing transaction (transaction ledger). */
export type QuestPayment = {
  at: string;
  usd: number;
  /** Counts as a payment to someone else (not a swap, save or own-wallet move). */
  eligible: boolean;
  source: string;
  payees: string[];
};

/**
 * What the server measured for one wallet. A missing fact means it couldn't
 * be read (or wasn't needed): quests that need it show no progress.
 */
export type QuestFacts = {
  payments?: QuestPayment[];
  /** Incoming transfers found on Arc. */
  received?: Array<{ at: string; usd: number }>;
  streak?: number;
  /** When each invited friend signed up. */
  referrals?: string[];
  save?: string[];
  earn?: string[];
  recurepay?: string[];
  invoicesSent?: string[];
  invoicesPaid?: string[];
  checkout?: string[];
  payroll?: string[];
  twoFactor?: boolean;
  profilePhoto?: boolean;
  businessVerified?: boolean;
};

export type QuestWindow = { starts_at: string; ends_at: string | null };

export type QuestProgress = {
  current: number;
  target: number;
  unit: string;
  /** The USD a percentage reward is paid on. */
  basisUsd: number;
};

export function inQuestWindow(at: string, window: QuestWindow) {
  const time = new Date(at).getTime();
  return (
    Number.isFinite(time) &&
    time >= new Date(window.starts_at).getTime() &&
    (!window.ends_at || time < new Date(window.ends_at).getTime())
  );
}

function counted(list: string[] | undefined, window: QuestWindow, target: number, unit: string): QuestProgress | null {
  if (!list) return null;
  return { basisUsd: 0, current: list.filter((at) => inQuestWindow(at, window)).length, target, unit };
}

function flag(value: boolean | undefined): QuestProgress | null {
  return value === undefined ? null : { basisUsd: 0, current: value ? 1 : 0, target: 1, unit: "done" };
}

const round2 = (value: number) => Math.floor(value * 100) / 100;

/**
 * How far a wallet is on one quest. Things done count only between the
 * quest's start and end; states (2FA on, verified, the current streak) count
 * whenever they are true. Null when the quest isn't automatic or its facts
 * are missing.
 */
export function evaluateQuest(rule: QuestRule, window: QuestWindow, facts: QuestFacts): QuestProgress | null {
  const payments = facts.payments?.filter((payment) => inQuestWindow(payment.at, window));
  const eligible = payments?.filter((payment) => payment.eligible);
  const bySource = (source: string) => payments?.filter((payment) => payment.source === source).map((p) => p.at);

  switch (rule.type) {
    case "payments": {
      if (!eligible) return null;
      const qualifying = eligible
        .filter((payment) => payment.usd + 0.000001 >= (rule.minUsd ?? 0))
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(0, rule.count);
      return {
        basisUsd: qualifying.reduce((sum, payment) => sum + payment.usd, 0),
        current: qualifying.length,
        target: rule.count,
        unit: rule.count === 1 ? "payment" : "payments",
      };
    }
    case "volume": {
      if (!eligible) return null;
      const total = eligible.reduce((sum, payment) => sum + payment.usd, 0);
      return { basisUsd: total, current: round2(total), target: rule.usd, unit: "USD" };
    }
    case "single_payment": {
      if (!eligible) return null;
      const hit = eligible
        .filter((payment) => payment.usd + 0.000001 >= rule.usd)
        .sort((a, b) => a.at.localeCompare(b.at))[0];
      return { basisUsd: hit?.usd ?? 0, current: hit ? 1 : 0, target: 1, unit: "payment" };
    }
    case "unique_payees": {
      if (!eligible) return null;
      const people = new Set(eligible.flatMap((payment) => payment.payees.map((payee) => payee.toLowerCase())));
      return { basisUsd: 0, current: people.size, target: rule.count, unit: rule.count === 1 ? "person" : "people" };
    }
    case "receive": {
      if (!facts.received) return null;
      const hits = facts.received.filter(
        (entry) => inQuestWindow(entry.at, window) && entry.usd + 0.000001 >= (rule.minUsd ?? 0),
      );
      return { basisUsd: 0, current: hits.length, target: rule.count, unit: "times" };
    }
    case "streak":
      return facts.streak === undefined ? null : { basisUsd: 0, current: facts.streak, target: rule.days, unit: "days" };
    case "referrals":
      return counted(facts.referrals, window, rule.count, rule.count === 1 ? "friend" : "friends");
    case "save":
      return counted(facts.save, window, rule.count, "times");
    case "earn":
      return counted(facts.earn, window, rule.count, "times");
    case "swap":
      return counted(bySource("swap"), window, rule.count, rule.count === 1 ? "swap" : "swaps");
    case "bulkpay":
      return counted(bySource("batch"), window, rule.count, rule.count === 1 ? "batch" : "batches");
    case "recurepay":
      return counted(facts.recurepay, window, rule.count, rule.count === 1 ? "schedule" : "schedules");
    case "invoices_sent":
      return counted(facts.invoicesSent, window, rule.count, rule.count === 1 ? "invoice" : "invoices");
    case "invoices_paid":
      return counted(facts.invoicesPaid, window, rule.count, rule.count === 1 ? "invoice" : "invoices");
    case "checkout_payments":
      return counted(facts.checkout, window, rule.count, rule.count === 1 ? "payment" : "payments");
    case "payroll_runs":
      return counted(facts.payroll, window, rule.count, rule.count === 1 ? "run" : "runs");
    case "two_factor":
      return flag(facts.twoFactor);
    case "profile_photo":
      return flag(facts.profilePhoto);
    case "business_verified":
      return flag(facts.businessVerified);
    default:
      return null;
  }
}

export function isQuestDone(progress: QuestProgress | null) {
  return Boolean(progress && progress.current + 0.000001 >= progress.target);
}
