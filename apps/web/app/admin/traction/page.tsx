"use client";

import { useEffect, useMemo, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";

type TractionSummary = {
  actuals: {
    activeWallets30d: number;
    businessAccounts: number;
    earnAum: number;
    invoices: number;
    monthlyStablecoinVolume: number;
    monthlyTransactions: number;
    paymentSubmissionSuccessRate: number | null;
    payrollRuns: number;
    recurringSchedules: number;
    registeredWallets: number;
    savingsAum: number;
    totalTrackedEvents30d: number;
  };
  byCurrency: Record<
    string,
    {
      earnAum: number;
      paymentVolume: number;
      savingsAum: number;
      swapVolume: number;
    }
  >;
  dataHealth: {
    configured: boolean;
    missingTables: string[];
    notes: string[];
  };
  eventCounts: Record<string, number>;
  generatedAt: string;
  lastEvents: Array<{
    amount: number;
    currency: string;
    eventType: string;
    occurredAt: string;
    source: string;
    txHash: string;
    walletAddress: string;
  }>;
  rangeDays: number;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "No data";
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    style: "percent",
  }).format(value);
}

function shortHash(value: string) {
  return value ? `${value.slice(0, 8)}...${value.slice(-6)}` : "No hash";
}

function shortWallet(value: string) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Session only";
}

