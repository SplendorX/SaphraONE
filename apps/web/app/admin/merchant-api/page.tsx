"use client";

import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_WINDOW_DAYS, type AdminMerchantView, type AdminOverview } from "@/lib/merchant-api/admin-rules";

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never";
}

function volumeText(volume: Record<string, string>) {
  const entries = Object.entries(volume);
  return entries.length ? entries.map(([currency, amount]) => `${amount} ${currency}`).join(" · ") : "0";
}

/**
 * Businesses taking payments through the Checkout API: who has keys, how much
 * went through in the last week, which webhook endpoints are failing, and a
 * way to revoke a key at once (with a reason the business is told).
 */
export default function MerchantApiAdminPage() {
  const { adminFetch } = useAdmin();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/admin/merchant-api");
      const body = (await response.json().catch(() => null)) as { overview?: AdminOverview; message?: string } | null;
      if (!response.ok || !body?.overview) throw new Error(body?.message ?? "Couldn't load the Checkout API.");
      setOverview(body.overview);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load the Checkout API.");
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(keyId: string) {
    setRevoking(keyId);
    setError(null);
    try {
      const response = await adminFetch("/api/admin/merchant-api", {
        body: JSON.stringify({ action: "revoke_key", keyId, reason: reasons[keyId] ?? "" }),
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "Couldn't revoke the key.");
      setReasons((current) => ({ ...current, [keyId]: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't revoke the key.");
    } finally {
      setRevoking(null);
    }
  }

  const totals = overview?.totals;
  const days = overview?.windowDays ?? ADMIN_WINDOW_DAYS;

  return (
    <div>
      <div className="adm-page-head">
        <div>
          <h1 className="adm-title">Checkout API</h1>
          <p className="adm-subtitle">
            Businesses with API keys, their online sessions over the last {days} days, and webhook endpoints that are
            failing. Revoke a key at once if it leaked or is being misused; the business is told why.
          </p>
        </div>
        <Button disabled={loading} onClick={() => void load()} variant="outline">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {error ? <p className="adm-error mb-3">{error}</p> : null}

      {totals ? (
        <div className="adm-grid adm-grid-4 mb-5">
          <div className="adm-card">
            <p className="adm-stat-label">Businesses with active keys</p>
            <p className="adm-stat-value">{totals.merchants}</p>
            <p className="adm-note">{totals.activeKeys} active keys</p>
          </div>
          <div className="adm-card">
            <p className="adm-stat-label">Sessions, {days} days</p>
            <p className="adm-stat-value">{totals.sessions}</p>
            <p className="adm-note">{totals.paidSessions} paid</p>
          </div>
          <div className="adm-card">
            <p className="adm-stat-label">Received, {days} days</p>
            <p className="adm-stat-value">{volumeText(totals.volume)}</p>
          </div>
          <div className="adm-card">
            <p className="adm-stat-label">Failing endpoints</p>
            <p className="adm-stat-value">{totals.failingEndpoints}</p>
          </div>
        </div>
      ) : null}

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Keys</th>
              <th>Last API call</th>
              <th className="adm-num">Sessions</th>
              <th className="adm-num">Received</th>
              <th>Webhooks</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {overview?.merchants.map((merchant) => (
              <Fragment key={merchant.wallet}>
                <tr className="is-clickable" onClick={() => setOpen(open === merchant.wallet ? null : merchant.wallet)}>
                  <td>
                    <span className="font-semibold">{merchant.businessName ?? "Unnamed business"}</span>
                    {merchant.verified ? <span className="adm-chip is-good ml-2">Verified</span> : null}
                    <span className="adm-note block">
                      {merchant.username ? `${merchant.username}.one · ` : ""}
                      <span className="adm-mono">{shortWallet(merchant.wallet)}</span>
                    </span>
                  </td>
                  <td>
                    {merchant.activeKeys} active
                    {merchant.keys.length > merchant.activeKeys ? (
                      <span className="adm-note block">{merchant.keys.length - merchant.activeKeys} revoked</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap">{when(merchant.lastUsedAt)}</td>
                  <td className="adm-num">
                    {merchant.sessions}
                    <span className="adm-note block">{merchant.paidSessions} paid</span>
                  </td>
                  <td className="adm-num">{volumeText(merchant.volume)}</td>
                  <td>
                    {merchant.failingEndpoints > 0 ? (
                      <span className="adm-chip is-warn">{merchant.failingEndpoints} failing</span>
                    ) : merchant.endpoints.length ? (
                      `${merchant.endpoints.length} endpoint${merchant.endpoints.length === 1 ? "" : "s"}`
                    ) : (
                      "None"
                    )}
                  </td>
                  <td>
                    <ChevronDown
                      className={`h-4 w-4 transition ${open === merchant.wallet ? "rotate-180" : ""}`}
                    />
                  </td>
                </tr>
                {open === merchant.wallet ? (
                  <tr>
                    <td colSpan={7}>
                      <MerchantDetail
                        merchant={merchant}
                        onReason={(keyId, value) => setReasons((current) => ({ ...current, [keyId]: value }))}
                        onRevoke={(keyId) => void revoke(keyId)}
                        reasons={reasons}
                        revoking={revoking}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {loading && !overview ? (
          <p className="adm-empty">
            <Loader2 className="mx-auto h-4 w-4 animate-spin" />
          </p>
        ) : overview && overview.merchants.length === 0 ? (
          <p className="adm-empty">No business has created an API key yet.</p>
        ) : null}
      </div>
    </div>
  );
}

function MerchantDetail({
  merchant,
  onReason,
  onRevoke,
  reasons,
  revoking,
}: {
  merchant: AdminMerchantView;
  onReason: (keyId: string, value: string) => void;
  onRevoke: (keyId: string) => void;
  reasons: Record<string, string>;
  revoking: string | null;
}) {
  return (
    <div className="space-y-4 py-2">
      <div>
        <p className="adm-field-label">API keys</p>
        <div className="space-y-2">
          {merchant.keys.map((key) => (
            <div className="flex flex-wrap items-center gap-2" key={key.id}>
              <span className="adm-mono">{key.key_prefix}…</span>
              <span className="font-medium">{key.name}</span>
              <span className="adm-note">
                {key.mode} · created {when(key.created_at)} · last used {when(key.last_used_at)}
              </span>
              {key.revoked_at ? (
                <span className="adm-chip">Revoked {when(key.revoked_at)}</span>
              ) : (
                <>
                  <Input
                    className="h-9 min-w-56 flex-1"
                    onChange={(event) => onReason(key.id, event.target.value)}
                    placeholder="Reason (the business sees it)"
                    value={reasons[key.id] ?? ""}
                  />
                  <Button
                    disabled={revoking === key.id || (reasons[key.id] ?? "").trim().length < 3}
                    onClick={() => onRevoke(key.id)}
                    size="sm"
                    variant="destructive"
                  >
                    {revoking === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Revoke
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="adm-field-label">Webhook endpoints</p>
        {merchant.endpoints.length === 0 ? (
          <p className="adm-note">None added.</p>
        ) : (
          <div className="space-y-1.5">
            {merchant.endpoints.map((endpoint) => (
              <div className="flex flex-wrap items-center gap-2" key={endpoint.id}>
                <span className="adm-mono break-all">{endpoint.url}</span>
                {endpoint.disabled ? <span className="adm-chip">Off</span> : null}
                {endpoint.failingSince ? (
                  <span className="adm-chip is-warn">Failing since {when(endpoint.failingSince)}</span>
                ) : null}
                <span className="adm-note">
                  {endpoint.failed} gave up · {endpoint.retrying} retrying ({ADMIN_WINDOW_DAYS} days)
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
