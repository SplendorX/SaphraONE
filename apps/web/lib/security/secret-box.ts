// Server-only. AES-256-GCM for secrets kept at rest (2FA seeds, webhook
// signing secrets). Each use names its own key, so rotating one never makes
// another unreadable.
import crypto from "node:crypto";

export type SecretBoxKeyName = "SAPHRA_MFA_KEY" | "MERCHANT_WEBHOOK_KEY";

/** 32 bytes as 64 hex characters or base64, or null when unset or malformed. */
export function secretBoxKey(name: SecretBoxKeyName) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function secretBoxAvailable(name: SecretBoxKeyName) {
  return secretBoxKey(name) !== null;
}

export function encryptSecret(secret: string, name: SecretBoxKeyName) {
  const key = secretBoxKey(name);
  if (!key) throw new Error(`${name} is not set.`);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(value: string, name: SecretBoxKeyName) {
  const key = secretBoxKey(name);
  if (!key) throw new Error(`${name} is not set.`);
  const [version, iv, body] = value.split(".");
  if (version !== "v1" || !iv || !body) throw new Error("Unreadable secret.");
  const data = Buffer.from(body, "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString(
    "utf8",
  );
}
