/**
 * Which business IDs SaphraONE can check, per country, and against what.
 * Client-safe: the settings panel uses it to offer the right ID types; the
 * server (registry-check.ts) does the actual lookups.
 *
 * Every automatic source here is an official register with a free API,
 * except Nigeria CAC/TIN through Prembly when that key is configured.
 */
export type BusinessIdType = "VAT" | "REGISTRATION" | "TAX" | "LEI";

export type BusinessIdOption = {
  type: BusinessIdType;
  label: string;
  placeholder: string;
  /** Checked against an official register on submit. */
  automatic: boolean;
  /** The register, as shown to the business. */
  source?: string;
};

/** EU member states in VIES. Greece is "EL" there. */
export const viesCountries = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

const lei: BusinessIdOption = {
  type: "LEI",
  label: "LEI (Legal Entity Identifier)",
  placeholder: "20 characters, e.g. 5493001KJTIIGC8Y1R12",
  automatic: true,
  source: "GLEIF",
};

/**
 * The ID types offered to a business in `countryCode` (ISO alpha-2).
 * `keys` says which optional free API keys the server has, since UK and
 * Australia need a (free) registration before they can be queried.
 */
export function businessIdOptions(
  countryCode: string | null | undefined,
  keys: { companiesHouse?: boolean; abnLookup?: boolean; prembly?: boolean } = {},
): BusinessIdOption[] {
  const code = countryCode?.toUpperCase() ?? "";
  const options: BusinessIdOption[] = [];

  if (code === "FR") {
    options.push({
      type: "REGISTRATION",
      label: "SIREN or SIRET",
      placeholder: "9-digit SIREN or 14-digit SIRET",
      automatic: true,
      source: "Annuaire des Entreprises (INSEE)",
    });
  } else if (code === "GB") {
    options.push({
      type: "REGISTRATION",
      label: "Companies House number",
      placeholder: "e.g. 09446231",
      automatic: Boolean(keys.companiesHouse),
      source: keys.companiesHouse ? "Companies House" : undefined,
    });
  } else if (code === "NO") {
    options.push({
      type: "REGISTRATION",
      label: "Organisation number",
      placeholder: "9 digits",
      automatic: true,
      source: "Brønnøysund Register Centre",
    });
  } else if (code === "AU") {
    options.push({
      type: "REGISTRATION",
      label: "ABN",
      placeholder: "11 digits",
      automatic: Boolean(keys.abnLookup),
      source: keys.abnLookup ? "Australian Business Register" : undefined,
    });
  } else {
    options.push({
      type: "REGISTRATION",
      label: "Company registration number",
      placeholder: code === "NG" ? "e.g. RC 1234567" : "As shown on your certificate",
      automatic: false,
    });
  }

  if (viesCountries.has(code)) {
    options.push({
      type: "VAT",
      label: "EU VAT number",
      placeholder: `e.g. ${code === "GR" ? "EL" : code}123456789`,
      automatic: true,
      source: "EU VIES",
    });
  } else if (code !== "AU") {
    options.push({
      type: "TAX",
      label: code === "NG" ? "Tax ID (TIN)" : code === "US" ? "EIN" : "Tax ID",
      placeholder: "As issued by your tax authority",
      automatic: false,
    });
  }

  options.push(lei);
  return options;
}

/** Where a reviewer can look a business up by hand, when there is a site. */
export const manualLookupSites: Record<string, { label: string; url: string }> = {
  NG: { label: "CAC public search", url: "https://search.cac.gov.ng/" },
  GH: { label: "ORC Ghana search", url: "https://orc.gov.gh/" },
  KE: { label: "eCitizen business search", url: "https://brs.ecitizen.go.ke/" },
  ZA: { label: "CIPC search", url: "https://eservices.cipc.co.za/" },
  US: { label: "OpenCorporates search", url: "https://opencorporates.com/" },
  GB: { label: "Companies House search", url: "https://find-and-update.company-information.service.gov.uk/" },
  AU: { label: "ABN Lookup", url: "https://abr.business.gov.au/" },
  IN: { label: "MCA company search", url: "https://www.mca.gov.in/" },
};
