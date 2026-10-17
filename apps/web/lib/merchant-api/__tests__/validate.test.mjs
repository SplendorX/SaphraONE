/**
 * Checkout API input rules: redirect URLs, metadata, line items, limits.
 *
 * Run: node --experimental-strip-types --import ./lib/payment-engine/__tests__/register.mjs \
 *        --test lib/merchant-api/__tests__/validate.test.mjs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ApiParamError,
  fillSessionTemplate,
  readAmount,
  readCurrency,
  readEmail,
  readExpiresInMinutes,
  readLineItems,
  readMetadata,
  readRedirectUrl,
  siteHostOf,
} from "@/lib/merchant-api/validate";

const live = { mode: "live", param: "success_url", required: true };
const test = { mode: "test", param: "success_url", required: true };

function throwsParam(fn, param) {
  assert.throws(fn, (error) => error instanceof ApiParamError && (!param || error.param === param));
}

describe("readRedirectUrl", () => {
  it("accepts https, with the session id template", () => {
    const url = "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}";
    assert.equal(readRedirectUrl(url, live), url);
    assert.equal(readRedirectUrl(" https://shop.example/a ", live), "https://shop.example/a");
  });

  it("allows http only for localhost with a test key", () => {
    assert.equal(readRedirectUrl("http://localhost:3000/ok", test), "http://localhost:3000/ok");
    assert.equal(readRedirectUrl("http://127.0.0.1/ok", test), "http://127.0.0.1/ok");
    throwsParam(() => readRedirectUrl("http://localhost:3000/ok", live), "success_url");
    throwsParam(() => readRedirectUrl("http://shop.example/ok", test), "success_url");
  });

  it("rejects other schemes, credentials, junk and over-long URLs", () => {
    throwsParam(() => readRedirectUrl("javascript:alert(1)", live));
    throwsParam(() => readRedirectUrl("data:text/html,hi", live));
    throwsParam(() => readRedirectUrl("https://user:pass@shop.example/", live));
    throwsParam(() => readRedirectUrl("/relative/path", live));
    throwsParam(() => readRedirectUrl(42, live));
    throwsParam(() => readRedirectUrl(`https://shop.example/${"a".repeat(2050)}`, live));
  });

  it("is required only when asked", () => {
    throwsParam(() => readRedirectUrl(undefined, live), "success_url");
    assert.equal(readRedirectUrl("", { ...live, param: "cancel_url", required: false }), null);
  });
});

describe("fillSessionTemplate / siteHostOf", () => {
  it("fills every template and names the host", () => {
    const url = "https://www.shop.example/t?a={CHECKOUT_SESSION_ID}&b={CHECKOUT_SESSION_ID}";
    assert.equal(
      fillSessionTemplate(url, "cs_test_abc"),
      "https://www.shop.example/t?a=cs_test_abc&b=cs_test_abc",
    );
    assert.equal(siteHostOf(url), "shop.example");
    assert.equal(siteHostOf("not a url"), "");
  });
});

describe("amount, currency, email, expiry", () => {
  it("takes amounts as decimal strings only", () => {
    assert.equal(readAmount("25.00"), "25.00");
    throwsParam(() => readAmount(25), "amount");
    throwsParam(() => readAmount("1e3"), "amount");
    throwsParam(() => readAmount("1.1234567"), "amount");
  });

  it("defaults to USDC and allows EURC", () => {
    assert.equal(readCurrency(undefined), "USDC");
    assert.equal(readCurrency("eurc"), "EURC");
    throwsParam(() => readCurrency("USDT"), "currency");
  });

  it("checks and lowercases email", () => {
    assert.equal(readEmail("Buyer@Example.com"), "buyer@example.com");
    assert.equal(readEmail(undefined), null);
    throwsParam(() => readEmail("not-an-email"), "customer_email");
  });

  it("keeps expiry between 30 minutes and a day", () => {
    assert.equal(readExpiresInMinutes(undefined), 60);
    assert.equal(readExpiresInMinutes(30), 30);
    assert.equal(readExpiresInMinutes(1440), 1440);
    throwsParam(() => readExpiresInMinutes(29));
    throwsParam(() => readExpiresInMinutes(1441));
    throwsParam(() => readExpiresInMinutes(45.5));
  });
});

describe("readMetadata", () => {
  it("keeps string values and stringifies numbers and booleans", () => {
    assert.deepEqual(readMetadata({ order: "1042", n: 3, gift: true }), {
      gift: "true",
      n: "3",
      order: "1042",
    });
    assert.deepEqual(readMetadata(undefined), {});
  });

  it("enforces key count and sizes", () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    throwsParam(() => readMetadata(many), "metadata");
    throwsParam(() => readMetadata({ ["k".repeat(41)]: "v" }));
    throwsParam(() => readMetadata({ k: "v".repeat(501) }));
    throwsParam(() => readMetadata({ k: { nested: true } }));
    throwsParam(() => readMetadata(["a"]), "metadata");
  });
});

describe("readLineItems", () => {
  it("accepts items that add up to the amount exactly", () => {
    const items = readLineItems(
      [
        { name: "Tee", quantity: 2, unit_amount: "10.10" },
        { name: "Shipping", unit_amount: "4.80" },
      ],
      "25.00",
    );
    assert.deepEqual(items, [
      { name: "Tee", quantity: 2, unit_amount: "10.10" },
      { name: "Shipping", quantity: 1, unit_amount: "4.80" },
    ]);
    assert.deepEqual(readLineItems(undefined, "5"), []);
  });

  it("rejects a total that doesn't match, without float rounding", () => {
    throwsParam(() => readLineItems([{ name: "A", unit_amount: "0.1" }, { name: "B", unit_amount: "0.2" }], "0.31"), "line_items");
    assert.equal(
      readLineItems([{ name: "A", unit_amount: "0.1" }, { name: "B", unit_amount: "0.2" }], "0.3").length,
      2,
    );
  });

  it("rejects bad items", () => {
    throwsParam(() => readLineItems([{ unit_amount: "1" }], "1"), "line_items[0].name");
    throwsParam(() => readLineItems([{ name: "A", quantity: 0, unit_amount: "1" }], "0"), "line_items[0].quantity");
    throwsParam(() => readLineItems([{ name: "A", unit_amount: 1 }], "1"), "line_items[0].unit_amount");
    throwsParam(() => readLineItems("nope", "1"), "line_items");
  });
});
