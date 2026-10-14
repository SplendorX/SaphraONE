"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Shield,
} from "lucide-react";
import Link from "next/link";

import { EarnModeBanner } from "@/components/earn/earn-mode-banner";
import { AdminPageHeader, useAdmin } from "@/components/admin/admin-shell";
import { type EarnMode } from "@/lib/earn/config";
import { cn } from "@/lib/utils";

type AdminPayload = {
  mode: EarnMode;
  banner: { tone: string; title: string; body: string };
  tvl: {
    totalAssetsDisplay: string;
    totalAssetsUnits: string;
    totalSupply: string;
  };
  users: {
    depositEvents: number;
    withdrawalEvents: number;
    uniqueDepositorsIndexed: number;
  };
  fees: {
    performanceFeeBps: number;
    recent: Array<{ gross_yield: string; fee: string; timestamp: string | null }>;
  };
  apy: {
    grossApyDisplay: string | null;
    netApyDisplay: string | null;
    dataSource: string;
    message: string;
    isSimulation: boolean;
  };
  strategy: {
    name: string | null;
    healthy: boolean | null;
    isSimulation: boolean | null;
    address: string | null;
    aavePool: string | null;
    aToken: string | null;
  };
  vault: {
    address: string | null;
    paused: boolean | null;
  };
  network: {
    chainId: number;
    name: string;
    explorer: string;
  };
  errors: string[];
  notes: string[];
  message?: string;
};

function explorerUrl(base: string, address: string | null) {
  if (!address) return null;
  return `${base}/address/${address}`;
}

export default function AdminEarnPage() {
  const { adminFetch } = useAdmin();
  const [data, setData] = useState<AdminPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/earn");
      const payload = (await res.json()) as AdminPayload & { message?: string };
      if (!res.ok) {
        throw new Error(payload.message || "Admin API failed.");
      }
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <AdminPageHeader subtitle="TVL, fees, APY, strategy health" title="Earn" />
      <div className="earn-page">
        <div className="earn-admin-auth">
          <div className="earn-actions">
            <button
              className="earn-btn earn-btn-primary"
              disabled={loading}
              onClick={() => void load()}
              type="button"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" /> Refresh
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <p className="earn-error">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}

        {data && (
          <>
            <EarnModeBanner mode={data.mode} />

            <div className="earn-admin-grid">
              <article className="earn-balance-card">
                <div className="earn-balance-header">
                  <Activity className="h-5 w-5" />
                  <span>Total TVL (on-chain)</span>
                </div>
                <p className="earn-balance-value">
                  ${data.tvl.totalAssetsDisplay}
                </p>
                <div className="earn-stat-row">
                  <div>
                    <p className="earn-stat-label">Share supply</p>
                    <p className="earn-stat-value">
                      {data.tvl.totalSupply === "0"
                        ? "0"
                        : `${data.tvl.totalSupply.slice(0, 12)}…`}
                    </p>
                  </div>
                  <div>
                    <p className="earn-stat-label">Vault paused</p>
                    <p className="earn-stat-value">
                      {data.vault.paused === null
                        ? "—"
                        : data.vault.paused
                          ? "Yes"
                          : "No"}
                    </p>
                  </div>
                  <div>
                    <p className="earn-stat-label">Network</p>
                    <p className="earn-stat-value">{data.network.name}</p>
                  </div>
                </div>
              </article>

              <article className="earn-performance-card">
                <h2>APY</h2>
                <dl className="earn-dl">
                  <div>
                    <dt>Gross / underlying</dt>
                    <dd>{data.apy.grossApyDisplay ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Net (after SaphraONE fee)</dt>
                    <dd>{data.apy.netApyDisplay ?? "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Data source</dt>
                    <dd>{data.apy.dataSource}</dd>
                  </div>
                </dl>
                <p className="earn-footnote">{data.apy.message}</p>
              </article>

              <article className="earn-performance-card">
                <h2>Users (indexed)</h2>
                <dl className="earn-dl">
                  <div>
                    <dt>Unique depositors</dt>
                    <dd>{data.users.uniqueDepositorsIndexed}</dd>
                  </div>
                  <div>
                    <dt>Deposit events</dt>
                    <dd>{data.users.depositEvents}</dd>
                  </div>
                  <div>
                    <dt>Withdrawal events</dt>
                    <dd>{data.users.withdrawalEvents}</dd>
                  </div>
                </dl>
                <p className="earn-footnote">
                  Counts require Supabase + earn indexer cron.
                </p>
              </article>

              <article className="earn-performance-card">
                <h2>
                  <Shield className="h-4 w-4" /> Strategy
                </h2>
                <dl className="earn-dl">
                  <div>
                    <dt>Name</dt>
                    <dd>{data.strategy.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Healthy</dt>
                    <dd>
                      {data.strategy.healthy === null
                        ? "—"
                        : data.strategy.healthy
                          ? "Yes"
                          : "No"}
                    </dd>
                  </div>
                  <div>
                    <dt>Simulation</dt>
                    <dd>
                      {data.strategy.isSimulation === null
                        ? "—"
                        : data.strategy.isSimulation
                          ? "Yes"
                          : "No"}
                    </dd>
                  </div>
                  <div>
                    <dt>Fee</dt>
                    <dd>{data.fees.performanceFeeBps / 100}% of yield</dd>
                  </div>
                </dl>
                <div className="earn-address-grid">
                  <Addr
                    explorer={data.network.explorer}
                    label="Vault"
                    address={data.vault.address}
                  />
                  <Addr
                    explorer={data.network.explorer}
                    label="Strategy"
                    address={data.strategy.address}
                  />
                  <Addr
                    explorer={data.network.explorer}
                    label="Aave Pool"
                    address={data.strategy.aavePool}
                  />
                  <Addr
                    explorer={data.network.explorer}
                    label="aToken"
                    address={data.strategy.aToken}
                  />
                </div>
              </article>
            </div>

            {data.fees.recent.length > 0 && (
              <section className="earn-transparency">
                <h2>Recent performance fees</h2>
                <ul className="earn-admin-fees">
                  {data.fees.recent.map((f, i) => (
                    <li key={`${f.fee}-${i}`}>
                      Gross yield ${f.gross_yield} · Fee ${f.fee}
                      {f.timestamp
                        ? ` · ${new Date(f.timestamp).toLocaleString()}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.errors.length > 0 && (
              <section className="earn-risks">
                <h2>Read errors</h2>
                <ul>
                  {data.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </section>
            )}

            <section className="earn-footnote">
              {data.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </section>
          </>
        )}

        <p className="earn-footer-link">
          <Link href="/earn">← Earn app</Link>
        </p>
      </div>
    </div>
  );
}

function Addr({
  label,
  address,
  explorer,
}: {
  label: string;
  address: string | null;
  explorer: string;
}) {
  const href = explorerUrl(explorer, address);
  return (
    <div className="earn-address-row">
      <span>{label}</span>
      {href && address ? (
        <a
          className={cn("earn-address-link")}
          href={href}
          rel="noreferrer"
          target="_blank"
        >
          {address.slice(0, 6)}…{address.slice(-4)}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="text-muted-foreground">Not set</span>
      )}
    </div>
  );
}
