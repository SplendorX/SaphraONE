/**
 * USDC campaigns: what a campaign is, how its input is checked, and how its
 * prize pool is split. Pure, so the admin API, the payout step and the tests
 * all run exactly this.
 */

export const campaignMetrics = ["volume", "payments", "fees", "unique_payees"] as const;
export type CampaignMetric = (typeof campaignMetrics)[number];

export const campaignStatuses = ["draft", "live", "finalized", "paid", "cancelled"] as const;
export type CampaignStatus = (typeof campaignStatuses)[number];

export type CampaignPayoutType = "top" | "threshold";

export const metricLabels: Record<CampaignMetric, { name: string; unit: string; hint: string }> = {
  fees: {
    hint: "Fees paid can't be inflated without real cost, so it resists wash trading best.",
    name: "Fees paid",
    unit: "USDC in fees",
  },
  payments: {
    hint: "Number of payments. Pair it with a minimum payment so tiny sends don't count.",
    name: "Payments made",
    unit: "payments",
  },
  unique_payees: {
    hint: "Different people paid. Moving money back and forth between two accounts scores 1.",
    name: "People paid",
    unit: "people paid",
  },
  volume: {
    hint: "Total paid in USDC terms. The easiest to game; use with care.",
    name: "Volume",
    unit: "USDC paid",
  },
};

/** Ledger sources a campaign may count. Swaps and savings never count. */
export const campaignSources = [
  "send",
  "batch",
  "invoice",
  "request",
  "checkout",
  "payroll",
  "recurepay",
  "circle",
  "agent",
] as const;

export type CampaignRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  metric: CampaignMetric;
  sources: string[];
  min_amount_usd: number;
  min_score: number;
  excluded_wallets: string[];
  starts_at: string;
  ends_at: string;
  prize_pool_usdc: number;
  payout_type: CampaignPayoutType;
  payout_splits: number[];
  threshold_prize_usdc: number;
  status: CampaignStatus;
  finalized_at: string | null;
  created_at: string;
};

export class CampaignError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CampaignError";
    this.status = status;
  }
}

function text(value: unknown, field: string, max: number, required = true) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw && required) throw new CampaignError(`${field} is required.`);
  if (raw.length > max) throw new CampaignError(`${field} must be at most ${max} characters.`);
  return raw;
}

function amount(value: unknown, field: string, { min = 0, max = 1_000_000 } = {}) {
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new CampaignError(`${field} must be a number between ${min} and ${max.toLocaleString()}.`);
  }
  return parsed;
}

function instant(value: unknown, field: string) {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) throw new CampaignError(`${field} must be a date and time.`);
  return new Date(time).toISOString();
}

/** "Spring sprint 2026!" → "spring-sprint-2026". */
export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Check an admin's campaign form and turn it into a row. Throws CampaignError
 * with a message the admin can act on.
 */
