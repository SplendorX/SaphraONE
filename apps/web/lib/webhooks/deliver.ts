// Server-only. Sends webhook deliveries and schedules their retries. Every
// attempt is claimed with a guarded update first, so two instances (a request's
// after(), the cron, a Resend) never send the same delivery at once.
import https from "node:https";

import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { createSavingsNotificationResult } from "@/lib/save/notifications";
import { decryptSecret } from "@/lib/security/secret-box";
import {
  DELIVERY_LOCK_MS,
  DELIVERY_TIMEOUT_MS,
  describeFailure,
  isDeliverySuccess,
  nextRetryDelayMs,
} from "@/lib/webhooks/rules";
import { checkWebhookUrl, publicLookup } from "@/lib/webhooks/ssrf";
import { signPayload } from "@/lib/webhooks/standard-webhooks";
import type {
  WebhookDeliveryRecord,
  WebhookEndpointRecord,
  WebhookEventRecord,
} from "@/lib/webhooks/types";

export const WEBHOOK_USER_AGENT = "SaphraONE-Webhooks/1";
const MAX_RESPONSE_BYTES = 2_048;

type SendResult = { statusCode: number | null; body: string | null; error: string | null };

/**
 * One POST. No redirects are followed and the connection only opens to a
 * public address (publicLookup), so an endpoint can't point us inward.
 */
function postWebhook(url: string, body: string, headers: Record<string, string>): Promise<SendResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SendResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let request: ReturnType<typeof https.request>;
    try {
      request = https.request(
        url,
        {
          headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
          lookup: publicLookup as never,
          method: "POST",
          timeout: DELIVERY_TIMEOUT_MS,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            if (size < MAX_RESPONSE_BYTES) chunks.push(chunk);
            size += chunk.length;
          });
          response.on("end", () =>
            finish({
              body: Buffer.concat(chunks).toString("utf8").slice(0, MAX_RESPONSE_BYTES),
              error: null,
              statusCode: response.statusCode ?? null,
            }),
          );
          response.on("error", (error) => finish({ body: null, error: error.message, statusCode: response.statusCode ?? null }));
        },
      );
    } catch (error) {
      finish({ body: null, error: error instanceof Error ? error.message : "Could not send.", statusCode: null });
      return;
    }
    request.on("timeout", () => {
      request.destroy(new Error(`Timed out after ${DELIVERY_TIMEOUT_MS / 1000}s`));
    });
    request.on("error", (error) => finish({ body: null, error: error.message, statusCode: null }));
    request.end(body);
  });
}

function nowIso() {
  return new Date().toISOString();
}

/** Takes the delivery for this instance, or returns false if another has it. */
async function claimDelivery(id: string, options?: { manual?: boolean }) {
  const now = nowIso();
  let query = accountDb()
    .from(accountTables.webhookDeliveries)
    .update({ locked_until: new Date(Date.now() + DELIVERY_LOCK_MS).toISOString() })
    .eq("id", id)
    .or(`locked_until.is.null,locked_until.lt."${now}"`);
  // A Resend may retry a FAILED or not-yet-due delivery; the scheduler may not.
  if (!options?.manual) query = query.eq("status", "PENDING").lte("next_attempt_at", now);
  const { data, error } = await query.select("*");
  if (error) throw new Error(readAccountDbError(error, "Could not claim the webhook delivery."));
  return ((data ?? []) as WebhookDeliveryRecord[])[0] ?? null;
}

async function loadEvents(ids: string[]) {
  const map = new Map<string, WebhookEventRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await accountDb().from(accountTables.webhookEvents).select("*").in("id", ids);
  if (error) throw new Error(readAccountDbError(error, "Could not load webhook events."));
  for (const row of (data ?? []) as WebhookEventRecord[]) map.set(row.id, row);
  return map;
}

async function loadEndpoints(ids: string[]) {
  const map = new Map<string, WebhookEndpointRecord>();
  if (ids.length === 0) return map;
  const { data, error } = await accountDb().from(accountTables.webhookEndpoints).select("*").in("id", ids);
  if (error) throw new Error(readAccountDbError(error, "Could not load webhook endpoints."));
  for (const row of (data ?? []) as WebhookEndpointRecord[]) map.set(row.id, row);
  return map;
}

async function markEndpointFailing(endpoint: WebhookEndpointRecord, eventType: string) {
  const { data, error } = await accountDb()
    .from(accountTables.webhookEndpoints)
    .update({ failing_since: nowIso(), updated_at: nowIso() })
    .eq("id", endpoint.id)
    .is("failing_since", null)
    .select("id");
  if (error) {
    console.warn("[webhooks] could not mark endpoint failing", error.message);
    return;
  }
  // Only the first failure since it last worked notifies the owner.
  if ((data ?? []).length === 0) return;
  let host = endpoint.url;
  try {
    host = new URL(endpoint.url).host;
  } catch {
    // Keep the raw URL.
  }
  void createSavingsNotificationResult({
    body: `A ${eventType} webhook to ${host} failed after every retry. Check the endpoint, then use Resend in Developers.`,
    fallbackKind: "reconciliation_alert",
    kind: "reconciliation_alert",
    metadata: { endpointId: endpoint.id, type: "webhook_endpoint_failing" },
    ownerWallet: endpoint.wallet_address,
    title: "Webhook deliveries are failing",
  });
}

async function clearEndpointFailing(endpoint: WebhookEndpointRecord) {
  if (!endpoint.failing_since) return;
  const { error } = await accountDb()
    .from(accountTables.webhookEndpoints)
    .update({ failing_since: null, updated_at: nowIso() })
    .eq("id", endpoint.id);
  if (error) console.warn("[webhooks] could not clear failing_since", error.message);
}

