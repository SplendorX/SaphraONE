// Server-only. Records merchant webhook events and queues their deliveries.
// The event row is written before anything is sent, so a crash or a slow
// endpoint never loses an event: the retries pick it up.
import { after } from "next/server";

import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { newEventId } from "@/lib/merchant-api/ids";
import { deploymentMode } from "@/lib/merchant-api/keys";
import { consumeRateLimit } from "@/lib/rate-limit";
import { deliverDue } from "@/lib/webhooks/deliver";
import type { SentEventType } from "@/lib/webhooks/rules";
import type { WebhookEndpointRecord, WebhookEventRecord, WebhookPayload } from "@/lib/webhooks/types";

/**
 * Runs `task` once the response is sent (Next's after()), or straight away
 * outside a request, e.g. in a script.
 */
export function runAfterResponse(task: () => Promise<unknown>) {
  const run = () => task().catch((error) => console.warn("[webhooks] background task failed", error));
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * Records one event and a PENDING delivery for each enabled endpoint that
 * subscribes to it (or only `endpointId`, for a test ping). Returns null when
 * an event with this dedupe key already exists, so callers can emit freely.
 */
export async function emitMerchantEvent(input: {
  wallet: string;
  type: SentEventType;
  dedupeKey: string;
  data: Record<string, unknown>;
  endpointId?: string;
  /** False when the caller sends it itself (Send test event). */
  deliver?: boolean;
}) {
  const wallet = input.wallet.toLowerCase();
  const publicId = newEventId();
  const payload: WebhookPayload = {
    created: Math.floor(Date.now() / 1000),
    data: input.data,
    id: publicId,
    livemode: deploymentMode() === "live",
    type: input.type,
  };

  let endpointQuery = accountDb()
    .from(accountTables.webhookEndpoints)
    .select("id, events")
    .eq("wallet_address", wallet)
    .is("disabled_at", null);
  if (input.endpointId) endpointQuery = endpointQuery.eq("id", input.endpointId);
  const endpoints = await endpointQuery;
  if (endpoints.error) {
    throw new Error(readAccountDbError(endpoints.error, "Could not load webhook endpoints."));
  }
  const targets = ((endpoints.data ?? []) as Pick<WebhookEndpointRecord, "id" | "events">[]).filter(
    (endpoint) => input.endpointId || (endpoint.events as string[]).includes(input.type),
  );

  const inserted = await accountDb()
    .from(accountTables.webhookEvents)
    .insert({
      dedupe_key: input.dedupeKey,
      payload,
      public_id: publicId,
      type: input.type,
      wallet_address: wallet,
    })
    .select("*")
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") return null;
    throw new Error(readAccountDbError(inserted.error, "Could not record the webhook event."));
  }
  const event = inserted.data as WebhookEventRecord;
  if (targets.length === 0) return event;

  // Due a moment ago by this server's clock, so the first send never waits on
  // clock skew with the database.
  const dueAt = new Date(Date.now() - 1_000).toISOString();
  const deliveries = await accountDb()
    .from(accountTables.webhookDeliveries)
    .upsert(
      targets.map((endpoint) => ({
        endpoint_id: endpoint.id,
        event_id: event.id,
        next_attempt_at: dueAt,
        wallet_address: wallet,
      })),
      { ignoreDuplicates: true, onConflict: "event_id,endpoint_id" },
    );
  if (deliveries.error) {
    throw new Error(readAccountDbError(deliveries.error, "Could not queue the webhook deliveries."));
  }
  if (input.deliver !== false) runAfterResponse(() => deliverDue({ budgetMs: 20_000, eventId: event.id }));
  return event;
}

/**
 * Sends a merchant's due retries after the response, at most once every 30s
 * per merchant. Called on their API calls and hosted-page polls, so retries
 * keep moving between cron runs.
 */
export function driveMerchantDeliveries(wallet: string) {
  const key = wallet.toLowerCase();
  runAfterResponse(async () => {
    if (!(await consumeRateLimit(`webhook-drive:${key}`, 1, 30))) return;
    await deliverDue({ budgetMs: 10_000, limit: 10, wallet: key });
  });
}
