// Browser fetchers for the Developers page (API keys and webhooks).
import type { MerchantAuth } from "@/lib/checkout/client";
import type { ApiMode } from "@/lib/merchant-api/ids";
import type { WebhookEventType } from "@/lib/webhooks/rules";
import type { WebhookDeliveryView, WebhookEndpointView } from "@/lib/webhooks/types";

export type { WebhookDeliveryView, WebhookEndpointView, WebhookEventType };

export type ApiKeyView = {
  id: string;
  mode: ApiMode;
  name: string;
  key_prefix: string;
  created_by_wallet: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { cache: "no-store", ...init });
  } catch {
    throw new Error("Could not reach SaphraONE. Refresh and try again.");
  }
  const text = await response.text();
  let payload: T & { message?: string };
  try {
    payload = JSON.parse(text) as T & { message?: string };
  } catch {
    throw new Error(`Invalid JSON (${response.status}).`);
  }
  if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status}).`);
  return payload;
}

function withAuth(path: string, auth: MerchantAuth) {
  const params = new URLSearchParams({ ownerWallet: auth.ownerWallet });
  if (auth.circleSocialUuid) params.set("circleSocialUuid", auth.circleSocialUuid);
  return `${path}?${params.toString()}`;
}

function postJson<T>(path: string, body: unknown) {
  return requestJson<T>(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export function fetchApiKeys(auth: MerchantAuth) {
  return requestJson<{ keys: ApiKeyView[]; mode: ApiMode }>(
    withAuth("/api/business/developers/keys", auth),
  );
}

/** The response carries the full key; show it once and drop it. */
export function createApiKeyClient(auth: MerchantAuth, name: string) {
  return postJson<{ key: string; record: ApiKeyView }>("/api/business/developers/keys", {
    ...auth,
    name,
  });
}

export function revokeApiKeyClient(auth: MerchantAuth, keyId: string) {
  return postJson<{ key: ApiKeyView }>(
    `/api/business/developers/keys/${encodeURIComponent(keyId)}/revoke`,
    auth,
  );
}

// ── Webhooks ────────────────────────────────────────────────────────────────

function sendJson<T>(path: string, method: "PATCH" | "DELETE", body: unknown) {
  return requestJson<T>(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
}

function endpointPath(endpointId: string, action?: string) {
  return `/api/business/developers/webhooks/${encodeURIComponent(endpointId)}${action ? `/${action}` : ""}`;
}

export function fetchWebhookEndpoints(auth: MerchantAuth) {
  return requestJson<{
    endpoints: WebhookEndpointView[];
    eventTypes: WebhookEventType[];
    maxEndpoints: number;
  }>(withAuth("/api/business/developers/webhooks", auth));
}

/** The response carries the signing secret. */
export function createWebhookEndpointClient(auth: MerchantAuth, input: { url: string; events: WebhookEventType[] }) {
  return postJson<{ endpoint: WebhookEndpointView; secret: string }>("/api/business/developers/webhooks", {
    ...auth,
    ...input,
  });
}

export function updateWebhookEndpointClient(
  auth: MerchantAuth,
  endpointId: string,
  changes: { url?: string; events?: WebhookEventType[]; disabled?: boolean },
) {
  return sendJson<{ endpoint: WebhookEndpointView }>(endpointPath(endpointId), "PATCH", { ...auth, ...changes });
}

export function deleteWebhookEndpointClient(auth: MerchantAuth, endpointId: string) {
  return sendJson<{ deleted: boolean }>(endpointPath(endpointId), "DELETE", auth);
}

export function revealWebhookSecretClient(auth: MerchantAuth, endpointId: string) {
  return postJson<{ secret: string }>(endpointPath(endpointId, "secret"), auth);
}

export function rotateWebhookSecretClient(auth: MerchantAuth, endpointId: string) {
  return postJson<{ secret: string }>(endpointPath(endpointId, "rotate"), auth);
}

export function sendWebhookTestClient(auth: MerchantAuth, endpointId: string) {
  return postJson<{ delivery: WebhookDeliveryView | null }>(endpointPath(endpointId, "test"), auth);
}

export function fetchWebhookDeliveries(auth: MerchantAuth) {
  return requestJson<{ deliveries: WebhookDeliveryView[] }>(withAuth("/api/business/developers/deliveries", auth));
}

export function resendWebhookDeliveryClient(auth: MerchantAuth, deliveryId: string) {
  return postJson<{ delivery: WebhookDeliveryView }>(
    `/api/business/developers/deliveries/${encodeURIComponent(deliveryId)}/resend`,
    auth,
  );
}
