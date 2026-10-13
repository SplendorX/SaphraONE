/**
 * Agent-payment fees.
 *
 * Agent payments settle through the send router (SaphraSend), which takes
 * its band fee on-chain in the same call (100 USDC → 0.20). ALLIE's own fee is a separate transfer.
 * These tests pin the arithmetic and which fees need a leg of their own.
 *
 * Run: pnpm --filter @saphra/web test:allie
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

const platform = "0x1111111111111111111111111111111111111111";
const allie = "0x2222222222222222222222222222222222222222";

let computeAgentFees;
let feeLegs;

before(async () => {
  process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT = platform;
  process.env.ALLIE_PRO_FEE_RECIPIENT = allie;
  process.env.ALLIE_PER_PAYMENT_FEE_UNITS = "3000";

  ({ computeAgentFees, feeLegs } = await import("@/lib/allie/agent-fees"));
});

const usdc = (value) => BigInt(Math.round(value * 1_000_000));

describe("computeAgentFees", () => {
  it("charges the platform band fee and the ALLIE fee on free tier", () => {
    const breakdown = computeAgentFees(usdc(100), "free");

    assert.equal(breakdown.fees.length, 2);
    assert.equal(breakdown.fees[0].kind, "platform");
    assert.equal(breakdown.fees[0].units, usdc(0.2), "band fee for 100");
    assert.equal(breakdown.fees[0].via, "router", "taken inside the send call");
    assert.equal(breakdown.fees[1].kind, "allie");
    assert.equal(breakdown.fees[1].units, 3_000n);
    assert.equal(breakdown.fees[1].via, "transfer");

    assert.equal(breakdown.totalFeeUnits, usdc(0.2) + 3_000n);
    assert.equal(
      breakdown.totalDebitUnits,
      usdc(100) + usdc(0.2) + 3_000n,
      "payment plus every fee",
    );
  });

  it("drops the ALLIE fee for Pro — they already paid monthly", () => {
    const breakdown = computeAgentFees(usdc(100), "pro");

    assert.equal(breakdown.fees.length, 1);
    assert.equal(breakdown.fees[0].kind, "platform");
    assert.equal(breakdown.totalFeeUnits, usdc(0.2));
  });

  it("still charges the platform fee on Pro", () => {
    // Pro buys language understanding, not free settlement.
    assert.ok(computeAgentFees(usdc(50), "pro").totalFeeUnits > 0n);
  });

  it("still charges the platform fee without a configured recipient", () => {
    // The router holds its own fee recipient on-chain, so this fee cannot be
    // lost to a missing env var the way a transfer-based one could.
    const saved = process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT;
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT = "";

    try {
      const breakdown = computeAgentFees(usdc(100), "pro");

      assert.equal(breakdown.fees.length, 1);
      assert.equal(breakdown.totalFeeUnits, usdc(0.2));
      assert.deepEqual(breakdown.skipped, []);
    } finally {
      process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT = saved;
    }
  });

  it("skips ALLIE's fee when its recipient is not configured", () => {
    const savedAllie = process.env.ALLIE_PRO_FEE_RECIPIENT;
    const savedPlatform = process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT;
    process.env.ALLIE_PRO_FEE_RECIPIENT = "";
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT = "";

    try {
      const breakdown = computeAgentFees(usdc(100), "free");

      assert.deepEqual(breakdown.skipped, ["allie"]);
      assert.equal(
        breakdown.totalFeeUnits,
        usdc(0.2),
        "an unconfigured fee is skipped, never folded into the payment",
      );
    } finally {
      process.env.ALLIE_PRO_FEE_RECIPIENT = savedAllie;
      process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT = savedPlatform;
    }
  });

  it("charges the 0.01 minimum on dust payments", () => {
    // Up to 10 USDC pays the flat 0.01, which covers the network's gas.
    const breakdown = computeAgentFees(500n, "pro");

    assert.equal(breakdown.totalFeeUnits, usdc(0.01));
    assert.equal(breakdown.totalDebitUnits, 500n + usdc(0.01));
  });

  it("steps the platform fee up with the payment, not the leg count", () => {
    const small = computeAgentFees(usdc(10), "pro").totalFeeUnits;
    const large = computeAgentFees(usdc(1000), "pro").totalFeeUnits;

    assert.equal(small, usdc(0.01));
    assert.equal(large, usdc(1));
  });
});

describe("feeLegs", () => {
  it("never adds a leg for the router-collected fee", () => {
    // Charging it again as a transfer would double-bill the sender.
    const legs = feeLegs(computeAgentFees(usdc(100), "free"));

    assert.equal(legs.length, 1, "only ALLIE's fee needs its own transfer");
    assert.equal(legs[0].kind, "fee");
    assert.equal(legs[0].recipient, allie);
    assert.equal(legs[0].amountUnits, 3_000n);
    assert.ok(
      !legs.some((leg) => leg.recipient === platform),
      "the platform fee is taken inside the send call",
    );
  });

  it("produces no legs at all for a Pro payment", () => {
    assert.deepEqual(feeLegs(computeAgentFees(usdc(100), "pro")), []);
  });

  it("produces nothing when there is nothing to charge", () => {
    assert.deepEqual(feeLegs(computeAgentFees(500n, "pro")), []);
  });
});
