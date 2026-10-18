/** Pure identity matching for Nigerian KYC. */

const titles = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "professor", "alhaji", "alhaja",
  "chief", "sir", "madam", "hon", "honourable", "pastor", "rev", "reverend",
  "engr", "engineer", "barr", "barrister", "imam", "mallam", "hajia",
]);

function fold(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameTokens(value: string) {
  return fold(value)
    .split(" ")
    .filter((token) => token && !titles.has(token));
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = a[i - 1] === b[j - 1] ? previous : 1 + Math.min(previous, row[j], row[j - 1]);
      previous = current;
    }
  }
  return row[b.length];
}

function tokenMatches(a: string, b: string) {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  if (Math.abs(a.length - b.length) > 1) return false;
  return levenshtein(a, b) <= 1;
}

/**
 * Every typed token must match a token on the record, order insensitive,
 * ignoring titles and diacritics, allowing one-letter typos. A single
 * letter matches as an initial ("ADEBAYO O. SMITH"), but at least two
 * full names must still match.
 */
export function namesMatch(typed: string, record: string) {
  const a = nameTokens(typed);
  const b = nameTokens(record);
  if (a.length < 2 || b.length < 2) return false;
  let full = 0;
  for (const token of a) {
    const hit = b.find((candidate) => tokenMatches(token, candidate));
    if (!hit) return false;
    if (token.length > 1 && hit.length > 1) full += 1;
  }
  return full >= 2;
}

/**
 * Which verified name a bank account is in: the company's CAC name (KYB)
 * or the owner's KYC name. Null for a third-party account.
 */
export function beneficiaryNameMatch(
  accountName: string,
  ownerName: string,
  companyName: string | null,
  companyMatches: (profileName: string, registryName: string) => boolean,
): "OWNER" | "COMPANY" | null {
  if (companyName && companyMatches(companyName, accountName)) return "COMPANY";
  if (ownerName && (namesMatch(accountName, ownerName) || namesMatch(ownerName, accountName))) return "OWNER";
  return null;
}

/** Nigerian mobile numbers as +234…, or null when the shape is wrong. */
export function normalizeNgPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  let national = digits;
  if (digits.startsWith("234") && digits.length === 13) national = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 11) national = digits.slice(1);
  else if (digits.length === 10) national = digits;
  else return null;
  if (!/^[789]\d{9}$/.test(national)) return null;
  return `+234${national}`;
}

function parseDob(value: string) {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${month}-${day}`;
  }
  const months: Record<string, string> = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10",
    october: "10", nov: "11", november: "11", dec: "12", december: "12",
  };
  const named = /^(\d{1,2})[-/\s]+([A-Za-z]+)[-/\s]+(\d{4})$/.exec(trimmed);
  if (named) {
    const month = months[named[2].toLowerCase()];
    if (!month) return null;
    return `${named[3]}-${month}-${named[1].padStart(2, "0")}`;
  }
  return null;
}

export function dobMatches(typed: string, record: string) {
  const a = parseDob(typed);
  const b = parseDob(record);
  return Boolean(a && b && a === b);
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const left = normalizeNgPhone(a);
  const right = normalizeNgPhone(b);
  return Boolean(left && right && left === right);
}

export function legalName(first: string | null, middle: string | null, last: string | null) {
  return [first, middle, last].filter((part) => part && part.trim()).join(" ");
}

/**
 * CAC affiliates who can speak for the business. Lawyers and company
 * secretaries are listed too, but they don't own or run it. An unknown
 * role still counts, since some CAC records leave it blank.
 */
export function canActForCompany(role: string | null) {
  if (!role) return true;
  return /director|proprietor|owner|partner|trustee|significant|psc|shareholder|chairman|member/i.test(role);
}
