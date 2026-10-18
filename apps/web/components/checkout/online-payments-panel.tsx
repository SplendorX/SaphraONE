"use client";

import { ArrowRight, ArrowUpRight, Globe, Loader2, RotateCcw, Terminal, Undo2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { chargeRefundable, RefundSheet } from "@/components/checkout/refund-sheet";
import { Button } from "@/components/ui/button";
import { formatMoney, moneyNumber } from "@/lib/account/money";
import {
  cancelRefundClient,
  fetchCharges,
  fetchPendingRefunds,
  type MerchantAuth,
  type RefundRequestView,
} from "@/lib/checkout/client";
import type { ChargeWithPayments } from "@/lib/checkout/types";
import { paymentStatus, sessionStatus } from "@/lib/merchant-api/serialize";
import { explorerTxUrl } from "@/lib/onchain-facts";

import "../developers/developers.css";

const POLL_MS = 15_000;

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" });
}

/** Checkouts a website started with the API: newest first, refreshed while open. */
export function OnlinePaymentsPanel({
  auth,
  showDevelopersLink = true,
}: {
  auth: MerchantAuth | null;
  /** The link to API keys; off inside the developer console, which has them a tab away. */
  showDevelopersLink?: boolean;
}) {
  const [charges, setCharges] = useState<ChargeWithPayments[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<RefundRequestView[]>([]);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!auth) return;
    try {
      const [result, pending] = await Promise.all([
        fetchCharges(auth, { kind: "ONLINE" }),
        // Only owners, admins and finance can refund; for others the list stays empty.
        fetchPendingRefunds(auth).catch(() => ({ refunds: [] as RefundRequestView[] })),
      ]);
      setCharges(result.charges);
      setRequests(pending.refunds);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load online payments.");
    } finally {
      setLoaded(true);
    }
  }, [auth]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function cancel(request: RefundRequestView) {
    if (!auth) return;
    setCancelling(request.public_id);
    try {
      await cancelRefundClient(auth, request.public_id);
      toast.success(request.source === "API" ? "Refund request declined" : "Refund cancelled");
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not cancel the refund.");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <>
      {showDevelopersLink ? (
      <Link className="dv-next" href="/business/developers">
        <span className="flex items-center gap-3">
          <span className="ck-item-icon">
            <Terminal className="h-4 w-4" />
          </span>
          <span>
            <span className="block font-semibold">Sell on your website</span>
            <span className="ck-muted block text-xs">API keys and the Checkout API quick start</span>
          </span>
        </span>
        <ArrowRight className="h-4 w-4" />
      </Link>
      ) : null}

      {requests.length > 0 ? (
        <section className="ck-card">
          <h2 className="ck-card-title">
            <Undo2 className="h-4 w-4 text-primary" />
            Refund requests
          </h2>
          <p className="ck-muted text-sm">
            Refunds waiting for you to send them. Each counts once the transfer from your business wallet is
            confirmed.
          </p>
          <div>
            {requests.map((request) => (
              <div className="ck-request" key={request.id}>
                <span className="min-w-0">
                  <span className="ck-item-amount">{formatMoney(request.amount, request.currency)}</span>
                  <span className="ck-item-meta">
                    {request.source === "API" ? "Requested by your website" : "Started here, not sent yet"}
                    {request.client_reference_id ? (
                      <>
                        {" · order "}
                        <span className="ck-online-ref">{request.client_reference_id}</span>
                      </>
                    ) : (
                      ` · ${request.charge_code}`
                    )}
                    {request.reason ? ` · ${request.reason}` : ""}
                  </span>
                  <span className="ck-item-meta font-mono">to {request.destination_wallet}</span>
                </span>
                <span className="ck-request-actions">
                  <Button asChild size="sm">
                    <Link href={request.send_href}>Send refund</Link>
                  </Button>
                  <Button
                    disabled={cancelling === request.public_id}
                    onClick={() => void cancel(request)}
                    size="sm"
                    variant="ghost"
                  >
                    {cancelling === request.public_id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {request.source === "API" ? "Decline" : "Cancel"}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="ck-card">
        <h2 className="ck-card-title">
          <Globe className="h-4 w-4 text-primary" />
          Online payments
        </h2>
        {!loaded ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : charges.length === 0 ? (
          <p className="ck-muted">
            Checkouts your website creates with the API show up here, with their order ids.
          </p>
        ) : (
          <ul className="ck-list">
            {charges.map((charge) => {
              const payment = paymentStatus(charge);
              const received = moneyNumber(charge.amount_received);
              const refunded = moneyNumber(charge.amount_refunded ?? "0");
              const refundable = chargeRefundable(charge);
              return (
                <Fragment key={charge.id}>
                  <li className="ck-item">
                    <span className="ck-item-icon" data-status={charge.status}>
                      <Globe className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="ck-item-amount">
                        {formatMoney(charge.amount, charge.currency)}
                        {payment === "partially_paid" ? (
                          <span className="ck-item-tip">
                            {formatMoney(received, charge.currency)} received
                          </span>
                        ) : null}
                      </span>
                      <span className="ck-item-meta">
                        {timeLabel(charge.created_at)}
                        {charge.session?.client_reference_id ? (
                          <>
                            {" · order "}
                            <span className="ck-online-ref">{charge.session.client_reference_id}</span>
                          </>
                        ) : null}
                        {charge.note ? ` · ${charge.note}` : ""}
                        {refunded > 0 ? ` · refunded ${formatMoney(refunded, charge.currency)}` : ""}
                      </span>
                    </span>
                    <span className="ck-status" data-status={charge.status}>
                      {sessionStatus(charge.status)}
                    </span>
                    {refundable > 0 ? (
                      <button
                        aria-expanded={refunding === charge.id}
                        aria-label="Refund"
                        className="ck-item-action"
                        onClick={() => setRefunding((current) => (current === charge.id ? null : charge.id))}
                        title="Refund"
                        type="button"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    ) : null}
                    {charge.payments[0] ? (
                      <a
                        aria-label="View transaction"
                        className="ck-item-action"
                        href={explorerTxUrl(charge.payments[0].tx_hash)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </a>
                    ) : null}
                  </li>
                  {refunding === charge.id ? (
                    <li className="ck-item-refund">
                      <RefundSheet auth={auth} charge={charge} onClose={() => setRefunding(null)} />
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
