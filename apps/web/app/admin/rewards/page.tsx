"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { adminLoadError, useAdminKey } from "@/components/admin/use-admin-key";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { arcChain } from "@/lib/chains";
import { cn } from "@/lib/utils";

import "./admin-rewards.css";

type QuestRule =
  | { type: "payments"; count: number }
  | { type: "volume"; usd: number }
  | { type: "streak"; days: number }
  | { type: "manual" };

type AdminData = {
  claims: Array<{
    amountUsdc: number;
    createdAt: string;
    id: string;
    kind: "review" | "stuck";
    lastError: string | null;
    wallet: string;
  }>;
  discounts: Array<{
    createdAt: string;
    id: string;
    lastError: string | null;
    pointsSpent: number;
    product: string;
    refundPercent: number;
    refundUsdc: number;
    wallet: string;
  }>;
  held: Array<{
    amountUsdc: number;
    createdAt: string;
    feeUsd: number;
    id: string;
    referred: string;
    referrer: string;
    source: string;
    tier: string;
    txHash: string;
  }>;
  quests: Array<{
    active: boolean;
    completions: number;
    description: string;
    endsAt: string | null;
    id: string;
    points: number;
    rule: QuestRule;
    ruleText: string;
    slug: string;
    startsAt: string;
    title: string;
  }>;
};

const explorer = arcChain.blockExplorers.default.url;

