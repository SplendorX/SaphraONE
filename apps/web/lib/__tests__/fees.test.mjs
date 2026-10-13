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

const { bulkFeeLabel, bulkFeeUnits, payrollFeeUnits, recurringFeeUnits } = await import("../fees.ts");
const saphraBulk = "0x2222222222222222222222222222222222222222";
const saphraRecure = "0x3333333333333333333333333333333333333333";

test("SaphraBulkPay: band on the total, at least 0.01 per person", () => {
  const cases = [
    // [people, total, fee]
    [5, "50", "0.1"], [30, "30", "0.3"], [40, "200", "0.5"], [100, "200", "1"],
    [300, "300", "3"], [20, "2000", "5"], [3, "50.01", "0.5"], [2, "100000.01", "25"],
    [500, "50000", "20"],
  ];
  for (const [people, total, fee] of cases) {
    assert.equal(bulkFeeUnits(units(total), people, saphraBulk), units(fee), `${people} people, ${total}`);
    assert.equal(payrollFeeUnits(units(total), people, saphraBulk), units(fee), `payroll ${people}, ${total}`);
  }
  assert.equal(bulkFeeLabel(units("30"), 30, false), "Service fee (0.01 per person minimum)");
  assert.equal(bulkFeeLabel(units("2000"), 20, false), "Service fee");
});

test("the old BatchPay and payroll contracts keep their 1%", () => {
  assert.equal(bulkFeeUnits(units("1000"), 10, "0x4fe71EA6edAa8ac55c134d3de29A6b682Cc398E5"), units("10"));
  assert.equal(payrollFeeUnits(units("1000"), 10, "0xC189c6b4fB836381de9702B9dE957020e630Fc26"), units("10"));
});

test("SaphraRecurePay: flat fee per payment, edges included", () => {
  const cases = [
    ["0.5", "0.02"], ["10", "0.02"], ["10.01", "0.1"], ["50", "0.1"], ["50.01", "0.3"],
    ["200", "0.3"], ["200.01", "0.75"], ["500", "0.75"], ["500.01", "1.5"], ["1000", "1.5"],
    ["1000.01", "3"], ["5000", "3"], ["5000.01", "6"], ["20000", "6"], ["20000.01", "8"],
  ];
  for (const [amount, fee] of cases) {
    assert.equal(recurringFeeUnits(units(amount), saphraRecure), units(fee), `fee for ${amount}`);
  }
  // The old executor (mainnet) still charges 1%.
  assert.equal(recurringFeeUnits(units("500"), "0x23C1565446F57Bb2c12287fE5d8D667a88fe7928"), units("5"));
});
