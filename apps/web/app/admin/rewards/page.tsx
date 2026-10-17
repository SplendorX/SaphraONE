"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { adminLoadError, useAdminKey } from "@/components/admin/use-admin-key";
import { AdminPageHeader } from "@/components/admin/admin-shell";
import { arcChain } from "@/lib/chains";
import {
  describeQuestRule,
  QUEST_AUDIENCES,
  QUEST_TYPES,
  readQuestRule,
  SOCIAL_PLATFORMS,
  type QuestAudience,
  type QuestRule,
  type QuestRuleType,
} from "@/lib/rewards/quest-rules";
import { cn } from "@/lib/utils";

import "./admin-rewards.css";

type AdminQuest = {
  active: boolean;
  audience: QuestAudience;
  completions: number;
  description: string;
  endsAt: string | null;
  id: string;
  maxCompletions: number | null;
  points: number;
  reward: { kind: "fixed"; points: number } | { kind: "percent"; percent: number; maxPoints: number };
  rewardText: string;
  rule: QuestRule;
  ruleText: string;
  slug: string;
  startsAt: string;
  title: string;
};

type QuestCompletion = { completedAt: string; points: number | null; username: string | null; wallet: string };

const questGroups = ["Payments", "Activity", "Features", "Business", "Other"] as const;

function audienceLabel(audience: QuestAudience) {
  return QUEST_AUDIENCES.find(([value]) => value === audience)?.[1] ?? "Everyone";
}

/** An ISO time as a datetime-local value, in the admin's own time zone. */
function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

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
  quests: AdminQuest[];
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
  audience: "all" as QuestAudience,
  count: "3",
  days: "7",
  description: "",
  endsAt: "",
  maxCompletions: "",
  minUsd: "",
  percent: "10",
  points: "50",
  rewardKind: "fixed" as "fixed" | "percent",
  ruleType: "payments" as QuestRuleType,
  socialPlatform: "x",
  socialUrl: "",
  startsAt: "",
  title: "",
  usd: "100",
};

