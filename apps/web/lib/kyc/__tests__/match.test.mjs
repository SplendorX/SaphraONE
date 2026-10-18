/**
 * Nigerian KYC name, phone and date-of-birth matching.
 *
 * Run: pnpm --filter @saphra/web test:kyc
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { namesMatch as businessNamesMatch } from "@/lib/business/registry-check";
import { beneficiaryNameMatch, canActForCompany, dobMatches, namesMatch, normalizeNgPhone, phonesMatch } from "@/lib/kyc/match";

describe("namesMatch", () => {
  it("matches reversed first and last names", () => {
    assert.equal(namesMatch("Adebayo Okonkwo", "Okonkwo Adebayo"), true);
  });

  it("ignores a middle name on the record", () => {
    assert.equal(namesMatch("Adebayo Okonkwo", "Adebayo Olu Okonkwo"), true);
  });

  it("allows a one-letter typo", () => {
    assert.equal(namesMatch("Adebayo Okonkwo", "Adebayo Okonkwu"), true);
  });

  it("folds Yoruba and Igbo diacritics", () => {
    assert.equal(namesMatch("Adewale Onyeukwu", "Adéwalé Onyeùkwu"), true);
  });

  it("strips titles", () => {
    assert.equal(namesMatch("Adebayo Okonkwo", "Alhaji Adebayo Okonkwo"), true);
    assert.equal(namesMatch("Chief Ada Okeke", "Ada Okeke"), true);
  });

  it("rejects a different surname", () => {
    assert.equal(namesMatch("Adebayo Okonkwo", "Adebayo Eze"), false);
  });

  it("rejects a single token", () => {
    assert.equal(namesMatch("Adebayo", "Adebayo Okonkwo"), false);
  });

  it("matches a bank name that uses an initial", () => {
    assert.equal(namesMatch("ADEBAYO O. SMITH", "Adebayo Oluwaseun Smith"), true);
    assert.equal(namesMatch("Adebayo Oluwaseun Smith", "ADEBAYO O SMITH"), true);
  });

  it("needs two full names besides initials", () => {
    assert.equal(namesMatch("A. Smith", "Adebayo Smith"), false);
    assert.equal(namesMatch("A O Smith", "Adebayo Oluwaseun Smith"), false);
  });

  it("rejects an initial with the wrong letter", () => {
    assert.equal(namesMatch("Adebayo K. Smith", "Adebayo Oluwaseun Smith"), false);
  });
});

describe("beneficiaryNameMatch", () => {
  const owner = "Adebayo Oluwaseun Smith";
  const company = "Smith Logistics Limited";

  it("prefers the company name for a KYB business", () => {
    assert.equal(beneficiaryNameMatch("SMITH LOGISTICS LTD", owner, company, businessNamesMatch), "COMPANY");
  });

  it("accepts the owner's own account", () => {
    assert.equal(beneficiaryNameMatch("ADEBAYO O. SMITH", owner, company, businessNamesMatch), "OWNER");
  });

  it("rejects a third party", () => {
    assert.equal(beneficiaryNameMatch("CHINEDU EZE", owner, company, businessNamesMatch), null);
  });

  it("never matches a company without KYB", () => {
    assert.equal(beneficiaryNameMatch("SMITH LOGISTICS LTD", owner, null, businessNamesMatch), null);
  });
});

describe("normalizeNgPhone", () => {
  it("accepts local, national and E.164 forms", () => {
    assert.equal(normalizeNgPhone("08031234567"), "+2348031234567");
    assert.equal(normalizeNgPhone("2348031234567"), "+2348031234567");
    assert.equal(normalizeNgPhone("+2348031234567"), "+2348031234567");
    assert.equal(normalizeNgPhone("8031234567"), "+2348031234567");
  });

  it("rejects a landline-shaped number", () => {
    assert.equal(normalizeNgPhone("014123456"), null);
  });
});

describe("phonesMatch", () => {
  it("treats 0803 and +234803 as the same", () => {
    assert.equal(phonesMatch("08031234567", "+2348031234567"), true);
  });
});

describe("dobMatches", () => {
  it("accepts ISO, DMY and named months", () => {
    assert.equal(dobMatches("1990-01-15", "15-01-1990"), true);
    assert.equal(dobMatches("1990-01-15", "15-Jan-1990"), true);
    assert.equal(dobMatches("1990-01-15", "15 January 1990"), true);
  });

  it("rejects a different day", () => {
    assert.equal(dobMatches("1990-01-15", "1990-01-16"), false);
  });
});

describe("canActForCompany", () => {
  it("lets directors, proprietors and trustees act, not the company's lawyer", () => {
    assert.equal(canActForCompany("DIRECTOR"), true);
    assert.equal(canActForCompany("Proprietor"), true);
    assert.equal(canActForCompany("TRUSTEE"), true);
    assert.equal(canActForCompany("LAWYER"), false);
    assert.equal(canActForCompany("SECRETARY"), false);
    assert.equal(canActForCompany(null), true);
  });
});
