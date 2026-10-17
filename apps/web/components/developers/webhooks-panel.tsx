"use client";

import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { MerchantAuth } from "@/lib/checkout/client";
import {
  createWebhookEndpointClient,
  deleteWebhookEndpointClient,
  fetchWebhookDeliveries,
  fetchWebhookEndpoints,
  resendWebhookDeliveryClient,
  revealWebhookSecretClient,
  rotateWebhookSecretClient,
  sendWebhookTestClient,
  updateWebhookEndpointClient,
  type WebhookDeliveryView,
  type WebhookEndpointView,
  type WebhookEventType,
} from "@/lib/merchant-api/client";

import "../checkout/checkout.css";
import "./developers.css";

const eventLabels: Record<WebhookEventType, string> = {
  "checkout.session.completed": "Session completed",
  "checkout.session.expired": "Session expired",
  "checkout.session.payment_received": "Payment received",
  "refund.succeeded": "Refund succeeded",
};

const verifySample = `import { Webhook } from "standardwebhooks";

const wh = new Webhook(process.env.SAPHRA_WEBHOOK_SECRET); // whsec_…

app.post("/webhooks/saphraone", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = wh.verify(req.body.toString(), req.headers); // throws if forged
  } catch {
    return res.status(400).end();
  }
  if (event.type === "checkout.session.completed") {
    fulfil(event.data.object); // dedupe on event.id / webhook-id
  }
  res.status(200).end();
});`;

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" });
}

