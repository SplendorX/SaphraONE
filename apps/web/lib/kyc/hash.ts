import { createHmac } from "node:crypto";

function secret() {
  const value = process.env.KYC_HASH_SECRET?.trim();
  if (!value || value.length < 32) return null;
  return value;
}

/** HMAC-SHA256 of `TYPE:number`. Null when the hash secret isn't set. */
export function hashId(type: string, number: string): string | null {
  const key = secret();
  if (!key) return null;
  const normalized = `${type.toUpperCase()}:${number.replace(/\s/g, "")}`;
  return createHmac("sha256", key).update(normalized).digest("hex");
}

export function last4(number: string) {
  const digits = number.replace(/\D/g, "");
  return digits.slice(-4);
}

export function hashSecretConfigured() {
  return Boolean(secret());
}
