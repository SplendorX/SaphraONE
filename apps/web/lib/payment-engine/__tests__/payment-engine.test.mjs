/**
 * Payment engine unit tests — exercises the real modules (no Supabase, no
 * Circle, no Anthropic).
 *
 * Run: pnpm --filter @saphra/web test:payment-engine
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAgentIntent,
  createBusinessIntent,
  createPersonalIntent,
  formatAmountUnits,
  parseAmountUnits,
  parseDecimalToUnits,
} from "@/lib/payment-engine/intent";
import { evaluatePolicy } from "@/lib/payment-engine/policy";
import { routeIntent } from "@/lib/payment-engine/router";

const usdc = (value) => parseAmountUnits(String(value));

function basePolicy(overrides = {}) {
  return {
    ownerWallet: "0x1111111111111111111111111111111111111111",
    perTxLimitUnits: usdc(10),
    dailyLimitUnits: usdc(100),
    approvedRecipients: [],
    approvedAssets: ["USDC"],
    requiresApprovalAboveUnits: usdc(5),
    status: "active",
    ...overrides,
  };
}

function baseIntent(overrides = {}) {
  return createAgentIntent({
    initiatorId: "0x1111111111111111111111111111111111111111",
    recipient: "0x2222222222222222222222222222222222222222",
    resolvedRecipient: "0x2222222222222222222222222222222222222222",
    amountUnits: usdc(1),
    ...overrides,
  });
}

describe("intent factories", () => {
  it("tags the initiator type and starts pending", () => {
    assert.equal(createPersonalIntent({
      initiatorId: "0x1111111111111111111111111111111111111111",
      recipient: "@alex",
      amountUnits: usdc(1),
    }).initiatorType, "human");

    assert.equal(createBusinessIntent({
      initiatorId: "0x1111111111111111111111111111111111111111",
      recipient: "@alex",
      amountUnits: usdc(1),
    }).initiatorType, "business");

    const agent = createAgentIntent({
      initiatorId: "0x1111111111111111111111111111111111111111",
      recipient: "@alex",
      amountUnits: usdc(1),
    });

    assert.equal(agent.initiatorType, "agent");
    assert.equal(agent.status, "pending");
    assert.equal(agent.asset, "USDC");
    assert.ok(agent.idempotencyKey);
  });

  it("rejects a zero or negative amount", () => {
    assert.throws(() =>
      createAgentIntent({
        initiatorId: "0x1111111111111111111111111111111111111111",
        recipient: "@alex",
        amountUnits: 0n,
      }),
    );
  });

  it("parses amounts without float drift", () => {
    assert.equal(parseAmountUnits("12.345678"), 12_345_678n);
    assert.equal(parseAmountUnits("0.000001"), 1n);
    assert.equal(parseAmountUnits("12.3456789"), null, "over-precise");
    assert.equal(parseAmountUnits("0"), null, "zero");
    assert.equal(parseAmountUnits("-1"), null, "negative");
    assert.equal(parseAmountUnits("abc"), null, "non-numeric");
    assert.equal(formatAmountUnits(12_345_678n), "12.345678");
    assert.equal(formatAmountUnits(1_000_000n), "1");
  });

  it("reads a provider decimal amount into 6-decimal units", () => {
    // Regression: Circle reports `amount` as a human decimal while the token
    // declares 18 decimals for native USDC on Arc. Feeding that 18 into the
    // parser inflated a $10 balance to 10000000000000.
    assert.equal(parseDecimalToUnits("10"), 10_000_000n);
    assert.equal(parseDecimalToUnits("10.5"), 10_500_000n);
    assert.equal(parseDecimalToUnits("0.000001"), 1n);
    assert.equal(
      formatAmountUnits(parseDecimalToUnits("10")),
      "10",
      "round trips back to the same display value",
    );
  });

  it("truncates precision beyond 6 places instead of rejecting it", () => {
    // An 18-decimal token can report more places than USDC can hold.
    assert.equal(parseDecimalToUnits("1.2345678901234"), 1_234_567n);
    assert.equal(parseDecimalToUnits("0.0000009"), 0n);
  });

  it("treats unusable provider amounts as zero, never NaN", () => {
    for (const value of [undefined, null, "", "abc", "-5", {}]) {
      assert.equal(parseDecimalToUnits(value), 0n, String(value));
    }
  });
});

describe("evaluatePolicy", () => {
  it("blocks an amount over the per-transaction limit", () => {
    const result = evaluatePolicy(
      baseIntent({ amountUnits: usdc(20) }),
      basePolicy({ perTxLimitUnits: usdc(10) }),
      0n,
    );

    assert.deepEqual(result, {
      allowed: false,
      reason: "Exceeds per-transaction limit",
    });
  });

  it("blocks a paused or revoked wallet before anything else", () => {
    for (const status of ["paused", "revoked"]) {
      const result = evaluatePolicy(
        baseIntent(),
        basePolicy({ status }),
        0n,
      );

      assert.equal(result.allowed, false);
      assert.equal(result.reason, "Agent wallet is paused or revoked");
    }
  });

  it("blocks an unapproved asset", () => {
    const result = evaluatePolicy(
      baseIntent({ asset: "EURC" }),
      basePolicy({ approvedAssets: ["USDC"] }),
      0n,
    );

    assert.equal(result.reason, "Asset not approved");
  });

  it("blocks once the rolling daily cap is reached", () => {
    const result = evaluatePolicy(
      baseIntent({ amountUnits: usdc(5) }),
      basePolicy({ dailyLimitUnits: usdc(100) }),
      usdc(96),
    );

    assert.equal(result.reason, "Daily limit reached");
  });

  it("enforces the recipient allowlist when one is set", () => {
    const policy = basePolicy({
      approvedRecipients: ["0x3333333333333333333333333333333333333333"],
    });

    assert.equal(
      evaluatePolicy(baseIntent(), policy, 0n).reason,
      "Recipient not on allowlist",
    );

    const allowed = evaluatePolicy(
      baseIntent({
        recipient: "0x3333333333333333333333333333333333333333",
        resolvedRecipient: "0x3333333333333333333333333333333333333333",
      }),
      policy,
      0n,
    );

    assert.equal(allowed.allowed, true);
  });

  it("matches allowlisted usernames case- and @-insensitively", () => {
    const result = evaluatePolicy(
      baseIntent({ recipient: "@Alex", resolvedRecipient: undefined }),
      basePolicy({ approvedRecipients: ["alex"] }),
      0n,
    );

    assert.equal(result.allowed, true);
  });

  it("flags for human approval above the threshold", () => {
    const result = evaluatePolicy(
      baseIntent({ amountUnits: usdc(8) }),
      basePolicy({ requiresApprovalAboveUnits: usdc(5) }),
      0n,
    );

    assert.deepEqual(result, { allowed: true, requiresApproval: true });
  });

  it("allows an in-policy payment", () => {
    const result = evaluatePolicy(baseIntent(), basePolicy(), 0n);
    assert.deepEqual(result, { allowed: true });
  });

  it("fails closed when evaluation throws", () => {
    const hostile = basePolicy();
    Object.defineProperty(hostile, "status", {
      get() {
        throw new Error("boom");
      },
    });

    assert.deepEqual(evaluatePolicy(baseIntent(), hostile, 0n), {
      allowed: false,
      reason: "Policy evaluation error",
    });
  });
});

describe("routeIntent", () => {
  it("routes an agent intent to the agent wallet", () => {
    const decision = routeIntent(baseIntent(), {
      initiatorType: "agent",
      walletMode: "agent",
    });

    assert.equal(decision.rail, "agent-direct");
    assert.equal(decision.executor, "agent-wallet");
  });

  it("routes a batch payout to SwiftBatch", () => {
    const decision = routeIntent(baseIntent(), {
      initiatorType: "business",
      walletMode: "circle",
      isBatch: true,
    });

    assert.equal(decision.rail, "batch");
    assert.equal(decision.executor, "circle-user-wallet");
  });

  it("routes a recurring payment to SwiftRecurepay", () => {
    const decision = routeIntent(baseIntent(), {
      initiatorType: "human",
      walletMode: "external",
      isRecurring: true,
    });

    assert.equal(decision.rail, "recurring");
    assert.equal(decision.executor, "external-wallet");
  });

  it("routes a cross-chain payment to CCTP", () => {
    const intent = baseIntent();
    const decision = routeIntent(intent, {
      initiatorType: "human",
      walletMode: "circle",
      targetChainId: intent.chainId + 1,
    });

    assert.equal(decision.rail, "cctp");
  });

  it("stays on Arc when the target chain matches", () => {
    const intent = baseIntent();
    const decision = routeIntent(intent, {
      initiatorType: "human",
      walletMode: "external",
      targetChainId: intent.chainId,
    });

    assert.equal(decision.rail, "arc-native");
  });

  it("prefers batch over every later rule", () => {
    const intent = baseIntent();
    const decision = routeIntent(intent, {
      initiatorType: "agent",
      walletMode: "agent",
      isBatch: true,
      isRecurring: true,
      targetChainId: intent.chainId + 1,
    });

    assert.equal(decision.rail, "batch");
  });

  it("reports unbuilt Phase F / Phase G rails instead of falling back", () => {
    for (const requestedRail of ["gateway", "x402", "nanopayment"]) {
      const decision = routeIntent(baseIntent(), {
        initiatorType: "agent",
        walletMode: "agent",
        requestedRail,
      });

      assert.equal(decision.rail, "not-yet-available");
      assert.equal(decision.estimatedFeeUnits, 0n);
    }
  });

  it("charges the send router's band fee on live rails", () => {
    const decision = routeIntent(baseIntent({ amountUnits: usdc(100) }), {
      initiatorType: "human",
      walletMode: "external",
    });

    // SaphraSend: over 50, up to 200 → 0.20.
    assert.equal(decision.estimatedFeeUnits, usdc(0.2));
  });
});
