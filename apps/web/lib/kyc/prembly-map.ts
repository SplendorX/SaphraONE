/** Pure Prembly response mapping. Field names confirmed against the sandbox (Oct 2026), see README.md. */

export type PremblyKind = "ok" | "not_found" | "blocked" | "unavailable" | "rejected" | "error";

export type PremblyClass =
  | { ok: true; code: string; reference: string | null }
  | { ok: false; kind: Exclude<PremblyKind, "ok">; code: string; message: string };

export type PremblyPerson = {
  firstName: string;
  lastName: string;
  middleName: string | null;
  dob: string | null;
  phone: string | null;
  /** The BVN is on the banks' fraud watch-list (BVN only). */
  watchlisted: boolean;
};

export type PremblyFace = { matched: boolean; score: number; code: string };

export type PremblyCompany = {
  name: string | null;
  status: string | null;
  rcNumber: string | null;
  companyType: string | null;
  registrationDate: string | null;
  people: { name: string; role: string | null }[];
};

function isRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pick(row: Record<string, unknown> | null, ...keys: string[]) {
  if (!row) return null;
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return null;
}

function dataOf(body: unknown) {
  if (!isRow(body)) return null;
  return isRow(body.data) ? body.data : body;
}

function verificationOf(body: unknown) {
  if (!isRow(body)) return null;
  return isRow(body.verification) ? body.verification : null;
}

function codeOf(body: unknown) {
  if (!isRow(body)) return "";
  // Errors can carry the code only as errors.error_code (seen on a 404 from iGree).
  const nested = isRow(body.errors) ? body.errors.error_code : undefined;
  return String(body.response_code ?? body.responseCode ?? nested ?? "").trim();
}

/**
 * Prembly can return HTTP 200 for a failed check. Success needs 200, status
 * true, response_code 00, and verification.status VERIFIED when that field
 * is present.
 */
export function classifyPrembly(body: unknown, httpStatus: number): PremblyClass {
  if (httpStatus === 0 || httpStatus >= 500) {
    return { ok: false, kind: "unavailable", code: String(httpStatus), message: "Verification is unavailable right now. Try again shortly." };
  }
  if (!isRow(body)) {
    return { ok: false, kind: "error", code: String(httpStatus), message: "Verification is unavailable right now. Try again shortly." };
  }
  const code = codeOf(body) || String(httpStatus);
  const reference = pick(verificationOf(body) ?? {}, "reference") ?? pick(body, "reference");
  const statusFlag = body.status;
  const verification = verificationOf(body);
  const verified = !verification || String(verification.status ?? "").toUpperCase() === "VERIFIED";

  if (code === "01") {
    return { ok: false, kind: "not_found", code, message: "We couldn't find that number. Check the 11 digits." };
  }
  if (code === "07") {
    return { ok: false, kind: "blocked", code, message: "This BVN can't be used. Contact your bank." };
  }
  if (code === "02" || code === "03") {
    return { ok: false, kind: "unavailable", code, message: "Verification is unavailable right now. Try again shortly." };
  }
  if (httpStatus === 200 && (statusFlag === true || statusFlag === "true") && code === "00" && verified) {
    return { ok: true, code, reference };
  }
  if (httpStatus >= 400 && httpStatus < 500 && code !== "00") {
    return { ok: false, kind: "rejected", code, message: text(body.detail) ?? text(body.message) ?? "That check didn't succeed. Try again." };
  }
  if (code === "00" && statusFlag === false) {
    return { ok: false, kind: "rejected", code, message: text(body.detail) ?? text(body.message) ?? "That check didn't succeed. Try again." };
  }
  if (code !== "00") {
    return { ok: false, kind: "rejected", code, message: text(body.detail) ?? text(body.message) ?? "That check didn't succeed. Try again." };
  }
  return { ok: false, kind: "error", code, message: "Verification is unavailable right now. Try again shortly." };
}

function truthy(value: unknown) {
  return value === true || (typeof value === "string" && /^(true|yes|1)$/i.test(value.trim()));
}

/**
 * BVN: firstName, lastName, middleName, dateOfBirth ("11-May-2004"),
 * phoneNumber1, watchListed ("False"). NIN: firstname, surname,
 * middlename, birthdate ("22-05-1998"), telephoneno.
 */
export function mapBvn(body: unknown): PremblyPerson | null {
  const data = dataOf(body);
  if (!data) return null;
  const firstName = pick(data, "firstName", "first_name", "firstname");
  const lastName = pick(data, "lastName", "last_name", "surname", "lastname");
  if (!firstName || !lastName) return null;
  return {
    firstName,
    lastName,
    middleName: pick(data, "middleName", "middle_name", "middlename"),
    dob: pick(data, "dateOfBirth", "date_of_birth", "dob", "birthdate"),
    phone: pick(data, "phoneNumber1", "phoneNumber", "phone_number", "telephoneno", "phone", "mobile", "phoneNumber2"),
    watchlisted: truthy(data.watchListed ?? data.watch_listed),
  };
}

