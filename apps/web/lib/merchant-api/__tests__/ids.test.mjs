/**
 * Checkout API ids and secret keys: shape, mode, randomness.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/merchant-api/__tests__/ids.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  API_KEY_SECRET_LENGTH,
  apiKeyPrefix,
  generateApiKey,
  newEventId,
  newRefundId,
  newSessionId,
  randomPublicSuffix,
  readApiKeyMode,
  readSessionId,
} from "@/lib/merchant-api/ids";

describe("generateApiKey", () => {
  it("carries its mode and 43 base62 characters", () => {
    for (const mode of ["live", "test"]) {
      const key = generateApiKey(mode);
      assert.match(key, new RegExp(`^sk_${mode}_[0-9A-Za-z]{${API_KEY_SECRET_LENGTH}}$`));
      assert.equal(readApiKeyMode(key), mode);
    }
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 500 }, () => generateApiKey("test")));
    assert.equal(keys.size, 500);
  });

  it("uses the whole alphabet", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateApiKey("live").slice(8)).join(""));
    assert.equal(seen.size, 62);
  });

  it("shows only the mode and a few characters as its prefix", () => {
    const key = generateApiKey("live");
    assert.equal(apiKeyPrefix(key), key.slice(0, 12));
    assert.ok(apiKeyPrefix(key).startsWith("sk_live_"));
  });
});

describe("readApiKeyMode", () => {
  it("rejects anything not shaped like a key", () => {
    assert.equal(readApiKeyMode(""), null);
    assert.equal(readApiKeyMode("sk_prod_" + "a".repeat(43)), null);
    assert.equal(readApiKeyMode("sk_live_" + "a".repeat(42)), null);
    assert.equal(readApiKeyMode("sk_live_" + "a".repeat(42) + "-"), null);
    assert.equal(readApiKeyMode("pk_live_" + "a".repeat(43)), null);
  });
});

describe("public ids", () => {
  it("draws 24 lowercase Crockford characters from 15 bytes", () => {
    assert.equal(randomPublicSuffix(new Uint8Array(15)), "0".repeat(24));
    assert.equal(randomPublicSuffix(new Uint8Array(15).fill(255)), "z".repeat(24));
    for (let index = 0; index < 100; index += 1) {
      assert.match(randomPublicSuffix(), /^[0-9a-hjkmnp-tv-z]{24}$/);
    }
  });

  it("prefixes sessions, refunds and events", () => {
    assert.match(newSessionId("live"), /^cs_live_[0-9a-z]{24}$/);
    assert.match(newSessionId("test"), /^cs_test_[0-9a-z]{24}$/);
    assert.match(newRefundId("live"), /^re_live_[0-9a-z]{24}$/);
    assert.match(newEventId(), /^evt_[0-9a-z]{24}$/);
  });

  it("reads a session id case-insensitively and rejects others", () => {
    const id = newSessionId("test");
    assert.equal(readSessionId(id.toUpperCase()), id);
    assert.equal(readSessionId(` ${id} `), id);
    assert.equal(readSessionId("cs_live_short"), null);
    assert.equal(readSessionId("ABCDEFGHJK"), null);
    assert.equal(readSessionId(42), null);
  });
});
