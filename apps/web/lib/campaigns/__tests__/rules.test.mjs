/**
 * USDC campaign rules: prize splits, the threshold pool, and admin input.
 *
 * Run: pnpm --filter @saphra/web test:campaigns
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { campaignPhase, computePayouts, readCampaignInput } from "@/lib/campaigns/rules";

const standing = (rank, score) => ({ rank, score, wallet_address: `0x${String(rank).padStart(40, "0")}` });

describe("top payouts", () => {
  const campaign = { min_score: 0, payout_splits: [50, 30, 20], payout_type: "top", prize_pool_usdc: 1000, threshold_prize_usdc: 0 };

  it("splits the pool by rank", () => {
    const payouts = computePayouts(campaign, [standing(1, 90), standing(2, 50), standing(3, 10), standing(4, 5)]);
    assert.deepEqual(payouts.map((row) => row.amountUsdc), [500, 300, 200]);
  });

  it("pays only the places that were filled", () => {
    assert.equal(computePayouts(campaign, [standing(1, 90)]).length, 1);
  });

  it("never pays more than the pool, rounding down to the cent", () => {
    const odd = { ...campaign, payout_splits: [33.333, 33.333, 33.333], prize_pool_usdc: 100 };
    const total = computePayouts(odd, [standing(1, 3), standing(2, 2), standing(3, 1)]).reduce((sum, row) => sum + row.amountUsdc, 0);
    assert.ok(total <= 100);
  });

  it("skips wallets under the minimum score", () => {
    const strict = { ...campaign, min_score: 40 };
    assert.deepEqual(computePayouts(strict, [standing(1, 90), standing(2, 30)]).map((row) => row.rank), [1]);
  });
});

describe("threshold payouts", () => {
  const campaign = { min_score: 5, payout_splits: [], payout_type: "threshold", prize_pool_usdc: 25, threshold_prize_usdc: 10 };

  it("pays the fixed prize best rank first, while the pool covers a full prize", () => {
    const payouts = computePayouts(campaign, [standing(1, 9), standing(2, 8), standing(3, 7)]);
    assert.deepEqual(payouts.map((row) => [row.rank, row.amountUsdc]), [[1, 10], [2, 10]]);
  });
});

describe("admin input", () => {
  const valid = {
    endsAt: "2026-11-30T00:00:00Z",
    metric: "unique_payees",
    payoutSplits: "50, 30, 20",
    prizePoolUsdc: "500",
    startsAt: "2026-11-01T00:00:00Z",
    title: "November sprint!",
  };

  it("accepts a well-formed campaign and makes a slug", () => {
    const row = readCampaignInput(valid);
    assert.equal(row.slug, "november-sprint");
    assert.deepEqual(row.payout_splits, [50, 30, 20]);
  });

  it("refuses shares over 100%", () => {
    assert.throws(() => readCampaignInput({ ...valid, payoutSplits: "60, 50" }), /100%/);
  });

  it("refuses an end before the start", () => {
    assert.throws(() => readCampaignInput({ ...valid, endsAt: "2026-10-01T00:00:00Z" }), /after the start/);
  });

  it("refuses swaps and other non-payments as counted types", () => {
    assert.throws(() => readCampaignInput({ ...valid, sources: ["swap"] }), /Unknown payment types/);
  });

  it("needs a qualifying score for a threshold campaign", () => {
    assert.throws(() => readCampaignInput({ ...valid, payoutType: "threshold", thresholdPrizeUsdc: 5 }), /minimum score/);
  });
});

describe("phase", () => {
  const campaign = { ends_at: "2026-11-30T00:00:00Z", starts_at: "2026-11-01T00:00:00Z" };
  it("follows the clock", () => {
    assert.equal(campaignPhase(campaign, Date.parse("2026-10-20T00:00:00Z")), "upcoming");
    assert.equal(campaignPhase(campaign, Date.parse("2026-11-10T00:00:00Z")), "running");
    assert.equal(campaignPhase(campaign, Date.parse("2026-12-01T00:00:00Z")), "ended");
  });
});
