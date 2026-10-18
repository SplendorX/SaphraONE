// Server-only. Looks a business ID up in a free official register.
import type { BusinessIdType } from "@/lib/business/registry-sources";
import { viesCountries } from "@/lib/business/registry-sources";

/** What a register said about an ID. */
export type RegistryResult =
  | {
      kind: "found";
      source: string;
      active: boolean;
      /** The legal name on the register, when it publishes one. */
      name: string | null;
      /** ISO alpha-2, when the register says where the entity is. */
      country?: string | null;
      status?: string | null;
    }
  | { kind: "not_found"; source: string }
  /** No automatic source, or the register couldn't be reached. */
  | { kind: "unavailable"; source?: string; note: string };

// Registers can be slow on a cold request; past this a person reviews it instead.
const timeout = () => AbortSignal.timeout(15_000);

// ── Normalising what people type ────────────────────────────────────────────

/** Strips spaces, dots and dashes, and a leading country prefix on a VAT number. */
export function normalizeBusinessId(type: BusinessIdType, countryCode: string, raw: string) {
  let value = raw.toUpperCase().replace(/[\s.\-/]/g, "");
  if (type === "VAT") {
    const prefix = countryCode === "GR" ? "EL" : countryCode;
    if (value.startsWith(prefix)) value = value.slice(prefix.length);
  }
  if (type === "REGISTRATION" && countryCode === "NG") value = value.replace(/^(RC|BN|IT)/, "");
  return value;
}

/** Cheap shape checks, so obvious typos never reach a register. */
export function businessIdShapeError(type: BusinessIdType, countryCode: string, value: string) {
  if (!value || value.length < 4 || value.length > 24 || !/^[A-Z0-9]+$/.test(value)) {
    return "Enter the number exactly as it appears on your documents.";
  }
  if (type === "LEI" && !/^[A-Z0-9]{18}[0-9]{2}$/.test(value)) return "An LEI is 20 characters.";
  if (type === "REGISTRATION" && countryCode === "FR" && !/^(\d{9}|\d{14})$/.test(value)) {
    return "A SIREN is 9 digits; a SIRET is 14.";
  }
  if (type === "REGISTRATION" && countryCode === "NO" && !/^\d{9}$/.test(value)) {
    return "A Norwegian organisation number is 9 digits.";
  }
  if (type === "REGISTRATION" && countryCode === "AU" && !/^\d{11}$/.test(value)) {
    return "An ABN is 11 digits.";
  }
  return null;
}

// ── Name matching ───────────────────────────────────────────────────────────

const legalSuffixes = new Set([
  "ltd", "limited", "llc", "inc", "incorporated", "corp", "corporation", "co", "company",
  "plc", "gmbh", "ag", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "as", "asa", "ab",
  "oy", "oyj", "aps", "sl", "kg", "lp", "llp", "pty", "pte", "the", "and", "of", "enterprise",
  "enterprises", "holdings", "group", "nig", "nigeria",
]);

function nameTokens(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token && !legalSuffixes.has(token));
}

/**
 * Whether the name on the register is plausibly this business. Ignores case,
 * accents, punctuation and legal forms ("Olu Ltd" = "OLU LIMITED"); anything
 * looser goes to a person rather than being approved.
 */
export function namesMatch(profileName: string, registryName: string) {
  const a = nameTokens(profileName);
  const b = nameTokens(registryName);
  if (a.length === 0 || b.length === 0) return false;
  if (a.join(" ") === b.join(" ")) return true;
  const setA = new Set(a);
  const shared = b.filter((token) => setA.has(token)).length;
  // Every distinctive word of the shorter name appears in the longer one.
  return shared >= Math.min(a.length, b.length) && shared / Math.max(a.length, b.length) >= 0.5;
}

// ── Sources ─────────────────────────────────────────────────────────────────

