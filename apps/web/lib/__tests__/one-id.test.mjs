/**
 * ONE IDs read as "amara.one"; the older "@amara" and a bare "amara" still
 * find the same account everywhere a name is typed.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/__tests__/one-id.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyMessage } from "@/lib/allie/classifier";
import { normalizeHandle } from "@/lib/business/usernames";
import {
  formatUsernameLabel,
  normalizeUsername,
  parseRecipientInput,
  validateUsername,
} from "@/lib/profile-utils";

describe("ONE ID format", () => {
  it("shows a stored name as name.one", () => {
    assert.equal(formatUsernameLabel("amara"), "amara.one");
    assert.equal(formatUsernameLabel("@amara"), "amara.one");
    assert.equal(formatUsernameLabel("amara.one"), "amara.one");
  });

  it("reads every way of typing it as the stored name", () => {
    for (const typed of ["amara.one", "AMARA.ONE", "@amara", " amara ", "amara"]) {
      assert.equal(normalizeUsername(typed), "amara");
    }
    assert.equal(normalizeHandle("acme-studio.one"), "acme-studio");
  });

  it("validates the name, not the suffix", () => {
    assert.equal(validateUsername("amara.one"), null);
    assert.notEqual(validateUsername("am.one"), null);
  });

  it("parses a typed recipient", () => {
    assert.deepEqual(parseRecipientInput("amara.one"), { kind: "username", username: "amara" });
    assert.deepEqual(parseRecipientInput("@amara"), { kind: "username", username: "amara" });
    assert.equal(parseRecipientInput("0x123").kind, "invalid");
  });
});

describe("ALLIE and ONE IDs", () => {
  it("treats name.one as an account, like @name", () => {
    const result = classifyMessage("send $20 to alex.one");
    assert.equal(result?.action.type, "PaymentIntent");
    assert.equal(result?.action.recipient, "@alex");
  });

  it("still reads the older @name", () => {
    assert.equal(classifyMessage("pay @alex 12.50 usdc")?.action.recipient, "@alex");
  });
});