function hostOf(url: string | null) {
  if (!url) return "deleted endpoint";
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy. Select and copy it instead.");
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function deliveryTone(delivery: WebhookDeliveryView) {
  if (delivery.status === "SUCCEEDED") return "PAID";
  if (delivery.status === "FAILED") return "FAILED";
  return "OPEN";
}

function deliveryMeta(delivery: WebhookDeliveryView) {
  const parts = [hostOf(delivery.endpoint_url)];
  if (delivery.last_status_code !== null) parts.push(`HTTP ${delivery.last_status_code}`);
  if (delivery.attempts > 0) parts.push(`${delivery.attempts} attempt${delivery.attempts === 1 ? "" : "s"}`);
  if (delivery.status === "PENDING" && delivery.attempts > 0) {
    parts.push(`next ${dateLabel(delivery.next_attempt_at) ?? "soon"}`);
  } else {
    const when = dateLabel(delivery.last_attempt_at ?? delivery.created_at);
    if (when) parts.push(when);
  }
  return parts.join(" · ");
}

/** Webhook endpoints, their signing secrets and the delivery log. */
export function WebhooksPanel({ auth }: { auth: MerchantAuth | null }) {
  const [endpoints, setEndpoints] = useState<WebhookEndpointView[]>([]);
  const [eventTypes, setEventTypes] = useState<WebhookEventType[]>([]);
  const [maxEndpoints, setMaxEndpoints] = useState(3);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<WebhookEventType[]>([]);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "delete" | "rotate" } | null>(null);

  const load = useCallback(async () => {
    if (!auth) return;
    try {
      const [endpointResult, deliveryResult] = await Promise.all([
        fetchWebhookEndpoints(auth),
        fetchWebhookDeliveries(auth),
      ]);
      setEndpoints(endpointResult.endpoints);
      setEventTypes(endpointResult.eventTypes);
      setMaxEndpoints(endpointResult.maxEndpoints);
      setChosen((current) => (current.length > 0 ? current : endpointResult.eventTypes));
      setDeliveries(deliveryResult.deliveries);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Could not load your webhooks."));
    } finally {
      setLoaded(true);
    }
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function run(key: string, task: () => Promise<void>, fallback: string) {
    setBusy(key);
    try {
      await task();
    } catch (error) {
      toast.error(errorMessage(error, fallback));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!auth || !url.trim() || chosen.length === 0) return;
    setCreating(true);
    try {
      const result = await createWebhookEndpointClient(auth, { events: chosen, url: url.trim() });
      setNewSecret(result.secret);
      setUrl("");
      void load();
    } catch (error) {
      toast.error(errorMessage(error, "Could not add the endpoint."));
    } finally {
      setCreating(false);
    }
  }

  function toggleEvent(type: WebhookEventType) {
    setChosen((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  const canAdd = endpoints.length < maxEndpoints;

  return (
    <>
      <section className="ck-card">
        <div className="dv-card-head">
          <h2 className="ck-card-title">
            <Webhook className="h-4 w-4 text-primary" />
            Webhooks
          </h2>
          <button
            aria-label="Refresh webhooks"
            className="ck-item-action"
            disabled={refreshing}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
        </div>
        <p className="ck-muted text-sm">
          SaphraONE posts a signed event to your server when a session is paid, completed or expires. Verify the{" "}
          <code>webhook-signature</code> header with your endpoint&rsquo;s secret, answer with a 2xx, and fulfil from{" "}
          <code>checkout.session.completed</code>. Failed deliveries are retried for about four days.
        </p>

        {newSecret ? (
          <div className="dv-reveal">
            <p className="text-sm font-semibold">Endpoint added. Here is its signing secret</p>
            <p className="ck-muted text-xs">
              Store it on your server as an environment variable. You can reveal it again here at any time.
            </p>
            <code className="dv-key">{newSecret}</code>
            <div className="ck-row">
              <Button className="flex-1" onClick={() => void copyText(newSecret, "Secret")} variant="outline">
                <Copy className="h-4 w-4" />
                Copy secret
              </Button>
              <Button className="flex-1" onClick={() => setNewSecret(null)}>
                <Check className="h-4 w-4" />
                Done
              </Button>
            </div>
          </div>
        ) : canAdd ? (
          <div className="dv-webhook-form">
            <label className="ck-field">
              <input
                autoComplete="off"
                disabled={creating || !auth}
                inputMode="url"
                maxLength={2048}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create();
                }}
                placeholder="https://shop.example/webhooks/saphraone"
                value={url}
              />
            </label>
            <fieldset className="dv-events">
              <legend className="sr-only">Events to send</legend>
              {eventTypes.map((type) => (
                <label className="dv-event" key={type}>
                  <input
                    checked={chosen.includes(type)}
                    disabled={creating}
                    onChange={() => toggleEvent(type)}
                    type="checkbox"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{eventLabels[type]}</span>
                    <code className="dv-event-code">{type}</code>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button
              disabled={creating || !auth || !url.trim() || chosen.length === 0}
              onClick={() => void create()}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add endpoint
            </Button>
          </div>
        ) : (
          <p className="ck-muted text-sm">
            You have {maxEndpoints} endpoints, the most allowed. Delete one to add another.
          </p>
        )}

        {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

        {!loaded ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : endpoints.length === 0 ? (
          <p className="ck-muted">No endpoints yet.</p>
        ) : (
          <ul className="ck-list">
            {endpoints.map((endpoint) => {
              const secret = secrets[endpoint.id];
              const confirming = confirm?.id === endpoint.id ? confirm.action : null;
              const status = endpoint.disabled_at ? "disabled" : endpoint.failing_since ? "failing" : "active";
              return (
                <li className="dv-endpoint" key={endpoint.id}>
                  <div className="dv-endpoint-head">
                    <span className="min-w-0 flex-1">
                      <span className="dv-endpoint-url">{endpoint.url}</span>
                      <span className="ck-item-meta">
                        {endpoint.events.map((type) => eventLabels[type] ?? type).join(" · ")}
                      </span>
                    </span>
                    <span
                      className="ck-status"
                      data-status={status === "active" ? "PAID" : status === "failing" ? "FAILED" : "CANCELLED"}
                    >
                      {status}
                    </span>
                  </div>
                  {status === "failing" ? (
                    <p className="dv-endpoint-warn">
                      Deliveries have been failing since {dateLabel(endpoint.failing_since)}. Fix the endpoint, then
                      Resend from the log below.
                    </p>
                  ) : null}

                  {secret ? (
                    <div className="dv-secret">
                      <code className="dv-key">{secret}</code>
                      <button
                        aria-label="Copy secret"
                        className="ck-item-action"
                        onClick={() => void copyText(secret, "Secret")}
                        type="button"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}

                  {confirming ? (
                    <div className="dv-endpoint-confirm">
                      <p className="text-sm">
                        {confirming === "delete"
                          ? "Delete this endpoint and its delivery log? Events stop going to it at once."
                          : "Rotate the secret? The old one stops working at once, so update your server straight after."}
                      </p>
                      <span className="dv-confirm">
                        <Button
                          disabled={busy === `${confirming}:${endpoint.id}`}
                          onClick={() =>
                            void run(
                              `${confirming}:${endpoint.id}`,
                              async () => {
                                if (!auth) return;
                                if (confirming === "delete") {
                                  await deleteWebhookEndpointClient(auth, endpoint.id);
                                  toast.success("Endpoint deleted");
                                } else {
                                  const result = await rotateWebhookSecretClient(auth, endpoint.id);
                                  setSecrets((current) => ({ ...current, [endpoint.id]: result.secret }));
                                  toast.success("New secret in effect");
                                }
                                setConfirm(null);
                                await load();
                              },
                              confirming === "delete" ? "Could not delete the endpoint." : "Could not rotate the secret.",
                            )
                          }
                          size="sm"
                          variant="destructive"
                        >
                          {busy === `${confirming}:${endpoint.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {confirming === "delete" ? "Delete" : "Rotate"}
                        </Button>
                        <Button onClick={() => setConfirm(null)} size="sm" variant="ghost">
                          Keep
                        </Button>
                      </span>
                    </div>
                  ) : (
                    <div className="dv-endpoint-actions">
                      <Button
                        disabled={Boolean(endpoint.disabled_at) || busy === `test:${endpoint.id}`}
                        onClick={() =>
                          void run(
                            `test:${endpoint.id}`,
                            async () => {
                              if (!auth) return;
                              const result = await sendWebhookTestClient(auth, endpoint.id);
                              const delivery = result.delivery;
                              if (delivery?.status === "SUCCEEDED") {
                                toast.success(`Test event delivered (HTTP ${delivery.last_status_code}).`);
                              } else {
                                toast.error(
                                  `Test event failed: ${delivery?.last_error ?? "no response"}. It will be retried.`,
                                );
                              }
                              await load();
                            },
                            "Could not send the test event.",
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        {busy === `test:${endpoint.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        Send test event
                      </Button>
                      <Button
                        disabled={busy === `secret:${endpoint.id}`}
                        onClick={() => {
                          if (secret) {
                            setSecrets((current) => {
                              const next = { ...current };
                              delete next[endpoint.id];
                              return next;
                            });
                            return;
                          }
                          void run(
                            `secret:${endpoint.id}`,
                            async () => {
                              if (!auth) return;
                              const result = await revealWebhookSecretClient(auth, endpoint.id);
                              setSecrets((current) => ({ ...current, [endpoint.id]: result.secret }));
                            },
                            "Could not reveal the secret.",
                          );
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {secret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {secret ? "Hide secret" : "Reveal secret"}
                      </Button>
                      <Button onClick={() => setConfirm({ action: "rotate", id: endpoint.id })} size="sm" variant="outline">
                        <RotateCcw className="h-4 w-4" />
                        Rotate
                      </Button>
                      <Button
                        disabled={busy === `toggle:${endpoint.id}`}
                        onClick={() =>
                          void run(
                            `toggle:${endpoint.id}`,
                            async () => {
                              if (!auth) return;
                              await updateWebhookEndpointClient(auth, endpoint.id, {
                                disabled: !endpoint.disabled_at,
                              });
                              await load();
                            },
                            "Could not update the endpoint.",
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        {endpoint.disabled_at ? "Turn on" : "Turn off"}
                      </Button>
                      <Button
                        aria-label="Delete endpoint"
                        onClick={() => setConfirm({ action: "delete", id: endpoint.id })}
                        size="sm"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {endpoints.length > 0 || deliveries.length > 0 ? (
        <section className="ck-card">
          <h2 className="ck-card-title">
            <Send className="h-4 w-4 text-primary" />
            Recent deliveries
          </h2>
          {deliveries.length === 0 ? (
            <p className="ck-muted">Nothing sent yet. Send a test event to check your endpoint.</p>
          ) : (
            <ul className="ck-list">
              {deliveries.map((delivery) => (
                <li className="ck-item" key={delivery.id}>
                  <span className="min-w-0 flex-1">
                    <span className="dv-delivery-type">{delivery.event?.type ?? "event"}</span>
                    <span className="ck-item-meta">{deliveryMeta(delivery)}</span>
                    {delivery.last_error && delivery.status !== "SUCCEEDED" ? (
                      <span className="ck-item-meta dv-delivery-error">{delivery.last_error}</span>
                    ) : null}
                  </span>
                  <span className="ck-status" data-status={deliveryTone(delivery)}>
                    {delivery.status === "SUCCEEDED" ? "delivered" : delivery.status === "FAILED" ? "failed" : "retrying"}
                  </span>
                  <Button
                    aria-label="Resend"
                    disabled={busy === `resend:${delivery.id}`}
                    onClick={() =>
                      void run(
                        `resend:${delivery.id}`,
                        async () => {
                          if (!auth) return;
                          const result = await resendWebhookDeliveryClient(auth, delivery.id);
                          if (result.delivery.status === "SUCCEEDED") toast.success("Delivered");
                          else toast.error(`Still failing: ${result.delivery.last_error ?? "no response"}`);
                          await load();
                        },
                        "Could not resend.",
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    {busy === `resend:${delivery.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Resend
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="ck-card">
        <h2 className="ck-card-title">
          <Check className="h-4 w-4 text-primary" />
          Verify the signature
        </h2>
        <p className="ck-muted text-sm">
          Events follow the open Standard Webhooks scheme, so any <code>standardwebhooks</code> or{" "}
          <code>svix</code> library verifies them. Verify the raw body before parsing it.
        </p>
        <pre className="dv-code">{verifySample}</pre>
        <button
          className="ck-quiet-link justify-self-start"
          onClick={() => void copyText(verifySample, "Example")}
          type="button"
        >
          Copy example
        </button>
      </section>
    </>
  );
}