export default function TractionAdminPage() {
  const { adminFetch } = useAdmin();
  const [rangeDays, setRangeDays] = useState(30);
  const [summary, setSummary] = useState<TractionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const currencyRows = useMemo(
    () =>
      Object.entries(summary?.byCurrency ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    [summary?.byCurrency],
  );
  const eventRows = useMemo(
    () =>
      Object.entries(summary?.eventCounts ?? {}).sort(
        ([, left], [, right]) => right - left,
      ),
    [summary?.eventCounts],
  );

  // Opens on the metrics for the chosen range.
  useEffect(() => {
    void loadTraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeDays]);

  async function loadTraction() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await adminFetch(`/api/admin/traction?rangeDays=${rangeDays}`);
      const payload = (await response.json()) as
        | TractionSummary
        | { message?: string };

      if (!response.ok) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "Could not load traction metrics.",
        );
      }

      setSummary(payload as TractionSummary);
    } catch (loadError) {
      setSummary(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load traction metrics.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="text-foreground">
      <div className="grid w-full max-w-7xl gap-6">
        <header className="grid gap-4 border-b border-border pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-muted-foreground">
              SaphraONE admin
            </p>
            <h1 className="mt-2 font-heading text-4xl font-semibold tracking-normal">
              Real traction dashboard
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">
              Live product metrics from telemetry, savings records, Earn records,
              profiles, and recurring schedules. No invented MAU, AUM, or volume.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-[10rem_auto]">
            <label className="grid gap-1">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Range
              </span>
              <select
                className="h-11 rounded-lg border border-border bg-background px-3 text-sm font-semibold"
                onChange={(event) => setRangeDays(Number(event.target.value))}
                value={rangeDays}
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>365 days</option>
              </select>
            </label>
            <button
              className="sp-bubble self-end rounded-lg bg-primary px-5 py-3 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLoading}
              onClick={() => void loadTraction()}
              type="button"
            >
              {isLoading ? "Loading" : "Load metrics"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {error}
          </div>
        ) : null}

        {summary ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Active wallets", formatNumber(summary.actuals.activeWallets30d)],
                [
                  "Stablecoin volume",
                  formatMoney(summary.actuals.monthlyStablecoinVolume),
                ],
                ["Transactions", formatNumber(summary.actuals.monthlyTransactions)],
                ["Indexed Earn AUM", formatMoney(summary.actuals.earnAum)],
                ["Savings AUM", formatMoney(summary.actuals.savingsAum)],
                ["Registered wallets", formatNumber(summary.actuals.registeredWallets)],
                [
                  "Payment submit rate",
                  formatPercent(summary.actuals.paymentSubmissionSuccessRate),
                ],
                [
                  "Recurring schedules",
                  formatNumber(summary.actuals.recurringSchedules),
                ],
                ["Business accounts", formatNumber(summary.actuals.businessAccounts)],
                ["Invoices", formatNumber(summary.actuals.invoices)],
                ["Payroll runs", formatNumber(summary.actuals.payrollRuns)],
                ["Tracked events", formatNumber(summary.actuals.totalTrackedEvents30d)],
              ].map(([label, value]) => (
                <article
                  className="rounded-lg border border-border bg-card p-4"
                  key={label}
                >
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-3 font-heading text-3xl font-semibold tracking-normal">
                    {value}
                  </p>
                </article>
              ))}
            </section>

            <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <article className="rounded-lg border border-border bg-card p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="font-heading text-2xl font-semibold">
                    Currency breakdown
                  </h2>
                  <span className="text-sm font-semibold text-muted-foreground">
                    Last {summary.rangeDays} days
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-3 pr-3">Currency</th>
                        <th className="py-3 pr-3">Payments</th>
                        <th className="py-3 pr-3">Swaps</th>
                        <th className="py-3 pr-3">Earn AUM</th>
                        <th className="py-3 pr-3">Savings AUM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currencyRows.length > 0 ? (
                        currencyRows.map(([currency, row]) => (
                          <tr className="border-b border-border/70" key={currency}>
                            <td className="py-3 pr-3 font-bold">{currency}</td>
                            <td className="py-3 pr-3">
                              {formatMoney(row.paymentVolume)}
                            </td>
                            <td className="py-3 pr-3">
                              {formatMoney(row.swapVolume)}
                            </td>
                            <td className="py-3 pr-3">
                              {formatMoney(row.earnAum)}
                            </td>
                            <td className="py-3 pr-3">
                              {formatMoney(row.savingsAum)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="py-4 text-muted-foreground" colSpan={5}>
                            No currency-level metrics yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="rounded-lg border border-border bg-card p-5">
                <h2 className="font-heading text-2xl font-semibold">
                  Event counts
                </h2>
                <div className="mt-4 grid gap-2">
                  {eventRows.length > 0 ? (
                    eventRows.slice(0, 12).map(([eventType, count]) => (
                      <div
                        className="flex items-center justify-between gap-3 border-b border-border/70 py-2 text-sm"
                        key={eventType}
                      >
                        <span className="font-semibold">{eventType}</span>
                        <span className="font-bold">{formatNumber(count)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No tracked events yet.
                    </p>
                  )}
                </div>
              </article>
            </section>

            <section className="rounded-lg border border-border bg-card p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-heading text-2xl font-semibold">
                    Latest traction events
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Generated {new Date(summary.generatedAt).toLocaleString()}
                  </p>
                </div>
                <span className="text-sm font-semibold text-muted-foreground">
                  {formatNumber(summary.actuals.totalTrackedEvents30d)} tracked
                  events
                </span>
              </div>
              <div className="grid gap-2">
                {summary.lastEvents.length > 0 ? (
                  summary.lastEvents.map((event, index) => (
                    <article
                      className="grid gap-2 rounded-lg border border-border/80 bg-background px-3 py-3 text-sm md:grid-cols-[1.1fr_0.8fr_0.8fr_0.8fr_1fr]"
                      key={`${event.eventType}-${event.txHash}-${index}`}
                    >
                      <span className="font-bold">{event.eventType}</span>
                      <span>{shortWallet(event.walletAddress)}</span>
                      <span>
                        {event.amount ? `${event.amount} ${event.currency}` : event.currency}
                      </span>
                      <span>{event.source}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {shortHash(event.txHash)}
                      </span>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No recent events yet.
                  </p>
                )}
              </div>
            </section>

            {summary.dataHealth.notes.length > 0 ? (
              <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-5">
                <h2 className="font-heading text-xl font-semibold">
                  Data health notes
                </h2>
                <ul className="mt-3 grid gap-2 text-sm font-semibold">
                  {summary.dataHealth.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <section className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
            <h2 className="font-heading text-2xl font-semibold">
              Load live traction metrics
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Set `TRACTION_ADMIN_SECRET` or reuse `EARN_ADMIN_SECRET`, apply the
              traction SQL, then load this page with the matching bearer secret.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
