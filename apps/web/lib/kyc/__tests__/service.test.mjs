/**
 * The KYC service and the ramp gate against an in-memory Supabase and a
 * stubbed Prembly: tiers, daily caps, payout names, iGree and reviews.
 *
 * Run: pnpm --filter @saphra/web test:kyc
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";

register("./fake-supabase-loader.mjs", import.meta.url);

process.env.NEXT_PUBLIC_KYC_REQUIRED = "true";
process.env.PREMBLY_API_KEY = "test-key";
process.env.PREMBLY_ENV = "sandbox";
process.env.KYC_HASH_SECRET = "x".repeat(40);
process.env.CENTIIV_PUBLIC_KEY = "pk_sandbox_test";
delete process.env.NEXT_PUBLIC_ARC_NETWORK;
delete process.env.KYC_BVN_IGREE;

const { fakeDb } = await import("./fake-supabase.mjs");
const kyc = await import("@/lib/kyc/service");
const { hashId } = await import("@/lib/kyc/hash");
const ramp = await import("@/lib/ramp/service");

const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const realFetch = globalThis.fetch;

const person = {
  firstName: "ADEBAYO",
  lastName: "SMITH",
  middleName: "OLUWASEUN",
  dateOfBirth: "15-Jan-1990",
  phoneNumber: "08031234567",
};

function premblyOk(data, reference = "ref-1") {
  return { status: true, response_code: "00", verification: { status: "VERIFIED", reference }, data };
}

/** Replies to Prembly paths; anything else fails the test. */
function stubPrembly(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, body });
    const reply = routes[path];
    if (!reply) throw new Error(`unexpected fetch ${path}`);
    const json = typeof reply === "function" ? reply(body) : reply;
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}

function verifiedProfile(owner, patch = {}) {
  fakeDb.rows("kyc_profiles").push({
    wallet_address: owner,
    country: "NG",
    tier: 1,
    status: "VERIFIED",
    provider: "PREMBLY",
    id_type: "NIN",
    id_hash: hashId("NIN", "12345678901"),
    id_last4: "8901",
    first_name: "ADEBAYO",
    last_name: "SMITH",
    middle_name: "OLUWASEUN",
    dob: "1990-01-15",
    phone_e164: "+2348031234567",
    flags: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...patch,
  });
}

