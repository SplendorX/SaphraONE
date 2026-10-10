// Server-only. Market and portfolio reads behind ALLIE's answers: live swap
// quotes, stablecoin prices, and money in/out over a period.
import { loadActivityItems } from "@/lib/activity/report";
import { activityFeatureMeta } from "@/lib/activity/types";
import type { AllieActivityPeriod, AllieAsset } from "@/lib/allie/actions";
import { platformFeeRecipient, SWAP_FEE_BPS } from "@/lib/fees";
import { isArcMainnet } from "@/lib/network";
import { usdPerEur } from "@/lib/referral/fx";
import { zeroAddress } from "viem";

import { arcTokens } from "@/lib/tokens";

// ─── Prices ──────────────────────────────────────────────────────────────────

/** Live USD price of each asset ALLIE holds. USDC is the dollar; EURC floats with EUR. */
export async function stablecoinPrices(): Promise<Record<AllieAsset, number>> {
  return { EURC: await usdPerEur(), USDC: 1 };
}

/** A USD value, written in USDC: SaphraONE counts in the token, not dollars. */
export function formatUsd(value: number) {
  return `${value.toLocaleString("en-US", {
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    minimumFractionDigits: 2,
  })} USDC`;
}

// ─── Swap quotes ─────────────────────────────────────────────────────────────

/** Same tolerance the Swap page quotes with (components/swap/SwapPanel.tsx). */
const quoteSlippageBps = 100;
/** Most a quote may take before ALLIE gives up and points at the Swap page. */
const quoteTimeoutMs = 8_000;

export type SwapQuote = {
  amountIn: number;
  fromAsset: AllieAsset;
  toAsset: AllieAsset;
  /** Expected output, after the route's own costs. */
  estimatedOut: number;
  /** Guaranteed minimum at the quoted slippage. */
  minimumOut: number;
  /** toAsset per 1 fromAsset. */
  rate: number;
  /** "LI.FI via Fly". */
  route: string;
  /** Network cost the route reports, in USD; null when it doesn't say. */
  gasUsd: number | null;
  /** SaphraONE's swap fee, in fromAsset. */
  serviceFee: number;
  serviceFeeBps: number;
  slippageBps: number;
};

type QuoteResponse = {
  quote?: {
    estimatedAmount?: string;
    minAmount?: string;
    route?: {
      provider?: string;
      steps?: Array<{ toolName?: string; tool?: string; estimate?: { gasCostUSD?: string } }>;
    };
  };
};

function kitKey() {
  return (
    process.env.CIRCLE_STABLECOIN_KIT_API_KEY?.trim() ||
    process.env.KIT_KEY?.trim() ||
    process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY?.trim() ||
    null
  );
}

const providerNames: Record<string, string> = { lifi: "LI.FI" };

/**
 * A live quote from Circle's Stablecoin Kit — the same service the Swap page
 * signs against — so the numbers match what the user will be shown there.
 * Null when the service can't be reached or has no route.
 */
