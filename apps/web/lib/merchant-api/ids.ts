/**
 * Public ids and secret keys for the Checkout API. Pure (Web Crypto only), so
 * the tests exercise exactly what the server runs.
 *
 *   sessions  cs_live_<24>   refunds  re_live_<24>   events  evt_<24>
 *   keys      sk_live_<43 base62>  (sk_test_… on the testnet deployment)
 */

export type ApiMode = "live" | "test";

const BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const PUBLIC_ID_LENGTH = 24;
export const API_KEY_SECRET_LENGTH = 43;

function randomBytes(count: number) {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** 24 base32 characters: 120 random bits. */
export function randomPublicSuffix(bytes: Uint8Array = randomBytes(15)) {
  let value = 0n;
  for (const byte of bytes.slice(0, 15)) value = (value << 8n) | BigInt(byte);
  let out = "";
  for (let index = 0; index < PUBLIC_ID_LENGTH; index += 1) {
    out = BASE32[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

export function newSessionId(mode: ApiMode) {
  return `cs_${mode}_${randomPublicSuffix()}`;
}

export function newRefundId(mode: ApiMode) {
  return `re_${mode}_${randomPublicSuffix()}`;
}

export function newEventId() {
  return `evt_${randomPublicSuffix()}`;
}

const sessionIdPattern = /^cs_(live|test)_[0-9a-z]{24}$/;

/** A session id as given in a URL or API path, or null when it can't be one. */
export function readSessionId(value: unknown) {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return sessionIdPattern.test(id) ? id : null;
}

/**
 * A secret key: `sk_<mode>_` + 43 base62 characters (~256 bits). Rejection
 * sampling keeps every character equally likely.
 */
export function generateApiKey(mode: ApiMode) {
  let secret = "";
  while (secret.length < API_KEY_SECRET_LENGTH) {
    for (const byte of randomBytes(64)) {
      if (byte >= 248) continue; // 248 = 62 * 4
      secret += BASE62[byte % 62];
      if (secret.length === API_KEY_SECRET_LENGTH) break;
    }
  }
  return `sk_${mode}_${secret}`;
}

const apiKeyPattern = /^sk_(live|test)_[0-9A-Za-z]{43}$/;

/** The mode a presented key claims, or null when it isn't shaped like a key. */
export function readApiKeyMode(value: string): ApiMode | null {
  const match = apiKeyPattern.exec(value);
  return match ? (match[1] as ApiMode) : null;
}

/** What the dashboard shows of a key: its mode and first characters. */
export function apiKeyPrefix(key: string) {
  return key.slice(0, 12);
}