function order(owner, direction, amount, status = "PENDING") {
  fakeDb.rows("ramp_orders").push({
    wallet_address: owner,
    direction,
    status,
    fiat_amount: direction === "ONRAMP" ? String(amount) : null,
    usdc_amount: direction === "OFFRAMP" ? String(amount) : null,
    created_at: new Date().toISOString(),
  });
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

beforeEach(() => {
  fakeDb.reset();
  delete process.env.KYC_BVN_IGREE;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("ramp gate", () => {
  it("refuses a new on-ramp order at tier 0", async () => {
    await rejectsWith(kyc.assertRampAllowed(wallet, "ONRAMP", "1000"), "KYC_REQUIRED");
  });

  it("refuses createOrder from an unverified wallet before calling Centiiv", async () => {
    globalThis.fetch = async () => {
      throw new Error("Centiiv must not be called");
    };
    await rejectsWith(
      ramp.createOrder({ wallet, direction: "ONRAMP", amount: "10000", idempotencyKey: "k1" }),
      "KYC_REQUIRED",
    );
  });

  it("holds tier 1 to the ₦500k rolling cap", async () => {
    verifiedProfile(wallet);
    order(wallet, "ONRAMP", 400_000);
    order(wallet, "ONRAMP", 900_000, "FAILED");
    await kyc.assertRampAllowed(wallet, "ONRAMP", "100000");
    await rejectsWith(kyc.assertRampAllowed(wallet, "ONRAMP", "100000.01"), "KYC_LIMIT");
  });

  it("fails closed when today's orders can't be read", async () => {
    verifiedProfile(wallet);
    fakeDb.failTables.add("ramp_orders");
    await assert.rejects(kyc.assertRampAllowed(wallet, "ONRAMP", "1000"), /boom on ramp_orders/);
  });

  it("fails an order that two parallel requests pushed over the cap", async () => {
    verifiedProfile(wallet);
    order(wallet, "ONRAMP", 300_000);
    order(wallet, "ONRAMP", 300_000);
    let failed = 0;
    await rejectsWith(
      kyc.settleDailyCap(wallet, "ONRAMP", async () => {
        failed += 1;
      }),
      "KYC_LIMIT",
    );
    assert.equal(failed, 1);
  });

  it("keeps an order that stays within the cap", async () => {
    verifiedProfile(wallet);
    order(wallet, "ONRAMP", 500_000);
    await kyc.settleDailyCap(wallet, "ONRAMP", async () => assert.fail("should not fail the order"));
  });
});

describe("payout names", () => {
  beforeEach(() => {
    verifiedProfile(wallet);
    fakeDb.rows("kyb_profiles").push({
      wallet_address: wallet,
      status: "VERIFIED",
      level: "BASIC",
      company_name: "Smith Logistics Limited",
      tin_hash: null,
      flags: {},
    });
  });

  it("accepts the company and the owner, and rejects a third party", async () => {
    assert.equal(await kyc.assertBeneficiaryMatchesKyc(wallet, "SMITH LOGISTICS LIMITED"), "COMPANY");
    assert.equal(await kyc.assertBeneficiaryMatchesKyc(wallet, "ADEBAYO O. SMITH"), "OWNER");
    await rejectsWith(kyc.assertBeneficiaryMatchesKyc(wallet, "CHINEDU EZE"), "BENEFICIARY_NAME_MISMATCH");
  });

  it("gives company payouts KYB limits and owner payouts personal limits", async () => {
    await kyc.assertRampAllowed(wallet, "OFFRAMP", "5000", { payout: "COMPANY" });
    await rejectsWith(kyc.assertRampAllowed(wallet, "OFFRAMP", "5000", { payout: "OWNER" }), "KYC_LIMIT");
    await kyc.assertRampAllowed(wallet, "OFFRAMP", "500", { payout: "OWNER" });
  });
});

describe("Tier 1 identity", () => {
  const input = { type: "NIN", number: "12345678901", dob: "1990-01-15", firstName: "Adebayo", lastName: "Smith" };

  it("holds a NIN match until Confirm, with the phone from the record", async () => {
    stubPrembly({ "/verification/vnin": premblyOk(person) });
    const state = await kyc.submitId(wallet, input);
    assert.equal(state.tier, 0, "a match alone is not verified");
    assert.equal(state.confirmRequired, true);
    assert.equal(state.consentRequired, false);
    await rejectsWith(kyc.assertRampAllowed(wallet, "ONRAMP", "1000"), "KYC_REQUIRED");
    const confirmed = await kyc.confirmIdentity(wallet, true);
    assert.equal(confirmed.tier, 1);
    await kyc.assertRampAllowed(wallet, "ONRAMP", "1000");
    const [row] = fakeDb.rows("kyc_profiles");
    assert.equal(row.flags.confirm_pending_at, undefined);
    assert.equal(row.phone_e164, "+2348031234567");
    assert.equal(row.id_last4, "8901");
    assert.equal(JSON.stringify(row).includes("12345678901"), false, "the raw NIN is never stored");
  });

  it("rejects the same NIN on a second wallet", async () => {
    stubPrembly({ "/verification/vnin": premblyOk(person) });
    await kyc.submitId(wallet, input);
    await kyc.confirmIdentity(wallet, true);
    await rejectsWith(kyc.submitId(other, input), "CONFLICT");
  });

  it("shows the same match again after a reload without a second lookup", async () => {
    const calls = stubPrembly({ "/verification/vnin": premblyOk(person) });
    await kyc.submitId(wallet, input);
    const again = await kyc.submitId(wallet, input);
    assert.equal(again.confirmRequired, true);
    assert.equal(again.preview.firstName, "ADEBAYO");
    assert.equal(calls.length, 1, "Prembly is called once");
    assert.equal(again.tier, 0);
  });

  it("clears the match on That's not me and counts a failure", async () => {
    stubPrembly({ "/verification/vnin": premblyOk(person) });
    await kyc.submitId(wallet, input);
    const state = await kyc.confirmIdentity(wallet, false);
    assert.equal(state.tier, 0);
    const [row] = fakeDb.rows("kyc_profiles");
    assert.equal(row.status, "NONE");
    assert.equal(row.id_hash, null);
    assert.equal(row.first_name, null);
    assert.equal(fakeDb.rows("kyc_attempts").at(-1).reason_code, "not_me");
    await rejectsWith(kyc.confirmIdentity(wallet, true), "INVALID");
  });

  it("refuses Confirm once the window has passed", async () => {
    stubPrembly({ "/verification/vnin": premblyOk(person) });
    await kyc.submitId(wallet, input);
    fakeDb.rows("kyc_profiles")[0].flags.confirm_pending_at = new Date(Date.now() - 31 * 60_000).toISOString();
    await rejectsWith(kyc.confirmIdentity(wallet, true), "INVALID");
  });

  it("rejects a wrong date of birth and logs the failure", async () => {
    stubPrembly({ "/verification/vnin": premblyOk(person) });
    await rejectsWith(kyc.submitId(wallet, { ...input, dob: "1990-01-16" }), "INVALID");
    assert.equal(fakeDb.rows("kyc_attempts").at(-1).reason_code, "dob");
  });

  it("does not count a Prembly outage as a failed attempt", async () => {
    stubPrembly({ "/verification/vnin": { status: false, response_code: "02" } });
    await rejectsWith(kyc.submitId(wallet, input), "KYC_UNAVAILABLE");
    assert.equal(fakeDb.rows("kyc_attempts").at(-1).result, "ERROR");
  });
});

describe("BVN consent (iGree)", () => {
  const bvn = "22345678901";
  const input = { type: "BVN", number: bvn, dob: "1990-01-15", firstName: "Adebayo", lastName: "Smith" };

  it("holds a BVN check until the code sent to the BVN's phone passes", async () => {
    process.env.KYC_BVN_IGREE = "true";
    const calls = stubPrembly({
      "/verification/bvn": premblyOk(person),
      "/verification/bvn/igree": (body) =>
        body.mode === "verify" && body.otp !== "123456" ? { status: false, response_code: "01" } : premblyOk({}, "igree-1"),
    });
    const pending = await kyc.submitId(wallet, input);
    assert.equal(pending.consentRequired, true);
    assert.equal(pending.tier, 0);
    assert.equal(calls.find((call) => call.path === "/verification/bvn/igree").body.number, bvn, "iGree gets the BVN, not a phone");

    await rejectsWith(kyc.confirmConsent(wallet, { number: "22345678900", code: "123456" }), "INVALID");
    await rejectsWith(kyc.confirmConsent(wallet, { number: bvn, code: "999999" }), "INVALID");
    await rejectsWith(kyc.confirmIdentity(wallet, true), "INVALID");
    const consented = await kyc.confirmConsent(wallet, { number: bvn, code: "123456" });
    assert.equal(consented.tier, 0, "the code alone is not Confirm");
    const done = await kyc.confirmIdentity(wallet, true);
    assert.equal(done.tier, 1);
    assert.equal(fakeDb.rows("kyc_profiles")[0].otp_provider, "prembly_igree");
    assert.equal(fakeDb.rows("kyc_profiles")[0].flags.consent_sent_at, undefined);
  });

  it("skips the code while iGree is off and goes straight to Confirm", async () => {
    const calls = stubPrembly({ "/verification/bvn": premblyOk(person) });
    const state = await kyc.submitId(wallet, input);
    assert.equal(state.consentRequired, false);
    assert.equal(state.confirmRequired, true);
    assert.equal(calls.some((call) => call.path === "/verification/bvn/igree"), false);
    assert.equal((await kyc.confirmIdentity(wallet, true)).tier, 1);
  });
});

describe("Tier 2 selfie", () => {
  it("needs the same ID number typed again", async () => {
    verifiedProfile(wallet);
    globalThis.fetch = async () => {
      throw new Error("Prembly must not be called");
    };
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64");
    await rejectsWith(kyc.submitSelfie(wallet, jpeg, "99999999999"), "INVALID");
    await rejectsWith(kyc.submitSelfie(wallet, jpeg, undefined), "INVALID");
  });
});

describe("manual review", () => {
  it("reopens a record with no confirmed identity instead of verifying it", async () => {
    fakeDb.rows("kyc_profiles").push({ wallet_address: wallet, tier: 0, status: "MANUAL_REVIEW", flags: {} });
    fakeDb.rows("rate_limit_windows").push({ key: `kyc-identity:${wallet}`, hits: 5 });
    const result = await kyc.decideKyc({ wallet, decision: "APPROVED", reason: "", reviewer: "ops" });
    assert.equal(result.outcome, "REOPENED");
    const [row] = fakeDb.rows("kyc_profiles");
    assert.equal(row.status, "NONE");
    assert.equal(row.tier, 0);
    assert.equal(typeof row.flags.review_cleared_at, "string");
    assert.equal(fakeDb.rows("rate_limit_windows").length, 0, "the day's identity limit is cleared");
  });

  it("approves a record whose identity was confirmed", async () => {
    verifiedProfile(wallet, { status: "MANUAL_REVIEW", tier: 0 });
    const result = await kyc.decideKyc({ wallet, decision: "APPROVED", reason: "", reviewer: "ops" });
    assert.equal(result.outcome, "APPROVED");
    assert.equal(fakeDb.rows("kyc_profiles")[0].tier, 1);
  });
});