async function checkVies(countryCode: string, vat: string): Promise<RegistryResult> {
  const source = "EU VIES";
  try {
    const response = await fetch(
      "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number",
      {
        body: JSON.stringify({ countryCode: countryCode === "GR" ? "EL" : countryCode, vatNumber: vat }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: timeout(),
      },
    );
    const data = (await response.json().catch(() => null)) as {
      valid?: boolean;
      name?: string;
      actionSucceed?: boolean;
      errorWrappers?: { error?: string }[];
    } | null;
    if (!response.ok || !data || data.actionSucceed === false || data.errorWrappers?.length) {
      return { kind: "unavailable", source, note: "The EU VIES service didn't answer; a reviewer will check it." };
    }
    if (!data.valid) return { kind: "not_found", source };
    const name = data.name && data.name.trim() !== "---" ? data.name.trim() : null;
    return { kind: "found", source, active: true, name, country: countryCode };
  } catch (error) {
    // Server log only: an outage should be visible to whoever runs SaphraONE.
    console.warn("[registry]", source, error instanceof Error ? error.message : error);
    return { kind: "unavailable", source, note: "The EU VIES service couldn't be reached; a reviewer will check it." };
  }
}

async function checkFrance(id: string): Promise<RegistryResult> {
  const source = "Annuaire des Entreprises (INSEE)";
  const siren = id.slice(0, 9);
  try {
    const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}`, {
      headers: { accept: "application/json" },
      signal: timeout(),
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as {
      results?: { siren?: string; nom_raison_sociale?: string; nom_complet?: string; etat_administratif?: string }[];
    };
    const match = data.results?.find((result) => result.siren === siren);
    if (!match) return { kind: "not_found", source };
    return {
      kind: "found",
      source,
      active: match.etat_administratif !== "C",
      name: match.nom_raison_sociale || match.nom_complet || null,
      country: "FR",
      status: match.etat_administratif === "C" ? "closed" : "active",
    };
  } catch (error) {
    // Server log only: an outage should be visible to whoever runs SaphraONE.
    console.warn("[registry]", source, error instanceof Error ? error.message : error);
    return { kind: "unavailable", source, note: "The French register couldn't be reached; a reviewer will check it." };
  }
}

async function checkNorway(id: string): Promise<RegistryResult> {
  const source = "Brønnøysund Register Centre";
  try {
    const response = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter/${id}`, {
      headers: { accept: "application/json" },
      signal: timeout(),
    });
    if (response.status === 404) return { kind: "not_found", source };
    if (response.status === 410) {
      return { kind: "found", source, active: false, name: null, country: "NO", status: "deleted" };
    }
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as {
      navn?: string;
      konkurs?: boolean;
      underAvvikling?: boolean;
      slettedato?: string;
    };
    const closed = Boolean(data.konkurs || data.underAvvikling || data.slettedato);
    return {
      kind: "found",
      source,
      active: !closed,
      name: data.navn ?? null,
      country: "NO",
      status: closed ? "bankrupt, winding up or deleted" : "active",
    };
  } catch (error) {
    // Server log only: an outage should be visible to whoever runs SaphraONE.
    console.warn("[registry]", source, error instanceof Error ? error.message : error);
    return { kind: "unavailable", source, note: "The Norwegian register couldn't be reached; a reviewer will check it." };
  }
}

async function checkCompaniesHouse(id: string): Promise<RegistryResult> {
  const source = "Companies House";
  const key = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!key) return { kind: "unavailable", note: "Automatic UK checks aren't set up; a reviewer will check it." };
  try {
    const response = await fetch(
      `https://api.company-information.service.gov.uk/company/${id.padStart(8, "0")}`,
      {
        headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
        signal: timeout(),
      },
    );
    if (response.status === 404) return { kind: "not_found", source };
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { company_name?: string; company_status?: string };
    return {
      kind: "found",
      source,
      active: data.company_status === "active",
      name: data.company_name ?? null,
      country: "GB",
      status: data.company_status ?? null,
    };
  } catch (error) {
    // Server log only: an outage should be visible to whoever runs SaphraONE.
    console.warn("[registry]", source, error instanceof Error ? error.message : error);
    return { kind: "unavailable", source, note: "Companies House couldn't be reached; a reviewer will check it." };
  }
}

async function checkAbn(id: string): Promise<RegistryResult> {
  const source = "Australian Business Register";
  const guid = process.env.ABN_LOOKUP_GUID?.trim();
  if (!guid) return { kind: "unavailable", note: "Automatic ABN checks aren't set up; a reviewer will check it." };
  try {
    const response = await fetch(
      `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${id}&guid=${encodeURIComponent(guid)}`,
      { signal: timeout() },
    );
    if (!response.ok) throw new Error(String(response.status));
    // JSONP: callback({...})
    const text = await response.text();
    const data = JSON.parse(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"))) as {
      Abn?: string;
      AbnStatus?: string;
      EntityName?: string;
      Message?: string;
    };
    if (!data.Abn) return { kind: "not_found", source };
    return {
      kind: "found",
      source,
      active: data.AbnStatus === "Active",
      name: data.EntityName || null,
      country: "AU",
      status: data.AbnStatus ?? null,
    };
  } catch (error) {
    // Server log only: an outage should be visible to whoever runs SaphraONE.
    console.warn("[registry]", source, error instanceof Error ? error.message : error);
    return { kind: "unavailable", source, note: "The ABN register couldn't be reached; a reviewer will check it." };
  }
}