export async function quoteSwap(input: {
  amount: number;
  fromAsset: AllieAsset;
  ownerWallet: string;
  toAsset: AllieAsset;
}): Promise<SwapQuote | null> {
  const key = kitKey();
  const tokenIn = arcTokens[input.fromAsset];
  const tokenOut = arcTokens[input.toAsset];
  if (!key || tokenIn.address === zeroAddress || tokenOut.address === zeroAddress) return null;

  const chain = isArcMainnet() ? "Arc" : "Arc_Testnet";
  const amountUnits = BigInt(Math.round(input.amount * 10 ** tokenIn.decimals));
  if (amountUnits <= 0n) return null;

  const url = new URL("https://api.circle.com/v1/stablecoinKits/quote");
  url.searchParams.set("tokenInAddress", tokenIn.address);
  url.searchParams.set("tokenInChain", chain);
  url.searchParams.set("tokenOutAddress", tokenOut.address);
  url.searchParams.set("tokenOutChain", chain);
  url.searchParams.set("fromAddress", input.ownerWallet);
  url.searchParams.set("toAddress", input.ownerWallet);
  url.searchParams.set("amount", amountUnits.toString());
  url.searchParams.set("slippageBps", String(quoteSlippageBps));
  const beneficiary = platformFeeRecipient();
  if (beneficiary) {
    url.searchParams.set("fees.platformBps", String(SWAP_FEE_BPS));
    url.searchParams.set("fees.beneficiary", beneficiary);
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(quoteTimeoutMs),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as QuoteResponse;
    const estimated = Number(payload.quote?.estimatedAmount);
    const minimum = Number(payload.quote?.minAmount);
    if (!Number.isFinite(estimated) || estimated <= 0) return null;

    const scale = 10 ** tokenOut.decimals;
    const steps = payload.quote?.route?.steps ?? [];
    const provider = payload.quote?.route?.provider ?? "";
    const tools = [...new Set(steps.map((step) => step.toolName ?? step.tool).filter(Boolean))];
    const gas = steps.reduce((sum, step) => {
      const cost = Number(step.estimate?.gasCostUSD);
      return Number.isFinite(cost) ? sum + cost : sum;
    }, 0);
    const estimatedOut = estimated / scale;

    return {
      amountIn: input.amount,
      estimatedOut,
      fromAsset: input.fromAsset,
      gasUsd: steps.some((step) => step.estimate?.gasCostUSD) ? gas : null,
      minimumOut: Number.isFinite(minimum) ? minimum / scale : estimatedOut,
      rate: estimatedOut / input.amount,
      route: [providerNames[provider] ?? provider, tools.length ? `via ${tools.join(", ")}` : ""]
        .filter(Boolean)
        .join(" ") || "Circle Stablecoin Kit",
      serviceFee: beneficiary ? (input.amount * SWAP_FEE_BPS) / 10_000 : 0,
      serviceFeeBps: beneficiary ? SWAP_FEE_BPS : 0,
      slippageBps: quoteSlippageBps,
      toAsset: input.toAsset,
    };
  } catch {
    return null;
  }
}

// ─── Activity over a period ──────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** SaphraONE's first records; "all" reads from here. */
const historyStart = new Date("2025-01-01T00:00:00Z");

export const activityPeriodLabels: Record<AllieActivityPeriod, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

function periodStart(period: AllieActivityPeriod, now: number) {
  if (period === "all") return historyStart;
  const days = period === "24h" ? 1 : period === "7d" ? 7 : 30;
  return new Date(now - days * DAY_MS);
}

export type ActivitySummary = {
  period: AllieActivityPeriod;
  /** Counted payments (moves between your own accounts are left out). */
  count: number;
  inUsd: number;
  outUsd: number;
  /** In and out per asset, in the asset itself. */
  byAsset: Record<AllieAsset, { in: number; out: number }>;
  largestOut: { amount: number; asset: AllieAsset; title: string } | null;
  /** Where most money went, by feature. */
  topOutCategory: { label: string; usd: number } | null;
};

/**
 * Money in and out over a period, valued in USD at today's EUR rate. A wallet
 * of stablecoins has no trading P&L to speak of; what moves its value is what
 * came in and what went out, so that is what this measures.
 */
export async function summarizeActivity(
  ownerWallet: string,
  period: AllieActivityPeriod,
  now = Date.now(),
): Promise<ActivitySummary> {
  const [items, prices] = await Promise.all([
    loadActivityItems(ownerWallet, { from: periodStart(period, now), to: new Date(now) }),
    stablecoinPrices(),
  ]);

  const byAsset: ActivitySummary["byAsset"] = { EURC: { in: 0, out: 0 }, USDC: { in: 0, out: 0 } };
  const categories = new Map<string, number>();
  let count = 0;
  let largestOut: ActivitySummary["largestOut"] = null;
  let largestOutUsd = 0;

  for (const item of items) {
    if (item.direction === "internal") continue;
    const asset = item.token?.toUpperCase();
    if (asset !== "USDC" && asset !== "EURC") continue;
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    count += 1;
    byAsset[asset][item.direction] += amount;
    if (item.direction === "out") {
      const usd = amount * prices[asset];
      const label = activityFeatureMeta[item.source]?.label ?? "Other";
      categories.set(label, (categories.get(label) ?? 0) + usd);
      if (usd > largestOutUsd) {
        largestOutUsd = usd;
        largestOut = { amount, asset, title: item.title };
      }
    }
  }

  const usdOf = (side: "in" | "out") =>
    byAsset.USDC[side] * prices.USDC + byAsset.EURC[side] * prices.EURC;
  const top = [...categories.entries()].sort((left, right) => right[1] - left[1])[0];

  return {
    byAsset,
    count,
    inUsd: usdOf("in"),
    largestOut,
    outUsd: usdOf("out"),
    period,
    topOutCategory: top ? { label: top[0], usd: top[1] } : null,
  };
}
