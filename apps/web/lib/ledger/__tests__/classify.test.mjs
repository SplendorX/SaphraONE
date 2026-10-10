/**
 * What counts toward USDC campaigns.
 *
 * Run: pnpm --filter @saphra/web test:ledger
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyLedgerEntry } from "@/lib/ledger/classify";

const owner = "0x1111111111111111111111111111111111111111";
const agent = "0x2222222222222222222222222222222222222222";
const friend = "0x3333333333333333333333333333333333333333";

const entry = (overrides) =>
  classifyLedgerEntry({
    amount: 25,
    ownWallets: [owner, agent],
    payees: { [friend]: 25 },
    source: "send",
    ...overrides,
  });

describe("ledger eligibility", () => {
  it("counts a payment to someone else", () => {
    assert.deepEqual(entry({}), { eligible: true, reason: null });
  });

  it("never counts swaps, savings or vault moves", () => {
    for (const source of ["swap", "save", "earn", "deposit"]) {
      assert.deepEqual(entry({ source }), { eligible: false, reason: "not-a-payment" });
    }
  });

  it("needs something to have reached a payee", () => {
    assert.equal(entry({ amount: 0 }).reason, "no-payee");
    assert.equal(entry({ payees: {} }).reason, "no-payee");
    assert.equal(entry({ payees: { [friend]: 0 } }).reason, "no-payee");
  });

  it("does not count moving money between your own wallets", () => {
    assert.equal(entry({ payees: { [agent.toUpperCase().replace("0X", "0x")]: 25 } }).reason, "own-wallets");
  });

  it("counts a batch that pays someone else alongside your own wallet", () => {
    assert.equal(entry({ payees: { [agent]: 5, [friend]: 20 } }).eligible, true);
  });
});
