/**
 * Multichain receive rules: state machine, below-minimum accumulation, fee
 * math, recovery without a bridge result, idempotency keys.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/multichain/__tests__/rules.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canMoveDeposit,
  checkOutbound,
  canMoveSweep,
  depositsForSweep,
  depositStateFromCircle,
  idempotencyUuid,
  isSweepInFlight,
  MAX_SWEEP_ATTEMPTS,
  nativeArcToUnits,
  planSweep,
  grossForReceive,
  quoteOutbound,
  readFeeMode,
  recoverSweepWithoutResult,
  sweepFeeUnits,
  sweepRetryDelayMs,
  unitsToUsdc,
  usdcToUnits,
} from "@/lib/multichain/rules";

describe("USDC units", () => {
  it("parses and prints 6-decimal amounts", () => {
    assert.equal(usdcToUnits("12.5"), 12_500_000n);
    assert.equal(usdcToUnits("0.000001"), 1n);
    assert.equal(usdcToUnits("3"), 3_000_000n);
    assert.equal(usdcToUnits(1), 1_000_000n);
    assert.equal(unitsToUsdc(12_500_000n), "12.5");
    assert.equal(unitsToUsdc(1n), "0.000001");
    assert.equal(unitsToUsdc(0n), "0");
  });

  it("cuts extra decimals instead of rounding up", () => {
    assert.equal(usdcToUnits("1.0000019"), 1_000_001n);
  });

  it("rejects junk", () => {
    assert.throws(() => usdcToUnits("-1"));
    assert.throws(() => usdcToUnits("1e3"));
    assert.throws(() => usdcToUnits(""));
  });

  it("converts the 18-decimal native Arc amount", () => {
    assert.equal(nativeArcToUnits(49_984_000_000_000_000_000n), 49_984_000n);
    assert.equal(nativeArcToUnits(999_999_999_999n), 0n);
  });
});

describe("planSweep", () => {
  const base = { hasSweepInFlight: false, minDeposit: 1, paused: false };

  it("sweeps the whole balance once it passes the minimum", () => {
    assert.deepEqual(planSweep({ ...base, balanceUnits: 1_000_000n }), { action: "sweep", amountUnits: 1_000_000n });
    assert.deepEqual(planSweep({ ...base, balanceUnits: 50_250_000n }), { action: "sweep", amountUnits: 50_250_000n });
  });

  it("waits below the minimum so small deposits add up", () => {
    assert.deepEqual(planSweep({ ...base, balanceUnits: 999_999n }), { action: "wait", reason: "below-min" });
    // Two 0.6 deposits pass a 1.0 minimum together.
    assert.equal(planSweep({ ...base, balanceUnits: 1_200_000n }).action, "sweep");
  });

  it("honours a higher minimum (Ethereum)", () => {
    assert.equal(planSweep({ ...base, balanceUnits: 24_990_000n, minDeposit: 25 }).action, "wait");
    assert.equal(planSweep({ ...base, balanceUnits: 25_000_000n, minDeposit: 25 }).action, "sweep");
  });

  it("never starts a second sweep or sweeps while paused", () => {
    assert.deepEqual(planSweep({ ...base, balanceUnits: 5_000_000n, hasSweepInFlight: true }), {
      action: "wait",
      reason: "in-flight",
    });
    assert.deepEqual(planSweep({ ...base, balanceUnits: 5_000_000n, paused: true }), { action: "wait", reason: "paused" });
    assert.deepEqual(planSweep({ ...base, balanceUnits: 0n }), { action: "wait", reason: "empty" });
  });
});

describe("state machine", () => {
  it("allows the happy path", () => {
    for (const [from, to] of [
      ["DETECTED", "CONFIRMED"],
      ["CONFIRMED", "SWEEPING"],
      ["CONFIRMED", "BELOW_MIN"],
      ["BELOW_MIN", "SWEEPING"],
      ["SWEEPING", "BURNED"],
      ["BURNED", "CREDITED"],
    ]) {
      assert.equal(canMoveDeposit(from, to), true, `${from} → ${to}`);
    }
  });

  it("never leaves CREDITED and never credits before detection", () => {
    assert.equal(canMoveDeposit("CREDITED", "SWEEPING"), false);
    assert.equal(canMoveDeposit("CREDITED", "FAILED"), false);
    assert.equal(canMoveDeposit("DETECTED", "CREDITED"), false);
    assert.equal(canMoveSweep("CREDITED", "SWEEPING"), false);
  });

  it("lets a failed sweep resume", () => {
    assert.equal(canMoveSweep("FAILED", "SWEEPING"), true);
    assert.equal(canMoveSweep("FAILED", "BURNED"), true);
    assert.equal(canMoveDeposit("FAILED", "SWEEPING"), true);
  });

  it("holds the address only while sweeping or burned", () => {
    assert.equal(isSweepInFlight("SWEEPING"), true);
    assert.equal(isSweepInFlight("BURNED"), true);
    assert.equal(isSweepInFlight("FAILED"), false);
    assert.equal(isSweepInFlight("CREDITED"), false);
  });
});

describe("depositStateFromCircle", () => {
  it("maps Circle's inbound states", () => {
    assert.equal(depositStateFromCircle("COMPLETE"), "CONFIRMED");
    assert.equal(depositStateFromCircle("CONFIRMED"), "DETECTED");
    assert.equal(depositStateFromCircle("QUEUED"), "DETECTED");
    assert.equal(depositStateFromCircle("FAILED"), "FAILED");
    assert.equal(depositStateFromCircle("DENIED"), "FAILED");
    assert.equal(depositStateFromCircle("SOMETHING_NEW"), null);
    assert.equal(depositStateFromCircle(undefined), null);
  });
});

describe("recoverSweepWithoutResult", () => {
  it("never burns twice: a burn on record wins", () => {
    assert.equal(recoverSweepWithoutResult({ burnTxHash: "0xabc", pendingOutbound: true }), "burned");
  });

  it("waits while a source transaction is still moving", () => {
    assert.equal(recoverSweepWithoutResult({ burnTxHash: null, pendingOutbound: true }), "wait");
  });

  it("restarts from a clean source, however many tries it took", () => {
    assert.equal(recoverSweepWithoutResult({ burnTxHash: null, pendingOutbound: false }), "restart");
  });
});

describe("sweepRetryDelayMs", () => {
  it("backs off from a minute to at most an hour", () => {
    assert.equal(sweepRetryDelayMs(1), 60_000);
    assert.equal(sweepRetryDelayMs(2), 120_000);
    assert.equal(sweepRetryDelayMs(3), 240_000);
    assert.equal(sweepRetryDelayMs(MAX_SWEEP_ATTEMPTS), 960_000);
    assert.equal(sweepRetryDelayMs(20), 3_600_000);
  });

  it("spreads five tries over half an hour, not one minute", () => {
    let total = 0;
    for (let attempt = 1; attempt < MAX_SWEEP_ATTEMPTS; attempt += 1) total += sweepRetryDelayMs(attempt);
    assert.ok(total >= 15 * 60_000);
  });
});

describe("depositsForSweep", () => {
  const row = (amount_in, detected_at) => ({ amount_in, detected_at });

  it("carries every deposit the balance covers, oldest first", () => {
    const rows = [row("5", "2026-10-06T10:02:00Z"), row("20", "2026-10-06T10:00:00Z")];
    assert.deepEqual(depositsForSweep(rows, 25_000_000n).map((r) => r.amount_in), ["20", "5"]);
  });

  it("leaves a deposit the swept balance does not include for the next sweep", () => {
    const rows = [row("20", "2026-10-06T10:00:00Z"), row("5", "2026-10-06T10:02:00Z")];
    assert.deepEqual(depositsForSweep(rows, 20_000_000n).map((r) => r.amount_in), ["20"]);
  });

  it("carries nothing when the first deposit is not in the balance yet", () => {
    assert.deepEqual(depositsForSweep([row("20", "2026-10-06T10:00:00Z")], 1_000_000n), []);
  });
});

describe("fees", () => {
  it("is what Circle kept, never negative", () => {
    assert.equal(sweepFeeUnits(50_000_000n, 49_984_000n), 16_000n);
    assert.equal(sweepFeeUnits(1_000_000n, 1_000_000n), 0n);
    assert.equal(sweepFeeUnits(1_000_000n, 1_100_000n), 0n);
  });
});

describe("idempotencyUuid", () => {
  it("is a stable v4-shaped UUID", () => {
    const digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    const first = idempotencyUuid(digest);
    assert.equal(first, idempotencyUuid(digest));
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first, idempotencyUuid("0".repeat(64)));
  });
});

describe("quoteOutbound", () => {
  it("takes the forward fee out of the amount", () => {
    assert.deepEqual(quoteOutbound({ amountUnits: 50_000_000n, fastFeeBps: 0, forwardFeeUnits: 55_000n }), {
      feeUnits: 55_000n,
      receiveUnits: 49_945_000n,
    });
  });

  it("adds a fractional fast fee, rounded up", () => {
    // 0.35 bps of 100 USDC = 0.0035 USDC = 3500 units.
    assert.equal(quoteOutbound({ amountUnits: 100_000_000n, fastFeeBps: 0.35, forwardFeeUnits: 0n }).feeUnits, 3_500n);
    assert.equal(quoteOutbound({ amountUnits: 1n, fastFeeBps: 0.35, forwardFeeUnits: 0n }).feeUnits, 1n);
  });

  it("never quotes a negative arrival (Ethereum's $1.17 fee on $1)", () => {
    assert.equal(quoteOutbound({ amountUnits: 1_000_000n, fastFeeBps: 0, forwardFeeUnits: 1_193_726n }).receiveUnits, 0n);
  });
});

describe("grossForReceive", () => {
  it("adds the forward fee on top so the recipient gets the amount", () => {
    assert.equal(grossForReceive({ fastFeeBps: 0, forwardFeeUnits: 54_362n, receiveUnits: 5_000_000n }), 5_054_362n);
  });

  it("covers a fractional fast fee and never under-delivers", () => {
    for (const receiveUnits of [1n, 999_999n, 5_000_000n, 123_456_789n]) {
      const input = { fastFeeBps: 1.3, forwardFeeUnits: 54_362n };
      const gross = grossForReceive({ ...input, receiveUnits });
      assert.ok(quoteOutbound({ amountUnits: gross, ...input }).receiveUnits >= receiveUnits);
      assert.ok(quoteOutbound({ amountUnits: gross - 1n, ...input }).receiveUnits < receiveUnits);
    }
  });

  it("reads anything but 'add' as deduct", () => {
    assert.equal(readFeeMode("add"), "add");
    assert.equal(readFeeMode("ADD"), "deduct");
    assert.equal(readFeeMode(undefined), "deduct");
  });
});

describe("checkOutbound", () => {
  it("accepts a covered amount", () => {
    const quote = { feeUnits: 55_000n, receiveUnits: 4_945_000n };
    assert.deepEqual(checkOutbound({ amount: "5", balanceUnits: 10_000_000n, quote }), { amountUnits: 5_000_000n, ok: true });
  });

  it("refuses below the minimum, over the balance, or under the fee", () => {
    assert.equal(checkOutbound({ amount: "0.5" }).ok, false);
    assert.equal(checkOutbound({ amount: "20", balanceUnits: 10_000_000n }).ok, false);
    assert.equal(checkOutbound({ amount: "1", quote: { feeUnits: 1_193_726n, receiveUnits: 0n } }).ok, false);
    assert.equal(checkOutbound({ amount: "1.1234567" }).ok, false);
    assert.equal(checkOutbound({ amount: "abc" }).ok, false);
  });
});
