import assert from "node:assert/strict";
import { test } from "node:test";

const saphraRouter = "0x1111111111111111111111111111111111111111";
const legacyRouter = "0x0B65Bc22f4Ad5106abfeb0585E6Ae7Ab7FcaF2d6";

const { maxSendableUnits, sendFeeUnits, usesLegacySendFee } = await import("../fees.ts");

const units = (value) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
};

test("SaphraSend charges the flat fee of each band, edges included", () => {
  const cases = [
    ["0.1", "0.01"], ["10", "0.01"], ["10.000001", "0.05"], ["50", "0.05"],
    ["50.01", "0.2"], ["200", "0.2"], ["200.01", "0.5"], ["500", "0.5"],
    ["500.01", "1"], ["1000", "1"], ["1000.01", "2"], ["5000", "2"],
    ["5000.01", "4"], ["20000", "4"], ["20000.01", "5"], ["1000000", "5"],
  ];
  for (const [amount, fee] of cases) {
    assert.equal(sendFeeUnits(units(amount), saphraRouter), units(fee), `fee for ${amount}`);
  }
  assert.equal(sendFeeUnits(0n, saphraRouter), 0n);
});

test("the old SwiftPaySend router keeps its 0.1%", () => {
  assert.equal(usesLegacySendFee(legacyRouter), true);
  assert.equal(sendFeeUnits(units("10000"), legacyRouter), units("10"));
});

test("Max leaves exactly enough for the band fee and Spend&Save", () => {
  for (const balance of ["0.005", "0.5", "10.01", "10.05", "50.2", "1001", "20004", "250000"]) {
    for (const saveBps of [0n, 500n]) {
      const spendable = units(balance);
      const max = maxSendableUnits(spendable, saveBps, saphraRouter);
      const cost = (amount) => amount + sendFeeUnits(amount, saphraRouter) + (amount * saveBps) / 10_000n;
      assert.ok(max === 0n || cost(max) <= spendable, `fits for ${balance}`);
      // Nothing bigger fits (Spend&Save rounding can leave a unit or two).
      assert.ok(cost(max + (saveBps ? 3n : 1n)) > spendable, `max for ${balance}`);
    }
  }
});