export function readCampaignInput(body: Record<string, unknown>) {
  const title = text(body.title, "Title", 80);
  const description = text(body.description, "Description", 600, false);
  const metric = body.metric as CampaignMetric;
  if (!campaignMetrics.includes(metric)) throw new CampaignError("Choose what ranks wallets.");

  const sources = Array.isArray(body.sources)
    ? [...new Set(body.sources.filter((source): source is string => typeof source === "string"))]
    : [];
  const unknown = sources.filter((source) => !(campaignSources as readonly string[]).includes(source));
  if (unknown.length) throw new CampaignError(`Unknown payment types: ${unknown.join(", ")}.`);

  const startsAt = instant(body.startsAt, "Start");
  const endsAt = instant(body.endsAt, "End");
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new CampaignError("The end must be after the start.");

  const prizePool = amount(body.prizePoolUsdc, "Prize pool", { min: 1 });
  const payoutType = body.payoutType === "threshold" ? "threshold" : "top";
  let payoutSplits: number[] = [];
  let thresholdPrize = 0;
  if (payoutType === "top") {
    const raw = Array.isArray(body.payoutSplits)
      ? body.payoutSplits
      : String(body.payoutSplits ?? "").split(",");
    payoutSplits = raw.map((value) => Number(String(value).trim())).filter((value) => value > 0);
    if (payoutSplits.length === 0 || payoutSplits.length > 100) {
      throw new CampaignError("Give the share for each winning rank, e.g. 50, 30, 20.");
    }
    const total = payoutSplits.reduce((sum, value) => sum + value, 0);
    if (total > 100.0001) throw new CampaignError(`The shares add up to ${total}%; they can't pass 100%.`);
  } else {
    thresholdPrize = amount(body.thresholdPrizeUsdc, "Prize per qualifying wallet", { min: 0.01 });
  }

  const minScore = amount(body.minScore, "Minimum score");
  if (payoutType === "threshold" && minScore <= 0) {
    throw new CampaignError("A threshold campaign needs a minimum score to qualify.");
  }

  const excluded = (Array.isArray(body.excludedWallets) ? body.excludedWallets : String(body.excludedWallets ?? "").split(/[\s,]+/))
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  const badWallet = excluded.find((wallet) => !/^0x[0-9a-f]{40}$/.test(wallet));
  if (badWallet) throw new CampaignError(`Not a wallet address: ${badWallet}`);

  return {
    description,
    ends_at: endsAt,
    excluded_wallets: [...new Set(excluded)],
    metric,
    min_amount_usd: amount(body.minAmountUsd, "Minimum payment"),
    min_score: minScore,
    payout_splits: payoutSplits,
    payout_type: payoutType as CampaignPayoutType,
    prize_pool_usdc: prizePool,
    slug: slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : title),
    sources,
    starts_at: startsAt,
    threshold_prize_usdc: thresholdPrize,
    title,
  };
}

export type Standing = {
  wallet_address: string;
  score: number;
  rank: number;
};

export type Payout = { wallet: string; rank: number; score: number; amountUsdc: number };

/** Round down to the cent: the treasury never pays more than the pool. */
function cents(value: number) {
  return Math.floor(value * 100 + 1e-9) / 100;
}

/**
 * Who gets what. `standings` is the campaign's ranking, best first, already
 * filtered to wallets at or above the minimum score.
 *
 * - top: rank i gets payout_splits[i] percent of the pool.
 * - threshold: every qualifying wallet gets the fixed prize, best rank first,
 *   until the pool can't cover another full prize.
 */
export function computePayouts(
  campaign: Pick<CampaignRow, "payout_type" | "payout_splits" | "prize_pool_usdc" | "threshold_prize_usdc" | "min_score">,
  standings: Standing[],
): Payout[] {
  const ranked = [...standings]
    .filter((row) => row.score > 0 && row.score >= campaign.min_score)
    .sort((left, right) => left.rank - right.rank);
  const pool = Number(campaign.prize_pool_usdc);

  if (campaign.payout_type === "top") {
    return campaign.payout_splits
      .map((share, index) => {
        const row = ranked[index];
        if (!row) return null;
        const amountUsdc = cents((pool * Number(share)) / 100);
        return amountUsdc > 0 ? { amountUsdc, rank: row.rank, score: row.score, wallet: row.wallet_address } : null;
      })
      .filter((row): row is Payout => row !== null);
  }

  const prize = cents(Number(campaign.threshold_prize_usdc));
  if (!(prize > 0)) return [];
  const affordable = Math.floor((pool + 1e-9) / prize);
  return ranked.slice(0, affordable).map((row) => ({
    amountUsdc: prize,
    rank: row.rank,
    score: row.score,
    wallet: row.wallet_address,
  }));
}

/** Where a campaign is in time, whatever its status says. */
export function campaignPhase(campaign: Pick<CampaignRow, "starts_at" | "ends_at">, now = Date.now()) {
  if (now < Date.parse(campaign.starts_at)) return "upcoming" as const;
  if (now < Date.parse(campaign.ends_at)) return "running" as const;
  return "ended" as const;
}
