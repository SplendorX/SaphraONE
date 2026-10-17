import type { SentEventType, WebhookEventType } from "@/lib/webhooks/rules";

export type WebhookEndpointRecord = {
  id: string;
  wallet_address: string;
  url: string;
  secret_encrypted: string;
  events: WebhookEventType[];
  disabled_at: string | null;
  failing_since: string | null;
  created_at: string;
  updated_at: string;
};

/** What the dashboard sees of an endpoint: never the secret. */
export type WebhookEndpointView = Omit<WebhookEndpointRecord, "secret_encrypted" | "wallet_address">;

export type WebhookPayload = {
  id: string;
  type: SentEventType;
  /** Seconds since the epoch. */
  created: number;
  livemode: boolean;
  data: Record<string, unknown>;
};

export type WebhookEventRecord = {
  id: string;
  public_id: string;
  wallet_address: string;
  type: SentEventType;
  dedupe_key: string;
  payload: WebhookPayload;
  created_at: string;
};

export type WebhookDeliveryStatus = "PENDING" | "SUCCEEDED" | "FAILED";

export type WebhookDeliveryRecord = {
  id: string;
  event_id: string;
  endpoint_id: string;
  wallet_address: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  next_attempt_at: string;
  locked_until: string | null;
  last_status_code: number | null;
  last_error: string | null;
  last_attempt_at: string | null;
  succeeded_at: string | null;
  created_at: string;
};

/** A delivery as the log shows it. */
export type WebhookDeliveryView = Omit<WebhookDeliveryRecord, "locked_until" | "wallet_address"> & {
  event: { id: string; type: SentEventType; created_at: string } | null;
  endpoint_url: string | null;
};
