/**
 * Svix webhook signatures, as Centiiv sends them. Pure apart from node:crypto.
 *
 *   signed content: `${svix-id}.${svix-timestamp}.${rawBody}`
 *   key:            base64-decoded secret after "whsec_"
 *   svix-signature: space-separated "v1,<base64 HMAC-SHA256>" entries
 */
import crypto from "node:crypto";

/** Reject a delivery whose timestamp is further than this from now. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

type HeaderSource = Headers | Record<string, string | null | undefined>;

function header(headers: HeaderSource, name: string) {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name)?.trim() || null;
  }
  const record = headers as Record<string, string | null | undefined>;
  return (record[name] ?? record[name.toLowerCase()])?.trim() || null;
}

function secretKey(secret: string) {
  const encoded = secret.trim().replace(/^whsec_/, "");
  const key = Buffer.from(encoded, "base64");
  return key.length > 0 ? key : null;
}

export type SignatureCheck = { ok: true; eventId: string | null } | { ok: false; reason: string };

export function verifySvixSignature(input: {
  rawBody: string;
  headers: HeaderSource;
  secret: string | null | undefined;
  /** Seconds since the epoch. */
  now?: number;
  /** Local `next dev` with no secret set may post unsigned test events. */
  development?: boolean;
}): SignatureCheck {
  const id = header(input.headers, "svix-id");
  const timestamp = header(input.headers, "svix-timestamp");
  const signatures = header(input.headers, "svix-signature");
  const secret = input.secret?.trim();

  if (!secret) {
    const development = input.development ?? process.env.NODE_ENV === "development";
    return development ? { ok: true, eventId: id } : { ok: false, reason: "No webhook secret is set." };
  }
  if (!id || !timestamp || !signatures) return { ok: false, reason: "Missing signature headers." };

  const sentAt = Number(timestamp);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "Timestamp outside tolerance." };
  }

  const key = secretKey(secret);
  if (!key) return { ok: false, reason: "Webhook secret is not valid base64." };
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${input.rawBody}`)
    .digest();

  for (const entry of signatures.split(" ")) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    const presented = Buffer.from(value, "base64");
    if (presented.length === expected.length && crypto.timingSafeEqual(presented, expected)) {
      return { ok: true, eventId: id };
    }
  }
  return { ok: false, reason: "No signature matched." };
}
