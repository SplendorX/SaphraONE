/**
 * Daily allowance maths for KYC tiers and KYB levels.
 *
 * Run: pnpm --filter @saphra/web test:kyc
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultKycLimits, effectiveKybLevel, exceedsCap, fitsAllowance, remainingAllowance } from "@/lib/kyc/gate";

const limits = defaultKycLimits;
const none = { onrampNgn: 0, offrampUsdc: 0 };

describe("remainingAllowance", () => {
  it("blocks tier 0", () => {
    const remaining = remainingAllowance(0, none, limits);
    assert.equal(remaining.onrampNgn, 0);
    assert.equal(remaining.offrampUsdc, 0);
    assert.equal(remaining.nextTier, 1);
  });

  it("gives tier 1 the ₦500k / $500 caps", () => {
    const remaining = remainingAllowance(1, none, limits);
    assert.equal(remaining.onrampNgn, 500_000);
    assert.equal(remaining.offrampUsdc, 500);
    assert.equal(remaining.nextTier, 2);
  });

  it("gives tier 2 the ₦5m / $5k caps", () => {
    const remaining = remainingAllowance(2, none, limits);
    assert.equal(remaining.onrampNgn, 5_000_000);
    assert.equal(remaining.offrampUsdc, 5_000);
    assert.equal(remaining.nextTier, null);
  });

  it("subtracts today's volume", () => {
    const remaining = remainingAllowance(1, { onrampNgn: 100_000, offrampUsdc: 20 }, limits);
    assert.equal(remaining.onrampNgn, 400_000);
    assert.equal(remaining.offrampUsdc, 480);
  });

  it("is zero exactly at the cap", () => {
    const remaining = remainingAllowance(1, { onrampNgn: 500_000, offrampUsdc: 500 }, limits);
    assert.equal(remaining.onrampNgn, 0);
    assert.equal(remaining.offrampUsdc, 0);
  });

  it("does not go negative one kobo over", () => {
    const remaining = remainingAllowance(1, { onrampNgn: 500_000.01, offrampUsdc: 500.01 }, limits);
    assert.equal(remaining.onrampNgn, 0);
    assert.equal(remaining.offrampUsdc, 0);
  });

  it("takes the higher of personal tier and KYB basic", () => {
    const remaining = remainingAllowance(1, none, limits, "BASIC");
    assert.equal(remaining.onrampNgn, 10_000_000);
    assert.equal(remaining.offrampUsdc, 10_000);
  });
});

describe("fitsAllowance", () => {
  it("allows an amount equal to the remaining cap", () => {
    assert.equal(fitsAllowance(500_000, 500_000), true);
  });

  it("rejects one kobo over", () => {
    assert.equal(fitsAllowance(500_000, 500_000.01), false);
  });
});

describe("exceedsCap", () => {
  it("allows volume exactly at the cap", () => {
    assert.equal(exceedsCap(500_000, 500_000), false);
  });

  it("flags two orders that together pass the cap", () => {
    assert.equal(exceedsCap(300_000 + 300_000, 500_000), true);
  });
});

describe("effectiveKybLevel", () => {
  const basic = { status: "VERIFIED", level: "BASIC", tin_hash: null };

  it("is NONE until the business is verified", () => {
    assert.equal(effectiveKybLevel({ ...basic, status: "MANUAL_REVIEW" }, 2), "NONE");
    assert.equal(effectiveKybLevel(null, 2), "NONE");
  });

  it("stays BASIC without a TIN", () => {
    assert.equal(effectiveKybLevel(basic, 2), "BASIC");
  });

  it("reaches FULL when the owner gets Tier 2 after the TIN", () => {
    assert.equal(effectiveKybLevel({ ...basic, tin_hash: "h" }, 1), "BASIC");
    assert.equal(effectiveKybLevel({ ...basic, tin_hash: "h" }, 2), "FULL");
  });
});
