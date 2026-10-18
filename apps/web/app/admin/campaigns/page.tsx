"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { adminLoadError, useAdminKey } from "@/components/admin/use-admin-key";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { PremiumOffersPanel } from "@/components/admin/premium-offers-panel";
import { campaignSources, metricLabels, type CampaignMetric } from "@/lib/campaigns/rules";
import { arcChain } from "@/lib/chains";
import { cn } from "@/lib/utils";

import "../rewards/admin-rewards.css";

type Winner = {
  id: string;
  wallet_address: string;
  name: string;
  rank: number;
  score: number;
  amount_usdc: number;
  status: "REVIEW" | "PENDING" | "PAID" | "REJECTED";
  payout_tx_hash: string | null;
  last_error: string | null;
  reason: string | null;
};

type AdminCampaign = {
  id: string;
  title: string;
  description: string;
  metric: CampaignMetric;
  sources: string[];
  min_amount_usd: number;
  min_score: number;
  starts_at: string;
  ends_at: string;
  prize_pool_usdc: number;
  payout_type: "top" | "threshold";
  payout_splits: number[];
  threshold_prize_usdc: number;
  status: "draft" | "live" | "finalized" | "paid" | "cancelled";
  phase: "upcoming" | "running" | "ended";
  winners: Winner[];
};

type LedgerStatus = {
  totalRows: number;
  eligibleRows: number;
  lastRecordedAt: string | null;
  backfill: { cursorAt: string | null; processed: number; updatedAt: string } | null;
};

type Standing = { rank: number; name: string; wallet: string; score: number; payments: number; volume: number; fees: number; uniquePayees: number };

const explorer = arcChain.blockExplorers.default.url;

const emptyDraft = {
  description: "",
  endsAt: "",
  excludedWallets: "",
  metric: "unique_payees" as CampaignMetric,
  minAmountUsd: "1",
  minScore: "0",
  payoutSplits: "50, 30, 20",
  payoutType: "top" as "top" | "threshold",
  prizePoolUsdc: "100",
  sources: [] as string[],
  startsAt: "",
  thresholdPrizeUsdc: "5",
  title: "",
};

