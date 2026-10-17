/**
 * An off-ramp deposit is credited from the chain: the full amount to the
 * deposit wallet, from the order's wallet, counting Arc's double ERC-20 +
 * native event once.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/ramp/__tests__/verify.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";

import { NATIVE_USDC_EVENT_ADDRESS } from "@/lib/arc-transfers";
import { checkOfframpDeposit } from "@/lib/ramp/verify";
import { arcTokens } from "@/lib/tokens";

const abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const usdc = arcTokens.USDC.address;
const deposit = "0x1111111111111111111111111111111111111111";
const user = "0x2222222222222222222222222222222222222222";
const stranger = "0x3333333333333333333333333333333333333333";

function transfer(token, from, to, units) {
  return {
    address: token,
    topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [units]),
  };
}

const both = (from, to, usdcAmount) => [
  transfer(usdc, from, to, BigInt(Math.round(usdcAmount * 1e6))),
  transfer(NATIVE_USDC_EVENT_ADDRESS, from, to, BigInt(Math.round(usdcAmount * 1e6)) * 10n ** 12n),
];

describe("checkOfframpDeposit", () => {
  it("credits an ERC-20 send with its native twin once", () => {
    const result = checkOfframpDeposit({
      logs: both(user, deposit, 100.5),
      depositAddress: deposit,
      totalToPay: "100.5",
      wallet: user,
    });
    assert.deepEqual(result, { status: "ok", amount: 100.5, from: user });
  });

  it("credits a plain native send", () => {
    const logs = [transfer(NATIVE_USDC_EVENT_ADDRESS, user, deposit, 2n * 10n ** 18n)];
    assert.equal(checkOfframpDeposit({ logs, depositAddress: deposit, totalToPay: "2", wallet: user }).status, "ok");
  });

  it("rejects a transfer to another address", () => {
    const result = checkOfframpDeposit({
      logs: both(user, stranger, 100),
      depositAddress: deposit,
      totalToPay: "100",
      wallet: user,
    });
    assert.equal(result.status, "invalid");
  });

  it("rejects an underpayment", () => {
    const result = checkOfframpDeposit({
      logs: both(user, deposit, 99.99),
      depositAddress: deposit,
      totalToPay: "100",
      wallet: user,
    });
    assert.equal(result.status, "invalid");
    assert.match(result.reason, /needs 100/);
  });

  it("rejects a transfer from a different wallet", () => {
    const result = checkOfframpDeposit({
      logs: both(stranger, deposit, 100),
      depositAddress: deposit,
      totalToPay: "100",
      wallet: user,
    });
    assert.equal(result.status, "invalid");
    assert.match(result.reason, /different wallet/);
  });

  it("matches the wallet regardless of address case", () => {
    const result = checkOfframpDeposit({
      logs: both(user, deposit, 1),
      depositAddress: deposit.toUpperCase().replace("0X", "0x"),
      totalToPay: "1",
      wallet: user,
    });
    assert.equal(result.status, "ok");
  });
});