export function mapNin(body: unknown): PremblyPerson | null {
  return mapBvn(body);
}

/**
 * Face match. face_data.response_code "00" only means the comparison ran
 * (the sandbox says "Fatch Match" at confidence 0.04), so callers must
 * check `score` against KYC_FACE_MATCH_MIN. Scales differ by endpoint:
 * nin_w_face reports 0-100 (99.98), so it is always divided by 100.
 * bvn_w_face reported 0.04 for a non-matching face, which reads as 0-1;
 * values above 1 are still treated as percentages.
 */
export function mapFace(body: unknown, scale: "percent" | "auto" = "auto"): PremblyFace {
  const data = dataOf(body);
  const face = isRow(data) && isRow(data.face_data) ? data.face_data : isRow(body) && isRow(body.face_data) ? body.face_data : data;
  const code = face ? String(face.response_code ?? face.responseCode ?? "").trim() : "";
  const scoreRaw = face ? Number(face.confidence ?? face.score ?? face.confidence_score ?? 0) : 0;
  const fraction = scale === "percent" || scoreRaw > 1 ? scoreRaw / 100 : scoreRaw;
  const score = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return { matched: code === "00", score, code };
}

/** Liveness: data.confidence (0-1) next to data.confidence_in_percentage. */
export function mapLiveness(body: unknown): { score: number } {
  const data = dataOf(body);
  const percent = isRow(data) ? Number(data.confidence_in_percentage) : Number.NaN;
  if (Number.isFinite(percent)) return { score: Math.min(1, Math.max(0, percent / 100)) };
  const scoreRaw = Number(
    (isRow(data) ? data.confidence ?? data.score ?? data.liveness_score : null) ??
      (isRow(body) ? body.confidence ?? body.score : 0) ??
      0,
  );
  const score = Number.isFinite(scoreRaw) ? (scoreRaw > 1 ? scoreRaw / 100 : scoreRaw) : 0;
  return { score: Math.min(1, Math.max(0, score)) };
}

function personName(entry: Record<string, unknown>) {
  const full = pick(entry, "name", "fullName", "full_name", "director_name");
  if (full) return full;
  const other = pick(entry, "otherName", "other_name", "middleName");
  const parts = [
    pick(entry, "firstname", "firstName", "first_name"),
    other && !/^n\/?a$/i.test(other) ? other : null,
    pick(entry, "surname", "lastName", "last_name"),
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** CAC affiliates. Ones CAC marks as no longer active are left out. */
function peopleFrom(value: unknown): PremblyCompany["people"] {
  if (!Array.isArray(value)) return [];
  const people: PremblyCompany["people"] = [];
  for (const entry of value) {
    if (!isRow(entry)) continue;
    const status = text(entry.status);
    if (status && status.toUpperCase() !== "ACTIVE") continue;
    const name = personName(entry);
    if (!name) continue;
    const affiliate = isRow(entry.affiliateTypeFk) ? entry.affiliateTypeFk : null;
    people.push({ name, role: pick(affiliate, "name") ?? pick(entry, "role", "position", "designation", "type") });
  }
  return people;
}

function rcDigits(value: string | null) {
  return value ? value.replace(/\D/g, "").replace(/^0+/, "") : "";
}

/**
 * CAC advance returns `data` as a list of companies. Only the entry whose
 * RC number equals the one asked for counts: a name search can return
 * others. Null when none matches.
 */
export function mapCac(body: unknown, rcNumber?: string): PremblyCompany | null {
  if (!isRow(body)) return null;
  const entries = Array.isArray(body.data) ? body.data.filter(isRow) : isRow(body.data) ? [body.data] : [body];
  const wanted = rcDigits(rcNumber ?? null);
  const data = wanted
    ? entries.find((entry) => rcDigits(pick(entry, "rc_number", "rcNumber", "registration_number")) === wanted)
    : entries[0];
  if (!data) return null;
  const people = [
    ...peopleFrom(data.directors),
    ...peopleFrom(data.proprietors),
    ...peopleFrom(data.persons_with_significant_control),
    ...peopleFrom(data.psc),
    ...peopleFrom(data.affiliates),
    ...peopleFrom(data.people),
  ];
  return {
    name: pick(data, "company_name", "companyName", "approvedName", "name", "business_name"),
    status: pick(data, "company_status", "companyStatus", "status", "state"),
    rcNumber: pick(data, "rc_number", "rcNumber", "registration_number"),
    companyType: pick(data, "entity_type", "company_type", "companyType", "type"),
    registrationDate: pick(data, "registrationDate", "registration_date", "date_of_registration"),
    people,
  };
}

export function mapTin(body: unknown): { name: string | null; number: string | null } | null {
  const data = dataOf(body);
  if (!data) return null;
  return {
    name: pick(data, "taxpayer_name", "name", "registered_name", "company_name"),
    number: pick(data, "tin", "firstin", "jittin", "number", "tax_id"),
  };
}