async function checkLei(id: string): Promise<RegistryResult> {
  const source = "GLEIF";
  try {
    const response = await fetch(`https://api.gleif.org/api/v1/lei-records/${id}`, {
      headers: { accept: "application/vnd.api+json" },
      signal: timeout(),
    });
    if (response.status === 404) return { kind: "not_found", source };
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as {
      data?: {
        attributes?: {
          entity?: {
            legalName?: { name?: string };
            status?: string;
            legalAddress?: { country?: string };
          };
          registration?: { status?: string };
        };
      };
    };
    const entity = data.data?.attributes?.entity;
    if (!entity) return { kind: "not_found", source };
    return {
      kind: "found",
      source,
      active: entity.status === "ACTIVE",
      name: entity.legalName?.name ?? null,
      country: entity.legalAddress?.country ?? null,
      status: data.data?.attributes?.registration?.status ?? entity.status ?? null,
    };
  } catch (error) {
    // Server log only: an outage should be visible to whoever runs SaphraONE.
    console.warn("[registry]", source, error instanceof Error ? error.message : error);
    return { kind: "unavailable", source, note: "The GLEIF register couldn't be reached; a reviewer will check it." };
  }
}

/** Look an ID up in the free official register for it, if there is one. */
export async function lookUpBusinessId(
  type: BusinessIdType,
  countryCode: string,
  id: string,
): Promise<RegistryResult> {
  if (type === "LEI") return checkLei(id);
  if (type === "VAT" && viesCountries.has(countryCode)) return checkVies(countryCode, id);
  if (type === "REGISTRATION") {
    if (countryCode === "FR") return checkFrance(id);
    if (countryCode === "NO") return checkNorway(id);
    if (countryCode === "GB") return checkCompaniesHouse(id);
    if (countryCode === "AU") return checkAbn(id);
  }
  return { kind: "unavailable", note: "There's no free official register to check this automatically; a reviewer will check it." };
}

export function availableRegistryKeys() {
  return {
    abnLookup: Boolean(process.env.ABN_LOOKUP_GUID?.trim()),
    companiesHouse: Boolean(process.env.COMPANIES_HOUSE_API_KEY?.trim()),
    prembly: Boolean(process.env.PREMBLY_API_KEY?.trim()),
  };
}

// ── Deciding ──────────────────────────────────────────────────────────────

export type RegistryDecision = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  method: "AUTOMATIC" | "MANUAL";
  source: string | null;
  registryName: string | null;
  registryStatus: string | null;
  note: string | null;
  reason: string | null;
};

/**
 * What a register's answer means. Only a clean match is approved without a
 * person; a clear "no" is rejected with the reason; anything in between goes
 * to a reviewer, with the register's answer attached for them.
 */
export function decideFromRegistry(
  result: RegistryResult,
  businessName: string,
  countryCode: string,
): RegistryDecision {
  if (result.kind === "unavailable") {
    return {
      method: "MANUAL",
      note: result.note,
      reason: null,
      registryName: null,
      registryStatus: null,
      source: result.source ?? null,
      status: "PENDING",
    };
  }
  if (result.kind === "not_found") {
    return {
      method: "AUTOMATIC",
      note: null,
      reason: `${result.source} has no record of this number. Check it against your documents and try again.`,
      registryName: null,
      registryStatus: null,
      source: result.source,
      status: "REJECTED",
    };
  }

  const base = {
    registryName: result.name,
    registryStatus: result.status ?? (result.active ? "active" : "inactive"),
    source: result.source,
  };

  if (!result.active) {
    return {
      ...base,
      method: "AUTOMATIC",
      note: null,
      reason: `${result.source} lists this business as ${result.status ?? "inactive"}. Only active businesses can be verified.`,
      status: "REJECTED",
    };
  }
  if (result.country && result.country.toUpperCase() !== countryCode) {
    return {
      ...base,
      method: "MANUAL",
      note: `The register places this entity in ${result.country}, but the profile says ${countryCode}.`,
      reason: null,
      status: "PENDING",
    };
  }
  if (!result.name) {
    return {
      ...base,
      method: "MANUAL",
      note: `${result.source} confirmed the number is valid but doesn't publish the business name.`,
      reason: null,
      status: "PENDING",
    };
  }
  if (!namesMatch(businessName, result.name)) {
    return {
      ...base,
      method: "MANUAL",
      note: `The register's name “${result.name}” doesn't clearly match “${businessName}”.`,
      reason: null,
      status: "PENDING",
    };
  }
  return { ...base, method: "AUTOMATIC", note: null, reason: null, status: "APPROVED" };
}

