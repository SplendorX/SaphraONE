/**
 * Checkout API objects: status mapping and the session's public shape.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/merchant-api/__tests__/serialize.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chargeStatusFor,
  paymentStatus,
  sessionStatus,
  toSessionObject,
} from "@/lib/merchant-api/serialize";

const charge = {
  amount: "25",
  amount_received: "25",
  amount_refunded: "0",
  created_at: "2026-10-17T10:00:00.000Z",
  currency: "USDC",
  expires_at: "2026-10-17T11:00:00.000Z",
  id: "charge-1",
  kind: "ONLINE",
  note: "Order #1042",
  overpayment: "0",
  paid_at: "2026-10-17T10:05:00.000Z",
  public_id: "ABCDEFGHJK",
  status: "PAID",
  tip_amount: "0",
  wallet_address: "0xmerchant",
};

const session = {
  cancel_url: null,
  charge_id: "charge-1",
  client_reference_id: "1042",
  created_at: "2026-10-17T10:00:00.000Z",
  customer_email: "buyer@example.com",
  id: "session-row",
  line_items: [],
  metadata: { cart: "abc" },
  mode: "test",
  public_id: "cs_test_000000000000000000000000",
  success_url: "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
  wallet_address: "0xmerchant",
};

function build(overrides = {}) {
  return toSessionObject({
    charge: { ...charge, ...overrides.charge },
    explorerUrl: (hash) => `https://explorer.example/tx/${hash}`,
    origin: "https://app.saphra.one/",
    payments: overrides.payments ?? [
      { amount: "25", paid_at: charge.paid_at, source: "WALLET", tx_hash: "0xabc" },
    ],
    refunds: overrides.refunds ?? [],
    session: { ...session, ...overrides.session },
  });
}

describe("status mapping", () => {
  it("maps charge statuses both ways", () => {
    assert.equal(sessionStatus("OPEN"), "open");
    assert.equal(sessionStatus("PAID"), "complete");
    assert.equal(sessionStatus("EXPIRED"), "expired");
    assert.equal(sessionStatus("CANCELLED"), "cancelled");
    assert.equal(chargeStatusFor("complete"), "PAID");
    assert.equal(chargeStatusFor("PAID"), null);
  });

  it("derives payment_status from what arrived", () => {
    assert.equal(paymentStatus({ amount: "25", amount_received: "0" }), "unpaid");
    assert.equal(paymentStatus({ amount: "25", amount_received: "10" }), "partially_paid");
    assert.equal(paymentStatus({ amount: "25", amount_received: "25" }), "paid");
    assert.equal(paymentStatus({ amount: "25", amount_received: "30" }), "paid");
  });
});

describe("toSessionObject", () => {
  it("builds the public session object", () => {
    const object = build();
    assert.equal(object.object, "checkout.session");
    assert.equal(object.id, session.public_id);
    assert.equal(object.status, "complete");
    assert.equal(object.payment_status, "paid");
    assert.equal(object.url, "https://app.saphra.one/checkout/cs_test_000000000000000000000000");
    assert.equal(object.livemode, false);
    assert.equal(object.completed_at, charge.paid_at);
    assert.equal(object.description, "Order #1042");
    assert.deepEqual(object.metadata, { cart: "abc" });
    assert.deepEqual(object.payments, [
      {
        amount: "25",
        explorer_url: "https://explorer.example/tx/0xabc",
        method: "wallet",
        paid_at: charge.paid_at,
        tx_hash: "0xabc",
      },
    ]);
  });

  it("never exposes the merchant wallet or internal ids", () => {
    const json = JSON.stringify(build());
    assert.ok(!json.includes("0xmerchant"));
    assert.ok(!json.includes("charge-1"));
    assert.ok(!json.includes("session-row"));
  });

  it("sums only succeeded refunds", () => {
    const refund = (amount, status) => ({
      amount,
      created_at: charge.created_at,
      currency: "USDC",
      destination_wallet: "0xbuyer",
      public_id: `re_test_${status}`,
      reason: null,
      status,
      succeeded_at: null,
      tx_hash: null,
    });
    const object = build({
      refunds: [refund("5", "SUCCEEDED"), refund("3", "REQUESTED"), refund("2", "CANCELLED")],
    });
    assert.equal(object.amount_refunded, "5");
    assert.deepEqual(
      object.refunds.map((entry) => [entry.status, entry.session]),
      [
        ["succeeded", session.public_id],
        ["requested", session.public_id],
        ["cancelled", session.public_id],
      ],
    );
  });

  it("reports an open, partly paid session", () => {
    const object = build({
      charge: { amount_received: "10", paid_at: null, status: "OPEN" },
      session: { mode: "live" },
    });
    assert.equal(object.status, "open");
    assert.equal(object.payment_status, "partially_paid");
    assert.equal(object.livemode, true);
  });
});
