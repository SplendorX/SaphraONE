"use client";

import { AtSign, CheckCircle2, Loader2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isAddress } from "viem";

import { RecipientStatus } from "@/components/recipient-status";
import { resolvePayeeQuery } from "@/lib/batch/parse-payees";
import { searchPeople } from "@/lib/business/client";
import type { DirectoryHit } from "@/lib/business/types";
import { formatUsernameLabel } from "@/lib/profile-utils";
import { cn } from "@/lib/utils";

import "./username-field.css";

export type ResolvedPerson = {
  address: string;
  avatarUrl: string | null;
  displayName: string | null;
  username: string | null;
};

/**
 * A SaphraONE @username field that works like BulkPay's: people are suggested
 * as you type, the username is looked up, and the line underneath says
 * exactly who (and which wallet) it is. `allowAddress` also accepts a pasted
 * 0x wallet.
 */
export function UsernameField({
  allowAddress = false,
  autoFocus,
  className,
  id,
  onChange,
  onResolved,
  placeholder,
  value,
}: {
  allowAddress?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
  /** The raw text, without a leading @. */
  onChange: (value: string) => void;
  /** Who the text resolves to, or null while empty, unresolved or not found. */
  onResolved?: (person: ResolvedPerson | null) => void;
  placeholder?: string;
  value: string;
}) {
  const [suggestions, setSuggestions] = useState<DirectoryHit[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedPerson | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  const query = value.trim();
  const looksLikeAddress = query.startsWith("0x");

  // Look the text up a moment after typing stops.
  useEffect(() => {
    setResolved(null);
    setResolveError(null);
    onResolvedRef.current?.(null);
    if (!query) {
      setResolving(false);
      return;
    }
    if (looksLikeAddress && !allowAddress) {
      setResolving(false);
      setResolveError("Enter a ONE ID, not a wallet address.");
      return;
    }
    let cancelled = false;
    setResolving(true);
    const timer = window.setTimeout(() => {
      void resolvePayeeQuery(query)
        .then((person) => {
          if (cancelled) return;
          const next = person
            ? {
                address: person.address,
                avatarUrl: person.avatarUrl ?? null,
                displayName: person.displayName ?? null,
                username: person.username ?? null,
              }
            : null;
          setResolved(next);
          onResolvedRef.current?.(next);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setResolveError(error instanceof Error ? error.message : "Could not find this person.");
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allowAddress, looksLikeAddress, query]);

  // Suggest people while the field has focus.
  useEffect(() => {
    const term = query.replace(/^@+/, "");
    if (!focused || !term || isAddress(term) || looksLikeAddress) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    let cancelled = false;
    setSuggestLoading(true);
    const timer = window.setTimeout(() => {
      void searchPeople(term)
        .then((payload) => {
          if (!cancelled) setSuggestions(payload.results.slice(0, 6));
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSuggestLoading(false);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [focused, looksLikeAddress, query]);

  const exactMatch = resolved?.username && resolved.username.toLowerCase() === query.replace(/^@+/, "").toLowerCase();
  const showSuggest = focused && query.length > 0 && !exactMatch && (suggestLoading || suggestions.length > 0);

  return (
    <div className={cn("uf", className)}>
      <label className="uf-field">
        {resolved?.avatarUrl ? (
          <img alt="" className="uf-avatar" src={resolved.avatarUrl} />
        ) : (
          <AtSign className="h-4 w-4 shrink-0 text-primary" />
        )}
        <input
          aria-describedby={id ? `${id}-status` : undefined}
          autoCapitalize="off"
          autoComplete="off"
          autoFocus={autoFocus}
          id={id}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(event) => onChange(event.target.value.replace(/\s/g, "").replace(/^@+/, ""))}
          onFocus={() => setFocused(true)}
          placeholder={placeholder ?? (allowAddress ? "ONE ID or 0x…" : "ONE ID")}
          spellCheck={false}
          value={value}
        />
        {resolving ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : resolved ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : null}
      </label>

      {showSuggest ? (
        <div className="uf-suggest" role="listbox">
          {suggestLoading && suggestions.length === 0 ? <p className="uf-suggest-note">Searching people…</p> : null}
          {suggestions.map((hit) => (
            <button
              className="uf-suggest-item"
              key={`${hit.kind}-${hit.username}`}
              onClick={() => {
                onChange(hit.username);
                setFocused(false);
              }}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
              aria-selected={false}
            >
              <span className="uf-suggest-avatar">
                {hit.avatarUrl ? <img alt="" src={hit.avatarUrl} /> : <UserRound className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{hit.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatUsernameLabel(hit.username)}
                  {hit.kind === "business" ? " · Business" : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {query ? (
        <RecipientStatus
          className="mt-1.5"
          id={id ? `${id}-status` : undefined}
          resolution={{
            error: resolveError,
            isResolving: resolving,
            isValid: Boolean(resolved && !resolving && !resolveError),
            resolvedAddress: resolved?.address ?? null,
            resolvedUsername: resolved?.username ?? null,
          }}
        />
      ) : null}
    </div>
  );
}
