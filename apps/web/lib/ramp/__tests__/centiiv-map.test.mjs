/**
 * Centiiv request responses, shaped like the docs' examples, map to the right
 * `ramp_orders` columns.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/ramp/__tests__/centiiv-map.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapRequestToPatch } from "@/lib/ramp/centiiv-map";

const delivery = `0x${"cd".repeat(32)}`;

describe("mapRequestToPatch", () => {
  it("maps a new on-ramp to its virtual bank account", () => {
    const patch = mapRequestToPatch({
      id: "req_on_1",
      status: "PENDING",
      type: "ONRAMP",
      amount: 150000,
      totalToPay: 150000,
      temporaryWallet: {
        virtualAccountNumber: "8012345678",
        virtualAccountName: "Cent Protocol / Jane Smith",
        virtualBankName: "Wema Bank",
        virtualBankCode: "035",
      },
    });
    assert.deepEqual(patch, {
      provider_order_id: "req_on_1",
      status: "PENDING",
      total_to_pay: "150000",
      payin_instructions: {
        accountNumber: "8012345678",
        accountName: "Cent Protocol / Jane Smith",
        bankName: "Wema Bank",
        bankCode: "035",
      },
    });
  });

  it("maps the on-ramp shape the sandbox actually returns", () => {
    const patch = mapRequestToPatch({
      id: "b633e1d6-e5a0-48d0-9a12-dbb3068d69cd",
      status: "PENDING",
      environment: "SANDBOX",
      fromAsset: "NGN",
      toAsset: "USDC",
      amount: 5000,
      totalToPay: 5000,
      type: "ONRAMP",
      beneficiary: { address: "0x000000000000000000000000000000000000dEaD", network: "ARC", isTestnet: true },
      createdAt: "2026-10-15T21:09:03.891Z",
      temporaryWallet: {
        accountName: "CENTIIV/SaphraONE",
        accountNumber: "5457663008",
        bankCode: "090645",
        bankName: "Nombank MFB",
        expiresAt: "2026-10-15T21:54:03.943Z",
      },
      fulfillments: [{ amount: "5000" }],
      adminNote: null,
    });
    assert.deepEqual(patch.payin_instructions, {
      accountNumber: "5457663008",
      accountName: "CENTIIV/SaphraONE",
      bankName: "Nombank MFB",
      bankCode: "090645",
    });
    assert.equal(patch.deposit_expires_at, "2026-10-15T21:54:03.943Z");
    assert.equal(patch.total_to_pay, "5000");
  });

  it("maps a new off-ramp's expiry but never its deposit address", () => {
    const patch = mapRequestToPatch({
      id: "req_off_1",
      status: "PENDING",
      type: "OFFRAMP",
      totalToPay: 100,
      temporaryWallet: {
        publicAddress: "0x1111111111111111111111111111111111111111",
        network: "ARC",
        isTestnet: true,
        expiresAt: "2026-10-15T12:30:00.000Z",
      },
    });
    assert.deepEqual(patch, {
      provider_order_id: "req_off_1",
      status: "PENDING",
      total_to_pay: "100",
      deposit_expires_at: "2026-10-15T12:30:00.000Z",
    });
    assert.equal("deposit_address" in patch, false);
  });

  it("maps a fulfilled on-ramp to its delivery transaction and amount", () => {
    const patch = mapRequestToPatch({
      id: "req_on_1",
      status: "FULFILLED",
      type: "ONRAMP",
      totalToPay: "150000",
      blockchainTxs: [
        { txHash: delivery, direction: "OUTGOING", amount: "100.97", network: "ARC", status: "CONFIRMED" },
      ],
    });
    assert.equal(patch.status, "FULFILLED");
    assert.equal(patch.delivery_tx_hash, delivery);
    assert.equal(patch.usdc_amount, "100.97");
    assert.equal(patch.failure_reason, undefined);
  });

  it("explains a failed or refunded order", () => {
    assert.equal(
      mapRequestToPatch({ id: "a", status: "FAILED", type: "OFFRAMP", adminNote: "Bank rejected the transfer" })
        .failure_reason,
      "Bank rejected the transfer",
    );
    assert.equal(
      mapRequestToPatch({ id: "b", status: "refunded", type: "OFFRAMP" }).failure_reason,
      "The USDC was returned to your wallet.",
    );
  });

  it("ignores an unknown status", () => {
    const patch = mapRequestToPatch({ id: "c", status: "WEIRD", type: "ONRAMP" });
    assert.equal(patch.status, undefined);
  });
});
