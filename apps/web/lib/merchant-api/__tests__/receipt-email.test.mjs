/**
 * The buyer's receipt email for a completed Checkout session.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/merchant-api/__tests__/receipt-email.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { receiptEmailHtml, receiptEmailText, receiptSubject } from "@/lib/email/checkout-receipt-email";

const session = {
  amount: "25",
  amount_received: "26",
  amount_refunded: "0",
  cancel_url: null,
  client_reference_id: "order-SECRET-1042",
  completed_at: "2026-10-17T10:05:00.000Z",
  created_at: "2026-10-17T10:00:00.000Z",
  currency: "USDC",
  customer_email: "ada@example.com",
  description: "Order <b>#1042</b>",
  expires_at: "2026-10-17T11:00:00.000Z",
  id: "cs_test_abc",
  line_items: [
    { name: "Mug", quantity: 2, unit_amount: "10" },
    { name: "Tea & honey", quantity: 1, unit_amount: "5" },
  ],
  livemode: false,
  metadata: { internal_note: "metadata-SECRET" },
  object: "checkout.session",
  overpayment: "1",
  payment_status: "paid",
  payments: [
    {
      amount: "26",
      explorer_url: "https://testnet.arcscan.app/tx/0xabc",
      method: "wallet",
      paid_at: "2026-10-17T10:05:00.000Z",
      tx_hash: "0xabc",
    },
  ],
  refunds: [],
  status: "complete",
  success_url: "https://shop.example/thanks",
  url: "https://testnet.saphra.one/checkout/cs_test_abc",
};

const input = { businessName: "Ada's <Shop>", replyTo: "hello@shop.example", session };

describe("checkout receipt email", () => {
  const html = receiptEmailHtml({ ...input, hasWordmark: true });
  const text = receiptEmailText(input);

  it("shows what was paid, the items and the reference", () => {
    assert.match(receiptSubject(input), /26\.00 USDC/);
    assert.match(html, /2 × 10\.00 USDC/);
    assert.match(html, /20\.00 USDC/);
    assert.match(html, /Tea &amp; honey/);
    assert.match(html, /cs_test_abc/);
    assert.match(html, /Arc wallet/);
    assert.match(html, /testnet\.arcscan\.app\/tx\/0xabc/);
    assert.match(text, /- Mug \(2 × 10\.00 USDC\): 20\.00 USDC/);
  });

  it("mentions an overpayment", () => {
    assert.match(html, /Paid above the total/);
    assert.match(text, /1\.00 USDC above the total/);
  });

  it("escapes the business name", () => {
    assert.match(html, /Ada&#39;s &lt;Shop&gt;/);
    assert.doesNotMatch(html, /<Shop>/);
  });

  it("never shows the merchant's own references", () => {
    for (const body of [html, text]) {
      assert.doesNotMatch(body, /order-SECRET/);
      assert.doesNotMatch(body, /metadata-SECRET/);
    }
  });

  it("falls back to the description when there are no line items", () => {
    const plain = { ...input, session: { ...session, line_items: [], overpayment: "0" } };
    const body = receiptEmailHtml({ ...plain, hasWordmark: true });
    assert.match(body, /Order &lt;b&gt;#1042&lt;\/b&gt;/);
    assert.doesNotMatch(body, /Paid above the total/);
  });

  it("says replies go to the business only when it has a contact email", () => {
    assert.match(text, /Reply to this email/);
    assert.match(receiptEmailText({ ...input, replyTo: null }), /isn't monitored/);
  });
});
