/**
 * Refund rules: how much can be refunded, where it goes, and what proves it
 * on chain.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/checkout/__tests__/refunds.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";

import { NATIVE_USDC_EVENT_ADDRESS } from "@/lib/arc-transfers";
import {
  defaultRefundDestination,
  readRefundAmount,
  readRefundDestination,
  readRefundReason,
  refundableAmount,
  refundedAmount,
  refundTransferProven,
  sentByWallet,
} from "@/lib/checkout/refund-rules";
import { receivedChargeAmount } from "@/lib/checkout/verify";
import { arcTokens } from "@/lib/tokens";

const merchant = "0x1111111111111111111111111111111111111111";
const buyer = "0x2222222222222222222222222222222222222222";
const router = "0x3333333333333333333333333333333333333333";
const stranger = "0x4444444444444444444444444444444444444444";

describe("refundableAmount", () => {
  it("is what arrived minus every refund that isn't cancelled", () => {
    const refunds = [
      { amount: "3", status: "SUCCEEDED" },
      { amount: "1.5", status: "REQUESTED" },
      { amount: "10", status: "CANCELLED" },
    ];
    assert.equal(refundableAmount({ amountReceived: "5", refunds }), 0.5);
    assert.equal(refundedAmount(refunds), 3);
  });

  it("never goes below zero", () => {
    assert.equal(refundableAmount({ amountReceived: "2", refunds: [{ amount: "5", status: "SUCCEEDED" }] }), 0);
  });
});

describe("readRefundAmount", () => {
  it("defaults to everything refundable", () => {
    assert.deepEqual(readRefundAmount(undefined, 12.5), { ok: true, value: "12.5" });
    assert.deepEqual(readRefundAmount("", 3), { ok: true, value: "3" });
  });

  it("allows partial refunds and caps at what is refundable", () => {
    assert.deepEqual(readRefundAmount("2.25", 5), { ok: true, value: "2.25" });
    assert.deepEqual(readRefundAmount("5", 5), { ok: true, value: "5" });
    assert.equal(readRefundAmount("5.01", 5).ok, false);
  });

  it("lets partial plus partial reach exactly what arrived, and no further", () => {
    const received = "5";
    const first = readRefundAmount("3", refundableAmount({ amountReceived: received, refunds: [] }));
    assert.equal(first.ok, true);
    const after = [{ amount: "3", status: "SUCCEEDED" }];
    assert.deepEqual(readRefundAmount("2", refundableAmount({ amountReceived: received, refunds: after })), {
      ok: true,
      value: "2",
    });
    assert.equal(readRefundAmount("2.01", refundableAmount({ amountReceived: received, refunds: after })).ok, false);
  });

  it("refuses nonsense, dust and an empty charge", () => {
    for (const value of ["abc", "-1", "1e3", "0", "0.001", "1.1234567", 5]) {
      const result = readRefundAmount(value, 10);
      if (value === 5) assert.equal(result.ok, true);
      else assert.equal(result.ok, false, String(value));
    }
    assert.equal(readRefundAmount(undefined, 0).ok, false);
  });
});

describe("refund destination", () => {
  const wallet = (payer_wallet, source = "WALLET") => ({ payer_wallet, source });

  it("defaults to the payer when every payment came straight from one wallet", () => {
    assert.equal(defaultRefundDestination([wallet(buyer), wallet(buyer.toUpperCase().replace("0X", "0x"), "SWIFTPAY")]), buyer);
  });

  it("has no default for card/bank, cross-chain, hand-attached or mixed payers", () => {
    for (const source of ["ONRAMP", "BRIDGE", "RECONCILE"]) {
      assert.equal(defaultRefundDestination([wallet(buyer, source)]), null, source);
    }
    assert.equal(defaultRefundDestination([wallet(buyer), wallet(stranger)]), null);
    assert.equal(defaultRefundDestination([wallet(null)]), null);
    assert.equal(defaultRefundDestination([]), null);
  });

  it("needs a wallet when there is no default, and never the merchant's own", () => {
    const card = [wallet(router, "ONRAMP")];
    assert.equal(readRefundDestination({ merchantWallet: merchant, payments: card, value: "" }).ok, false);
    assert.deepEqual(readRefundDestination({ merchantWallet: merchant, payments: card, value: ` ${buyer} ` }), {
      ok: true,
      value: buyer,
    });
    assert.equal(readRefundDestination({ merchantWallet: merchant, payments: [], value: merchant }).ok, false);
    assert.equal(readRefundDestination({ merchantWallet: merchant, payments: [], value: "0x123" }).ok, false);
  });
});

describe("readRefundReason", () => {
  it("is optional, trimmed and capped", () => {
    assert.deepEqual(readRefundReason(undefined), { ok: true, value: null });
    assert.deepEqual(readRefundReason("  Out   of stock "), { ok: true, value: "Out of stock" });
    assert.equal(readRefundReason("x".repeat(201)).ok, false);
    assert.equal(readRefundReason(42).ok, false);
  });
});

// ── On chain ────────────────────────────────────────────────────────────────

const abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const usdc = arcTokens.USDC.address;
const usdcEmitters = [usdc, NATIVE_USDC_EVENT_ADDRESS];

function transfer(token, from, to, units) {
  return {
    address: token,
    data: encodeAbiParameters([{ type: "uint256" }], [units]),
    topics: encodeEventTopics({ abi, args: { from, to }, eventName: "Transfer" }),
  };
}

function proven(logs, amount = "5") {
  const received = receivedChargeAmount({ currency: "USDC", destination: buyer, logs })?.amount ?? null;
  const sentByMerchant = sentByWallet({ emitters: usdcEmitters, logs, wallet: merchant });
  return refundTransferProven({ amount, received, sentByMerchant });
}

describe("refund transfer", () => {
  it("is proven by a direct send from the merchant to the buyer", () => {
    assert.equal(proven([transfer(usdc, merchant, buyer, 5_000_000n)]), true);
  });

  it("is proven through the SaphraSend router (merchant → router → buyer, fee kept)", () => {
    const logs = [
      transfer(usdc, merchant, router, 5_010_000n),
      transfer(usdc, router, buyer, 5_000_000n),
      transfer(usdc, router, stranger, 10_000n),
    ];
    assert.equal(proven(logs), true);
  });

  it("counts a native USDC send once, with its ERC-20 twin", () => {
    const logs = [
      transfer(usdc, merchant, buyer, 5_000_000n),
      transfer(NATIVE_USDC_EVENT_ADDRESS, merchant, buyer, 5n * 10n ** 18n),
    ];
    assert.equal(receivedChargeAmount({ currency: "USDC", destination: buyer, logs })?.amount, 5);
    assert.equal(proven(logs, "5"), true);
    assert.equal(proven(logs, "10"), false);
  });

  it("is not proven when someone else sent it", () => {
    assert.equal(proven([transfer(usdc, stranger, buyer, 5_000_000n)]), false);
  });

  it("is not proven when the buyer got less, or it went elsewhere", () => {
    assert.equal(proven([transfer(usdc, merchant, buyer, 4_990_000n)]), false);
    assert.equal(proven([transfer(usdc, merchant, stranger, 5_000_000n)]), false);
  });

  it("ignores other tokens", () => {
    assert.equal(proven([transfer(arcTokens.EURC.address, merchant, buyer, 5_000_000n)]), false);
  });
});
