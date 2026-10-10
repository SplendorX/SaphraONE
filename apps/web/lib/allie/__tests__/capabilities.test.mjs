/**
 * Tier 1 coverage for the product capabilities, and the precedence between
 * them — a broad status phrase must never swallow a money movement.
 *
 * Run: pnpm --filter @saphra/web test:allie
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyMessage } from "@/lib/allie/classifier";
import { parseAllieAction } from "@/lib/allie/actions";

const type = (message) => classifyMessage(message)?.action.type ?? null;

describe("Tier 1 — batch payments", () => {
  it("reads several recipients from one instruction", () => {
    const result = classifyMessage("send $5 to @alex and $10 to @sam");

    assert.equal(result?.action.type, "BatchPay");
    assert.deepEqual(result.action.legs, [
      { amountUsdc: 5, recipient: "@alex" },
      { amountUsdc: 10, recipient: "@sam" },
    ]);
  });

  it("handles comma-separated legs and three recipients", () => {
    const result = classifyMessage(
      "pay 5 to @alex, 6 to @sam, 7 to @jo",
    );

    assert.equal(result?.action.type, "BatchPay");
    assert.equal(result.action.legs.length, 3);
  });

  it("stays a single payment when there is only one recipient", () => {
    assert.equal(type("send $5 to @alex"), "PaymentIntent");
  });

  it("escalates rather than half-reading a batch", () => {
    // Second clause has no amount — a partial batch is worse than asking.
    assert.equal(type("send $5 to @alex and something to @sam"), null);
  });
});

describe("Tier 1 — recurring", () => {
  it("beats the single-send pattern", () => {
    const result = classifyMessage("send $50 to @landlord every month");

    assert.equal(result?.action.type, "Recurring");
    assert.equal(result.action.frequency, "monthly");
    assert.equal(result.action.recipient, "@landlord");
    assert.equal(result.action.amountUsdc, 50);
  });

  it("maps natural frequency words", () => {
    assert.equal(
      classifyMessage("pay $10 to @sam every week")?.action.frequency,
      "weekly",
    );
    assert.equal(
      classifyMessage("send 20 to @sam every fortnight")?.action.frequency,
      "biweekly",
    );
  });

  it("reads a status question", () => {
    assert.equal(type("my recurring payments"), "RecurringStatus");
  });
});

describe("Tier 1 — swap", () => {
  it("reads both sides", () => {
    const result = classifyMessage("swap 25 usdc for eurc");

    assert.equal(result?.action.type, "Swap");
    assert.equal(result.action.fromAsset, "USDC");
    assert.equal(result.action.toAsset, "EURC");
    assert.equal(result.action.amountUsdc, 25);
  });

  it("escalates a same-asset swap", () => {
    assert.equal(type("swap 25 usdc for usdc"), null);
  });
});

describe("Tier 1 — save and earn", () => {
  it("separates movement from status", () => {
    assert.equal(type("my savings balance"), "SaveStatus");
    assert.equal(type("deposit $40 into my savings"), "Save");
    assert.equal(type("withdraw 10 from savings"), "Save");
    assert.equal(type("my earn balance"), "EarnStatus");
    assert.equal(type("deposit 100 into the vault"), "Earn");
  });

  it("carries the amount and direction", () => {
    const deposit = classifyMessage("deposit $40 into my savings");
    assert.equal(deposit?.action.action, "deposit");
    assert.equal(deposit.action.amountUsdc, 40);

    const withdraw = classifyMessage("withdraw 10 from savings");
    assert.equal(withdraw?.action.action, "withdraw");
  });

  it("does not let 'save' swallow an ordinary send", () => {
    assert.equal(type("send $5 to @save"), "PaymentIntent");
  });
});

describe("Tier 1 — requests and payroll", () => {
  it("reads a request for money", () => {
    const result = classifyMessage("request $30");
    assert.equal(result?.action.type, "RequestPayment");
    assert.equal(result.action.amountUsdc, 30);
  });

  it("reads a request however it is worded", () => {
    // Every one of these is the same instruction.
    for (const message of [
      "send a 5usdc request to splendor",
      "request 5 usdc from splendor",
      "bill splendor $5",
      "ask splendor for $5",
    ]) {
      const result = classifyMessage(message);
      assert.equal(result?.action.type, "RequestPayment", message);
      assert.equal(result.action.amountUsdc, 5, message);
      assert.equal(result.action.from, "@splendor", message);
    }
  });

  it("keeps a request ahead of a send", () => {
    // "send a ... request to X" is a request, not a payment to X.
    assert.equal(
      classifyMessage("send a 5usdc request to splendor")?.action.type,
      "RequestPayment",
    );
  });

  it("keeps paying and requesting apart", () => {
    assert.equal(type("request $30"), "RequestPayment");
    assert.equal(type("pay @alex $30"), "PaymentIntent");
  });

  it("routes payroll", () => {
    assert.equal(type("start a payroll run"), "Payroll");
    assert.equal(type("payroll team"), "Payroll");
    assert.equal(type("my payroll"), "PayrollStatus");
  });
});

describe("Tier 1 — splitting", () => {
  it("divides an amount equally", () => {
    const result = classifyMessage("split $30 between @alex and @sam");

    assert.equal(result?.action.type, "BatchPay");
    assert.deepEqual(result.action.legs, [
      { amountUsdc: 15, recipient: "@alex" },
      { amountUsdc: 15, recipient: "@sam" },
    ]);
  });

  it("never treats a connective as a payee", () => {
    const result = classifyMessage("split $10 between alex, sam and jo");

    assert.equal(result.action.legs.length, 3);
    assert.deepEqual(
      result.action.legs.map((leg) => leg.recipient),
      ["alex", "sam", "jo"],
    );
  });

  it("gives the remainder to the first leg so the legs sum exactly", () => {
    const result = classifyMessage("split $10 between alex, sam and jo");
    const total = result.action.legs.reduce((sum, leg) => sum + leg.amountUsdc, 0);

    assert.equal(Math.round(total * 100), 1000);
    assert.equal(result.action.legs[0].amountUsdc, 3.34);
  });
});

describe("Tier 1 — status questions beat the generic balance", () => {
  it("routes savings and vault questions to their own products", () => {
    assert.equal(classifyMessage("my savings balance")?.action.type, "SaveStatus");
    assert.equal(classifyMessage("show my savings")?.action.type, "SaveStatus");
    assert.equal(
      classifyMessage("how much do I have in savings")?.action.type,
      "SaveStatus",
      "more specific than the plain balance question",
    );
    assert.equal(classifyMessage("what's in my vault")?.action.type, "EarnStatus");
  });

  it("still answers the plain balance question", () => {
    assert.equal(classifyMessage("how much do I have")?.action.type, "QueryBalance");
  });
});

describe("parseAllieAction — new shapes", () => {
  it("accepts a well-formed batch", () => {
    const action = parseAllieAction(
      '{"type":"BatchPay","legs":[{"recipient":"@a","amountUsdc":1},{"recipient":"@b","amountUsdc":2}],"asset":"USDC"}',
    );

    assert.equal(action?.type, "BatchPay");
    assert.equal(action.legs.length, 2);
  });

  it("rejects a batch with a bad leg", () => {
    assert.equal(
      parseAllieAction(
        '{"type":"BatchPay","legs":[{"recipient":"@a","amountUsdc":0}],"asset":"USDC"}',
      ),
      null,
    );
    assert.equal(parseAllieAction('{"type":"BatchPay","legs":[]}'), null);
  });

  it("rejects an unknown frequency and a same-asset swap", () => {
    assert.equal(
      parseAllieAction(
        '{"type":"Recurring","recipient":"@a","amountUsdc":5,"asset":"USDC","frequency":"hourly"}',
      ),
      null,
    );
    assert.equal(
      parseAllieAction(
        '{"type":"Swap","fromAsset":"USDC","toAsset":"USDC","amountUsdc":5}',
      ),
      null,
    );
  });

  it("rejects an unknown sub-action", () => {
    assert.equal(
      parseAllieAction('{"type":"Save","action":"burn","amountUsdc":5}'),
      null,
    );
    assert.equal(parseAllieAction('{"type":"Payroll","action":"delete"}'), null);
  });

  it("caps a runaway batch instead of accepting it whole", () => {
    const legs = Array.from({ length: 50 }, (_, i) => ({
      recipient: `@u${i}`,
      amountUsdc: 1,
    }));

    const action = parseAllieAction(
      JSON.stringify({ type: "BatchPay", legs, asset: "USDC" }),
    );

    assert.equal(action?.type, "BatchPay");
    assert.equal(action.legs.length, 20);
  });
});

describe("Tier 1 — swap quotes", () => {
  it("reads a quote request without starting a swap", () => {
    const result = classifyMessage("quote 100 usdc to eurc");

    assert.equal(result?.action.type, "SwapQuote");
    assert.equal(result.action.amountUsdc, 100);
    assert.equal(result.action.fromAsset, "USDC");
    assert.equal(result.action.toAsset, "EURC");
  });

  it("reads 'how much X for N Y' the right way round", () => {
    const result = classifyMessage("how much eurc for 50 usdc");

    assert.equal(result?.action.type, "SwapQuote");
    assert.equal(result.action.fromAsset, "USDC");
    assert.equal(result.action.toAsset, "EURC");
    assert.equal(result.action.amountUsdc, 50);
  });

  it("treats a price question as a 1-unit quote", () => {
    const result = classifyMessage("what's the eurc price");

    assert.equal(result?.action.type, "SwapQuote");
    assert.equal(result.action.fromAsset, "EURC");
    assert.equal(result.action.amountUsdc, 1);
  });

  it("still swaps when asked to swap", () => {
    assert.equal(type("swap 25 usdc for eurc"), "Swap");
  });
});

describe("Tier 1 — activity summary", () => {
  const period = (message) => classifyMessage(message)?.action.period;

  it("reads the window", () => {
    assert.equal(type("how much did I spend this week"), "ActivitySummary");
    assert.equal(period("how much did I spend this week"), "7d");
    assert.equal(period("my portfolio today"), "24h");
    assert.equal(period("activity summary for 30 days"), "30d");
    assert.equal(period("total volume all time"), "all");
  });

  it("defaults to 30 days", () => {
    assert.equal(period("show my spending breakdown"), "30d");
  });

  it("leaves balance questions alone", () => {
    assert.equal(type("what's my balance"), "QueryBalance");
  });

  it("parses model output and defaults a bad period", () => {
    assert.deepEqual(parseAllieAction('{"type":"ActivitySummary","period":"7d"}'), {
      type: "ActivitySummary",
      period: "7d",
    });
    assert.equal(parseAllieAction('{"type":"ActivitySummary","period":"1y"}')?.period, "30d");
  });
});