function short(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function when(value: string) {
  return new Date(value).toLocaleString();
}

function usd(value: number, digits = 2) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 2 })}`;
}

/** One queue row: a reason box (and a hash box when needed) above its buttons. */
function Decision({
  actions,
  busy,
  needsHash,
  onAct,
}: {
  actions: Array<{ action: string; label: string; needsHash?: boolean; tone?: "danger" | "primary" }>;
  busy: boolean;
  needsHash?: boolean;
  onAct: (action: string, fields: { reason: string; txHash: string }) => void;
}) {
  const [reason, setReason] = useState("");
  const [txHash, setTxHash] = useState("");
  return (
    <div className="ar-decision">
      <input
        className="ar-input"
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason (needed to reject or return)"
        value={reason}
      />
      {needsHash ? (
        <input
          className="ar-input"
          onChange={(event) => setTxHash(event.target.value.trim())}
          placeholder="Payout tx hash, if it went out (0x…)"
          value={txHash}
        />
      ) : null}
      <div className="ar-buttons">
        {actions.map((entry) => (
          <button
            className={cn("ar-btn", entry.tone === "danger" && "is-danger", entry.tone === "primary" && "is-primary")}
            disabled={busy || (entry.needsHash && !txHash)}
            key={entry.action}
            onClick={() => onAct(entry.action, { reason, txHash })}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const emptyQuest = {
  description: "",
  endsAt: "",
  points: "50",
  ruleType: "payments",
  ruleValue: "3",
  startsAt: "",
  title: "",
};

export default function AdminRewardsPage() {
  const { key: adminKey, ready: keyReady, setKey: setAdminKey } = useAdminKey();
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<"queues" | "quests">("queues");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);
  const [draft, setDraft] = useState(emptyQuest);
  const [awardWallet, setAwardWallet] = useState<Record<string, string>>({});
  const [awardReason, setAwardReason] = useState<Record<string, string>>({});

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
      const response = await fetch("/api/admin/rewards", { cache: "no-store", headers: headers() });
      const json = (await response.json()) as AdminData & { message?: string };
      if (!response.ok) throw new Error(adminLoadError(response.status, Boolean(adminKey), json.message || "Could not load."));
      setData(json);
      // A successful load clears an earlier load error (e.g. the first try,
      // before the key was entered); action results stay.
      setMessage((current) => (current?.tone === "error" ? null : current));
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "Could not load.", tone: "error" });
      setData(null);
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

  async function act(id: string, body: Record<string, unknown>, done: string) {
    setBusyId(id);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/rewards", {
        body: JSON.stringify({ id, ...body }),
        headers: headers(),
        method: "POST",
      });
      const json = (await response.json()) as { message?: string; txHash?: string };
      if (!response.ok) throw new Error(json.message || "That didn't work.");
      setMessage({ text: json.txHash ? `${done} · ${short(json.txHash)}` : done, tone: "ok" });
      await load();
      return true;
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "That didn't work.", tone: "error" });
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function ruleFromDraft(): QuestRule {
    const value = Number(draft.ruleValue);
    if (draft.ruleType === "payments") return { count: value, type: "payments" };
    if (draft.ruleType === "volume") return { type: "volume", usd: value };
    if (draft.ruleType === "streak") return { days: value, type: "streak" };
    return { type: "manual" };
  }

  async function createQuest() {
    const ok = await act(
      "new",
      {
        action: "create_quest",
        description: draft.description,
        endsAt: draft.endsAt || null,
        points: Number(draft.points),
        rule: ruleFromDraft(),
        startsAt: draft.startsAt || null,
        title: draft.title,
      },
      "Quest created",
    );
    if (ok) setDraft(emptyQuest);
  }

  const counts = data ? { claims: data.claims.length, discounts: data.discounts.length, held: data.held.length } : null;

  return (
    <PlatformChrome subtitle="Review queues and quests" title="Admin · Rewards">
      <div className="ar-page">
        <div className="ar-auth">
          <input
            className="ar-input"
            onChange={(event) => setAdminKey(event.target.value)}
            placeholder="Admin key (ADMIN_SECRET; optional in local dev)"
            type="password"
            value={adminKey}
          />
          <button className="ar-btn is-primary" disabled={loading} onClick={() => void load()} type="button">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {message ? <p className={cn("ar-message", message.tone === "error" && "is-error")}>{message.text}</p> : null}

        <div className="ar-tabs" role="tablist">
          <button aria-selected={tab === "queues"} className="ar-tab" onClick={() => setTab("queues")} role="tab" type="button">
            Review queues{counts ? ` (${counts.held + counts.claims + counts.discounts})` : ""}
          </button>
          <button aria-selected={tab === "quests"} className="ar-tab" onClick={() => setTab("quests")} role="tab" type="button">
            Quests{data ? ` (${data.quests.length})` : ""}
          </button>
        </div>

        {!data ? null : tab === "queues" ? (
          <>
            {/* Held referral earnings */}
            <section className="ar-section">
              <h2>Held referral earnings</h2>
              <p className="ar-hint">
                Commission from referrals flagged as risky. Release makes it claimable; reject reverses it.
              </p>
              {data.held.length === 0 ? <p className="ar-empty">Nothing held.</p> : null}
              {data.held.map((row) => (
                <article className="ar-row" key={row.id}>
                  <div className="ar-facts">
                    <strong>{usd(row.amountUsdc, 6)} USDC</strong>
                    <span>
                      Referrer {short(row.referrer)} · referral {short(row.referred)}
                    </span>
                    <span>
                      Fee {usd(row.feeUsd, 6)} · {row.tier.toLowerCase()} · {row.source} · {when(row.createdAt)}
                    </span>
                    <a href={`${explorer}/tx/${row.txHash}`} rel="noreferrer" target="_blank">
                      Transaction <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <Decision
                    actions={[
                      { action: "release_earning", label: "Release", tone: "primary" },
                      { action: "reject_earning", label: "Reject", tone: "danger" },
                    ]}
                    busy={busyId === row.id}
                    onAct={(action, fields) =>
                      void act(row.id, { action, reason: fields.reason }, action === "release_earning" ? "Released" : "Rejected")
                    }
                  />
                </article>
              ))}
            </section>

            {/* Referral claims */}
            <section className="ar-section">
              <h2>Referral claims</h2>
              <p className="ar-hint">
                &quot;Over the limit&quot;: above the automatic payout cap, waiting for approval. &quot;Unconfirmed&quot;: the
                payout&apos;s outcome is unknown. Check the treasury on the explorer before marking it paid or returning it.
              </p>
              {data.claims.length === 0 ? <p className="ar-empty">No claims waiting.</p> : null}
              {data.claims.map((row) => (
                <article className="ar-row" key={row.id}>
                  <div className="ar-facts">
                    <strong>{usd(row.amountUsdc)} USDC</strong>
                    <span className={cn("ar-tag", row.kind === "stuck" && "is-warn")}>
                      {row.kind === "review" ? "Over the limit" : "Unconfirmed"}
                    </span>
                    <span>
                      To {short(row.wallet)} · {when(row.createdAt)}
                    </span>
                    {row.lastError ? <span className="ar-error">{row.lastError}</span> : null}
                  </div>
                  <Decision
                    actions={
                      row.kind === "review"
                        ? [
                            { action: "pay_claim", label: "Pay now", tone: "primary" },
                            { action: "return_claim", label: "Return earnings" },
                            { action: "reject_claim", label: "Reject (fraud)", tone: "danger" },
                          ]
                        : [
                            { action: "mark_claim_paid", label: "Mark paid", needsHash: true, tone: "primary" },
                            { action: "return_claim", label: "Not sent: return earnings" },
                          ]
                    }
                    busy={busyId === row.id}
                    needsHash={row.kind === "stuck"}
                    onAct={(action, fields) =>
                      void act(row.id, { action, reason: fields.reason, txHash: fields.txHash }, "Done")
                    }
                  />
                </article>
              ))}
            </section>

            {/* Discount refunds */}
            <section className="ar-section">
              <h2>Discount refunds</h2>
              <p className="ar-hint">
                Refunds whose payout couldn&apos;t be confirmed. If it went out, mark it paid; if not, fail it and the
                points go back.
              </p>
              {data.discounts.length === 0 ? <p className="ar-empty">No refunds waiting.</p> : null}
              {data.discounts.map((row) => (
                <article className="ar-row" key={row.id}>
                  <div className="ar-facts">
                    <strong>{usd(row.refundUsdc)} USDC</strong>
                    <span>
                      {row.refundPercent}% of {row.product} · {row.pointsSpent} points · {short(row.wallet)}
                    </span>
                    <span>{when(row.createdAt)}</span>
                    {row.lastError ? <span className="ar-error">{row.lastError}</span> : null}
                  </div>
                  <Decision
                    actions={[
                      { action: "mark_discount_paid", label: "Mark paid", needsHash: true, tone: "primary" },
                      { action: "fail_discount", label: "Not sent: return points", tone: "danger" },
                    ]}
                    busy={busyId === row.id}
                    needsHash
                    onAct={(action, fields) =>
                      void act(row.id, { action, reason: fields.reason, txHash: fields.txHash }, "Done")
                    }
                  />
                </article>
              ))}
            </section>
          </>
        ) : (
          <>
            {/* New quest */}
            <section className="ar-section">
              <h2>New quest</h2>
              <div className="ar-form">
                <input
                  className="ar-input"
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Title, e.g. Send 3 payments this week"
                  value={draft.title}
                />
                <input
                  className="ar-input"
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="Description (optional; the rule is shown if empty)"
                  value={draft.description}
                />
                <div className="ar-grid">
                  <label>
                    Points
                    <input
                      className="ar-input"
                      inputMode="decimal"
                      onChange={(event) => setDraft({ ...draft, points: event.target.value })}
                      value={draft.points}
                    />
                  </label>
                  <label>
                    Rule
                    <select
                      className="ar-input"
                      onChange={(event) => setDraft({ ...draft, ruleType: event.target.value })}
                      value={draft.ruleType}
                    >
                      <option value="payments">Number of payments</option>
                      <option value="volume">Total paid (USD)</option>
                      <option value="streak">Streak length (days)</option>
                      <option value="manual">Awarded by hand</option>
                    </select>
                  </label>
                  {draft.ruleType !== "manual" ? (
                    <label>
                      {draft.ruleType === "payments" ? "Payments" : draft.ruleType === "volume" ? "USD" : "Days"}
                      <input
                        className="ar-input"
                        inputMode="decimal"
                        onChange={(event) => setDraft({ ...draft, ruleValue: event.target.value })}
                        value={draft.ruleValue}
                      />
                    </label>
                  ) : null}
                  <label>
                    Starts (empty = now)
                    <input
                      className="ar-input"
                      onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
                      type="datetime-local"
                      value={draft.startsAt}
                    />
                  </label>
                  <label>
                    Ends (optional)
                    <input
                      className="ar-input"
                      onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
                      type="datetime-local"
                      value={draft.endsAt}
                    />
                  </label>
                </div>
                <p className="ar-hint">
                  Payments and total paid count only between the start and end. Points are paid once per person, as soon
                  as they finish.
                </p>
                <button
                  className="ar-btn is-primary"
                  disabled={busyId === "new" || !draft.title.trim()}
                  onClick={() => void createQuest()}
                  type="button"
                >
                  Create quest
                </button>
              </div>
            </section>

            {/* Quests */}
            <section className="ar-section">
              <h2>Quests</h2>
              {data.quests.length === 0 ? <p className="ar-empty">No quests yet.</p> : null}
              {data.quests.map((quest) => {
                const ended = quest.endsAt ? new Date(quest.endsAt).getTime() < Date.now() : false;
                const upcoming = new Date(quest.startsAt).getTime() > Date.now();
                return (
                  <article className="ar-row" key={quest.id}>
                    <div className="ar-facts">
                      <strong>{quest.title}</strong>
                      <span className={cn("ar-tag", (!quest.active || ended) && "is-warn")}>
                        {!quest.active ? "Paused" : ended ? "Ended" : upcoming ? "Scheduled" : "Live"}
                      </span>
                      <span>
                        {quest.ruleText} · {quest.points} points · {quest.completions} completed
                      </span>
                      <span>
                        {when(quest.startsAt)}
                        {quest.endsAt ? ` → ${when(quest.endsAt)}` : " → no end"}
                      </span>
                    </div>
                    <div className="ar-decision">
                      <div className="ar-buttons">
                        <button
                          className="ar-btn"
                          disabled={busyId === quest.id}
                          onClick={() =>
                            void act(quest.id, { action: "set_quest_active", active: !quest.active }, quest.active ? "Paused" : "Activated")
                          }
                          type="button"
                        >
                          {quest.active ? "Pause" : "Activate"}
                        </button>
                      </div>
                      <input
                        className="ar-input"
                        onChange={(event) => setAwardWallet({ ...awardWallet, [quest.id]: event.target.value.trim() })}
                        placeholder="Award to wallet (0x…)"
                        value={awardWallet[quest.id] ?? ""}
                      />
                      <input
                        className="ar-input"
                        onChange={(event) => setAwardReason({ ...awardReason, [quest.id]: event.target.value })}
                        placeholder="Reason"
                        value={awardReason[quest.id] ?? ""}
                      />
                      <div className="ar-buttons">
                        <button
                          className="ar-btn is-primary"
                          disabled={busyId === quest.id || !awardWallet[quest.id]}
                          onClick={() =>
                            void act(
                              quest.id,
                              { action: "award_quest", reason: awardReason[quest.id] ?? "", wallet: awardWallet[quest.id] },
                              "Awarded",
                            )
                          }
                          type="button"
                        >
                          Award
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          </>
        )}
      </div>
    </PlatformChrome>
  );
}
