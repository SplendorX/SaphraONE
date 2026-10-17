/**
 * Creator Partners rules: perk math and caps, window edges, offer
 * availability, commission and admin input.
 *
 * Run: pnpm --filter @saphra/web test:partners
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  budgetCostUsd,
  cashbackBoostFor,
  daysLeft,
  effectiveCommissionBps,
  feeRebateFor,
  memberWindow,
  normalizeOfferCode,
  offerAvailability,
  perkSummary,
  premiumDiscountFor,
  readOfferInput,
  readPartnerInput,
  readPerkConfig,
  readPerksInput,
  windowOpen,
} from "@/lib/partners/rules";

const now = new Date("2026-10-17T12:00:00Z");
const liveOffer = {
  budget_usdc: 50,
  ends_at: "2026-11-17T00:00:00Z",
  max_members: 100,
  members_count: 3,
  spent_usdc: 4,
  starts_at: "2026-10-01T00:00:00Z",
  status: "LIVE",
};

describe("link codes", () => {
  it("accepts lowercase codes with inner hyphens", () => {
    assert.equal(normalizeOfferCode("  Ada-Launch "), "ada-launch");
    assert.equal(normalizeOfferCode("abc"), "abc");
  });

  it("rejects short, long, edge-hyphen and odd codes", () => {
    for (const bad of ["ab", "-abc", "abc-", "a b c", "abc!", "x".repeat(33), 42, null]) {
      assert.equal(normalizeOfferCode(bad), null, String(bad));
    }
  });
});

describe("fee rebates", () => {
  it("rebates the percent of the fee", () => {
    assert.equal(feeRebateFor({ capUsdc: 10, feeUsd: 0.2, percent: 100, usedUsdc: 0 }), 0.2);
    assert.equal(feeRebateFor({ capUsdc: 10, feeUsd: 0.2, percent: 50, usedUsdc: 0 }), 0.1);
  });

  it("stops at the cap", () => {
    assert.equal(feeRebateFor({ capUsdc: 10, feeUsd: 0.5, percent: 100, usedUsdc: 9.8 }), 0.2);
    assert.equal(feeRebateFor({ capUsdc: 10, feeUsd: 0.5, percent: 100, usedUsdc: 10 }), 0);
  });

  it("is never more than the fee, nor anything without one", () => {
    assert.equal(feeRebateFor({ capUsdc: 10, feeUsd: 0, percent: 100, usedUsdc: 0 }), 0);
    assert.equal(feeRebateFor({ capUsdc: 10, feeUsd: -1, percent: 100, usedUsdc: 0 }), 0);
  });

  it("rounds down to micro-USDC", () => {
    assert.equal(feeRebateFor({ capUsdc: 10, feeUsd: 0.0000019, percent: 100, usedUsdc: 0 }), 0.000001);
  });
});

describe("cashback boost", () => {
  it("adds (multiplier − 1) × the cashback", () => {
    assert.equal(cashbackBoostFor({ capPoints: 500, cashbackPoints: 3, multiplier: 2, usedPoints: 0 }), 3);
    assert.equal(cashbackBoostFor({ capPoints: 500, cashbackPoints: 3, multiplier: 1.5, usedPoints: 0 }), 1.5);
  });

  it("stops at the cap and needs cashback", () => {
    assert.equal(cashbackBoostFor({ capPoints: 500, cashbackPoints: 10, multiplier: 2, usedPoints: 496 }), 4);
    assert.equal(cashbackBoostFor({ capPoints: 500, cashbackPoints: 0, multiplier: 2, usedPoints: 0 }), 0);
  });
});

describe("premium discount", () => {
  const config = readPerkConfig("PREMIUM_DISCOUNT", {});

  it("gives the percent back on a covered product in the window", () => {
    assert.equal(
      premiumDiscountFor({ alreadyUsed: false, amountUsdc: 5, config, memberSince: "2026-10-10T00:00:00Z", now, product: "ALLIE_PRO" }),
      2.5,
    );
  });

  it("only once per product", () => {
    assert.equal(
      premiumDiscountFor({ alreadyUsed: true, amountUsdc: 5, config, memberSince: "2026-10-10T00:00:00Z", now, product: "ALLIE_PRO" }),
      0,
    );
  });

  it("not after the window, nor on other products", () => {
    assert.equal(
      premiumDiscountFor({ alreadyUsed: false, amountUsdc: 5, config, memberSince: "2026-07-01T00:00:00Z", now, product: "ALLIE_PRO" }),
      0,
    );
    assert.equal(
      premiumDiscountFor({ alreadyUsed: false, amountUsdc: 5, config, memberSince: "2026-10-10T00:00:00Z", now, product: "ALLIE_OVERAGE" }),
      0,
    );
  });
});

describe("welcome window", () => {
  const window = memberWindow(new Date("2026-10-01T00:00:00Z"), 30);

  it("runs perk_days from signup", () => {
    assert.equal(window.endsAt, "2026-10-31T00:00:00.000Z");
  });

  it("is open inside and closed at the end", () => {
    const member = { perks_end_at: window.endsAt, perks_start_at: window.startsAt };
    assert.equal(windowOpen(member, new Date("2026-10-30T23:59:59Z")), true);
    assert.equal(windowOpen(member, new Date("2026-10-31T00:00:00Z")), false);
    assert.equal(windowOpen(member, new Date("2026-09-30T23:59:59Z")), false);
  });

  it("counts part days as days left", () => {
    assert.equal(daysLeft(window.endsAt, new Date("2026-10-30T12:00:00Z")), 1);
    assert.equal(daysLeft(window.endsAt, new Date("2026-11-02T00:00:00Z")), 0);
  });
});

describe("offer availability", () => {
  const partner = { status: "ACTIVE" };

  it("is available while live, started, with room and budget", () => {
    assert.deepEqual(offerAvailability(liveOffer, partner, now), { available: true, reason: null });
  });

  it("explains why not", () => {
    const cases = [
      [{ ...liveOffer, status: "DRAFT" }, partner, "not_live"],
      [{ ...liveOffer, status: "PAUSED" }, partner, "not_live"],
      [{ ...liveOffer, starts_at: "2026-10-20T00:00:00Z" }, partner, "not_started"],
      [{ ...liveOffer, ends_at: "2026-10-17T11:59:59Z" }, partner, "ended"],
      [{ ...liveOffer, status: "ENDED" }, partner, "ended"],
      [{ ...liveOffer, members_count: 100 }, partner, "full"],
      [{ ...liveOffer, spent_usdc: 50 }, partner, "out_of_budget"],
      [liveOffer, { status: "PAUSED" }, "partner_inactive"],
    ];
    for (const [offer, who, reason] of cases) {
      assert.equal(offerAvailability(offer, who, now).reason, reason);
    }
  });

  it("has no member cap when max_members is null", () => {
    assert.equal(offerAvailability({ ...liveOffer, max_members: null, members_count: 10_000 }, partner, now).available, true);
  });
});

describe("partner commission", () => {
  const partner = {
    commission_bps: 2500,
    commission_mode: "FIXED",
    contract_ends_at: "2027-10-01T00:00:00Z",
    contract_starts_at: "2026-10-01T00:00:00Z",
    status: "ACTIVE",
  };

  it("uses the contract while it runs", () => {
    assert.equal(effectiveCommissionBps(partner, 1000, now), 2500);
    assert.equal(effectiveCommissionBps({ ...partner, commission_bps: 500 }, 1000, now), 500);
  });

  it("takes the higher of contract and tier in AT_LEAST_TIER mode", () => {
    const atLeast = { ...partner, commission_bps: 1500, commission_mode: "AT_LEAST_TIER" };
    assert.equal(effectiveCommissionBps(atLeast, 1000, now), 1500);
    assert.equal(effectiveCommissionBps(atLeast, 2000, now), 2000);
  });

  it("falls back to the tier outside the contract, when paused, or without a rate", () => {
    assert.equal(effectiveCommissionBps(partner, 1000, new Date("2027-10-01T00:00:00Z")), 1000);
    assert.equal(effectiveCommissionBps({ ...partner, status: "PAUSED" }, 1000, now), 1000);
    assert.equal(effectiveCommissionBps({ ...partner, commission_bps: null }, 1000, now), 1000);
    assert.equal(effectiveCommissionBps(null, 1000, now), 1000);
  });
});

describe("admin input", () => {
  it("fills perk defaults and checks numbers", () => {
    assert.deepEqual(readPerkConfig("WELCOME_POINTS", {}), { points: 300 });
    assert.deepEqual(readPerkConfig("CASHBACK_BOOST", { cap_points: 200 }), { capPoints: 200, multiplier: 2 });
    assert.throws(() => readPerkConfig("FEE_REBATE", { percent: 150 }), /between 1 and 100/);
    assert.throws(() => readPerkConfig("PREMIUM_DISCOUNT", { products: ["ALLIE_OVERAGE"] }), /unknown/);
  });

  it("refuses the same perk twice", () => {
    assert.throws(
      () => readPerksInput([{ kind: "FEE_REBATE" }, { kind: "FEE_REBATE" }]),
      /only be added once/,
    );
    assert.equal(readPerksInput([{ kind: "FEE_REBATE" }, { kind: "ALLIE_PRO_TRIAL" }]).length, 2);
  });

  it("reads an offer", () => {
    const offer = readOfferInput({ budgetUsdc: "50", code: "Ada-Launch", maxMembers: "", title: "Ada launch" });
    assert.equal(offer.code, "ada-launch");
    assert.equal(offer.max_members, null);
    assert.equal(offer.perk_days, 30);
    assert.equal(offer.budget_usdc, 50);
    assert.throws(() => readOfferInput({ code: "x", title: "t" }), /link code/);
    assert.throws(
      () => readOfferInput({ code: "abc", endsAt: "2026-10-01", startsAt: "2026-10-02", title: "t" }),
      /end after/,
    );
  });

  it("reads a partner", () => {
    const partner = readPartnerInput({
      commissionBps: "2500",
      commissionMode: "FIXED",
      displayName: "Ada",
      handle: "@ada",
      walletAddress: "0xAbCdEf0123456789aBcDeF0123456789abcdef01",
    });
    assert.equal(partner.wallet_address, "0xabcdef0123456789abcdef0123456789abcdef01");
    assert.equal(partner.handle, "ada");
    assert.equal(partner.commission_bps, 2500);
    assert.throws(() => readPartnerInput({ displayName: "Ada", walletAddress: "0x12" }), /wallet/);
    assert.throws(
      () => readPartnerInput({ avatarUrl: "http://x", displayName: "Ada", walletAddress: `0x${"1".repeat(40)}` }),
      /https/,
    );
  });
});

describe("budget and wording", () => {
  it("counts points at a cent each", () => {
    assert.equal(budgetCostUsd({ points: 300 }), 3);
    assert.equal(budgetCostUsd({ amountUsdc: 0.25, points: 10 }), 0.35);
  });

  it("describes perks plainly", () => {
    assert.equal(perkSummary("FEE_REBATE", {}, 30), "Your payment fees back for 30 days, up to $10 in USDC");
    assert.equal(perkSummary("WELCOME_POINTS", {}), "300 ONE Points after your first payment");
    assert.equal(perkSummary("ALLIE_PRO_TRIAL", {}), "ALLIE Pro free for 30 days");
    assert.match(perkSummary("PREMIUM_DISCOUNT", { products: ["ALLIE_PRO"] }), /first ALLIE Pro purchase/);
  });
});
