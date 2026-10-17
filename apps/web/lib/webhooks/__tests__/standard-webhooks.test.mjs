/**
 * Standard Webhooks signing and verification.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/webhooks/__tests__/standard-webhooks.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateWebhookSecret,
  signPayload,
  verifyPayload,
  verifySvixSignature,
} from "@/lib/webhooks/standard-webhooks";

// The test vector published with the Standard Webhooks libraries.
const vector = {
  body: '{"test": 2432232314}',
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  timestamp: 1614265330,
};

function headers({ id = vector.id, timestamp = vector.timestamp, signature }) {
  return {
    "webhook-id": id,
    "webhook-signature": signature,
    "webhook-timestamp": String(timestamp),
  };
}

describe("signPayload", () => {
  it("matches the Standard Webhooks test vector", () => {
    assert.equal(signPayload(vector), vector.signature);
  });

  it("rejects a secret that isn't base64", () => {
    assert.throws(() => signPayload({ ...vector, secret: "whsec_" }));
  });
});

describe("verifyPayload", () => {
  it("accepts the test vector", () => {
    const result = verifyPayload({
      headers: headers({ signature: vector.signature }),
      now: vector.timestamp + 10,
      rawBody: vector.body,
      secret: vector.secret,
    });
    assert.deepEqual(result, { eventId: vector.id, ok: true });
  });

  it("round-trips what we sign, with a fresh secret", () => {
    const secret = generateWebhookSecret();
    assert.match(secret, /^whsec_[A-Za-z0-9+/]+=*$/);
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
    const timestamp = 1_792_000_000;
    const signature = signPayload({ body, id: "evt_1", secret, timestamp });
    const result = verifyPayload({
      headers: headers({ id: "evt_1", signature, timestamp }),
      now: timestamp,
      rawBody: body,
      secret,
    });
    assert.equal(result.ok, true);
  });

  it("rejects a tampered body", () => {
    const result = verifyPayload({
      headers: headers({ signature: vector.signature }),
      now: vector.timestamp,
      rawBody: '{"test": 2432232315}',
      secret: vector.secret,
    });
    assert.equal(result.ok, false);
  });

  it("rejects a timestamp outside five minutes, both ways", () => {
    for (const offset of [301, -301]) {
      const result = verifyPayload({
        headers: headers({ signature: vector.signature }),
        now: vector.timestamp + offset,
        rawBody: vector.body,
        secret: vector.secret,
      });
      assert.deepEqual(result, { ok: false, reason: "Timestamp outside tolerance." });
    }
  });

  it("stops verifying with the old secret after a rotation", () => {
    const oldSecret = generateWebhookSecret();
    const newSecret = generateWebhookSecret();
    const timestamp = 1_792_000_000;
    const signature = signPayload({ body: "{}", id: "evt_2", secret: newSecret, timestamp });
    const check = (secret) =>
      verifyPayload({ headers: headers({ id: "evt_2", signature, timestamp }), now: timestamp, rawBody: "{}", secret });
    assert.equal(check(newSecret).ok, true);
    assert.equal(check(oldSecret).ok, false);
  });

  it("accepts any one of several space-separated signatures", () => {
    const signature = `v1,bm9wZQ== v2,ignored ${vector.signature}`;
    const result = verifyPayload({
      headers: headers({ signature }),
      now: vector.timestamp,
      rawBody: vector.body,
      secret: vector.secret,
    });
    assert.equal(result.ok, true);
  });

  it("needs all three headers", () => {
    const result = verifyPayload({
      headers: { "webhook-id": vector.id, "webhook-timestamp": String(vector.timestamp) },
      now: vector.timestamp,
      rawBody: vector.body,
      secret: vector.secret,
    });
    assert.deepEqual(result, { ok: false, reason: "Missing signature headers." });
  });
});

describe("verifySvixSignature", () => {
  it("is the same scheme under svix-* headers", () => {
    const result = verifySvixSignature({
      headers: {
        "svix-id": vector.id,
        "svix-signature": vector.signature,
        "svix-timestamp": String(vector.timestamp),
      },
      now: vector.timestamp,
      rawBody: vector.body,
      secret: vector.secret,
    });
    assert.equal(result.ok, true);
  });

  it("doesn't read webhook-* headers", () => {
    const result = verifySvixSignature({
      headers: headers({ signature: vector.signature }),
      now: vector.timestamp,
      rawBody: vector.body,
      secret: vector.secret,
    });
    assert.equal(result.ok, false);
  });
});
