/**
 * Webhook rules: which events exist, how often a failed delivery is retried.
 * Pure, so the tests exercise exactly what the server runs.
 */

/** Events an endpoint can subscribe to. `ping` is only sent by "Send test event". */
export const WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.payment_received",
  "checkout.session.expired",
  "refund.succeeded",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export type SentEventType = WebhookEventType | "ping";

export const MAX_WEBHOOK_ENDPOINTS = 3;

/**
 * Wait after each failed attempt: 1m, 5m, 30m, 2h, 6h, 12h, 24h, 48h. Nine
 * attempts in all over about four days (92h 36m), then the delivery fails.
 */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  24 * 3_600_000,
  48 * 3_600_000,
];

export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Per-attempt timeout; a slower endpoint counts as failed. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** How long a claimed delivery stays locked against other instances. */
export const DELIVERY_LOCK_MS = 30_000;

/**
 * The wait before the next attempt, given how many attempts have now failed,
 * or null when that was the last one.
 */
export function nextRetryDelayMs(failedAttempts: number) {
  if (!Number.isInteger(failedAttempts) || failedAttempts < 1) return RETRY_DELAYS_MS[0];
  if (failedAttempts >= MAX_DELIVERY_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[failedAttempts - 1];
}

export function isDeliverySuccess(statusCode: number | null) {
  return statusCode !== null && statusCode >= 200 && statusCode < 300;
}

/** The subscribed events, deduplicated in a stable order; throws on unknown names. */
export function readEventTypes(value: unknown): WebhookEventType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Choose at least one event to send to this endpoint.");
  }
  const chosen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(item)) {
      throw new Error(`Unknown event type: ${String(item)}.`);
    }
    chosen.add(item);
  }
  return WEBHOOK_EVENT_TYPES.filter((type) => chosen.has(type));
}

/** A short, single-line note of why an attempt failed, for the delivery log. */
export function describeFailure(input: { statusCode: number | null; error?: string | null; body?: string | null }) {
  const clip = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (input.statusCode !== null) {
    const snippet = input.body ? clip(input.body) : "";
    return snippet ? `HTTP ${input.statusCode}: ${snippet}` : `HTTP ${input.statusCode}`;
  }
  return clip(input.error || "No response");
}
