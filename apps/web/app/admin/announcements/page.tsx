"use client";

import { AlertTriangle, Loader2, Megaphone, Moon, Pin, Plus, RefreshCw, Sparkles, Sun, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { AnnouncementCard } from "@/components/dashboard/announcements";
import {
  announcementLimits,
  announcementState,
  type AnnouncementTone,
  type TeamAnnouncement,
} from "@/lib/announcements/rules";
import type { Announcement } from "@/lib/announcements/service";
import { cn } from "@/lib/utils";

import "./announcements-admin.css";

const tones: Array<{ hint: string; icon: typeof Megaphone; label: string; tone: AnnouncementTone }> = [
  { hint: "News and launches", icon: Megaphone, label: "News", tone: "news" },
  { hint: "Something people must act on", icon: AlertTriangle, label: "Important", tone: "important" },
  { hint: "A new feature or change", icon: Sparkles, label: "Update", tone: "update" },
  { hint: "Planned downtime", icon: Wrench, label: "Maintenance", tone: "maintenance" },
];

const badgeIdeas = ["New", "Action needed", "Heads up", "Limited time"];

type Draft = {
  badge: string;
  body: string;
  dismissible: boolean;
  endsAt: string;
  href: string;
  pinned: boolean;
  startsAt: string;
  title: string;
  tone: AnnouncementTone;
};

const emptyDraft: Draft = {
  badge: "",
  body: "",
  dismissible: true,
  endsAt: "",
  href: "",
  pinned: false,
  startsAt: "",
  title: "",
  tone: "news",
};

type Filter = "all" | "live" | "scheduled" | "draft" | "ended";

const stateLabels: Record<Exclude<Filter, "all">, string> = {
  draft: "Draft",
  ended: "Ended",
  live: "Live",
  scheduled: "Scheduled",
};

/** An ISO time as a datetime-local value, in local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toIso(local: string) {
  return local ? new Date(local).toISOString() : null;
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
}

function windowText(row: TeamAnnouncement) {
  const start = when(row.starts_at);
  const end = when(row.ends_at);
  if (start && end) return `${start} → ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return "No end date";
}

/**
 * Team announcements: write a card, see it exactly as Home shows it, then
 * publish it to everyone now or on a schedule. Live cards lead Home's row of
 * campaigns and quests (lib/announcements/service.ts).
 */
export default function AdminAnnouncementsPage() {
  const { adminFetch } = useAdmin();
  const [rows, setRows] = useState<TeamAnnouncement[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [previewDark, setPreviewDark] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch("/api/admin/announcements");
      const body = (await response.json().catch(() => null)) as
        | { announcements?: TeamAnnouncement[]; message?: string }
        | null;
      if (!response.ok || !body?.announcements) throw new Error(body?.message ?? "Couldn't load announcements.");
      setRows(body.announcements);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load announcements.");
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(key: string, payload: Record<string, unknown>, done: string) {
    setBusy(key);
    setNotice(null);
    try {
      const response = await adminFetch("/api/admin/announcements", {
        body: JSON.stringify(payload),
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? "Couldn't save the announcement.");
      setError(null);
      setNotice(done);
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the announcement.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function fields() {
    return {
      badge: draft.badge,
      body: draft.body,
      dismissible: draft.dismissible,
      endsAt: toIso(draft.endsAt),
      href: draft.href,
      pinned: draft.pinned,
      startsAt: toIso(draft.startsAt),
      title: draft.title,
      tone: draft.tone,
    };
  }

  async function save(publish: boolean) {
    const ok = editing
      ? await send("save", { action: "update", id: editing, ...fields() }, "Changes saved.")
      : await send(
          "save",
          { action: "create", publish, ...fields() },
          publish
            ? draft.startsAt && new Date(draft.startsAt) > new Date()
              ? "Scheduled. It goes live on its start date."
              : "Published. Everyone sees it on Home now."
            : "Saved as a draft.",
        );
    if (ok) {
      setDraft(emptyDraft);
      setEditing(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save(true);
  }

  function edit(row: TeamAnnouncement) {
    setEditing(row.id);
    setDraft({
      badge: row.badge,
      body: row.body,
      dismissible: row.dismissible,
      endsAt: toLocalInput(row.ends_at),
      href: row.href,
      pinned: row.pinned,
      startsAt: toLocalInput(row.starts_at),
      title: row.title,
      tone: row.tone,
    });
    setNotice(null);
    window.scrollTo({ behavior: "smooth", top: 0 });
  }

  const preview: Announcement = {
    badge: draft.badge.trim(),
    body: draft.body.trim(),
    dismissible: draft.dismissible,
    href: draft.href.trim(),
    id: "preview",
    kind: "notice",
    publishedAt: new Date().toISOString(),
    title: draft.title.trim() || "Your headline",
    tone: draft.tone,
  };

  const counted = useMemo(() => {
    const now = new Date();
    return (rows ?? []).map((row) => ({ row, state: announcementState(row, now) }));
  }, [rows]);
  const counts = counted.reduce<Record<Filter, number>>(
    (sum, { state }) => ({ ...sum, all: sum.all + 1, [state]: sum[state] + 1 }),
    { all: 0, draft: 0, ended: 0, live: 0, scheduled: 0 },
  );
  const shown = counted.filter(({ state }) => filter === "all" || state === filter);
  const liveNow = counted.filter(({ state }) => state === "live").length;

  return (
    <div className="an-admin">
      <div className="adm-page-head">
        <div>
          <h1 className="adm-title">Announcements</h1>
          <p className="adm-subtitle">
            Post important news to everyone. It shows as a card on Home, before campaigns and quests.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("adm-chip", liveNow > 0 && "is-good")}>{liveNow} live now</span>
          <button className="an-btn" disabled={loading} onClick={() => void load()} type="button">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
      </div>

      {error ? <p className="adm-error mb-4">{error}</p> : null}
      {notice ? <p className="an-notice">{notice}</p> : null}

      <div className="an-workspace">
        {/* Composer */}
        <form className="adm-card an-composer" onSubmit={onSubmit}>
          <div className="an-composer-head">
            <h2>{editing ? "Edit announcement" : "New announcement"}</h2>
            {editing ? (
              <button
                className="an-link-btn"
                onClick={() => {
                  setEditing(null);
                  setDraft(emptyDraft);
                }}
                type="button"
              >
                <Plus className="h-3.5 w-3.5" /> Start a new one
              </button>
            ) : null}
          </div>

          <fieldset className="an-field">
            <legend>Style</legend>
            <div className="an-tones" role="radiogroup">
              {tones.map(({ hint, icon: Icon, label, tone }) => (
                <button
                  aria-checked={draft.tone === tone}
                  className={cn("an-tone", draft.tone === tone && "is-on")}
                  data-tone={tone}
                  key={tone}
                  onClick={() => setDraft({ ...draft, tone })}
                  role="radio"
                  type="button"
                >
                  <span className="an-tone-swatch">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="an-tone-text">
                    <strong>{label}</strong>
                    <span>{hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="an-field">
            <span className="an-label-row">
              Headline
              <Counter max={announcementLimits.title} value={draft.title} />
            </span>
            <input
              className="an-input"
              maxLength={announcementLimits.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Scheduled maintenance on Sunday"
              required
              value={draft.title}
            />
          </label>

          <label className="an-field">
            <span className="an-label-row">
              Message
              <Counter max={announcementLimits.body} value={draft.body} />
            </span>
            <textarea
              className="an-input an-textarea"
              maxLength={announcementLimits.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              placeholder="Payments pause from 02:00 to 02:30 UTC while we upgrade. Your money is safe."
              rows={3}
              value={draft.body}
            />
            <span className="an-hint">Home shows the first two lines.</span>
          </label>

          <div className="an-two">
            <label className="an-field">
              <span className="an-label-row">
                Badge <em>optional</em>
                <Counter max={announcementLimits.badge} value={draft.badge} />
              </span>
              <input
                className="an-input"
                maxLength={announcementLimits.badge}
                onChange={(event) => setDraft({ ...draft, badge: event.target.value })}
                placeholder="New"
                value={draft.badge}
              />
              <span className="an-ideas">
                {badgeIdeas.map((idea) => (
                  <button key={idea} onClick={() => setDraft({ ...draft, badge: idea })} type="button">
                    {idea}
                  </button>
                ))}
              </span>
            </label>
            <label className="an-field">
              <span className="an-label-row">
                Link <em>optional</em>
              </span>
              <input
                className="an-input"
                onChange={(event) => setDraft({ ...draft, href: event.target.value })}
                placeholder="/rewards or https://saphra.one/blog/…"
                value={draft.href}
              />
              <span className="an-hint">Where the card opens. Empty: it&apos;s just a notice.</span>
            </label>
          </div>

          <div className="an-two">
            <label className="an-field">
              <span className="an-label-row">
                Starts <em>optional</em>
              </span>
              <input
                className="an-input"
                onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
                type="datetime-local"
                value={draft.startsAt}
              />
              <span className="an-hint">Empty: as soon as it&apos;s published.</span>
            </label>
            <label className="an-field">
              <span className="an-label-row">
                Ends <em>optional</em>
              </span>
              <input
                className="an-input"
                onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
                type="datetime-local"
                value={draft.endsAt}
              />
              <span className="an-hint">Empty: until you end it.</span>
            </label>
          </div>

          <div className="an-switches">
            <Switch
              checked={draft.pinned}
              hint="Shows before every other card"
              label="Pin to the front"
              onChange={(pinned) => setDraft({ ...draft, pinned })}
            />
            <Switch
              checked={draft.dismissible}
              hint="Off for notices everyone must see until they end"
              label="People can close it"
              onChange={(dismissible) => setDraft({ ...draft, dismissible })}
            />
          </div>

          <div className="an-actions">
            {editing ? (
              <button className="an-btn is-primary" disabled={busy === "save"} type="submit">
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save changes
              </button>
            ) : (
              <>
                <button className="an-btn is-primary" disabled={busy === "save"} type="submit">
                  {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                  {draft.startsAt && new Date(draft.startsAt) > new Date() ? "Schedule" : "Publish to everyone"}
                </button>
                <button className="an-btn" disabled={busy === "save"} onClick={() => void save(false)} type="button">
                  Save draft
                </button>
              </>
            )}
          </div>
        </form>

        {/* Live preview */}
        <aside className="adm-card an-preview">
          <div className="an-preview-head">
            <h2>Preview on Home</h2>
            <div className="an-seg" role="group">
              <button aria-pressed={!previewDark} onClick={() => setPreviewDark(false)} type="button">
                <Sun className="h-3.5 w-3.5" /> Light
              </button>
              <button aria-pressed={previewDark} onClick={() => setPreviewDark(true)} type="button">
                <Moon className="h-3.5 w-3.5" /> Dark
              </button>
            </div>
          </div>
          <div className={cn("an-phone", previewDark && "dark")}>
            <div className="an-phone-notch" />
            <p className="an-phone-hello">Good afternoon,</p>
            <p className="an-phone-name">Ada</p>
            <div className="an-phone-balance" />
            <div className="ann" data-count="1">
              <AnnouncementCard item={preview} onDismiss={() => undefined} />
            </div>
            <div className="an-phone-row" />
            <div className="an-phone-row is-short" />
          </div>
          <p className="an-hint">
            {draft.pinned ? "Pinned: first in the row. " : ""}
            {draft.dismissible ? "People can close it with ×." : "No ×: it stays until it ends."}
          </p>
        </aside>
      </div>

      {/* Everything posted */}
      <section className="adm-card an-list">
        <div className="an-list-head">
          <h2>All announcements</h2>
          <div className="an-filters" role="tablist">
            {(["all", "live", "scheduled", "draft", "ended"] as const).map((key) => (
              <button
                aria-selected={filter === key}
                className={cn(filter === key && "is-on")}
                key={key}
                onClick={() => setFilter(key)}
                role="tab"
                type="button"
              >
                {key === "all" ? "All" : stateLabels[key]}
                <span>{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>

        {rows === null && loading ? (
          <div className="adm-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : shown.length === 0 ? (
          <p className="adm-empty">
            {counts.all === 0 ? "Nothing posted yet. Write your first announcement above." : "None here."}
          </p>
        ) : (
          <ul className="an-rows">
            {shown.map(({ row, state }) => (
              <li className="an-row" key={row.id}>
                <span className="an-row-swatch" data-tone={row.tone}>
                  {(() => {
                    const Icon = tones.find((item) => item.tone === row.tone)?.icon ?? Megaphone;
                    return <Icon className="h-4 w-4" />;
                  })()}
                </span>
                <div className="an-row-main">
                  <p className="an-row-title">
                    {row.pinned ? <Pin aria-label="Pinned" className="h-3.5 w-3.5" /> : null}
                    {row.title}
                  </p>
                  {row.body ? <p className="an-row-body">{row.body}</p> : null}
                  <p className="an-row-meta">
                    {windowText(row)}
                    {row.href ? ` · opens ${row.href}` : ""}
                    {row.created_by ? ` · by ${row.created_by}` : ""}
                  </p>
                </div>
                <span className={cn("an-state", `is-${state}`)}>{stateLabels[state]}</span>
                <div className="an-row-actions">
                  <button className="an-btn is-small" onClick={() => edit(row)} type="button">
                    Edit
                  </button>
                  {state === "draft" || state === "ended" ? (
                    <button
                      className="an-btn is-small is-primary"
                      disabled={busy === row.id}
                      onClick={() => void send(row.id, { action: "publish", id: row.id }, "Published.")}
                      type="button"
                    >
                      Publish
                    </button>
                  ) : (
                    <button
                      className="an-btn is-small"
                      disabled={busy === row.id}
                      onClick={() => void send(row.id, { action: "end", id: row.id }, "Ended. It's off Home.")}
                      type="button"
                    >
                      End
                    </button>
                  )}
                  {confirmDelete === row.id ? (
                    <button
                      className="an-btn is-small is-danger"
                      disabled={busy === row.id}
                      onClick={() =>
                        void send(row.id, { action: "delete", id: row.id }, "Deleted.").then(() => setConfirmDelete(null))
                      }
                      type="button"
                    >
                      Confirm delete
                    </button>
                  ) : (
                    <button className="an-btn is-small is-quiet" onClick={() => setConfirmDelete(row.id)} type="button">
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Counter({ max, value }: { max: number; value: string }) {
  const left = max - value.length;
  return <span className={cn("an-counter", left <= 10 && "is-low")}>{left}</span>;
}

function Switch({
  checked,
  hint,
  label,
  onChange,
}: {
  checked: boolean;
  hint: string;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button aria-checked={checked} className="an-switch" onClick={() => onChange(!checked)} role="switch" type="button">
      <span className={cn("an-switch-track", checked && "is-on")}>
        <span />
      </span>
      <span className="an-switch-text">
        <strong>{label}</strong>
        <span>{hint}</span>
      </span>
    </button>
  );
}
