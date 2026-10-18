/**
 * Prembly response_code mapping and person/face/CAC mappers.
 *
 * Run: pnpm --filter @saphra/web test:kyc
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { classifyPrembly, mapBvn, mapCac, mapFace, mapLiveness, mapNin, mapTin } from "@/lib/kyc/prembly-map";

/** Redacted sandbox bodies from scripts/prembly-sandbox.mjs (Oct 2026). */
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/prembly-${name}.json`, import.meta.url), "utf8"));

const person = {
  status: true,
  response_code: "00",
  verification: { status: "VERIFIED", reference: "ref-1" },
  data: {
    firstName: "ADEBAYO",
    last_name: "OKONKWO",
    middleName: "OLU",
    dateOfBirth: "1990-01-15",
    phoneNumber: "08031234567",
  },
};

describe("classifyPrembly", () => {
  it("accepts 00 + VERIFIED on HTTP 200", () => {
    const result = classifyPrembly(person, 200);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.reference, "ref-1");
  });

  it("maps 01 to not_found", () => {
    const result = classifyPrembly({ status: false, response_code: "01" }, 200);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "not_found");
  });

  it("maps 02 and 03 to unavailable", () => {
    assert.equal(classifyPrembly({ status: false, response_code: "02" }, 200).ok, false);
    const empty = classifyPrembly({ status: false, response_code: "03" }, 200);
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.kind, "unavailable");
  });

  it("maps 07 to blocked", () => {
    const result = classifyPrembly({ status: false, response_code: "07" }, 200);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "blocked");
  });

  it("treats HTTP 200 with status false as a failure", () => {
    const result = classifyPrembly({ status: false, response_code: "00", detail: "no" }, 200);
    assert.equal(result.ok, false);
  });

  it("treats a timeout as unavailable", () => {
    const result = classifyPrembly(null, 0);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "unavailable");
  });
});

describe("mapBvn", () => {
  it("reads mixed casing", () => {
    const mapped = mapBvn(person);
    assert.deepEqual(mapped, {
      firstName: "ADEBAYO",
      lastName: "OKONKWO",
      middleName: "OLU",
      dob: "1990-01-15",
      phone: "08031234567",
      watchlisted: false,
    });
  });
});

describe("sandbox fixtures", () => {
  it("classifies a sandbox BVN body as verified with a reference", () => {
    const result = classifyPrembly(fixture("bvn"), 200);
    assert.equal(result.ok, true);
    if (result.ok) assert.ok(result.reference);
  });

  it("maps the BVN body, phoneNumber1 and watchListed included", () => {
    assert.deepEqual(mapBvn(fixture("bvn")), {
      firstName: "RONALD",
      lastName: "EKOM",
      middleName: "DONATIUS",
      dob: "11-May-2004",
      phone: "00000000000",
      watchlisted: false,
    });
    const listed = fixture("bvn");
    listed.data.watchListed = "True";
    assert.equal(mapBvn(listed)?.watchlisted, true);
  });

  it("maps the NIN body (firstname, surname, birthdate, telephoneno)", () => {
    const mapped = mapNin(fixture("nin"));
    assert.equal(mapped?.firstName, "CHIDERA");
    assert.equal(mapped?.lastName, "JOHNSON");
    assert.equal(mapped?.middleName, "ANITA");
    assert.equal(mapped?.dob, "22-05-1998");
    assert.equal(mapped?.phone, "00000000000");
  });

  it("maps the CAC list only for the RC number asked for", () => {
    const company = mapCac(fixture("cac"), "RC7000");
    assert.equal(company?.name, "JE TRADING CO. LTD");
    assert.equal(company?.status, "INACTIVE");
    assert.equal(company?.companyType, "RC");
    assert.deepEqual(company?.people.map((person) => person.role), ["LAWYER", "LAWYER", "DIRECTOR", "DIRECTOR", "DIRECTOR", "DIRECTOR"]);
    assert.equal(company?.people[0].name, "DEL LAYAN", "padding trimmed and N/A other name dropped");
    assert.equal(company?.people[2].name, "IEL YAN");
    assert.equal(mapCac(fixture("cac"), "1234567"), null);
  });

  it("drops directors CAC lists as inactive", () => {
    const body = fixture("cac");
    body.data[0].directors[0].status = "INACTIVE";
    assert.equal(mapCac(body, "7000")?.people.length, 5);
  });

  it("maps the TIN body", () => {
    assert.deepEqual(mapTin(fixture("tin")), { name: "test test", number: "00000000000" });
  });

  it("does not read face_data 00 as a match: the score decides", () => {
    const bvnFace = mapFace(fixture("bvn-face"));
    assert.equal(bvnFace.code, "00");
    assert.ok(bvnFace.score < 0.1, `bvn_w_face sent a non-matching face, got ${bvnFace.score}`);
  });

  it("reads nin_w_face confidence as a percentage, even below 1", () => {
    assert.ok(mapFace(fixture("nin-face"), "percent").score > 0.99);
    const weak = fixture("nin-face");
    weak.data.face_data.confidence = 0.9;
    assert.ok(Math.abs(mapFace(weak, "percent").score - 0.009) < 1e-9);
  });

  it("reads liveness from confidence_in_percentage", () => {
    assert.ok(mapLiveness(fixture("liveness")).score > 0.99);
  });

  it("reads errors.error_code on the iGree 404", () => {
    const result = classifyPrembly(fixture("igree-send"), 404);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "02");
      assert.equal(result.kind, "unavailable");
    }
  });
});

describe("mapFace", () => {
  it("does not treat a top-level 00 as a match when face_data failed", () => {
    const face = mapFace({
      status: true,
      response_code: "00",
      data: { face_data: { response_code: "01", confidence: 12 } },
    });
    assert.equal(face.matched, false);
    assert.equal(face.code, "01");
  });

  it("scales a 0–100 confidence down to 0–1", () => {
    const face = mapFace({ data: { face_data: { response_code: "00", confidence: 99.5 } } });
    assert.equal(face.matched, true);
    assert.ok(face.score > 0.9 && face.score <= 1);
  });
});

describe("mapCac", () => {
  it("collects directors and flags missing people", () => {
    const withPeople = mapCac({
      data: {
        company_name: "OLU LIMITED",
        status: "Active",
        rc_number: "1234567",
        directors: [{ name: "Adebayo Okonkwo", role: "Director" }],
      },
    });
    assert.equal(withPeople?.name, "OLU LIMITED");
    assert.equal(withPeople?.people.length, 1);

    const none = mapCac({ data: { company_name: "OLU LIMITED", status: "Active" } });
    assert.equal(none?.people.length, 0);
  });
});
