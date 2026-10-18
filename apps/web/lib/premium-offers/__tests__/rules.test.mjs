/**
 * Premium offers: the price after a discount, which offer a purchase gets,
 * the grace past an offer's end, and the admin's input checks.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/premium-offers/__tests__/rules.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  discountedPrice,
  OFFER_GRACE_MS,
  offerOpen,
  offerState,
  pickOffer,
  readOfferInput,
} from "@/lib/premium-offers/rules";

const now = new Date("2026-11-20T12:00:00Z");
const offer = (over = {}) => ({
  bonus_days: 0,
  created_at: "2026-11-01T00:00:00Z",
  created_by: "Owner",
  discount_percent: 25,
  ends_at: "2026-11-27T00:00:00Z",
  headline: "",
  id: "o1",
  max_per_member: 1,
  max_redemptions: null,
  products: ["ALLIE_PRO"],
  starts_at: "2026-11-15T00:00:00Z",
  status: "live",
  title: "Black Friday",
  updated_at: "2026-11-01T00:00:00Z",
  ...over,
});
const none = { usedByMember: {}, usedInAll: {} };

describe("discountedPrice", () => {
  it("takes the percent off, to the cent", () => {
    assert.equal(discountedPrice(9.99, 50), 5);
    assert.equal(discountedPrice(5, 25), 3.75);
    assert.equal(discountedPrice(10, 0), 10);
  });

  it("never goes below a cent or past 90%", () => {
    assert.equal(discountedPrice(0.01, 90), 0.01);
    assert.equal(discountedPrice(10, 100), 1);
  });
});

describe("pickOffer", () => {
  it("gives the biggest discount, then the most bonus days", () => {
    const offers = [offer({ id: "a", discount_percent: 10 }), offer({ id: "b", discount_percent: 40 }), offer({ id: "c", discount_percent: 40, bonus_days: 7 })];
    assert.equal(pickOffer(offers, { at: now, product: "ALLIE_PRO", ...none })?.id, "c");
  });

  it("skips another product, a draft, and one not started", () => {
    const offers = [
      offer({ id: "a", products: ["EARN_AUTO_DEPOSIT"] }),
      offer({ id: "b", status: "draft" }),
      offer({ id: "c", starts_at: "2026-11-21T00:00:00Z" }),
    ];
    assert.equal(pickOffer(offers, { at: now, product: "ALLIE_PRO", ...none }), null);
  });

  it("respects the member's limit and the total cap", () => {
    const offers = [offer({ id: "a", max_redemptions: 100 })];
    assert.equal(pickOffer(offers, { at: now, product: "ALLIE_PRO", usedByMember: { a: 1 }, usedInAll: {} }), null);
    assert.equal(pickOffer(offers, { at: now, product: "ALLIE_PRO", usedByMember: {}, usedInAll: { a: 100 } }), null);
    assert.equal(pickOffer([offer({ max_per_member: 2 })], { at: now, product: "ALLIE_PRO", usedByMember: { o1: 1 }, usedInAll: {} })?.id, "o1");
  });

  it("keeps an offer for a payment made just before it ended", () => {
    const justEnded = offer({ ends_at: new Date(now.getTime() - 10 * 60 * 1000).toISOString() });
    assert.equal(offerOpen(justEnded, now), false);
    assert.equal(offerOpen(justEnded, now, OFFER_GRACE_MS), true);
    assert.equal(pickOffer([justEnded], { at: now, graceMs: OFFER_GRACE_MS, product: "ALLIE_PRO", ...none })?.id, "o1");
  });
});

describe("offerState", () => {
  it("reads draft, scheduled, live and ended", () => {
    assert.equal(offerState(offer({ status: "draft" }), now), "draft");
    assert.equal(offerState(offer({ starts_at: "2026-11-21T00:00:00Z" }), now), "scheduled");
    assert.equal(offerState(offer(), now), "live");
    assert.equal(offerState(offer({ ends_at: "2026-11-19T00:00:00Z" }), now), "ended");
  });
});

describe("readOfferInput", () => {
  const good = { discountPercent: 50, endsAt: "2026-11-27T00:00:00Z", products: ["ALLIE_PRO"], startsAt: "2026-11-20T00:00:00Z", title: "Black Friday" };

  it("accepts a discount, bonus days or both", () => {
    assert.equal(readOfferInput(good).discount_percent, 50);
    assert.equal(readOfferInput({ ...good, bonusDays: 7, discountPercent: 0 }).bonus_days, 7);
  });

  it("refuses an offer that gives nothing, an unknown product, too big a discount and a bad window", () => {
    assert.throws(() => readOfferInput({ ...good, discountPercent: 0 }), /discount, bonus days/);
    assert.throws(() => readOfferInput({ ...good, products: ["SWAP"] }), /product/);
    assert.throws(() => readOfferInput({ ...good, discountPercent: 95 }), /Discount/);
    assert.throws(() => readOfferInput({ ...good, endsAt: "2026-11-19T00:00:00Z" }), /after the start/);
  });
});
