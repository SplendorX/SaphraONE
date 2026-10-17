/**
 * Ramp rules: amount parsing, the status machine, the deposit-wallet safety
 * check, Centiiv's delivery transaction and display helpers.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/ramp/__tests__/rules.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decimalText,
  displayMessage,
  expiresSoon,
  isTerminal,
  maskAccount,
  nextStatus,
  parseNgnAmount,
  parseUsdcAmount,
  pickDeliveryTx,
  readNuban,
  readStatus,
  toUsdcString,
  usdcUnits,
  validateDepositWallet,
} from "@/lib/ramp/rules";

const address = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const hash = `0x${"ab".repeat(32)}`;

describe("amount parsing", () => {
  it("accepts whole and 2-decimal amounts within limits", () => {
    assert.deepEqual(parseNgnAmount("150000"), { ok: true, value: "150000" });
    assert.deepEqual(parseNgnAmount(5000.5), { ok: true, value: "5000.5" });
    assert.deepEqual(parseUsdcAmount("12.34"), { ok: true, value: "12.34" });
  });

  it("accepts thousands commas", () => {
    assert.deepEqual(parseNgnAmount("150,000"), { ok: true, value: "150000" });
  });

  it("rejects zero, negatives, junk and 3 decimals", () => {
    for (const value of ["0", "-5", "abc", "", null, "1.234", "1e5", Number.NaN]) {
      assert.equal(parseUsdcAmount(value).ok, false, String(value));
    }
  });

  it("enforces the per-direction min and max", () => {
    const low = parseNgnAmount("999");
    assert.equal(low.ok, false);
    assert.match(low.message, /minimum is ₦1,000/);
    assert.equal(parseNgnAmount("15000001").ok, false);
    assert.equal(parseUsdcAmount("0.5").ok, false);
    assert.match(parseUsdcAmount("10000.01").message, /maximum is 10,000 USDC/);
  });
});

describe("decimal strings", () => {
  it("prints numbers without float drift", () => {
    assert.equal(toUsdcString(0.1 + 0.2), "0.3");
    assert.equal(toUsdcString(100), "100");
    assert.equal(toUsdcString("100.970000"), "100.97");
    assert.equal(decimalText("abc"), null);
    assert.equal(decimalText(-1), null);
  });

  it("converts exact USDC amounts to units and never rounds", () => {
    assert.equal(usdcUnits("100"), 100_000_000n);
    assert.equal(usdcUnits("0.000001"), 1n);
    assert.equal(usdcUnits("12.5"), 12_500_000n);
    assert.equal(usdcUnits("1.0000001"), null);
    assert.equal(usdcUnits("0"), null);
    assert.equal(usdcUnits(null), null);
  });
});

describe("status machine", () => {
  it("reads Centiiv statuses in any case", () => {
    assert.equal(readStatus("fulfilled"), "FULFILLED");
    assert.equal(readStatus("SOMETHING"), null);
  });

  it("knows the terminal statuses", () => {
    for (const status of ["FULFILLED", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"]) {
      assert.equal(isTerminal(status), true);
    }
    assert.equal(isTerminal("PENDING"), false);
    assert.equal(isTerminal("PROCESSING"), false);
  });

  it("keeps a terminal status terminal", () => {
    assert.equal(nextStatus("FULFILLED", "PROCESSING"), "FULFILLED");
    assert.equal(nextStatus("EXPIRED", "FULFILLED"), "EXPIRED");
  });

  it("moves forward only", () => {
    assert.equal(nextStatus("PENDING", "PROCESSING"), "PROCESSING");
    assert.equal(nextStatus("PROCESSING", "PENDING"), "PROCESSING");
    assert.equal(nextStatus("PENDING", "FULFILLED"), "FULFILLED");
    assert.equal(nextStatus("PROCESSING", "REFUNDED"), "REFUNDED");
    assert.equal(nextStatus("PENDING", null), "PENDING");
  });
});

describe("validateDepositWallet", () => {
  const good = { publicAddress: address, network: "ARC", isTestnet: true, expiresAt: "2026-10-15T12:00:00Z" };

  it("accepts an Arc testnet wallet on a testnet build", () => {
    assert.deepEqual(validateDepositWallet(good, { mainnet: false }), {
      ok: true,
      address: address.toLowerCase(),
      expiresAt: "2026-10-15T12:00:00Z",
    });
  });

  it("accepts a wallet without the testnet flag", () => {
    const { isTestnet, ...rest } = good;
    assert.equal(validateDepositWallet(rest, { mainnet: true }).ok, true);
  });

  it("rejects a bad or zero address", () => {
    assert.equal(validateDepositWallet({ ...good, publicAddress: "0x123" }, { mainnet: false }).ok, false);
    assert.equal(validateDepositWallet({ ...good, publicAddress: `0x${"0".repeat(40)}` }, { mainnet: false }).ok, false);
    assert.equal(validateDepositWallet(null, { mainnet: false }).ok, false);
  });

  it("rejects a wallet on another network", () => {
    assert.equal(validateDepositWallet({ ...good, network: "BASE" }, { mainnet: false }).ok, false);
  });

  it("rejects a testnet/mainnet mismatch both ways", () => {
    assert.equal(validateDepositWallet(good, { mainnet: true }).ok, false);
    assert.equal(validateDepositWallet({ ...good, isTestnet: false }, { mainnet: false }).ok, false);
    assert.equal(validateDepositWallet({ ...good, isTestnet: false }, { mainnet: true }).ok, true);
  });
});

describe("pickDeliveryTx", () => {
  it("returns the confirmed outgoing Arc transfer", () => {
    const request = {
      blockchainTxs: [
        { txHash: `0x${"11".repeat(32)}`, direction: "OUTGOING", status: "PENDING", network: "ARC", amount: "1" },
        { txHash: `0x${"22".repeat(32)}`, direction: "INCOMING", status: "CONFIRMED", network: "ARC", amount: "1" },
        { txHash: `0x${"33".repeat(32)}`, direction: "OUTGOING", status: "CONFIRMED", network: "BASE", amount: "1" },
        { txHash: hash.toUpperCase().replace("0X", "0x"), direction: "OUTGOING", status: "CONFIRMED", network: "ARC", amount: 100.97 },
      ],
    };
    assert.deepEqual(pickDeliveryTx(request), { hash, amount: "100.97" });
  });

  it("returns null when nothing is delivered yet", () => {
    assert.equal(pickDeliveryTx({ blockchainTxs: [] }), null);
    assert.equal(pickDeliveryTx({}), null);
  });
});

describe("display helpers", () => {
  it("masks an account number", () => {
    assert.equal(maskAccount("0123456789"), "•••• 6789");
  });

  it("reads a 10-digit NUBAN", () => {
    assert.equal(readNuban("0123456789"), "0123456789");
    assert.equal(readNuban("01234 56789"), "0123456789");
    assert.equal(readNuban("012345678"), null);
    assert.equal(readNuban(123), null);
  });

  it("knows when a deposit window is about to close", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    assert.equal(expiresSoon("2026-10-15T12:02:00Z", now, 3 * 60_000), true);
    assert.equal(expiresSoon("2026-10-15T12:10:00Z", now, 3 * 60_000), false);
    assert.equal(expiresSoon("2026-10-15T11:00:00Z", now, 0), true);
    assert.equal(expiresSoon("not a date", now, 0), true);
    assert.equal(expiresSoon(null, now, 3 * 60_000), false);
  });

  it("trims provider messages", () => {
    assert.equal(displayMessage("Amount is below the minimum", "x"), "Amount is below the minimum");
    assert.equal(displayMessage("", "fallback"), "fallback");
    assert.equal(displayMessage("a".repeat(300), "x").length, 200);
  });
});
