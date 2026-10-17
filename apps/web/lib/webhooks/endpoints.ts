// Server-only. A business's webhook endpoints, as the Developers page manages
// them. Signing secrets are encrypted at rest (MERCHANT_WEBHOOK_KEY) and only
// leave the server when the owner asks to reveal or rotate one.
import crypto from "node:crypto";

import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { accountErrors } from "@/lib/account/errors";
import { decryptSecret, encryptSecret, secretBoxAvailable } from "@/lib/security/secret-box";
import { deliverDue, redeliver } from "@/lib/webhooks/deliver";
import { emitMerchantEvent } from "@/lib/webhooks/events";
import { MAX_WEBHOOK_ENDPOINTS, readEventTypes } from "@/lib/webhooks/rules";
import { assertPublicHost, checkWebhookUrl } from "@/lib/webhooks/ssrf";
import { generateWebhookSecret } from "@/lib/webhooks/standard-webhooks";
import type {
  WebhookDeliveryRecord,
  WebhookDeliveryView,
  WebhookEndpointRecord,
  WebhookEndpointView,
  WebhookEventRecord,
} from "@/lib/webhooks/types";

const MAX_LOGGED_DELIVERIES = 50;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nowIso() {
  return new Date().toISOString();
}

function view(record: WebhookEndpointRecord): WebhookEndpointView {
  return {
    created_at: record.created_at,
    disabled_at: record.disabled_at,
    events: record.events,
    failing_since: record.failing_since,
    id: record.id,
    updated_at: record.updated_at,
    url: record.url,
  };
}

function requireSecretBox() {
  if (!secretBoxAvailable("MERCHANT_WEBHOOK_KEY")) {
    throw accountErrors.invalid(
      "Webhooks aren't switched on for this deployment yet (MERCHANT_WEBHOOK_KEY is not set).",
    );
  }
}

/** The URL as saved: https, public, and resolving only to public addresses. */
async function readEndpointUrl(value: unknown) {
  const checked = checkWebhookUrl(value);
  if (!checked.ok) throw accountErrors.invalid(checked.message);
  try {
    await assertPublicHost(new URL(checked.url).hostname);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw accountErrors.invalid(
      code === "ENOTFOUND" || code === "EAI_AGAIN"
        ? "That host name doesn't resolve. Check the URL."
        : "The URL must point to a public address.",
    );
  }
  return checked.url;
}

function readEvents(value: unknown) {
  try {
    return readEventTypes(value);
  } catch (error) {
    throw accountErrors.invalid(error instanceof Error ? error.message : "Choose the events to send.");
  }
}

async function loadOwnedEndpoint(wallet: string, id: string) {
  if (!uuidPattern.test(id)) throw accountErrors.notFound("Webhook endpoint");
  const { data, error } = await accountDb()
    .from(accountTables.webhookEndpoints)
    .select("*")
    .eq("id", id)
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the webhook endpoint."));
  if (!data) throw accountErrors.notFound("Webhook endpoint");
  return data as WebhookEndpointRecord;
}

export async function listEndpoints(wallet: string) {
  const { data, error } = await accountDb()
    .from(accountTables.webhookEndpoints)
    .select("*")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: true });
  if (error) throw new Error(readAccountDbError(error, "Could not load webhook endpoints."));
  return ((data ?? []) as WebhookEndpointRecord[]).map(view);
}

