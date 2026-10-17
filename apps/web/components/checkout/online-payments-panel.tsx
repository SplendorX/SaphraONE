"use client";

import { ArrowRight, ArrowUpRight, Globe, Loader2, Terminal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatMoney, moneyNumber } from "@/lib/account/money";
import { fetchCharges, type MerchantAuth } from "@/lib/checkout/client";
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
export function OnlinePaymentsPanel({ auth }: { auth: MerchantAuth | null }) {
  const [charges, setCharges] = useState<ChargeWithPayments[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!auth) return;
    try {
      const result = await fetchCharges(auth, { kind: "ONLINE" });
      setCharges(result.charges);
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

  return (
    <>
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
              return (
                <li className="ck-item" key={charge.id}>
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
                    </span>
                  </span>
                  <span className="ck-status" data-status={charge.status}>
                    {sessionStatus(charge.status)}
                  </span>
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
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
