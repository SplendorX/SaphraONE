/**
 * Svix signature checks for Centiiv webhooks.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/ramp/__tests__/webhook-signature.test.mjs
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

import { verifySvixSignature } from "@/lib/ramp/webhook-signature";

const secret = `whsec_${Buffer.from("swiftpay-test-secret-key-32bytes").toString("base64")}`;
const now = 1_792_000_000;
const body = JSON.stringify({ type: "request.fulfilled", data: { id: "req_1" } });

function sign(content, key = secret) {
  const raw = Buffer.from(key.replace(/^whsec_/, ""), "base64");
  return crypto.createHmac("sha256", raw).update(content).digest("base64");
}

function headers({ id = "msg_1", timestamp = String(now), signature } = {}) {
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signature ?? `v1,${sign(`${id}.${timestamp}.${body}`)}`,
  };
}

describe("verifySvixSignature", () => {
  it("accepts a valid signature", () => {
    assert.deepEqual(verifySvixSignature({ rawBody: body, headers: headers(), secret, now }), {
      ok: true,
      eventId: "msg_1",
    });
  });

  it("reads a Headers object", () => {
    const result = verifySvixSignature({ rawBody: body, headers: new Headers(headers()), secret, now });
    assert.equal(result.ok, true);
  });

  it("rejects a tampered body", () => {
    const result = verifySvixSignature({ rawBody: `${body} `, headers: headers(), secret, now });
    assert.equal(result.ok, false);
  });

  it("rejects the wrong secret", () => {
    const other = `whsec_${Buffer.from("another-secret-entirely-32-bytes").toString("base64")}`;
    assert.equal(verifySvixSignature({ rawBody: body, headers: headers(), secret: other, now }).ok, false);
  });

  it("rejects a timestamp 6 minutes old or ahead", () => {
    for (const offset of [-360, 360]) {
      const timestamp = String(now + offset);
      const signed = headers({ timestamp, signature: `v1,${sign(`msg_1.${timestamp}.${body}`)}` });
      assert.equal(verifySvixSignature({ rawBody: body, headers: signed, secret, now }).ok, false);
    }
  });

  it("rejects missing headers", () => {
    const { "svix-signature": _, ...rest } = headers();
    assert.equal(verifySvixSignature({ rawBody: body, headers: rest, secret, now }).ok, false);
    assert.equal(verifySvixSignature({ rawBody: body, headers: {}, secret, now }).ok, false);
  });

  it("accepts when one of several signatures is valid", () => {
    const valid = sign(`msg_1.${now}.${body}`);
    const signature = `v1,${Buffer.from("nope").toString("base64")} v2,${valid} v1,${valid}`;
    assert.equal(verifySvixSignature({ rawBody: body, headers: headers({ signature }), secret, now }).ok, true);
  });

  it("ignores a valid HMAC under another version", () => {
    const signature = `v2,${sign(`msg_1.${now}.${body}`)}`;
    assert.equal(verifySvixSignature({ rawBody: body, headers: headers({ signature }), secret, now }).ok, false);
  });

  it("accepts unsigned events only in development with no secret", () => {
    assert.equal(verifySvixSignature({ rawBody: body, headers: {}, secret: "", now, development: true }).ok, true);
    assert.equal(verifySvixSignature({ rawBody: body, headers: {}, secret: "", now, development: false }).ok, false);
    assert.equal(
      verifySvixSignature({ rawBody: body, headers: {}, secret, now, development: true }).ok,
      false,
    );
  });
});
