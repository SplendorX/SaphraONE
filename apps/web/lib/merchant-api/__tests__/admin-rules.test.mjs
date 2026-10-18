/**
 * The admin view of the Checkout API: grouping, totals, failing endpoints and
 * the revoke reason.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/merchant-api/__tests__/admin-rules.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRevokeReason, summarizeMerchantApi } from "@/lib/merchant-api/admin-rules";

const shop = "0xaaaa000000000000000000000000000000000001";
const cafe = "0xbbbb000000000000000000000000000000000002";

function key(id, wallet, overrides = {}) {
  return {
    created_at: "2026-10-10T10:00:00Z",
    id,
    key_prefix: "sk_test_abcd",
    last_used_at: null,
    mode: "test",
    name: `Key ${id}`,
    revoked_at: null,
    wallet_address: wallet,
    ...overrides,
  };
}

const input = {
  businesses: [
    { business_name: "Shop", username: "shop", verification_status: "VERIFIED", wallet_address: shop },
    { business_name: "Cafe", username: null, verification_status: "PENDING", wallet_address: cafe },
  ],
  charges: [
    { amount_received: "25", currency: "USDC", status: "PAID", wallet_address: shop },
    { amount_received: "3.5", currency: "USDC", status: "OPEN", wallet_address: shop },
    { amount_received: "10", currency: "EURC", status: "PAID", wallet_address: shop.toUpperCase() },
    { amount_received: "0", currency: "USDC", status: "EXPIRED", wallet_address: cafe },
    // A business without keys is not counted.
    { amount_received: "99", currency: "USDC", status: "PAID", wallet_address: "0xcccc" },
  ],
  deliveries: [
    { attempts: 9, endpoint_id: "ep-cafe", status: "FAILED", wallet_address: cafe },
    { attempts: 2, endpoint_id: "ep-cafe", status: "PENDING", wallet_address: cafe },
    { attempts: 0, endpoint_id: "ep-shop", status: "PENDING", wallet_address: shop },
  ],
  endpoints: [
    { disabled_at: null, failing_since: null, id: "ep-shop", url: "https://shop.example/hooks", wallet_address: shop },
    { disabled_at: null, failing_since: "2026-10-16T00:00:00Z", id: "ep-cafe", url: "https://cafe.example/h", wallet_address: cafe },
  ],
  keys: [
    key("k1", shop, { last_used_at: "2026-10-17T09:00:00Z" }),
    key("k2", shop, { last_used_at: "2026-10-17T12:00:00Z", revoked_at: "2026-10-17T13:00:00Z" }),
    key("k3", cafe),
  ],
};

describe("summarizeMerchantApi", () => {
  const overview = summarizeMerchantApi(input);
  const byWallet = Object.fromEntries(overview.merchants.map((merchant) => [merchant.wallet, merchant]));

  it("groups keys per business with the latest use", () => {
    assert.equal(byWallet[shop].keys.length, 2);
    assert.equal(byWallet[shop].activeKeys, 1);
    assert.equal(byWallet[shop].lastUsedAt, "2026-10-17T12:00:00Z");
    assert.equal(byWallet[shop].verified, true);
    assert.equal(byWallet[cafe].verified, false);
    assert.equal("wallet_address" in byWallet[shop].keys[0], false);
  });

  it("counts sessions and volume by currency, only for businesses with keys", () => {
    assert.equal(byWallet[shop].sessions, 3);
    assert.equal(byWallet[shop].paidSessions, 2);
    assert.deepEqual(byWallet[shop].volume, { EURC: "10", USDC: "28.5" });
    assert.deepEqual(overview.totals.volume, { EURC: "10", USDC: "28.5" });
    assert.equal(overview.totals.sessions, 4);
  });

  it("flags failing endpoints and puts those businesses first", () => {
    const [first] = overview.merchants;
    assert.equal(first.wallet, cafe);
    assert.equal(first.failingEndpoints, 1);
    assert.deepEqual(
      { failed: first.endpoints[0].failed, retrying: first.endpoints[0].retrying },
      { failed: 1, retrying: 1 },
    );
    assert.equal(byWallet[shop].failingEndpoints, 0);
    assert.equal(byWallet[shop].endpoints[0].retrying, 0);
    assert.equal(overview.totals.failingEndpoints, 1);
  });

  it("doesn't count a turned-off endpoint as failing", () => {
    const off = summarizeMerchantApi({
      ...input,
      endpoints: input.endpoints.map((endpoint) => ({ ...endpoint, disabled_at: "2026-10-17T00:00:00Z" })),
    });
    assert.equal(off.totals.failingEndpoints, 0);
  });

  it("counts only businesses with an active key", () => {
    const revoked = summarizeMerchantApi({
      ...input,
      keys: input.keys.map((item) => ({ ...item, revoked_at: "2026-10-17T13:00:00Z" })),
    });
    assert.equal(revoked.merchants.length, 2);
    assert.equal(revoked.totals.merchants, 0);
    assert.equal(revoked.totals.activeKeys, 0);
  });
});

describe("readRevokeReason", () => {
  it("requires a reason and tidies it", () => {
    assert.throws(() => readRevokeReason(""), /reason/i);
    assert.throws(() => readRevokeReason("  a "), /reason/i);
    assert.equal(readRevokeReason("  Key   posted on GitHub "), "Key posted on GitHub");
    assert.equal(readRevokeReason("x".repeat(300)).length, 200);
  });
});