export default function AdminRewardsPage() {
  // Signed in on the admin platform: its owner key, or none for a team member's own account.
  const { key: adminKey, ready: keyReady } = useAdminKey();
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<"queues" | "quests">("queues");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);
  const [draft, setDraft] = useState(emptyQuest);
  const [awardWallet, setAwardWallet] = useState<Record<string, string>>({});
  const [awardReason, setAwardReason] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [completions, setCompletions] = useState<Record<string, QuestCompletion[] | "loading" | undefined>>({});
  const formRef = useRef<HTMLElement>(null);

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

  const draftType = QUEST_TYPES[draft.ruleType];
  const percentReward = Boolean(draftType.percent) && draft.rewardKind === "percent";

  /**
   * The rule as typed. Sent unchecked so the server can refuse a bad number
   * instead of quietly turning it into a hand-awarded quest.
   */
  function rawRuleFromDraft(): Record<string, unknown> {
    const type = draft.ruleType;
    if (type === "social") return { platform: draft.socialPlatform, type, url: draft.socialUrl.trim() };
    const minUsd = draftType.minUsd && draft.minUsd.trim() ? { minUsd: Number(draft.minUsd) } : {};
    if (draftType.param === "count") return { count: Number(draft.count), type, ...minUsd };
    if (draftType.param === "usd") return { type, usd: Number(draft.usd) };
    if (draftType.param === "days") return { days: Number(draft.days), type };
    return { type };
  }

  /** How the rule will read, for the preview line. */
  function ruleFromDraft(): QuestRule {
    return readQuestRule(rawRuleFromDraft());
  }

  const socialUrlValid = /^https:\/\/[^\s/]+\.[^\s]+/i.test(draft.socialUrl.trim());

  /** Fills the form from a quest: to change it, or as a copy for a new one. */
  function startEdit(quest: AdminQuest, copy: boolean) {
    const rule = quest.rule as QuestRule & { count?: number; days?: number; minUsd?: number; usd?: number; platform?: string; url?: string };
    setDraft({
      ...emptyQuest,
      audience: quest.audience,
      count: rule.count ? String(rule.count) : emptyQuest.count,
      days: rule.days ? String(rule.days) : emptyQuest.days,
      description: quest.description,
      endsAt: copy ? "" : toLocalInput(quest.endsAt),
      maxCompletions: quest.maxCompletions ? String(quest.maxCompletions) : "",
      minUsd: rule.minUsd ? String(rule.minUsd) : "",
      percent: quest.reward.kind === "percent" ? String(quest.reward.percent) : emptyQuest.percent,
      points: String(quest.points),
      rewardKind: quest.reward.kind,
      ruleType: rule.type,
      socialPlatform: rule.platform ?? emptyQuest.socialPlatform,
      socialUrl: rule.url ?? "",
      startsAt: copy ? "" : toLocalInput(quest.startsAt),
      title: copy ? `${quest.title} (copy)` : quest.title,
      usd: rule.usd ? String(rule.usd) : emptyQuest.usd,
    });
    setEditingId(copy ? null : quest.id);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveQuest() {
    const editing = data?.quests.find((quest) => quest.id === editingId) ?? null;
    const fields = {
      audience: draftType.businessOnly ? "business" : draft.audience,
      description: draft.description,
      endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null,
      maxCompletions: draft.maxCompletions.trim() ? Number(draft.maxCompletions) : null,
      points: Number(draft.points),
      rewardPercent: percentReward ? Number(draft.percent) : null,
      rule: rawRuleFromDraft(),
      startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
      title: draft.title,
    };
    const ok = editing
      ? await act(editing.id, { action: "update_quest", active: editing.active, ...fields }, "Quest saved")
      : await act("new", { action: "create_quest", ...fields }, "Quest created");
    if (ok) {
      setDraft(emptyQuest);
      setEditingId(null);
    }
  }

  async function toggleCompletions(id: string) {
    if (completions[id]) {
      setCompletions((current) => ({ ...current, [id]: undefined }));
      return;
    }
    setCompletions((current) => ({ ...current, [id]: "loading" }));
    try {
      const response = await fetch("/api/admin/rewards", {
        body: JSON.stringify({ action: "quest_completions", id }),
        headers: headers(),
        method: "POST",
      });
      const json = (await response.json()) as { completions?: QuestCompletion[]; message?: string };
      if (!response.ok) throw new Error(json.message || "Could not load.");
      setCompletions((current) => ({ ...current, [id]: json.completions ?? [] }));
    } catch (cause) {
      setCompletions((current) => ({ ...current, [id]: undefined }));
      setMessage({ text: cause instanceof Error ? cause.message : "Could not load.", tone: "error" });
    }
  }

  const counts = data ? { claims: data.claims.length, discounts: data.discounts.length, held: data.held.length } : null;

  return (
    <div>
      <AdminPageHeader subtitle="Review queues and quests" title="Rewards" />
      <div className="ar-page">
        <div className="ar-auth">
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
            {/* New or edited quest */}
            <section className="ar-section" ref={formRef}>
              <h2>{editingId ? "Edit quest" : "New quest"}</h2>
              <div className="ar-form">
                <input
                  className="ar-input"
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Title, e.g. Your first $100 payment"
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
                    What to do
                    <select
                      className="ar-input"
                      onChange={(event) => setDraft({ ...draft, ruleType: event.target.value as QuestRuleType })}
                      value={draft.ruleType}
                    >
                      {questGroups.map((group) => (
                        <optgroup key={group} label={group}>
                          {(Object.entries(QUEST_TYPES) as Array<[QuestRuleType, (typeof QUEST_TYPES)[QuestRuleType]]>)
                            .filter(([, info]) => info.group === group)
                            .map(([value, info]) => (
                              <option key={value} value={value}>
                                {info.label}
                                {info.businessOnly ? " (business)" : ""}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  {draftType.param === "count" ? (
                    <label>
                      How many times
                      <input
                        className="ar-input"
                        inputMode="numeric"
                        onChange={(event) => setDraft({ ...draft, count: event.target.value })}
                        value={draft.count}
                      />
                    </label>
                  ) : draftType.param === "usd" ? (
                    <label>
                      Amount (USD)
                      <input
                        className="ar-input"
                        inputMode="decimal"
                        onChange={(event) => setDraft({ ...draft, usd: event.target.value })}
                        value={draft.usd}
                      />
                    </label>
                  ) : draftType.param === "days" ? (
                    <label>
                      Days
                      <input
                        className="ar-input"
                        inputMode="numeric"
                        onChange={(event) => setDraft({ ...draft, days: event.target.value })}
                        value={draft.days}
                      />
                    </label>
                  ) : null}
                  {draftType.minUsd ? (
                    <label>
                      Each at least (USD, optional)
                      <input
                        className="ar-input"
                        inputMode="decimal"
                        onChange={(event) => setDraft({ ...draft, minUsd: event.target.value })}
                        placeholder="Any amount"
                        value={draft.minUsd}
                      />
                    </label>
                  ) : null}
                  {draft.ruleType === "social" ? (
                    <>
                      <label>
                        Platform
                        <select
                          className="ar-input"
                          onChange={(event) => setDraft({ ...draft, socialPlatform: event.target.value })}
                          value={draft.socialPlatform}
                        >
                          {Object.entries(SOCIAL_PLATFORMS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Account link
                        <input
                          className="ar-input"
                          inputMode="url"
                          onChange={(event) => setDraft({ ...draft, socialUrl: event.target.value })}
                          placeholder="https://x.com/saphraone"
                          value={draft.socialUrl}
                        />
                      </label>
                    </>
                  ) : null}
                  <label>
                    Who it&apos;s for
                    <select
                      className="ar-input"
                      disabled={Boolean(draftType.businessOnly)}
                      onChange={(event) => setDraft({ ...draft, audience: event.target.value as QuestAudience })}
                      value={draftType.businessOnly ? "business" : draft.audience}
                    >
                      {QUEST_AUDIENCES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Reward
                    <select
                      className="ar-input"
                      disabled={!draftType.percent}
                      onChange={(event) => setDraft({ ...draft, rewardKind: event.target.value as "fixed" | "percent" })}
                      value={draftType.percent ? draft.rewardKind : "fixed"}
                    >
                      <option value="fixed">Fixed points</option>
                      <option value="percent">% of the payment back</option>
                    </select>
                  </label>
                  {percentReward ? (
                    <label>
                      Percent back
                      <input
                        className="ar-input"
                        inputMode="decimal"
                        onChange={(event) => setDraft({ ...draft, percent: event.target.value })}
                        value={draft.percent}
                      />
                    </label>
                  ) : null}
                  <label>
                    {percentReward ? "Most points" : "Points"}
                    <input
                      className="ar-input"
                      inputMode="decimal"
                      onChange={(event) => setDraft({ ...draft, points: event.target.value })}
                      value={draft.points}
                    />
                  </label>
                  <label>
                    First N people only (optional)
                    <input
                      className="ar-input"
                      inputMode="numeric"
                      onChange={(event) => setDraft({ ...draft, maxCompletions: event.target.value })}
                      placeholder="No limit"
                      value={draft.maxCompletions}
                    />
                  </label>
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
                  <strong>{describeQuestRule(ruleFromDraft())}</strong>
                  {" · "}
                  {percentReward
                    ? `${draft.percent || "?"}% of the payment back in points, up to ${draft.points || "?"}`
                    : `${draft.points || "?"} points`}
                  {draft.maxCompletions ? ` · first ${draft.maxCompletions} people` : ""}
                </p>
                <p className="ar-hint">
                  Everything except follow and hand-awarded quests completes on its own: payments are read back from
                  Arc, and features from their own records. Things done count only between the start and end; a state
                  (2FA on, verified, the current streak) counts whenever it is true. Points are paid once per person.
                  Follow quests show a Follow button; the person claims after opening the link.
                </p>
                <div className="ar-buttons">
                  <button
                    className="ar-btn is-primary"
                    disabled={busyId === (editingId ?? "new") || !draft.title.trim() || (draft.ruleType === "social" && !socialUrlValid)}
                    onClick={() => void saveQuest()}
                    type="button"
                  >
                    {editingId ? "Save changes" : "Create quest"}
                  </button>
                  {editingId ? (
                    <button
                      className="ar-btn"
                      onClick={() => {
                        setEditingId(null);
                        setDraft(emptyQuest);
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            {/* Quests */}
            <section className="ar-section">
              <h2>Quests</h2>
              {data.quests.length === 0 ? <p className="ar-empty">No quests yet.</p> : null}
              {data.quests.map((quest) => {
                const ended = quest.endsAt ? new Date(quest.endsAt).getTime() < Date.now() : false;
                const upcoming = new Date(quest.startsAt).getTime() > Date.now();
                const full = quest.maxCompletions !== null && quest.completions >= quest.maxCompletions;
                const list = completions[quest.id];
                return (
                  <article className="ar-row" key={quest.id}>
                    <div className="ar-facts">
                      <strong>{quest.title}</strong>
                      <span className={cn("ar-tag", (!quest.active || ended || full) && "is-warn")}>
                        {!quest.active ? "Paused" : ended ? "Ended" : full ? "Full" : upcoming ? "Scheduled" : "Live"}
                      </span>
                      <span>
                        {quest.ruleText} · {quest.rewardText}
                      </span>
                      <span>
                        {audienceLabel(quest.audience)} · {quest.completions}
                        {quest.maxCompletions !== null ? ` of ${quest.maxCompletions}` : ""} completed
                      </span>
                      <span>
                        {when(quest.startsAt)}
                        {quest.endsAt ? ` → ${when(quest.endsAt)}` : " → no end"}
                      </span>
                    </div>
                    <div className="ar-decision">
                      <div className="ar-buttons">
                        <button className="ar-btn" onClick={() => startEdit(quest, false)} type="button">
                          Edit
                        </button>
                        <button className="ar-btn" onClick={() => startEdit(quest, true)} type="button">
                          Duplicate
                        </button>
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
                        {!ended ? (
                          <button
                            className="ar-btn"
                            disabled={busyId === quest.id}
                            onClick={() => void act(quest.id, { action: "end_quest" }, "Ended")}
                            type="button"
                          >
                            End now
                          </button>
                        ) : null}
                        {quest.completions === 0 ? (
                          confirmDelete === quest.id ? (
                            <>
                              <button
                                className="ar-btn is-danger"
                                disabled={busyId === quest.id}
                                onClick={() => {
                                  setConfirmDelete(null);
                                  void act(quest.id, { action: "delete_quest" }, "Deleted");
                                }}
                                type="button"
                              >
                                Delete for good
                              </button>
                              <button className="ar-btn" onClick={() => setConfirmDelete(null)} type="button">
                                Keep
                              </button>
                            </>
                          ) : (
                            <button className="ar-btn is-danger" onClick={() => setConfirmDelete(quest.id)} type="button">
                              Delete
                            </button>
                          )
                        ) : (
                          <button className="ar-btn" onClick={() => void toggleCompletions(quest.id)} type="button">
                            {list ? "Hide who completed" : "Who completed"}
                          </button>
                        )}
                      </div>
                      {list ? (
                        list === "loading" ? (
                          <p className="ar-hint">Loading…</p>
                        ) : list.length === 0 ? (
                          <p className="ar-hint">Nobody yet.</p>
                        ) : (
                          <ul className="ar-completions">
                            {list.map((entry) => (
                              <li key={entry.wallet}>
                                <span>{entry.username ? `${entry.username}.one` : short(entry.wallet)}</span>
                                <span>{entry.points !== null ? `${entry.points} pts` : ""}</span>
                                <span>{when(entry.completedAt)}</span>
                              </li>
                            ))}
                          </ul>
                        )
                      ) : null}
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
    </div>
  );
}
