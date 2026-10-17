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
 * when there are several, and each one closes for good with its ×.
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

  function dismiss(id: string) {
    const next = [...new Set([...(dismissed ?? []), id])].slice(-50);
    setDismissed(next);
    try {
      window.localStorage.setItem(dismissedKey, JSON.stringify(next));
    } catch {}
  }

  // Wait for the dismissed list, so a closed card never flashes back.
  const shown = dismissed ? items.filter((item) => !dismissed.includes(item.id)) : [];
  if (shown.length === 0) return null;

  return (
    <section aria-label="Announcements" className="ann" data-count={shown.length}>
      {shown.map((item) => (
        <article className="ann-card" data-kind={item.kind} key={item.id}>
          <Link className="ann-link" href={item.href}>
            <span className="ann-text">
              <span className="ann-title">{item.title}</span>
              <span className="ann-body">{item.body}</span>
              <span className="ann-badge">{item.badge}</span>
            </span>
            {item.kind === "campaign" ? <TrophyArt /> : item.kind === "welcome" ? <GiftArt /> : <MedalArt />}
          </Link>
          <button
            aria-label={`Dismiss ${item.title}`}
            className="ann-close"
            onClick={() => dismiss(item.id)}
            type="button"
          >
            <X aria-hidden className="h-3.5 w-3.5" strokeWidth={2.6} />
          </button>
        </article>
      ))}
    </section>
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
