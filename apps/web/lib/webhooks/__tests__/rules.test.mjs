/**
 * Webhook delivery rules: the retry schedule and event names.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/webhooks/__tests__/rules.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeFailure,
  isDeliverySuccess,
  MAX_DELIVERY_ATTEMPTS,
  nextRetryDelayMs,
  readEventTypes,
  RETRY_DELAYS_MS,
  WEBHOOK_EVENT_TYPES,
} from "@/lib/webhooks/rules";

const minute = 60_000;
const hour = 60 * minute;

describe("retry schedule", () => {
  it("waits 1m, 5m, 30m, 2h, 6h, 12h, 24h, 48h", () => {
    const waits = [];
    for (let failed = 1; failed < MAX_DELIVERY_ATTEMPTS; failed += 1) waits.push(nextRetryDelayMs(failed));
    assert.deepEqual(waits, [minute, 5 * minute, 30 * minute, 2 * hour, 6 * hour, 12 * hour, 24 * hour, 48 * hour]);
  });

  it("gives up after the ninth attempt, about four days in", () => {
    assert.equal(MAX_DELIVERY_ATTEMPTS, 9);
    assert.equal(nextRetryDelayMs(9), null);
    assert.equal(nextRetryDelayMs(12), null);
    const total = RETRY_DELAYS_MS.reduce((sum, wait) => sum + wait, 0);
    assert.equal(total, 92 * hour + 36 * minute);
  });

  it("treats a bad count as the first failure", () => {
    assert.equal(nextRetryDelayMs(0), minute);
    assert.equal(nextRetryDelayMs(1.5), minute);
  });
});

describe("isDeliverySuccess", () => {
  it("is any 2xx, and nothing else", () => {
    for (const code of [200, 201, 204, 299]) assert.equal(isDeliverySuccess(code), true, String(code));
    for (const code of [null, 199, 301, 302, 400, 410, 500]) assert.equal(isDeliverySuccess(code), false, String(code));
  });
});

describe("readEventTypes", () => {
  it("keeps known events in a stable order without repeats", () => {
    assert.deepEqual(
      readEventTypes(["checkout.session.expired", "checkout.session.completed", "checkout.session.expired"]),
      ["checkout.session.completed", "checkout.session.expired"],
    );
    assert.deepEqual(readEventTypes([...WEBHOOK_EVENT_TYPES].reverse()), [...WEBHOOK_EVENT_TYPES]);
  });

  it("rejects an empty list, unknown events and ping", () => {
    assert.throws(() => readEventTypes([]));
    assert.throws(() => readEventTypes("checkout.session.completed"));
    assert.throws(() => readEventTypes(["checkout.session.paid"]));
    assert.throws(() => readEventTypes(["ping"]));
  });
});

describe("describeFailure", () => {
  it("keeps the status and a one-line snippet of the body", () => {
    assert.equal(describeFailure({ body: "Internal\n  error", statusCode: 500 }), "HTTP 500: Internal error");
    assert.equal(describeFailure({ statusCode: 404 }), "HTTP 404");
    assert.equal(describeFailure({ error: "connect ECONNREFUSED", statusCode: null }), "connect ECONNREFUSED");
    assert.equal(describeFailure({ body: "x".repeat(500), statusCode: 502 }).length, "HTTP 502: ".length + 200);
  });
});
