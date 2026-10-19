"use client";

import { UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { VerifiedBadge } from "@/components/verified-badge";
import { searchPeople } from "@/lib/business/client";
import type { DirectoryHit } from "@/lib/business/types";
import { formatUsernameLabel, normalizeUsername } from "@/lib/profile-utils";
import { cn } from "@/lib/utils";

import "./one-id-suggestions.css";

/** What is typed, as a name to search: "Ama", "@ama", "ama.one" → "ama". */
function searchTerm(query: string) {
  const value = query.trim();
  if (!value || /^0x/i.test(value)) return "";
  return normalizeUsername(value);
}

/** Exact ONE ID first, then names that start with what was typed. */
function rank(hit: DirectoryHit, term: string) {
  const username = hit.username.toLowerCase();
  const name = hit.displayName.toLowerCase();
  if (username === term) return 0;
  if (username.startsWith(term)) return 1;
  if (name.startsWith(term) || name.split(/\s+/).some((word) => word.startsWith(term))) return 2;
  return 3;
}

/**
 * People whose ONE ID or name matches what's being typed into a pay field,
 * each shown complete as `amara.one`, ready to tap. Sits under the field
 * (the parent is `position: relative`); hidden once the field holds exactly
 * one of them, or a 0x address.
 */
export function OneIdSuggestions({
  actionLabel = "Pay",
  className,
  inputId,
  onPick,
  open,
  query,
}: {
  /** The word on each row's button. */
  actionLabel?: string;
  className?: string;
  /** The field it belongs to: suggestions show while it has focus. */
  inputId?: string;
  onPick: (hit: DirectoryHit) => void;
  /** Or say when to show them directly. */
  open?: boolean;
  query: string;
}) {
  const term = searchTerm(query);
  const [hits, setHits] = useState<DirectoryHit[]>([]);
  const [loading, setLoading] = useState(false);
  // With `inputId` instead of `open`: shown while that input has focus.
  const [focused, setFocused] = useState(false);
  const isOpen = open ?? focused;

  useEffect(() => {
    if (!inputId) return;
    let blurTimer: number | undefined;
    const onFocusIn = (event: FocusEvent) => {
      if ((event.target as HTMLElement | null)?.id !== inputId) return;
      window.clearTimeout(blurTimer);
      setFocused(true);
    };
    const onFocusOut = (event: FocusEvent) => {
      if ((event.target as HTMLElement | null)?.id !== inputId) return;
      // Late enough for a tap on a suggestion to land first.
      blurTimer = window.setTimeout(() => setFocused(false), 150);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    if (document.activeElement?.id === inputId) setFocused(true);
    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [inputId]);

  useEffect(() => {
    if (!term || term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPeople(term)
        .then(({ results }) => {
          if (cancelled) return;
          const seen = new Set<string>();
          setHits(
            results
              .filter((hit) => {
                const key = hit.username.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              })
              .sort((a, b) => rank(a, term) - rank(b, term))
              .slice(0, 6),
          );
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  const chosen = hits.length === 1 && hits[0].username.toLowerCase() === term && /\.one$|^@/i.test(query.trim());
  if (!isOpen || !term || term.length < 2 || chosen || (!loading && hits.length === 0)) return null;

  return (
    <div className={cn("oid-suggest", className)} role="listbox">
      {loading && hits.length === 0 ? <p className="oid-suggest-note">Finding people…</p> : null}
      {hits.map((hit) => (
        <button
          aria-selected={false}
          className="oid-suggest-item"
          key={`${hit.kind}-${hit.username}`}
          onClick={() => onPick(hit)}
          // Keeps focus in the field until the pick lands.
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
        >
          <span className="oid-suggest-avatar">
            {hit.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={hit.avatarUrl} />
            ) : (
              <UserRound className="h-4 w-4" />
            )}
          </span>
          <span className="oid-suggest-text">
            <span className="oid-suggest-id">
              {formatUsernameLabel(hit.username)}
              <VerifiedBadge hit={hit} />
            </span>
            <span className="oid-suggest-name">
              {hit.displayName}
              {hit.kind === "business" ? " · Business" : ""}
            </span>
          </span>
          <span className="oid-suggest-pay">{actionLabel}</span>
        </button>
      ))}
    </div>
  );
}
