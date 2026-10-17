/**
 * Quests v2: every rule type, audiences, percentage rewards and progress.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/rewards/__tests__/quest-rules.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeQuestRule,
  evaluateQuest,
  isAutomaticQuest,
  isQuestDone,
  QUEST_TYPES,
  questFitsAccount,
  questRewardPoints,
  readQuestAudience,
  readQuestReward,
  readQuestRule,
} from "@/lib/rewards/quest-rules";

const window = { ends_at: "2026-11-01T00:00:00.000Z", starts_at: "2026-10-01T00:00:00.000Z" };
const inside = "2026-10-15T12:00:00.000Z";
const before = "2026-09-20T12:00:00.000Z";
const after = "2026-11-02T12:00:00.000Z";

function pay(usd, at = inside, extra = {}) {
  return { at, eligible: true, payees: ["0xaaa"], source: "send", usd, ...extra };
}

describe("readQuestRule", () => {
  it("reads every counted type with a whole number", () => {
    for (const [type, info] of Object.entries(QUEST_TYPES)) {
      if (info.param !== "count") continue;
      assert.deepEqual(readQuestRule({ count: 2.9, type }), { count: 2, type });
      assert.deepEqual(readQuestRule({ count: 0, type }), { type: "manual" });
    }
  });

  it("keeps a minimum only where it applies", () => {
    assert.deepEqual(readQuestRule({ count: 3, minUsd: 20, type: "payments" }), { count: 3, minUsd: 20, type: "payments" });
    assert.deepEqual(readQuestRule({ count: 3, minUsd: 20, type: "save" }), { count: 3, type: "save" });
    assert.deepEqual(readQuestRule({ count: 3, minUsd: -1, type: "receive" }), { count: 3, type: "receive" });
  });

  it("reads amount and state rules", () => {
    assert.deepEqual(readQuestRule({ type: "single_payment", usd: 100 }), { type: "single_payment", usd: 100 });
    assert.deepEqual(readQuestRule({ type: "two_factor" }), { type: "two_factor" });
    assert.deepEqual(readQuestRule({ type: "business_verified" }), { type: "business_verified" });
  });

  it("never treats a prototype key or junk as a type", () => {
    assert.deepEqual(readQuestRule({ count: 1, type: "constructor" }), { type: "manual" });
    assert.deepEqual(readQuestRule({ count: 1, type: "__proto__" }), { type: "manual" });
    assert.deepEqual(readQuestRule({ type: "single_payment" }), { type: "manual" });
  });
});

describe("describeQuestRule", () => {
  it("reads naturally for one and many", () => {
    assert.equal(describeQuestRule({ count: 3, minUsd: 20, type: "payments" }), "Make 3 payments of at least $20");
    assert.equal(describeQuestRule({ type: "single_payment", usd: 100 }), "Make a single payment of at least $100");
    assert.equal(describeQuestRule({ count: 1, type: "unique_payees" }), "Pay 1 different person");
    assert.equal(describeQuestRule({ count: 1, type: "referrals" }), "Invite a friend who joins SaphraONE");
    assert.equal(describeQuestRule({ count: 3, type: "referrals" }), "Invite 3 friends who join SaphraONE");
    assert.equal(describeQuestRule({ count: 1, type: "save" }), "Save into a pocket");
    assert.equal(describeQuestRule({ count: 2, type: "swap" }), "Make 2 swaps");
    assert.equal(describeQuestRule({ count: 5, type: "invoices_sent" }), "Send 5 invoices");
    assert.equal(describeQuestRule({ type: "volume", usd: 1500 }), "Pay $1,500 in total");
  });
});

describe("audience", () => {
  it("defaults to everyone and matches account types", () => {
    assert.equal(readQuestAudience("weird"), "all");
    assert.equal(questFitsAccount("all", "PERSONAL"), true);
    assert.equal(questFitsAccount(undefined, "BUSINESS"), true);
    assert.equal(questFitsAccount("business", "PERSONAL"), false);
    assert.equal(questFitsAccount("business", "BUSINESS"), true);
    assert.equal(questFitsAccount("personal", "BUSINESS"), false);
  });

  it("marks business features business-only", () => {
    for (const type of ["invoices_sent", "invoices_paid", "checkout_payments", "payroll_runs", "business_verified"]) {
      assert.equal(QUEST_TYPES[type].businessOnly, true, type);
    }
    assert.equal(QUEST_TYPES.payments.businessOnly, undefined);
  });

  it("knows which quests finish on their own", () => {
    assert.equal(isAutomaticQuest({ count: 1, type: "save" }), true);
    assert.equal(isAutomaticQuest({ type: "manual" }), false);
    assert.equal(isAutomaticQuest({ platform: "x", type: "social", url: "https://x.com/a" }), false);
  });
});

describe("rewards", () => {
  it("reads a percentage only on payment quests", () => {
    assert.deepEqual(readQuestReward({ rewardPercent: 10, type: "single_payment", usd: 100 }, 500), {
      kind: "percent",
      maxPoints: 500,
      percent: 10,
    });
    assert.deepEqual(readQuestReward({ count: 1, rewardPercent: 10, type: "save" }, 50), { kind: "fixed", points: 50 });
    assert.deepEqual(readQuestReward({ rewardPercent: 150, type: "volume", usd: 10 }, 50), { kind: "fixed", points: 50 });
  });

  it("pays a share of the payment in points, capped, and at least 1", () => {
    const reward = { kind: "percent", maxPoints: 500, percent: 10 };
    // 10% of $40 = $4 = 400 points (1 point = $0.01).
    assert.equal(questRewardPoints(reward, 40), 400);
    assert.equal(questRewardPoints(reward, 100), 500);
    assert.equal(questRewardPoints(reward, 0.001), 1);
    assert.equal(questRewardPoints({ kind: "fixed", points: 75 }, 1_000), 75);
  });
});

describe("evaluateQuest", () => {
  it("counts payments inside the window, with the minimum", () => {
    const facts = { payments: [pay(5), pay(25), pay(30, before), pay(40, after), pay(50, inside, { eligible: false })] };
    const any = evaluateQuest({ count: 3, type: "payments" }, window, facts);
    assert.equal(any.current, 2);
    const big = evaluateQuest({ count: 1, minUsd: 20, type: "payments" }, window, facts);
    assert.deepEqual([big.current, big.basisUsd], [1, 25]);
    assert.equal(isQuestDone(big), true);
  });

  it("finds one payment big enough and pays on it", () => {
    const progress = evaluateQuest({ type: "single_payment", usd: 100 }, window, {
      payments: [pay(60), pay(120, "2026-10-20T00:00:00.000Z"), pay(150, "2026-10-21T00:00:00.000Z")],
    });
    assert.deepEqual([progress.current, progress.target, progress.basisUsd], [1, 1, 120]);
  });

  it("sums volume and counts different people", () => {
    const facts = {
      payments: [pay(10, inside, { payees: ["0xA"] }), pay(15, inside, { payees: ["0xa", "0xb"] })],
    };
    assert.equal(evaluateQuest({ type: "volume", usd: 20 }, window, facts).current, 25);
    assert.equal(evaluateQuest({ count: 2, type: "unique_payees" }, window, facts).current, 2);
  });

  it("counts swaps and BulkPay from any verified outflow", () => {
    const facts = {
      payments: [
        pay(10, inside, { eligible: false, source: "swap" }),
        pay(10, inside, { source: "batch" }),
        pay(10, before, { eligible: false, source: "swap" }),
      ],
    };
    assert.equal(evaluateQuest({ count: 1, type: "swap" }, window, facts).current, 1);
    assert.equal(evaluateQuest({ count: 1, type: "bulkpay" }, window, facts).current, 1);
  });

  it("counts feature records in the window and reads states any time", () => {
    const facts = {
      businessVerified: false,
      invoicesSent: [inside, inside, before],
      received: [{ at: inside, usd: 5 }, { at: inside, usd: 50 }],
      twoFactor: true,
    };
    assert.equal(evaluateQuest({ count: 2, type: "invoices_sent" }, window, facts).current, 2);
    assert.equal(evaluateQuest({ count: 1, minUsd: 20, type: "receive" }, window, facts).current, 1);
    assert.equal(isQuestDone(evaluateQuest({ type: "two_factor" }, window, facts)), true);
    assert.equal(isQuestDone(evaluateQuest({ type: "business_verified" }, window, facts)), false);
  });

  it("shows nothing when a fact couldn't be read, or for claimed and manual quests", () => {
    assert.equal(evaluateQuest({ count: 1, type: "save" }, window, {}), null);
    assert.equal(evaluateQuest({ type: "manual" }, window, { payments: [] }), null);
    assert.equal(isQuestDone(null), false);
  });
});
