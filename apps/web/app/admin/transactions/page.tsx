"use client";

import { ExternalLink, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StyledSelect } from "@/components/ui/styled-select";
import { officialArcExplorerUrl } from "@/lib/network";

type LedgerResponse = {
  largeThresholdUsd: number;
  summary: {
    accounts: number;
    bySource: Array<{ count: number; source: string; volumeUsd: number }>;
    count: number;
    feesUsd: number;
    flagged: number;
    truncated: boolean;
    volumeUsd: number;
  };
  transactions: Array<{
    amount: number;
    amountUsd: number;
    feeUsd: number;
    flag: string | null;
    id: string;
    occurredAt: string;
    oneId: string | null;
    payeeCount: number;
    source: string;
    token: string;
    txHash: string;
    wallet: string;
  }>;
};

const periodOptions = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
];

const sourceOptions = [
  { label: "Every feature", value: "" },
  ...["send", "batch", "payroll", "invoice", "checkout", "recurepay", "circle", "save", "swap"].map((value) => ({
    label: value.charAt(0).toUpperCase() + value.slice(1),
    value,
  })),
];

const usd = (value: number) =>
  value.toLocaleString(undefined, { currency: "USD", maximumFractionDigits: 2, style: "currency" });

export default function AdminTransactionsPage() {
  const { adminFetch } = useAdmin();
  const [period, setPeriod] = useState("7d");
  const [source, setSource] = useState("");
  const [account, setAccount] = useState("");
  const [minUsd, setMinUsd] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (source) params.set("source", source);
    if (account.trim()) params.set("account", account.trim());
    if (Number(minUsd) > 0) params.set("minUsd", String(Number(minUsd)));
    if (flaggedOnly) params.set("flagged", "1");
    try {
      const response = await adminFetch(`/api/admin/transactions?${params}`);
      const body = (await response.json()) as LedgerResponse & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Couldn't load transactions.");
      setData(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load transactions.");
    } finally {
      setLoading(false);
    }
  }, [account, adminFetch, flaggedOnly, minUsd, period, source]);

  // Filters apply as they change; the account box waits for a pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 300);
    return () => window.clearTimeout(timer);
  }, [load]);

  const explorer = officialArcExplorerUrl();
  const summary = data?.summary;

  return (
    <div>
      <div className="adm-page-head">
        <div>
          <h1 className="adm-title">Transactions</h1>
          <p className="adm-subtitle">
            Payments recorded on Arc. Flagged: {usd(data?.largeThresholdUsd ?? 1000)} or more, or
            not eligible for rewards.
          </p>
        </div>
        <Button disabled={loading} onClick={() => void load()} variant="outline">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      <div className="adm-grid adm-grid-4 mb-4">
        <Stat label="Volume" value={summary ? usd(summary.volumeUsd) : "—"} />
        <Stat label="Transactions" value={summary ? summary.count.toLocaleString() : "—"} />
        <Stat label="Accounts" value={summary ? summary.accounts.toLocaleString() : "—"} />
        <Stat
          label="Flagged"
          tone={summary && summary.flagged > 0 ? "warn" : undefined}
          value={summary ? summary.flagged.toLocaleString() : "—"}
        />
      </div>

      {summary && summary.bySource.length > 0 ? (
        <div className="adm-card mb-4">
          <p className="adm-stat-label">Volume by feature · fees {usd(summary.feesUsd)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.bySource.map((item) => (
              <button
                className="adm-chip"
                key={item.source}
                onClick={() => setSource(item.source === source ? "" : item.source)}
                type="button"
              >
                {item.source} · {usd(item.volumeUsd)} · {item.count}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="adm-filters">
        <StyledSelect ariaLabel="Period" className="w-44" onChange={setPeriod} options={periodOptions} value={period} />
        <StyledSelect ariaLabel="Feature" className="w-44" onChange={setSource} options={sourceOptions} value={source} />
        <Input
          className="h-10 w-56"
          onChange={(event) => setAccount(event.target.value)}
          placeholder="One ID or wallet"
          value={account}
        />
        <Input
          className="h-10 w-36"
          inputMode="decimal"
          onChange={(event) => setMinUsd(event.target.value.replace(/[^\d.]/g, ""))}
          placeholder="Min $"
          value={minUsd}
        />
        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input checked={flaggedOnly} onChange={(event) => setFlaggedOnly(event.target.checked)} type="checkbox" />
          Flagged only
        </label>
      </div>

      {error ? <p className="adm-error mb-3">{error}</p> : null}
      {summary?.truncated ? (
        <p className="adm-note mb-3">Showing the latest 500. Narrow the period or filters to see the rest.</p>
      ) : null}

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Account</th>
              <th>Feature</th>
              <th className="adm-num">Amount</th>
              <th className="adm-num">USD</th>
              <th>Flag</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {(data?.transactions ?? []).map((tx) => (
              <tr key={tx.id}>
                <td className="whitespace-nowrap">
                  {new Date(tx.occurredAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td>
                  <span className="font-semibold">{tx.oneId ?? "—"}</span>
                  <span className="adm-mono block text-muted-foreground">
                    {tx.wallet.slice(0, 6)}…{tx.wallet.slice(-4)}
                  </span>
                </td>
                <td>
                  <span className="adm-chip">{tx.source}</span>
                  {tx.payeeCount > 1 ? <span className="adm-note ml-1">{tx.payeeCount} payees</span> : null}
                </td>
                <td className="adm-num">
                  {tx.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {tx.token}
                </td>
                <td className="adm-num">{usd(tx.amountUsd)}</td>
                <td>
                  {tx.flag ? (
                    <span className="adm-chip is-warn">
                      <TriangleAlert className="h-3 w-3" />
                      {tx.flag}
                    </span>
                  ) : null}
                </td>
                <td>
                  <a
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    href={`${explorer}/tx/${tx.txHash}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="adm-mono">{tx.txHash.slice(0, 8)}…</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && !data ? (
          <p className="adm-empty">
            <Loader2 className="mx-auto h-4 w-4 animate-spin" />
          </p>
        ) : data && data.transactions.length === 0 ? (
          <p className="adm-empty">No transactions match.</p>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, tone, value }: { label: string; tone?: "warn"; value: string }) {
  return (
    <div className="adm-card">
      <p className="adm-stat-label">{label}</p>
      <p className={tone === "warn" ? "adm-stat-value text-amber-600 dark:text-amber-400" : "adm-stat-value"}>
        {value}
      </p>
    </div>
  );
}
