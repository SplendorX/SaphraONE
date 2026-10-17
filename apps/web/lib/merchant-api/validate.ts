/**
 * Input rules for the Checkout API. Pure, so the tests exercise exactly what
 * the server runs. Each reader returns the clean value or throws an
 * ApiParamError naming the field, which the routes turn into a 400.
 */
import type { ApiMode } from "@/lib/merchant-api/ids";
import type { CheckoutLineItem } from "@/lib/checkout/types";

export class ApiParamError extends Error {
  readonly param: string;
  constructor(param: string, message: string) {
    super(message);
    this.name = "ApiParamError";
    this.param = param;
  }
}

export const SESSION_ID_TEMPLATE = "{CHECKOUT_SESSION_ID}";
export const MAX_URL_LENGTH = 2048;
export const MAX_METADATA_KEYS = 20;
export const MAX_METADATA_KEY_LENGTH = 40;
export const MAX_METADATA_VALUE_LENGTH = 500;
export const MAX_LINE_ITEMS = 20;
export const MIN_EXPIRES_MINUTES = 30;
export const MAX_EXPIRES_MINUTES = 24 * 60;
export const DEFAULT_EXPIRES_MINUTES = 60;

const amountPattern = /^\d+(\.\d{1,6})?$/;

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * A redirect URL for after payment. https only; plain http is accepted for
 * localhost with a test key so a developer can try it on their machine. The
 * session id template is the only placeholder.
 */
export function readRedirectUrl(
  value: unknown,
  options: { param: string; mode: ApiMode; required: boolean },
) {
  if (value === undefined || value === null || value === "") {
    if (options.required) throw new ApiParamError(options.param, `${options.param} is required.`);
    return null;
  }
  if (typeof value !== "string") {
    throw new ApiParamError(options.param, `${options.param} must be a string.`);
  }
  const raw = value.trim();
  if (raw.length > MAX_URL_LENGTH) {
    throw new ApiParamError(options.param, `${options.param} is longer than ${MAX_URL_LENGTH} characters.`);
  }
  let url: URL;
  try {
    // The template isn't valid in every URL position; check a filled-in copy.
    url = new URL(raw.split(SESSION_ID_TEMPLATE).join("cs_test_000000000000000000000000"));
  } catch {
    throw new ApiParamError(options.param, `${options.param} must be a full URL.`);
  }
  if (url.username || url.password) {
    throw new ApiParamError(options.param, `${options.param} must not contain a username or password.`);
  }
  const local = isLocalHost(url.hostname);
  if (url.protocol === "https:") return raw;
  if (url.protocol === "http:" && local && options.mode === "test") return raw;
  throw new ApiParamError(
    options.param,
    options.mode === "test"
      ? `${options.param} must use https (http is allowed only for localhost).`
      : `${options.param} must use https.`,
  );
}

/** The success URL with the session id filled in. */
export function fillSessionTemplate(url: string, sessionId: string) {
  return url.split(SESSION_ID_TEMPLATE).join(encodeURIComponent(sessionId));
}

/** The store's host name, shown on the hosted page ("Return to shop.example"). */
export function siteHostOf(url: string) {
  try {
    return new URL(url.split(SESSION_ID_TEMPLATE).join("x")).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function readAmount(value: unknown, param = "amount") {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!amountPattern.test(raw)) {
    throw new ApiParamError(param, `${param} must be a decimal string such as "25.00".`);
  }
  return raw;
}

export function readCurrency(value: unknown) {
  if (value === undefined || value === null || value === "") return "USDC" as const;
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (currency === "USDC" || currency === "EURC") return currency;
  throw new ApiParamError("currency", "currency must be USDC or EURC.");
}

function optionalText(value: unknown, param: string, max: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiParamError(param, `${param} must be a string.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > max) throw new ApiParamError(param, `${param} is longer than ${max} characters.`);
  return text || null;
}

export function readDescription(value: unknown) {
  return optionalText(value, "description", 140);
}

export function readClientReference(value: unknown) {
  return optionalText(value, "client_reference_id", 200);
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readEmail(value: unknown) {
  const email = optionalText(value, "customer_email", 254);
  if (email === null) return null;
  if (!emailPattern.test(email)) {
    throw new ApiParamError("customer_email", "customer_email is not a valid email address.");
  }
  return email.toLowerCase();
}

export function readExpiresInMinutes(value: unknown) {
  if (value === undefined || value === null || value === "") return DEFAULT_EXPIRES_MINUTES;
  const minutes = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_EXPIRES_MINUTES ||
    minutes > MAX_EXPIRES_MINUTES
  ) {
    throw new ApiParamError(
      "expires_in_minutes",
      `expires_in_minutes must be a whole number from ${MIN_EXPIRES_MINUTES} to ${MAX_EXPIRES_MINUTES}.`,
    );
  }
  return minutes;
}

/** Up to 20 string keys and values, kept for the merchant and never shown to the buyer. */
export function readMetadata(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiParamError("metadata", "metadata must be an object of strings.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_METADATA_KEYS) {
    throw new ApiParamError("metadata", `metadata can have at most ${MAX_METADATA_KEYS} keys.`);
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!key || key.length > MAX_METADATA_KEY_LENGTH) {
      throw new ApiParamError(
        `metadata[${key}]`,
        `metadata keys must be 1 to ${MAX_METADATA_KEY_LENGTH} characters.`,
      );
    }
    const text = typeof raw === "number" || typeof raw === "boolean" ? String(raw) : raw;
    if (typeof text !== "string") {
      throw new ApiParamError(`metadata[${key}]`, "metadata values must be strings.");
    }
    if (text.length > MAX_METADATA_VALUE_LENGTH) {
      throw new ApiParamError(
        `metadata[${key}]`,
        `metadata values must be at most ${MAX_METADATA_VALUE_LENGTH} characters.`,
      );
    }
    out[key] = text;
  }
  return out;
}

function toMicros(amount: string) {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

/**
 * Line items are shown to the buyer only; the amount is what gets charged. So
 * they must add up to it exactly (compared in millionths, no float).
 */
export function readLineItems(value: unknown, amount: string): CheckoutLineItem[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ApiParamError("line_items", "line_items must be an array.");
  if (value.length > MAX_LINE_ITEMS) {
    throw new ApiParamError("line_items", `line_items can have at most ${MAX_LINE_ITEMS} entries.`);
  }
  let total = 0n;
  const items = value.map((raw, index) => {
    const param = `line_items[${index}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ApiParamError(param, `${param} must be an object.`);
    }
    const item = raw as Record<string, unknown>;
    const name = optionalText(item.name, `${param}.name`, 120);
    if (!name) throw new ApiParamError(`${param}.name`, `${param}.name is required.`);
    const quantity = item.quantity === undefined ? 1 : Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
      throw new ApiParamError(`${param}.quantity`, `${param}.quantity must be a whole number from 1 to 10000.`);
    }
    const unitAmount = readAmount(item.unit_amount, `${param}.unit_amount`);
    total += toMicros(unitAmount) * BigInt(quantity);
    return { name, quantity, unit_amount: unitAmount };
  });
  if (items.length > 0 && total !== toMicros(amount)) {
    throw new ApiParamError("line_items", "line_items must add up to amount.");
  }
  return items;
}
