/**
 * Rewards v2 rules: monthly cashback tiers and cap, streak points, discount
 * pricing (REWARDS-PLAN.md).
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/rewards/__tests__/rewards.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cashbackPointsFor,
  discountCost,
  MONTHLY_CASHBACK_CAP_POINTS,
  streakPointsForDay,
} from "@/lib/rewards/config";

const fresh = { monthPoints: 0, monthVolumeUsd: 0 };

describe("cashback tiers", () => {
  it("pays 1 point per 10 USD in tier 1", () => {
    assert.equal(cashbackPointsFor({ ...fresh, volumeUsd: 100 }), 10);
  });

  it("splits a payment across the 500 USD tier boundary", () => {
    // 100 USD left in tier 1 (10 pts) + 100 USD in tier 2 at 0.5/10 (5 pts).
    assert.equal(cashbackPointsFor({ monthPoints: 40, monthVolumeUsd: 400, volumeUsd: 200 }), 15);
  });

  it("pays 0.5 points per 10 USD in tier 2", () => {
    assert.equal(cashbackPointsFor({ monthPoints: 50, monthVolumeUsd: 1_000, volumeUsd: 1_000 }), 50);
  });

  it("pays nothing past 50,000 USD in the month", () => {
    assert.equal(cashbackPointsFor({ monthPoints: 100, monthVolumeUsd: 50_000, volumeUsd: 500 }), 0);
  });

  it("stops at the $5 (500 point) monthly cap", () => {
    assert.equal(MONTHLY_CASHBACK_CAP_POINTS, 500);
    assert.equal(cashbackPointsFor({ monthPoints: 495, monthVolumeUsd: 10_000, volumeUsd: 1_000 }), 5);
    assert.equal(cashbackPointsFor({ monthPoints: 500, monthVolumeUsd: 10_000, volumeUsd: 1_000 }), 0);
  });

  it("never earns more than the fee was worth", () => {
    assert.equal(cashbackPointsFor({ ...fresh, feeCapPoints: 3, volumeUsd: 100 }), 3);
    assert.equal(cashbackPointsFor({ ...fresh, feeCapPoints: 0, volumeUsd: 100 }), 0);
  });

  it("keeps fractions to 1/100 of a point", () => {
    assert.equal(cashbackPointsFor({ ...fresh, volumeUsd: 12.34 }), 1.23);
  });
});

describe("streaks", () => {
  it("pays 0.5 a day with 4, 25 and 75 point milestones", () => {
    assert.equal(streakPointsForDay(1), 0.5);
    assert.equal(streakPointsForDay(2), 0.5);
    assert.equal(streakPointsForDay(3), 4.5);
    assert.equal(streakPointsForDay(7), 25.5);
    assert.equal(streakPointsForDay(30), 75.5);
  });

  it("adds up to 119 points over a full 30-day cycle", () => {
    let total = 0;
    for (let day = 1; day <= 30; day += 1) total += streakPointsForDay(day);
    assert.equal(total, 30 * 0.5 + 4 + 25 + 75);
  });
});

describe("discounts", () => {
  it("costs 100 points per dollar for 25% and 50%", () => {
    assert.deepEqual(discountCost(5, 25), { points: 125, refundUsdc: 1.25 });
    assert.deepEqual(discountCost(5, 50), { points: 250, refundUsdc: 2.5 });
  });

  it("costs 112 per dollar at 75% and 125 per dollar at 100%", () => {
    assert.deepEqual(discountCost(5, 75), { points: 420, refundUsdc: 3.75 });
    assert.deepEqual(discountCost(5, 100), { points: 625, refundUsdc: 5 });
  });

  it("rounds the refund down to the cent", () => {
    assert.equal(discountCost(0.002, 100).refundUsdc, 0);
    assert.equal(discountCost(15, 75).refundUsdc, 11.25);
  });

  it("rejects other percentages", () => {
    assert.throws(() => discountCost(5, 60));
  });
});

describe("quest rules", async () => {
  const { describeQuestRule, readQuestRule } = await import("@/lib/rewards/quests");

  it("reads the three automatic rules", () => {
    assert.deepEqual(readQuestRule({ count: 3, type: "payments" }), { count: 3, type: "payments" });
    assert.deepEqual(readQuestRule({ type: "volume", usd: 250 }), { type: "volume", usd: 250 });
    assert.deepEqual(readQuestRule({ days: 7, type: "streak" }), { days: 7, type: "streak" });
  });

  it("treats anything malformed as awarded by hand, never as automatic", () => {
    assert.deepEqual(readQuestRule({ count: 0, type: "payments" }), { type: "manual" });
    assert.deepEqual(readQuestRule({ type: "volume", usd: "lots" }), { type: "manual" });
    assert.deepEqual(readQuestRule({ type: "unknown" }), { type: "manual" });
    assert.deepEqual(readQuestRule(null), { type: "manual" });
  });

  it("describes rules in plain words", () => {
    assert.equal(describeQuestRule({ count: 1, type: "payments" }), "Make 1 payment");
    assert.equal(describeQuestRule({ count: 3, type: "payments" }), "Make 3 payments");
    assert.equal(describeQuestRule({ days: 7, type: "streak" }), "Reach a 7-day streak");
    assert.equal(
      describeQuestRule({ platform: "x", type: "social", url: "https://x.com/saphraone" }),
      "Follow SaphraONE on X",
    );
  });

  it("reads a follow-us rule with a known platform and an https link", () => {
    assert.deepEqual(readQuestRule({ platform: "X", type: "social", url: " https://x.com/saphraone " }), {
      platform: "x",
      type: "social",
      url: "https://x.com/saphraone",
    });
  });

  it("refuses follow-us rules with an unknown platform or an unsafe link", () => {
    assert.deepEqual(readQuestRule({ platform: "myspace", type: "social", url: "https://x.com/a" }), { type: "manual" });
    assert.deepEqual(readQuestRule({ platform: "x", type: "social", url: "http://x.com/a" }), { type: "manual" });
    assert.deepEqual(readQuestRule({ platform: "x", type: "social", url: "javascript:alert(1)" }), { type: "manual" });
    assert.deepEqual(readQuestRule({ platform: "x", type: "social" }), { type: "manual" });
  });
});
