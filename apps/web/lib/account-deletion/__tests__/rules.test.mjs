/**
 * Account deletion rules: the typed confirmation, reasons, the grace period
 * and the erased-account username.
 *
 * Run: pnpm --filter @saphra/web test:account-deletion
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  confirmPhraseMatches,
  daysUntil,
  deletedUsername,
  FEEDBACK_MAX,
  GRACE_DAYS,
  isDeletedUsername,
  readDeletionReason,
  readFeedback,
  scheduledDeletionDate,
  USERNAME_HOLD_DAYS,
  usernameHeldFrom,
  usernameReleaseDate,
} from "@/lib/account-deletion/rules";
import { validateUsername } from "@/lib/profile-utils";

describe("confirmPhraseMatches", () => {
  it("accepts DELETE in any case, with stray spaces", () => {
    assert.equal(confirmPhraseMatches("DELETE"), true);
    assert.equal(confirmPhraseMatches(" delete "), true);
  });

  it("refuses anything else", () => {
    assert.equal(confirmPhraseMatches("DELET"), false);
    assert.equal(confirmPhraseMatches("DELETE ME"), false);
    assert.equal(confirmPhraseMatches(""), false);
    assert.equal(confirmPhraseMatches(undefined), false);
    assert.equal(confirmPhraseMatches(1), false);
  });
});

describe("reasons and feedback", () => {
  it("only keeps a known reason", () => {
    assert.equal(readDeletionReason("privacy"), "privacy");
    assert.equal(readDeletionReason("<script>"), null);
    assert.equal(readDeletionReason(undefined), null);
  });

  it("trims, collapses and caps feedback", () => {
    assert.equal(readFeedback("  too   many\nfees "), "too many fees");
    assert.equal(readFeedback("   "), null);
    assert.equal(readFeedback(42), null);
    assert.equal(readFeedback("x".repeat(FEEDBACK_MAX + 50)).length, FEEDBACK_MAX);
  });
});

describe("grace period", () => {
  it("schedules GRACE_DAYS ahead", () => {
    const from = new Date("2026-10-12T10:00:00.000Z");
    const at = scheduledDeletionDate(from);
    assert.equal(at.getTime() - from.getTime(), GRACE_DAYS * 24 * 60 * 60_000);
    assert.equal(daysUntil(at.toISOString(), from.getTime()), GRACE_DAYS);
  });

  it("never counts below zero days", () => {
    assert.equal(daysUntil("2020-01-01T00:00:00.000Z"), 0);
    assert.equal(daysUntil("not a date"), 0);
  });
});

describe("erased-account username", () => {
  it("is recognised", () => {
    const username = deletedUsername("6f1c2c4e-5a7b-4d2e-9a51-1b2c3d4e5f60");
    assert.equal(isDeletedUsername(username), true);
    assert.equal(isDeletedUsername("alice"), false);
    assert.equal(isDeletedUsername(null), false);
  });

  it("can never be chosen, looked up or sent to as a username", () => {
    assert.notEqual(validateUsername(deletedUsername("abc")), null);
  });
});

describe("username hold", () => {
  const now = Date.parse("2026-10-12T10:00:00.000Z");
  const hold = {
    available_at: usernameReleaseDate(new Date(now)).toISOString(),
    owner_wallet: "0xAbC0000000000000000000000000000000000001",
  };

  it("lasts USERNAME_HOLD_DAYS", () => {
    assert.equal(Date.parse(hold.available_at) - now, USERNAME_HOLD_DAYS * 24 * 60 * 60_000);
  });

  it("blocks everyone else until it ends", () => {
    assert.equal(usernameHeldFrom(hold, "0x0000000000000000000000000000000000000002", now), true);
    assert.equal(usernameHeldFrom(hold, null, now), true);
    assert.equal(usernameHeldFrom(hold, "0x0000000000000000000000000000000000000002", Date.parse(hold.available_at) + 1), false);
  });

  it("never blocks the wallet that held it, whatever the case", () => {
    assert.equal(usernameHeldFrom(hold, "0xabc0000000000000000000000000000000000001", now), false);
  });

  it("is no hold when there's no row", () => {
    assert.equal(usernameHeldFrom(null, "0x1", now), false);
  });
});