/** Sends one claimed delivery and records the outcome. Never throws. */
async function attempt(
  delivery: WebhookDeliveryRecord,
  event: WebhookEventRecord | undefined,
  endpoint: WebhookEndpointRecord | undefined,
  options?: { manual?: boolean },
): Promise<WebhookDeliveryRecord> {
  let result: SendResult;
  if (!event) {
    result = { body: null, error: "The event no longer exists.", statusCode: null };
  } else if (!endpoint || endpoint.disabled_at) {
    result = { body: null, error: "The endpoint is disabled.", statusCode: null };
  } else {
    const checked = checkWebhookUrl(endpoint.url);
    if (!checked.ok) {
      result = { body: null, error: checked.message, statusCode: null };
    } else {
      try {
        const secret = decryptSecret(endpoint.secret_encrypted, "MERCHANT_WEBHOOK_KEY");
        const body = JSON.stringify(event.payload);
        const timestamp = Math.floor(Date.now() / 1000);
        result = await postWebhook(checked.url, body, {
          "content-type": "application/json",
          "user-agent": WEBHOOK_USER_AGENT,
          "webhook-id": event.public_id,
          "webhook-signature": signPayload({ body, id: event.public_id, secret, timestamp }),
          "webhook-timestamp": String(timestamp),
        });
      } catch (error) {
        result = { body: null, error: error instanceof Error ? error.message : "Could not send.", statusCode: null };
      }
    }
  }

  const attempts = delivery.attempts + 1;
  const succeeded = isDeliverySuccess(result.statusCode);
  // No endpoint or event left means nothing will ever succeed: stop now.
  const hopeless = !event || !endpoint || Boolean(endpoint.disabled_at);
  const delay = succeeded || hopeless ? null : nextRetryDelayMs(attempts);
  // A Resend that fails leaves a finished delivery as it was; it doesn't
  // restart the retries.
  const keepStatus = options?.manual && delivery.status !== "PENDING";
  const status = succeeded
    ? "SUCCEEDED"
    : keepStatus
      ? delivery.status
      : delay === null
        ? "FAILED"
        : "PENDING";

  const update = {
    attempts,
    last_attempt_at: nowIso(),
    last_error: succeeded ? null : describeFailure(result),
    last_status_code: result.statusCode,
    locked_until: null,
    status,
    ...(succeeded ? { succeeded_at: nowIso() } : {}),
    ...(status === "PENDING" && delay !== null ? { next_attempt_at: new Date(Date.now() + delay).toISOString() } : {}),
  };
  const { data, error } = await accountDb()
    .from(accountTables.webhookDeliveries)
    .update(update)
    .eq("id", delivery.id)
    .select("*");
  if (error) console.error("[webhooks] could not record a delivery attempt", error.message);

  if (endpoint && event) {
    if (succeeded) await clearEndpointFailing(endpoint);
    else if (status === "FAILED" && delivery.status === "PENDING" && !hopeless) {
      await markEndpointFailing(endpoint, event.type);
    }
  }
  return ((data ?? []) as WebhookDeliveryRecord[])[0] ?? { ...delivery, ...update };
}

/**
 * Sends what is due: one event's deliveries, one merchant's, or (the cron)
 * everyone's. Stops starting new sends once `budgetMs` has passed.
 */
export async function deliverDue(options: {
  eventId?: string;
  wallet?: string;
  budgetMs?: number;
  limit?: number;
} = {}) {
  const startedAt = Date.now();
  const budgetMs = options.budgetMs ?? 45_000;
  const now = nowIso();
  let query = accountDb()
    .from(accountTables.webhookDeliveries)
    .select("*")
    .eq("status", "PENDING")
    .lte("next_attempt_at", now)
    .or(`locked_until.is.null,locked_until.lt."${now}"`)
    .order("next_attempt_at", { ascending: true })
    .limit(options.limit ?? 50);
  if (options.eventId) query = query.eq("event_id", options.eventId);
  if (options.wallet) query = query.eq("wallet_address", options.wallet.toLowerCase());
  const { data, error } = await query;
  if (error) throw new Error(readAccountDbError(error, "Could not load due webhook deliveries."));
  const due = (data ?? []) as WebhookDeliveryRecord[];
  if (due.length === 0) return { attempted: 0, failed: 0, succeeded: 0 };

  const [events, endpoints] = await Promise.all([
    loadEvents([...new Set(due.map((row) => row.event_id))]),
    loadEndpoints([...new Set(due.map((row) => row.endpoint_id))]),
  ]);

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  // A few at a time: one slow endpoint shouldn't hold up everyone else's.
  for (let index = 0; index < due.length; index += 5) {
    if (Date.now() - startedAt > budgetMs) break;
    const results = await Promise.all(
      due.slice(index, index + 5).map(async (row) => {
        const claimed = await claimDelivery(row.id).catch(() => null);
        if (!claimed) return null;
        return attempt(claimed, events.get(claimed.event_id), endpoints.get(claimed.endpoint_id));
      }),
    );
    for (const result of results) {
      if (!result) continue;
      attempted += 1;
      if (result.status === "SUCCEEDED") succeeded += 1;
      else failed += 1;
    }
  }
  return { attempted, failed, succeeded };
}

/** "Resend" from the delivery log: one attempt now, whatever its schedule. */
export async function redeliver(delivery: WebhookDeliveryRecord) {
  const claimed = await claimDelivery(delivery.id, { manual: true });
  if (!claimed) return null;
  const [events, endpoints] = await Promise.all([
    loadEvents([claimed.event_id]),
    loadEndpoints([claimed.endpoint_id]),
  ]);
  return attempt(claimed, events.get(claimed.event_id), endpoints.get(claimed.endpoint_id), { manual: true });
}
