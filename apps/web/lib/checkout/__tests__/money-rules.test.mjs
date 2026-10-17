/**
 * Checkout money rules: bounds, tip cap, and how payments settle a charge.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/checkout/__tests__/money-rules.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyPaymentToCharge,
  chargeTotal,
  isExpired,
  validateChargeAmount,
  validateTip,
} from "@/lib/checkout/money-rules";

describe("validateChargeAmount", () => {
  it("accepts amounts within bounds and normalises them", () => {
    assert.deepEqual(validateChargeAmount("5.00", "MERCHANT"), { ok: true, amount: "5" });
    assert.deepEqual(validateChargeAmount("0.5", "MERCHANT"), { ok: true, amount: "0.5" });
    assert.deepEqual(validateChargeAmount("50000", "MERCHANT"), { ok: true, amount: "50000" });
  });

  it("rejects below the minimum, above the maximum, and junk", () => {
    assert.equal(validateChargeAmount("0.49", "MERCHANT").ok, false);
    assert.equal(validateChargeAmount("50000.01", "MERCHANT").ok, false);
    assert.equal(validateChargeAmount("10000.01", "STOREFRONT").ok, false);
    assert.equal(validateChargeAmount("-1", "MERCHANT").ok, false);
    assert.equal(validateChargeAmount("1e3", "MERCHANT").ok, false);
    assert.equal(validateChargeAmount("1.1234567", "MERCHANT").ok, false);
    assert.equal(validateChargeAmount(undefined, "MERCHANT").ok, false);
  });
});

describe("validateTip", () => {
  it("treats an empty tip as zero", () => {
    assert.deepEqual(validateTip("", "5"), { ok: true, amount: "0" });
    assert.deepEqual(validateTip(undefined, "5"), { ok: true, amount: "0" });
  });

  it("caps the tip at three times the amount", () => {
    assert.equal(validateTip("15", "5").ok, true);
    assert.equal(validateTip("15.01", "5").ok, false);
  });

  it("caps the tip at 5,000 for large charges", () => {
    assert.equal(validateTip("5000", "40000").ok, true);
    assert.equal(validateTip("5000.01", "40000").ok, false);
  });
});

describe("chargeTotal", () => {
  it("adds the selected tip to the base amount", () => {
    assert.equal(chargeTotal({ amount: "5", tip_amount: "1" }), "6");
    assert.equal(chargeTotal({ amount: "5.1", tip_amount: "0.2" }), "5.3");
  });
});

describe("applyPaymentToCharge", () => {
  const charge = { amount: "5", status: "OPEN" };

  it("marks an exact payment paid with no tip", () => {
    assert.deepEqual(applyPaymentToCharge({ charge, received: 5 }), {
      amountReceived: "5",
      overpayment: "0",
      status: "PAID",
      tipAmount: "0",
    });
  });

  it("records anything above the base as tip", () => {
    const result = applyPaymentToCharge({ charge, received: 6 });
    assert.equal(result.status, "PAID");
    assert.equal(result.tipAmount, "1");
    assert.equal(result.overpayment, "0");
  });

  it("keeps an underpaid charge open", () => {
    const result = applyPaymentToCharge({ charge, received: 3 });
    assert.equal(result.status, "OPEN");
    assert.equal(result.amountReceived, "3");
    assert.equal(result.tipAmount, "0");
  });

  it("settles once cumulative payments reach the base", () => {
    assert.equal(applyPaymentToCharge({ charge, received: 3 + 2 }).status, "PAID");
    assert.equal(applyPaymentToCharge({ charge, received: 0.1 + 0.2 + 4.7 }).status, "PAID");
  });

  it("marks a late payment on an expired charge paid", () => {
    assert.equal(
      applyPaymentToCharge({ charge: { amount: "5", status: "EXPIRED" }, received: 5 }).status,
      "PAID",
    );
  });

  it("leaves an expired, short charge expired", () => {
    assert.equal(
      applyPaymentToCharge({ charge: { amount: "5", status: "EXPIRED" }, received: 1 }).status,
      "EXPIRED",
    );
  });

  it("splits excess beyond the tip cap into overpayment", () => {
    const result = applyPaymentToCharge({ charge, received: 25 });
    assert.equal(result.tipAmount, "15");
    assert.equal(result.overpayment, "5");
  });
});

describe("isExpired", () => {
  it("is true only for an open charge past its expiry", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(isExpired({ expires_at: past, status: "OPEN" }), true);
    assert.equal(isExpired({ expires_at: future, status: "OPEN" }), false);
    assert.equal(isExpired({ expires_at: past, status: "PAID" }), false);
  });
});

describe("online checkout (kind ONLINE)", () => {
  const online = { amount: "25", kind: "ONLINE", status: "OPEN" };

  it("allows up to 10 000", () => {
    assert.equal(validateChargeAmount("10000", "ONLINE").ok, true);
    assert.equal(validateChargeAmount("10000.01", "ONLINE").ok, false);
  });

  it("takes no tip: anything above the amount is overpayment", () => {
    const result = applyPaymentToCharge({ charge: online, received: 26.5 });
    assert.equal(result.status, "PAID");
    assert.equal(result.tipAmount, "0");
    assert.equal(result.overpayment, "1.5");
  });

  it("stays open while short", () => {
    const result = applyPaymentToCharge({ charge: online, received: 10 });
    assert.equal(result.status, "OPEN");
    assert.equal(result.amountReceived, "10");
  });
});