function when(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function usdc(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;
}

/** datetime-local gives local time without a zone; send it as an instant. */
function toIso(local: string) {
  return local ? new Date(local).toISOString() : "";
}

export default function AdminCampaignsPage() {
  // Signed in on the admin platform: its owner key, or none for a team member's own account.
  const { key: adminKey, ready: keyReady } = useAdminKey();
  const [campaigns, setCampaigns] = useState<AdminCampaign[] | null>(null);
  const [ledger, setLedger] = useState<LedgerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [boards, setBoards] = useState<Record<string, Standing[]>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [hashes, setHashes] = useState<Record<string, string>>({});

  const headers = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
    }),
    [adminKey],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/campaigns", { cache: "no-store", headers: headers() });
      const json = (await response.json()) as { campaigns: AdminCampaign[]; ledger: LedgerStatus; message?: string };
      if (!response.ok) throw new Error(adminLoadError(response.status, Boolean(adminKey), json.message || "Could not load."));
      setCampaigns(json.campaigns);
      setLedger(json.ledger);
      // A successful load clears an earlier load error (e.g. the first try,
      // before the key was entered); action results stay.
      setMessage((current) => (current?.tone === "error" ? null : current));
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "Could not load.", tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [adminKey, headers]);

  useEffect(() => {
    if (!keyReady) return;
    void load();
    // Loads once the remembered key is read (local dev needs none); "Refresh"
    // reloads with a newly typed key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyReady]);

  async function act(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/campaigns", { body: JSON.stringify(body), headers: headers(), method: "POST" });
      const json = (await response.json()) as Record<string, unknown> & { message?: string };
      if (!response.ok) throw new Error(json.message || "That didn't work.");
      setMessage({ text: done, tone: "ok" });
      if (body.action === "leaderboard") {
        setBoards((current) => ({ ...current, [String(body.id)]: (json.leaderboard as Standing[]) ?? [] }));
      } else {
        await load();
      }
      return json;
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "That didn't work.", tone: "error" });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const result = await act(
      "create",
      {
        ...draft,
        action: "create",
        endsAt: toIso(draft.endsAt),
        startsAt: toIso(draft.startsAt),
      },
      "Draft created. Check it, then publish.",
    );
    if (result) setDraft(emptyDraft);
  }

  const toggleSource = (source: string) =>
    setDraft((current) => ({
      ...current,
      sources: current.sources.includes(source)
        ? current.sources.filter((item) => item !== source)
        : [...current.sources, source],
    }));

  return (
    <div>
      <AdminPageHeader subtitle="Premium offers, USDC campaigns, leaderboards and payouts" title="Campaigns" />
      <div className="ar-page">
        <div className="ar-auth">
          <button className="ar-btn is-primary" disabled={loading} onClick={() => void load()} type="button">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {message ? <p className={cn("ar-message", message.tone === "error" && "is-error")}>{message.text}</p> : null}

        {/* Discounts and bonus days on premium purchases */}
        <PremiumOffersPanel />

        {/* Ledger */}
        <section className="ar-section">
          <h2>Transaction ledger</h2>
          <p className="ar-hint">
            Every payment made through SaphraONE, verified on Arc. Campaigns rank wallets from these rows. The daily job
            records ALLIE payments and backfills history; run either now if you need it sooner.
          </p>
          {ledger ? (
            <div className="ar-facts">
              <strong>
                {ledger.totalRows.toLocaleString()} transaction{ledger.totalRows === 1 ? "" : "s"} ·{" "}
                {ledger.eligibleRows.toLocaleString()} count{ledger.eligibleRows === 1 ? "s" : ""} toward campaigns
              </strong>
              <span>Last recorded: {when(ledger.lastRecordedAt)}</span>
              <span>
                Backfill: {ledger.backfill ? `${ledger.backfill.processed.toLocaleString()} records read, up to ${when(ledger.backfill.cursorAt)}` : "not started"}
              </span>
            </div>
          ) : (
            <p className="ar-empty">Ledger not readable yet. Run transaction-ledger.sql in Supabase.</p>
          )}
          <div className="ar-buttons">
            <button className="ar-btn" disabled={busy === "backfill"} onClick={() => void act("backfill", { action: "backfill" }, "Backfill batch done")} type="button">
              {busy === "backfill" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Run a backfill batch
            </button>
            <button className="ar-btn" disabled={busy === "sweep"} onClick={() => void act("sweep", { action: "sweep_agent" }, "ALLIE payments recorded")} type="button">
              {busy === "sweep" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Record ALLIE payments
            </button>
          </div>
        </section>

        {/* New campaign */}
        <section className="ar-section">
          <h2>New campaign</h2>
          <div className="ar-form">
            <div className="ar-grid">
              <label>
                Title
                <input className="ar-input" onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} />
              </label>
              <label>
                Ranks wallets by
                <select className="ar-input" onChange={(event) => setDraft({ ...draft, metric: event.target.value as CampaignMetric })} value={draft.metric}>
                  {(Object.keys(metricLabels) as CampaignMetric[]).map((metric) => (
                    <option key={metric} value={metric}>
                      {metricLabels[metric].name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Prize pool (USDC)
                <input className="ar-input" inputMode="decimal" onChange={(event) => setDraft({ ...draft, prizePoolUsdc: event.target.value })} value={draft.prizePoolUsdc} />
              </label>
              <label>
                Starts
                <input className="ar-input" onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} type="datetime-local" value={draft.startsAt} />
              </label>
              <label>
                Ends
                <input className="ar-input" onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} type="datetime-local" value={draft.endsAt} />
              </label>
              <label>
                Minimum payment (USDC)
                <input className="ar-input" inputMode="decimal" onChange={(event) => setDraft({ ...draft, minAmountUsd: event.target.value })} value={draft.minAmountUsd} />
              </label>
              <label>
                Payout
                <select className="ar-input" onChange={(event) => setDraft({ ...draft, payoutType: event.target.value as "top" | "threshold" })} value={draft.payoutType}>
                  <option value="top">Top places share the pool</option>
                  <option value="threshold">Fixed prize for everyone who qualifies</option>
                </select>
              </label>
              {draft.payoutType === "top" ? (
                <label>
                  Shares by place (%)
                  <input className="ar-input" onChange={(event) => setDraft({ ...draft, payoutSplits: event.target.value })} placeholder="50, 30, 20" value={draft.payoutSplits} />
                </label>
              ) : (
                <label>
                  Prize each (USDC)
                  <input className="ar-input" inputMode="decimal" onChange={(event) => setDraft({ ...draft, thresholdPrizeUsdc: event.target.value })} value={draft.thresholdPrizeUsdc} />
                </label>
              )}
              <label>
                Minimum score to place{draft.payoutType === "threshold" ? " (to qualify)" : ""}
                <input className="ar-input" inputMode="decimal" onChange={(event) => setDraft({ ...draft, minScore: event.target.value })} value={draft.minScore} />
              </label>
            </div>
            <p className="ar-hint">{metricLabels[draft.metric].hint}</p>
            <label>
              Description (shown to users)
              <textarea className="ar-input" onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} value={draft.description} />
            </label>
            <div>
              <p className="ar-hint">Payment types that count (none ticked = every eligible payment). Swaps and savings never count.</p>
              <div className="ar-buttons">
                {campaignSources.map((source) => (
                  <button
                    className={cn("ar-btn", draft.sources.includes(source) && "is-primary")}
                    key={source}
                    onClick={() => toggleSource(source)}
                    type="button"
                  >
                    {source}
                  </button>
                ))}
              </div>
            </div>
            <label>
              Excluded wallets (team, test accounts; one per line)
              <textarea className="ar-input" onChange={(event) => setDraft({ ...draft, excludedWallets: event.target.value })} rows={2} value={draft.excludedWallets} />
            </label>
            <button
              className="ar-btn is-primary"
              disabled={busy === "create" || !draft.title.trim() || !draft.startsAt || !draft.endsAt}
              onClick={() => void create()}
              type="button"
            >
              Create draft
            </button>
          </div>
        </section>

        {/* Campaigns */}
        <section className="ar-section">
          <h2>Campaigns</h2>
          {campaigns && campaigns.length === 0 ? <p className="ar-empty">No campaigns yet.</p> : null}
          {(campaigns ?? []).map((campaign) => {
            const reason = reasons[campaign.id] ?? "";
            const review = campaign.winners.filter((winner) => winner.status === "REVIEW");
            return (
              <article className="ar-row" key={campaign.id}>
                <div className="ar-facts">
                  <strong>{campaign.title}</strong>
                  <span className={cn("ar-tag", (campaign.status === "cancelled" || (campaign.status === "live" && campaign.phase === "ended")) && "is-warn")}>
                    {campaign.status === "live" ? `Live · ${campaign.phase}` : campaign.status}
                  </span>
                  <span>
                    {usdc(campaign.prize_pool_usdc)} · {metricLabels[campaign.metric].name} ·{" "}
                    {campaign.payout_type === "top"
                      ? `top ${campaign.payout_splits.length}: ${campaign.payout_splits.join(" / ")}%`
                      : `${usdc(campaign.threshold_prize_usdc)} each at ${campaign.min_score}+`}
                  </span>
                  <span>
                    {when(campaign.starts_at)} → {when(campaign.ends_at)}
                    {campaign.sources.length ? ` · ${campaign.sources.join(", ")}` : " · all payments"}
                    {campaign.min_amount_usd > 0 ? ` · ${usdc(campaign.min_amount_usd)}+` : ""}
                  </span>
                </div>

                <div className="ar-decision">
                  {campaign.status === "draft" || campaign.status === "live" ? (
                    <input
                      className="ar-input"
                      onChange={(event) => setReasons({ ...reasons, [campaign.id]: event.target.value })}
                      placeholder="Reason (needed to cancel)"
                      value={reason}
                    />
                  ) : null}
                  <div className="ar-buttons">
                    {campaign.status === "draft" ? (
                      <button className="ar-btn is-primary" disabled={busy === campaign.id} onClick={() => void act(campaign.id, { action: "publish", id: campaign.id }, "Live")} type="button">
                        Publish
                      </button>
                    ) : null}
                    {campaign.status !== "draft" && campaign.status !== "cancelled" ? (
                      <button className="ar-btn" disabled={busy === campaign.id} onClick={() => void act(campaign.id, { action: "leaderboard", id: campaign.id }, "Leaderboard loaded")} type="button">
                        Leaderboard
                      </button>
                    ) : null}
                    {campaign.status === "live" && campaign.phase === "ended" ? (
                      <button className="ar-btn is-primary" disabled={busy === campaign.id} onClick={() => void act(campaign.id, { action: "finalize", id: campaign.id }, "Results frozen. Review the winners below.")} type="button">
                        Finalize results
                      </button>
                    ) : null}
                    {campaign.status === "draft" || campaign.status === "live" ? (
                      <button className="ar-btn is-danger" disabled={busy === campaign.id || reason.trim().length < 3} onClick={() => void act(campaign.id, { action: "cancel", id: campaign.id, reason }, "Cancelled")} type="button">
                        Cancel campaign
                      </button>
                    ) : null}
                    {review.length > 0 ? (
                      <button className="ar-btn is-primary" disabled={busy === campaign.id} onClick={() => void act(campaign.id, { action: "pay_all", id: campaign.id, reason: "Paid from admin" }, "Payouts sent")} type="button">
                        Pay all {review.length} in review
                      </button>
                    ) : null}
                  </div>
                </div>

                {boards[campaign.id] ? (
                  <ol className="ar-form">
                    {boards[campaign.id].length === 0 ? <li className="ar-empty">No one on the board.</li> : null}
                    {boards[campaign.id].map((row) => (
                      <li className="ar-hint" key={row.rank}>
                        #{row.rank} {row.name} · score {row.score.toLocaleString()} · {row.payments} payments ·{" "}
                        {usdc(row.volume)} paid · {usdc(row.fees)} fees · {row.uniquePayees} people
                      </li>
                    ))}
                  </ol>
                ) : null}

                {campaign.winners.map((winner) => (
                  <div className="ar-row" key={winner.id}>
                    <div className="ar-facts">
                      <strong>
                        #{winner.rank} {winner.name} · {usdc(winner.amount_usdc)}
                      </strong>
                      <span className={cn("ar-tag", (winner.status === "PENDING" || winner.status === "REJECTED") && "is-warn")}>
                        {winner.status === "PENDING" ? "Payout unconfirmed" : winner.status.toLowerCase()}
                      </span>
                      <span>
                        {winner.wallet_address} · score {winner.score.toLocaleString()}
                      </span>
                      {winner.payout_tx_hash ? (
                        <a className="ar-hint" href={`${explorer}/tx/${winner.payout_tx_hash}`} rel="noreferrer" target="_blank">
                          Payout <ExternalLink className="inline h-3 w-3" />
                        </a>
                      ) : null}
                      {winner.last_error ? <span className="ar-error">{winner.last_error}</span> : null}
                      {winner.reason ? <span>Reason: {winner.reason}</span> : null}
                    </div>
                    {winner.status === "REVIEW" || winner.status === "PENDING" ? (
                      <div className="ar-decision">
                        <input
                          className="ar-input"
                          onChange={(event) => setReasons({ ...reasons, [winner.id]: event.target.value })}
                          placeholder="Reason (needed to reject)"
                          value={reasons[winner.id] ?? ""}
                        />
                        {winner.status === "PENDING" ? (
                          <input
                            className="ar-input"
                            onChange={(event) => setHashes({ ...hashes, [winner.id]: event.target.value.trim() })}
                            placeholder="Payout tx hash, if it went out (0x…)"
                            value={hashes[winner.id] ?? ""}
                          />
                        ) : null}
                        <div className="ar-buttons">
                          {winner.status === "REVIEW" ? (
                            <button className="ar-btn is-primary" disabled={busy === winner.id} onClick={() => void act(winner.id, { action: "pay_winner", id: winner.id, reason: reasons[winner.id] ?? "" }, "Paid")} type="button">
                              Pay {usdc(winner.amount_usdc)}
                            </button>
                          ) : (
                            <button className="ar-btn is-primary" disabled={busy === winner.id || !hashes[winner.id]} onClick={() => void act(winner.id, { action: "mark_winner_paid", id: winner.id, reason: reasons[winner.id] ?? "", txHash: hashes[winner.id] }, "Marked paid")} type="button">
                              Mark paid
                            </button>
                          )}
                          <button className="ar-btn is-danger" disabled={busy === winner.id || (reasons[winner.id] ?? "").trim().length < 3} onClick={() => void act(winner.id, { action: "reject_winner", id: winner.id, reason: reasons[winner.id] }, "Rejected")} type="button">
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
