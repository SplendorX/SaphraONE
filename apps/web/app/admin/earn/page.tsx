"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AdminPageHeader, useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { formatApy, formatUsdGrouped, isActiveVault, isLowLiquidityVault, protocolLabel } from "@/lib/earn/display";

type Vault = {
  address: string;
  apy: number | null;
  asset: string | null;
  circleGuarded: boolean | null;
  fee: number | null;
  liquidity: string | null;
  name: string;
  nativeApy: number | null;
  protocol: string | null;
  status: string;
  totalDeposits: string | null;
};

type AutoDeposit = {
  activeRules: number;
  failing: Array<{ error: string | null; lastRunAt: string | null; vault: string; wallet: string }>;
  monthlyUsdc: number;
  recent: Array<{
    amountUsdc: number;
    at: string | null;
    mode: string | null;
    reason: string | null;
    status: string | null;
    txHash: string | null;
    vault: string | null;
    wallet: string | null;
  }>;
  totalRules: number;
  unattendedRules: number;
  wallets: number;
};

type Payload = {
  autoDeposit: AutoDeposit | null;
  autoDepositError: string | null;
  network: { explorer: string; mainnet: boolean };
  vaults: Vault[];
  vaultsError: string | null;
};

function short(value: string | null) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function usd(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

/**
 * Invest (Earn): the outside vaults members can put USDC and EURC in, as
 * Circle's App Kit lists them, and the auto-invest rules people have set.
 * SaphraONE holds no vault of its own, so there is no SaphraONE TVL here.
 */
export default function AdminEarnPage() {
  const { adminFetch } = useAdmin();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/admin/earn");
      const body = (await response.json().catch(() => null)) as (Payload & { message?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.message ?? "Couldn't load Invest.");
      setData(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load Invest.");
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const auto = data?.autoDeposit;
  const explorer = data?.network.explorer ?? "";
  const bestApy = data?.vaults.reduce<number | null>(
    (best, vault) => (vault.apy !== null && (best === null || vault.apy > best) ? vault.apy : best),
    null,
  );

  return (
    <div>
      <AdminPageHeader
        actions={
          <Button disabled={loading} onClick={() => void load()} size="sm" variant="outline">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        }
        subtitle="The vaults members can invest in, and their auto-invest rules"
        title="Invest"
      />

      {error ? <p className="adm-error mb-4">{error}</p> : null}

      {!data && loading ? (
        <div className="adm-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <div className="grid gap-5">
          <div className="adm-grid adm-grid-4">
            <div className="adm-card">
              <p className="adm-stat-label">Vaults on offer</p>
              <p className="adm-stat-value">{data.vaults.length}</p>
            </div>
            <div className="adm-card">
              <p className="adm-stat-label">Best APY</p>
              <p className="adm-stat-value">{formatApy(bestApy) ?? "—"}</p>
            </div>
            <div className="adm-card">
              <p className="adm-stat-label">Auto-invest rules on</p>
              <p className="adm-stat-value">{auto ? auto.activeRules : "—"}</p>
              {auto ? (
                <p className="adm-fine">
                  {auto.wallets} {auto.wallets === 1 ? "member" : "members"} · {auto.unattendedRules} unattended
                </p>
              ) : null}
            </div>
            <div className="adm-card">
              <p className="adm-stat-label">Auto-invest, up to / month</p>
              <p className="adm-stat-value">{auto ? usd(auto.monthlyUsdc) : "—"}</p>
            </div>
          </div>

          <section className="adm-card grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Vaults</h2>
              <span className="adm-fine">
                {data.network.mainnet ? "Arc mainnet · the vaults SaphraONE lists" : "Arc testnet · everything App Kit returns"}
              </span>
            </div>
            {data.vaultsError ? <p className="adm-error">{data.vaultsError}</p> : null}
            {data.vaults.length === 0 && !data.vaultsError ? (
              <p className="adm-empty">App Kit returned no vaults.</p>
            ) : data.vaults.length > 0 ? (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Vault</th>
                      <th>Asset</th>
                      <th className="adm-num">APY</th>
                      <th className="adm-num">Vault fee</th>
                      <th className="adm-num">Deposits</th>
                      <th className="adm-num">Liquidity</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vaults.map((vault) => (
                      <tr key={vault.address}>
                        <td>
                          <p className="font-semibold">{vault.name}</p>
                          <a
                            className="adm-mono inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            href={`${explorer}/address/${vault.address}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {protocolLabel(vault.protocol ?? undefined)} · {short(vault.address)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </td>
                        <td>{vault.asset ?? "—"}</td>
                        <td className="adm-num">{formatApy(vault.apy) ?? "—"}</td>
                        <td className="adm-num">{vault.fee !== null ? `${(vault.fee * 100).toFixed(1)}%` : "—"}</td>
                        <td className="adm-num">{formatUsdGrouped(vault.totalDeposits) ?? "—"}</td>
                        <td className="adm-num">{formatUsdGrouped(vault.liquidity) ?? "—"}</td>
                        <td>
                          <span
                            className={
                              isLowLiquidityVault(vault.status)
                                ? "adm-chip is-warn"
                                : isActiveVault(vault.status)
                                  ? "adm-chip is-good"
                                  : "adm-chip"
                            }
                          >
                            {vault.status.replace(/_/g, " ").toLowerCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="adm-card grid gap-3">
            <h2 className="font-semibold">Auto-invest</h2>
            {data.autoDepositError ? <p className="adm-error">{data.autoDepositError}</p> : null}
            {auto ? (
              <>
                <p className="adm-fine">
                  {auto.totalRules} {auto.totalRules === 1 ? "rule" : "rules"} in all, {auto.activeRules} on.
                </p>
                {auto.failing.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="adm-stat-label">Failing on their last run</p>
                    <div className="adm-table-wrap">
                      <table className="adm-table">
                        <thead>
                          <tr>
                            <th>Member</th>
                            <th>Vault</th>
                            <th>Last run</th>
                            <th>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auto.failing.map((rule) => (
                            <tr key={`${rule.wallet}:${rule.vault}`}>
                              <td className="adm-mono">{short(rule.wallet)}</td>
                              <td className="adm-mono">{short(rule.vault)}</td>
                              <td>{when(rule.lastRunAt)}</td>
                              <td>{rule.error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
                <p className="adm-stat-label">Recent runs</p>
                {auto.recent.length === 0 ? (
                  <p className="adm-empty">No auto-invest runs yet.</p>
                ) : (
                  <div className="adm-table-wrap">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Member</th>
                          <th className="adm-num">Amount</th>
                          <th>Mode</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auto.recent.map((run, index) => (
                          <tr key={`${run.txHash ?? run.at ?? ""}:${index}`}>
                            <td>{when(run.at)}</td>
                            <td className="adm-mono">{short(run.wallet)}</td>
                            <td className="adm-num">{usd(run.amountUsdc)}</td>
                            <td>{run.mode?.toLowerCase() ?? "—"}</td>
                            <td>
                              {run.txHash ? (
                                <a
                                  className="inline-flex items-center gap-1 hover:underline"
                                  href={`${explorer}/tx/${run.txHash}`}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {run.status?.toLowerCase()} <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span title={run.reason ?? undefined}>{run.status?.toLowerCase() ?? "—"}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : null}
          </section>

          <p className="adm-note">
            Members invest from their own wallets straight into these vaults through Circle&apos;s App Kit; SaphraONE
            holds none of the money, so there&apos;s no SaphraONE total to show. Each vault&apos;s deposits are its
            total across everyone who uses it.
          </p>
        </div>
      ) : null}
    </div>
  );
}
