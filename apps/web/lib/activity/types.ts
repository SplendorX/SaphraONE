/**
 * Account activity: every confirmed transaction the account made, labelled with
 * the SaphraONE feature that performed it. Shared by the /api/activity route and
 * the dashboard, so it stays free of server-only imports.
 */

export const activitySources = [
  "send",
  "request",
  "payroll",
  "circle",
  "swap",
  "invoice",
  "save",
  "earn",
  "batch",
  "recurepay",
  "agent",
  "points",
  "checkout",
  "deposit",
  "ramp",
] as const;

export type ActivitySource = (typeof activitySources)[number];

/**
 * The Activity page shows this many days. Anything older is only available
 * in a downloaded statement of account, for a range the user picks.
 */
export const activityWindowDays = 30;

/** The start of the Activity window, as of `now`. */
export function activityWindowStart(now = Date.now(), days = activityWindowDays) {
  return new Date(now - days * 24 * 60 * 60 * 1000);
}

/**
 * Transaction History reaches back three months; anything older is in a
 * downloaded statement. Insights reads the last 30 days and the 30 before.
 */
export const transactionHistoryDays = 90;

/** A requested window in days, kept between 1 and the history limit. */
export function clampActivityDays(value: unknown, fallback = activityWindowDays) {
  const days = Math.round(Number(value));
  return Number.isFinite(days) && days >= 1 ? Math.min(days, transactionHistoryDays) : fallback;
}

/** Feature sources plus "wallet": on-chain transfers no feature claimed. */
export type ActivityFeed = ActivitySource | "wallet";

export type ActivityDirection = "in" | "out" | "internal";

export type ActivityBatchRecipient = {
  wallet: string;
  amount: string;
  /** @username or the name entered in the composer, when there was one. */
  label: string | null;
};

export type ActivityBatchDetails = {
  recipients: ActivityBatchRecipient[];
  fee: string | null;
  mode: string | null;
  /** "payroll" for a payroll run; a BulkPay batch otherwise. */
  kind?: "batch" | "payroll";
  /** The payroll run's name, for its receipt. */
  name?: string | null;
};

export type AccountActivityEntry = {
  id: string;
  source: ActivityFeed;
  direction: ActivityDirection;
  title: string;
  counterparty: string | null;
  /** Decimal string, e.g. "12.5". */
  amount: string | null;
  token: string | null;
  /** Second leg of a swap, e.g. the EURC received for USDC sent. */
  amountIn?: string | null;
  tokenIn?: string | null;
  /** BulkPay: everyone the batch paid, so the receipt can name them. */
  batch?: ActivityBatchDetails | null;
  /** Every on-chain transaction this activity produced. */
  txHashes: string[];
  occurredAt: string | null;
  /** Only labels a matching on-chain transfer; never listed on its own. */
  mirrored?: boolean;
};

export function isActivitySource(value: unknown): value is ActivitySource {
  return (
    typeof value === "string" &&
    (activitySources as readonly string[]).includes(value)
  );
}

export const activityFeatureMeta: Record<
  ActivityFeed,
  { label: string; href: string | null }
> = {
  send: { label: "Send Payment", href: "/send" },
  request: { label: "Request Payment", href: "/pay" },
  payroll: { label: "Payroll", href: "/business/payroll" },
  circle: { label: "Circle", href: "/circle" },
  swap: { label: "Swap", href: "/swap" },
  invoice: { label: "Invoices", href: "/business/invoices" },
  save: { label: "Save", href: "/save" },
  earn: { label: "Invest", href: "/earn" },
  batch: { label: "BulkPay", href: "/bulkpay" },
  recurepay: { label: "RecurePay", href: "/recurepay" },
  // ALLIE lives in the Pay with ALLIE bubble, opened from Activity directly.
  agent: { label: "ALLIE", href: null },
  points: { label: "OnePoints", href: "/referral" },
  // In-person payments to a business through SaphraONE Checkout.
  checkout: { label: "Checkout", href: null },
  // USDC received on another network and moved to Arc.
  deposit: { label: "Deposit", href: "/deposit" },
  // Naira bank deposits and withdrawals through Centiiv.
  ramp: { label: "Bank", href: "/withdraw" },
  wallet: { label: "Wallet", href: null },
};
