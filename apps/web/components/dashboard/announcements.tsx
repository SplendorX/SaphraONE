"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { Announcement } from "@/lib/announcements/service";

import "./announcements.css";

const dismissedKey = "saphra.dismissedAnnouncements";

function readDismissed(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(dismissedKey) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Home's announcement cards: a USDC campaign once it's published, a ONE
 * Points quest once it's live, and a creator partner's welcome package for
 * the member it belongs to (app/api/announcements). They scroll sideways
 * when there are several, and each one closes for good with its ×. Two or
 * more live quests share one "Challenges are live" card.
 */
export function Announcements() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[] | null>(null);

  useEffect(() => {
    setDismissed(readDismissed());
    let active = true;
    fetch("/api/announcements")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { announcements?: Announcement[] } | null) => {
        if (active && Array.isArray(payload?.announcements)) setItems(payload.announcements);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function dismiss(ids: string[]) {
    const next = [...new Set([...(dismissed ?? []), ...ids])].slice(-50);
    setDismissed(next);
    try {
      window.localStorage.setItem(dismissedKey, JSON.stringify(next));
    } catch {}
  }

  // Wait for the dismissed list, so a closed card never flashes back.
  const shown = dismissed ? items.filter((item) => !dismissed.includes(item.id)) : [];
  const cards = withQuestsCombined(shown);
  if (cards.length === 0) return null;

  return (
    <section aria-label="Announcements" className="ann" data-count={cards.length}>
      {cards.map((item) => (
        <AnnouncementCard item={item} key={item.id} onDismiss={() => dismiss(item.ids)} />
      ))}
    </section>
  );
}

/**
 * One card. Also the admin's live preview (app/admin/announcements), so what
 * the team sees there is what everyone gets on Home.
 */
export function AnnouncementCard({ item, onDismiss }: { item: Announcement; onDismiss?: () => void }) {
  const content = (
    <>
      <span className="ann-text">
        <span className="ann-title">{item.title}</span>
        {item.body ? <span className="ann-body">{item.body}</span> : null}
        {item.badge ? <span className="ann-badge">{item.badge}</span> : null}
      </span>
      <AnnouncementArt item={item} />
    </>
  );
  const external = item.href.startsWith("https://");
  return (
    <article className="ann-card" data-kind={item.kind} data-tone={item.tone}>
      {!item.href ? (
        <div className="ann-link">{content}</div>
      ) : external ? (
        <a className="ann-link" href={item.href} rel="noreferrer" target="_blank">
          {content}
        </a>
      ) : (
        <Link className="ann-link" href={item.href}>
          {content}
        </Link>
      )}
      {onDismiss && item.dismissible !== false ? (
        <button aria-label={`Dismiss ${item.title}`} className="ann-close" onClick={onDismiss} type="button">
          <X aria-hidden className="h-3.5 w-3.5" strokeWidth={2.6} />
        </button>
      ) : null}
    </article>
  );
}

function AnnouncementArt({ item }: { item: Announcement }) {
  if (item.kind === "campaign") return <TrophyArt />;
  if (item.kind === "welcome") return <GiftArt />;
  if (item.kind === "quest") return <MedalArt />;
  if (item.tone === "important") return <AlertArt />;
  if (item.tone === "update") return <SparkArt />;
  if (item.tone === "maintenance") return <WrenchArt />;
  return <MegaphoneArt />;
}

type Card = Announcement & { ids: string[] };

/** Each card with the ids it stands for; several quests become one card. */
function withQuestsCombined(items: Announcement[]): Card[] {
  const quests = items.filter((item) => item.kind === "quest");
  if (quests.length < 2) return items.map((item) => ({ ...item, ids: [item.id] }));
  const combined: Card = {
    badge: `${quests.length} challenges`,
    body: "Complete challenges. Build streaks. Earn points.",
    href: "/rewards",
    id: "quests",
    ids: quests.map((quest) => quest.id),
    kind: "quest",
    publishedAt: quests[0].publishedAt,
    title: "Challenges are live",
  };
  // In the first quest's place, the others dropped.
  return items.flatMap((item) =>
    item.kind !== "quest" ? [{ ...item, ids: [item.id] }] : item === quests[0] ? [combined] : [],
  );
}

/** A flat gold trophy with the ONE star: campaigns pay USDC prizes. */
function TrophyArt() {
  return (
    <svg aria-hidden className="ann-art" viewBox="0 0 96 96">
      <circle cx="48" cy="48" fill="#fff4d6" r="44" />
      <path d="M30 22h36v14a18 18 0 0 1-36 0Z" fill="#f5b82e" />
      <path d="M48 22h18v14a18 18 0 0 1-18 18Z" fill="#e3a11a" />
      <path
        d="M30 27h-7a2 2 0 0 0-2 2v3a12 12 0 0 0 11 12M66 27h7a2 2 0 0 1 2 2v3a12 12 0 0 1-11 12"
        fill="none"
        stroke="#e3a11a"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path d="M43 54h10v10H43Z" fill="#e3a11a" />
      <rect fill="#5b21b6" height="8" rx="3" width="30" x="33" y="64" />
      <path
        d="m48 28 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"
        fill="#ffffff"
      />
    </svg>
  );
}

/** A flat medal on a ribbon: quests pay ONE Points. */
function MedalArt() {
  return (
    <svg aria-hidden className="ann-art" viewBox="0 0 96 96">
      <circle cx="48" cy="48" fill="#dcf6ea" r="44" />
      <path d="M34 16h12l8 22H42Z" fill="#5b21b6" />
      <path d="M62 16H50l-8 22h12Z" fill="#3b2cf6" />
      <circle cx="48" cy="56" fill="#34c38f" r="22" />
      <circle cx="48" cy="56" fill="#2aa678" r="15" />
      <path
        d="m48 46 3 6.2 6.8 1-4.9 4.8 1.2 6.8-6.1-3.2-6.1 3.2 1.2-6.8-4.9-4.8 6.8-1Z"
        fill="#ffffff"
      />
    </svg>
  );
}

/** A flat megaphone: team news. */
function MegaphoneArt() {
  return (
    <svg aria-hidden className="ann-art" viewBox="0 0 96 96">
      <circle cx="48" cy="48" fill="#dbeafe" r="44" />
      <path d="M26 42h10l26-14v40L36 54H26a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4Z" fill="#2563eb" />
      <path d="M36 42l26-14v40L36 54Z" fill="#3b82f6" />
      <path d="M30 54l4 14a4 4 0 0 0 4 3h3a3 3 0 0 0 3-4l-3-13Z" fill="#1d4ed8" />
      <path d="M68 40c4 2 4 14 0 16" fill="none" stroke="#5b21b6" strokeLinecap="round" strokeWidth="4" />
      <path d="M73 34c8 5 8 23 0 28" fill="none" stroke="#5b21b6" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

/** A flat warning sign: something people need to act on. */
function AlertArt() {
  return (
    <svg aria-hidden className="ann-art" viewBox="0 0 96 96">
      <circle cx="48" cy="48" fill="#ffe4e6" r="44" />
      <path d="M48 20 76 70H20Z" fill="#f43f5e" strokeLinejoin="round" />
      <path d="M48 20 76 70H48Z" fill="#e11d48" />
      <rect fill="#ffffff" height="20" rx="3" width="6" x="45" y="36" />
      <circle cx="48" cy="63" fill="#ffffff" r="3.5" />
    </svg>
  );
}

/** Flat sparkles: something new in the app. */
function SparkArt() {
  return (
    <svg aria-hidden className="ann-art" viewBox="0 0 96 96">
      <circle cx="48" cy="48" fill="#e0e7ff" r="44" />
      <path d="M44 22c2 14 6 18 20 20-14 2-18 6-20 20-2-14-6-18-20-20 14-2 18-6 20-20Z" fill="#6366f1" />
      <path d="M44 22c2 14 6 18 20 20H44Z" fill="#4f46e5" />
      <path d="M66 54c1 7 3 9 10 10-7 1-9 3-10 10-1-7-3-9-10-10 7-1 9-3 10-10Z" fill="#5b21b6" />
    </svg>
  );
}

/** A flat spanner: planned maintenance. */
function WrenchArt() {
  return (
    <svg aria-hidden className="ann-art" viewBox="0 0 96 96">
      <circle cx="48" cy="48" fill="#e2e8f0" r="44" />
      <path
        d="M62 22a14 14 0 0 0-13 19L25 65a5 5 0 0 0 7 7l24-24a14 14 0 0 0 19-13l-8 8-8-2-2-8 8-8a14 14 0 0 0-3-1Z"
        fill="#475569"
      />
      <circle cx="30" cy="67" fill="#e2e8f0" r="2.5" />
    </svg>
  );
}

/** A flat gift box: a creator partner's welcome package. */
function GiftArt() {
  return (
    <svg aria-hidden className="ann-art" viewBox="0 0 96 96">
      <circle cx="48" cy="48" fill="#ede9fe" r="44" />
      <rect fill="#7c3aed" height="30" rx="4" width="44" x="26" y="44" />
      <rect fill="#8b5cf6" height="12" rx="3" width="52" x="22" y="34" />
      <rect fill="#f5c842" height="40" width="8" x="44" y="34" />
      <path d="M48 34c-4-9-15-12-17-5s9 6 17 5Zm0 0c4-9 15-12 17-5s-9 6-17 5Z" fill="#f5c842" />
    </svg>
  );
}