/** The response carries the signing secret; the dashboard can reveal it again later. */
export async function createEndpoint(input: { wallet: string; url: unknown; events: unknown }) {
  requireSecretBox();
  const url = await readEndpointUrl(input.url);
  const events = readEvents(input.events);

  const existing = await accountDb()
    .from(accountTables.webhookEndpoints)
    .select("id", { count: "exact", head: true })
    .eq("wallet_address", input.wallet);
  if (existing.error) throw new Error(readAccountDbError(existing.error, "Could not check your endpoints."));
  if ((existing.count ?? 0) >= MAX_WEBHOOK_ENDPOINTS) {
    throw accountErrors.invalid(`You can have ${MAX_WEBHOOK_ENDPOINTS} webhook endpoints. Delete one first.`);
  }

  const secret = generateWebhookSecret();
  const { data, error } = await accountDb()
    .from(accountTables.webhookEndpoints)
    .insert({
      events,
      secret_encrypted: encryptSecret(secret, "MERCHANT_WEBHOOK_KEY"),
      url,
      wallet_address: input.wallet,
    })
    .select("*")
    .single();
  if (error) throw new Error(readAccountDbError(error, "Could not add the webhook endpoint."));
  return { endpoint: view(data as WebhookEndpointRecord), secret };
}

export async function updateEndpoint(input: {
  wallet: string;
  id: string;
  url?: unknown;
  events?: unknown;
  disabled?: unknown;
}) {
  const current = await loadOwnedEndpoint(input.wallet, input.id);
  const changes: Record<string, unknown> = { updated_at: nowIso() };
  if (input.url !== undefined) changes.url = await readEndpointUrl(input.url);
  if (input.events !== undefined) changes.events = readEvents(input.events);
  if (input.disabled !== undefined) {
    if (typeof input.disabled !== "boolean") throw accountErrors.invalid("disabled must be true or false.");
    changes.disabled_at = input.disabled ? (current.disabled_at ?? nowIso()) : null;
    // Turning an endpoint back on gives it a clean slate.
    if (!input.disabled) changes.failing_since = null;
  }
  const { data, error } = await accountDb()
    .from(accountTables.webhookEndpoints)
    .update(changes)
    .eq("id", current.id)
    .eq("wallet_address", input.wallet)
    .select("*")
    .single();
  if (error) throw new Error(readAccountDbError(error, "Could not update the webhook endpoint."));
  return view(data as WebhookEndpointRecord);
}

/** Deletes the endpoint and (by cascade) its delivery log. */
export async function deleteEndpoint(input: { wallet: string; id: string }) {
  const current = await loadOwnedEndpoint(input.wallet, input.id);
  const { error } = await accountDb()
    .from(accountTables.webhookEndpoints)
    .delete()
    .eq("id", current.id)
    .eq("wallet_address", input.wallet);
  if (error) throw new Error(readAccountDbError(error, "Could not delete the webhook endpoint."));
  return { deleted: true, id: current.id };
}

export async function revealSecret(input: { wallet: string; id: string }) {
  requireSecretBox();
  const current = await loadOwnedEndpoint(input.wallet, input.id);
  return { secret: decryptSecret(current.secret_encrypted, "MERCHANT_WEBHOOK_KEY") };
}

/** A new secret takes effect at once; the old one stops verifying. */
export async function rotateSecret(input: { wallet: string; id: string }) {
  requireSecretBox();
  const current = await loadOwnedEndpoint(input.wallet, input.id);
  const secret = generateWebhookSecret();
  const { error } = await accountDb()
    .from(accountTables.webhookEndpoints)
    .update({ secret_encrypted: encryptSecret(secret, "MERCHANT_WEBHOOK_KEY"), updated_at: nowIso() })
    .eq("id", current.id)
    .eq("wallet_address", input.wallet);
  if (error) throw new Error(readAccountDbError(error, "Could not rotate the signing secret."));
  return { secret };
}

async function deliveryViews(rows: WebhookDeliveryRecord[]): Promise<WebhookDeliveryView[]> {
  if (rows.length === 0) return [];
  const eventIds = [...new Set(rows.map((row) => row.event_id))];
  const endpointIds = [...new Set(rows.map((row) => row.endpoint_id))];
  const [events, endpoints] = await Promise.all([
    accountDb().from(accountTables.webhookEvents).select("id, public_id, type, created_at").in("id", eventIds),
    accountDb().from(accountTables.webhookEndpoints).select("id, url").in("id", endpointIds),
  ]);
  if (events.error) throw new Error(readAccountDbError(events.error, "Could not load webhook events."));
  if (endpoints.error) throw new Error(readAccountDbError(endpoints.error, "Could not load webhook endpoints."));
  const eventById = new Map(
    ((events.data ?? []) as Pick<WebhookEventRecord, "id" | "public_id" | "type" | "created_at">[]).map((row) => [
      row.id,
      row,
    ]),
  );
  const urlById = new Map(((endpoints.data ?? []) as Array<{ id: string; url: string }>).map((row) => [row.id, row.url]));
  return rows.map((row) => {
    const event = eventById.get(row.event_id);
    return {
      attempts: row.attempts,
      created_at: row.created_at,
      endpoint_id: row.endpoint_id,
      endpoint_url: urlById.get(row.endpoint_id) ?? null,
      event: event ? { created_at: event.created_at, id: event.public_id, type: event.type } : null,
      event_id: row.event_id,
      id: row.id,
      last_attempt_at: row.last_attempt_at,
      last_error: row.last_error,
      last_status_code: row.last_status_code,
      next_attempt_at: row.next_attempt_at,
      status: row.status,
      succeeded_at: row.succeeded_at,
    };
  });
}

/** The newest deliveries, for the log: all endpoints, or one. */
export async function listDeliveries(input: { wallet: string; endpointId?: string | null }) {
  let query = accountDb()
    .from(accountTables.webhookDeliveries)
    .select("*")
    .eq("wallet_address", input.wallet)
    .order("created_at", { ascending: false })
    .limit(MAX_LOGGED_DELIVERIES);
  if (input.endpointId) {
    if (!uuidPattern.test(input.endpointId)) throw accountErrors.notFound("Webhook endpoint");
    query = query.eq("endpoint_id", input.endpointId);
  }
  const { data, error } = await query;
  if (error) throw new Error(readAccountDbError(error, "Could not load webhook deliveries."));
  return deliveryViews((data ?? []) as WebhookDeliveryRecord[]);
}

/** Sends a `ping` to one endpoint now and returns how it went. */
export async function sendTestEvent(input: { wallet: string; id: string }) {
  requireSecretBox();
  const endpoint = await loadOwnedEndpoint(input.wallet, input.id);
  if (endpoint.disabled_at) throw accountErrors.invalid("Turn the endpoint on before sending a test event.");
  const event = await emitMerchantEvent({
    data: { message: "A test event from SaphraONE. Your endpoint is receiving webhooks." },
    dedupeKey: `ping:${crypto.randomUUID()}`,
    deliver: false,
    endpointId: endpoint.id,
    type: "ping",
    wallet: input.wallet,
  });
  if (!event) throw new Error("Could not create the test event.");
  await deliverDue({ budgetMs: 15_000, eventId: event.id });
  const { data, error } = await accountDb()
    .from(accountTables.webhookDeliveries)
    .select("*")
    .eq("event_id", event.id)
    .eq("endpoint_id", endpoint.id)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the test delivery."));
  const [delivery] = await deliveryViews(data ? [data as WebhookDeliveryRecord] : []);
  return { delivery: delivery ?? null };
}

export async function resendDelivery(input: { wallet: string; deliveryId: string }) {
  if (!uuidPattern.test(input.deliveryId)) throw accountErrors.notFound("Webhook delivery");
  const { data, error } = await accountDb()
    .from(accountTables.webhookDeliveries)
    .select("*")
    .eq("id", input.deliveryId)
    .eq("wallet_address", input.wallet)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the webhook delivery."));
  if (!data) throw accountErrors.notFound("Webhook delivery");
  const result = await redeliver(data as WebhookDeliveryRecord);
  if (!result) throw accountErrors.conflict("This delivery is being sent right now. Try again in a moment.");
  const [delivery] = await deliveryViews([result]);
  return { delivery };
}
