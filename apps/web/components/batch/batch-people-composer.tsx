"use client";

import { BeneficiaryPickerSheet } from "@/components/beneficiary-picker-sheet";
import { RecipientStatus } from "@/components/recipient-status";
import { AnimatePresence, motion } from "framer-motion";
import {
  AtSign,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  Split,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isAddress, type Address } from "viem";

import { TokenIcon } from "@/components/token-icon";
import { Input } from "@/components/ui/input";
import {
  parseAmountUnits,
  parseBatchImportText,
  resolvePayeeQuery,
  splitEvenAmounts,
  type ResolvedBatchPayee,
} from "@/lib/batch/parse-payees";
import type { BeneficiaryAuth } from "@/lib/beneficiaries";
import { searchPeople } from "@/lib/business/client";
import type { DirectoryHit } from "@/lib/business/types";
import { formatUsernameLabel } from "@/lib/profile-utils";
import type { ArcTokenSymbol } from "@/lib/tokens";

export type BatchPeopleComposerHandle = {
  addRow: () => void;
  clear: () => void;
  importText: (input: string) => number;
};

export type BatchComposerResult = {
  errors: string[];
  recipients: ResolvedBatchPayee[];
  resolving: boolean;
};

type PayeeDraft = {
  amount: string;
  avatarUrl: string | null;
  displayName: string | null;
  id: string;
  note: string;
  query: string;
  resolveError: string | null;
  resolvedAddress: Address | null;
  resolving: boolean;
  username: string | null;
};

function createDraft(partial?: Partial<PayeeDraft>): PayeeDraft {
  return {
    amount: "",
    avatarUrl: null,
    displayName: null,
    id: crypto.randomUUID(),
    note: "",
    query: "",
    resolveError: null,
    resolvedAddress: null,
    resolving: false,
    username: null,
    ...partial,
  };
}

function shortenAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export const BatchPeopleComposer = forwardRef<
  BatchPeopleComposerHandle,
  {
    actions?: ReactNode;
    /** Whose saved contacts "Choose beneficiary" lists. */
    beneficiaryAuth?: BeneficiaryAuth | null;
    maxRecipients: number;
    onResolvedChange: (result: BatchComposerResult) => void;
    token: ArcTokenSymbol;
  }
>(function BatchPeopleComposer({ actions, beneficiaryAuth = null, maxRecipients, onResolvedChange, token }, ref) {
  const [rows, setRows] = useState<PayeeDraft[]>(() => [createDraft()]);
  // The row "Choose beneficiary" will fill.
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [splitTotal, setSplitTotal] = useState("");
  const [activeSuggestId, setActiveSuggestId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DirectoryHit[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const amountRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const lastQueryRef = useRef<Record<string, string>>({});
  const querySignature = rows.map((row) => `${row.id}:${row.query.trim()}`).join("|");

  const updateRow = useCallback((id: string, patch: Partial<PayeeDraft>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }, []);

  const addRow = useCallback(() => {
    setRows((current) => {
      if (current.length >= maxRecipients) return current;
      return [...current, createDraft()];
    });
  }, [maxRecipients]);

  const removeRow = useCallback((id: string) => {
    setRows((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length > 0 ? next : [createDraft()];
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      addRow,
      clear() {
        setRows([createDraft()]);
        setSplitTotal("");
      },
      importText(input: string) {
        const imported = parseBatchImportText(input);
        if (imported.length === 0) return 0;
        setRows(
          imported.slice(0, maxRecipients).map((item) =>
            createDraft({
              amount: item.amount,
              note: item.note ?? "",
              query: item.query,
            }),
          ),
        );
        return Math.min(imported.length, maxRecipients);
      },
    }),
    [addRow, maxRecipients],
  );

  useEffect(() => {
    const snapshot = rows.map((row) => ({ id: row.id, query: row.query.trim() }));
    const liveIds = new Set(snapshot.map((row) => row.id));
    Object.keys(lastQueryRef.current).forEach((id) => {
      if (!liveIds.has(id)) delete lastQueryRef.current[id];
    });
    const timers: number[] = [];

    snapshot.forEach(({ id, query }) => {
      if (lastQueryRef.current[id] === query) return;
      lastQueryRef.current[id] = query;

      if (!query) {
        updateRow(id, {
          avatarUrl: null,
          displayName: null,
          resolveError: null,
          resolvedAddress: null,
          resolving: false,
          username: null,
        });
        return;
      }

      updateRow(id, { resolving: true, resolveError: null });
      const timer = window.setTimeout(() => {
        void resolvePayeeQuery(query)
          .then((resolved) => {
            if (!resolved) {
              updateRow(id, {
                avatarUrl: null,
                displayName: null,
                resolveError: null,
                resolvedAddress: null,
                resolving: false,
                username: null,
              });
              return;
            }
            updateRow(id, {
              avatarUrl: resolved.avatarUrl ?? null,
              displayName: resolved.displayName ?? null,
              resolveError: null,
              resolvedAddress: resolved.address,
              resolving: false,
              username: resolved.username ?? null,
            });
          })
          .catch((error: unknown) => {
            updateRow(id, {
              avatarUrl: null,
              displayName: null,
              resolveError:
                error instanceof Error ? error.message : "Could not resolve this person.",
              resolvedAddress: null,
              resolving: false,
              username: null,
            });
          });
      }, 320);
      timers.push(timer);
    });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [querySignature, updateRow]);

  useEffect(() => {
    const active = rows.find((row) => row.id === activeSuggestId);
    const query = active?.query.trim().replace(/^@+/, "") ?? "";
    if (!active || query.length < 1 || isAddress(active.query.trim())) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    setSuggestLoading(true);
    const timer = window.setTimeout(() => {
      void searchPeople(query)
        .then((payload) => setSuggestions(payload.results.slice(0, 6)))
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestLoading(false));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [activeSuggestId, rows]);

  const result = useMemo<BatchComposerResult>(() => {
    const errors: string[] = [];
    const recipients: ResolvedBatchPayee[] = [];
    const seen = new Map<string, string>();

    rows.forEach((row, index) => {
      const line = index + 1;
      const query = row.query.trim();
      if (!query && !row.amount.trim()) return;
      if (!query) {
        errors.push(`Person ${line}: add a username or wallet.`);
        return;
      }
      if (row.resolving) return;
      if (row.resolveError) {
        errors.push(`Person ${line}: ${row.resolveError}`);
        return;
      }
      if (!row.resolvedAddress) {
        errors.push(`Person ${line}: username is not resolved yet.`);
        return;
      }
      const amountUnits = parseAmountUnits(row.amount, token);
      if (!amountUnits) {
        errors.push(`Person ${line}: enter an amount greater than zero.`);
        return;
      }
      const key = row.resolvedAddress.toLowerCase();
      const previous = seen.get(key);
      if (previous) {
        errors.push(
          `${row.username ? formatUsernameLabel(row.username) : shortenAddress(row.resolvedAddress)} is listed twice.`,
        );
        return;
      }
      seen.set(key, row.id);
      recipients.push({
        address: row.resolvedAddress,
        amount: row.amount.trim(),
        amountUnits,
        avatarUrl: row.avatarUrl,
        displayName: row.displayName,
        id: row.id,
        label: row.note.trim() || row.displayName || undefined,
        line,
        query: row.query,
        username: row.username ?? undefined,
      });
    });

    if (recipients.length > maxRecipients) {
      errors.push(`BulkPay supports up to ${maxRecipients} people.`);
    }

    return {
      errors,
      recipients,
      resolving: rows.some((row) => row.resolving && row.query.trim()),
    };
  }, [maxRecipients, rows, token]);

  const resultSignature = `${result.resolving}|${result.errors.join("|")}|${result.recipients
    .map((payee) => `${payee.address}:${payee.amount}:${payee.username ?? ""}:${payee.label ?? ""}`)
    .join("|")}`;

  useEffect(() => {
    onResolvedChange(result);
  }, [onResolvedChange, result, resultSignature]);

  function applySplit() {
    const filled = rows.filter((row) => row.query.trim());
    const count = filled.length || rows.length;
    const amounts = splitEvenAmounts(splitTotal, count, token);
    if (amounts.length === 0) return;
    setRows((current) =>
      current.map((row, index) => ({
        ...row,
        amount: amounts[Math.min(index, amounts.length - 1)] ?? row.amount,
      })),
    );
  }

  const filledCount = rows.filter((row) => row.query.trim()).length;

  return (
    <div className="bp-composer">
      <div className="bp-head">
        <div className="min-w-0">
          <h2 className="bp-title">Who are you paying?</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Enter a SaphraONE username or paste a wallet address, set an amount, then add the next person.
          </p>
        </div>
        <div className="bp-tools">
          {actions}
          <div className="bp-split">
            <Split className="h-3.5 w-3.5 text-primary" />
            <Input
              className="h-8 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
              inputMode="decimal"
              onChange={(event) => setSplitTotal(event.target.value)}
              placeholder={`Split ${token}`}
              value={splitTotal}
            />
            <button
              className="text-xs font-bold text-primary disabled:opacity-40"
              disabled={!splitTotal.trim() || filledCount === 0}
              onClick={applySplit}
              type="button"
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="bp-stack mt-4">
        <AnimatePresence initial={false}>
          {rows.map((row, index) => {
            const showSuggest =
              activeSuggestId === row.id &&
              row.query.trim().length > 0 &&
              !isAddress(row.query.trim()) &&
              (suggestLoading || suggestions.length > 0);

            return (
              <motion.article
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="bp-card"
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                key={row.id}
                layout
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="bp-index">{index + 1}</div>
                <div className="bp-avatar">
                  {row.avatarUrl ? (
                    <img alt="" src={row.avatarUrl} />
                  ) : (
                    <UserRound className="h-5 w-5" />
                  )}
                </div>
                <div className="bp-person min-w-0 flex-1">
                  <div className="bp-field-head">
                    <span>Recipient</span>
                    <button className="bp-choose" onClick={() => setPickingFor(row.id)} type="button">
                      Choose beneficiary
                    </button>
                  </div>
                  <label className="bp-field">
                    <AtSign className="h-4 w-4 text-primary" />
                    <input
                      autoCapitalize="off"
                      autoComplete="off"
                      onBlur={() => {
                        window.setTimeout(() => {
                          setActiveSuggestId((current) =>
                            current === row.id ? null : current,
                          );
                        }, 120);
                      }}
                      onChange={(event) => {
                        updateRow(row.id, {
                          query: event.target.value.replace(/\s/g, ""),
                          resolvedAddress: null,
                          username: null,
                        });
                        setActiveSuggestId(row.id);
                      }}
                      onFocus={() => setActiveSuggestId(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          amountRefs.current[row.id]?.focus();
                        }
                      }}
                      placeholder="username or 0x…"
                      spellCheck={false}
                      value={row.query}
                    />
                    {row.resolving ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : row.resolvedAddress ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : null}
                  </label>
                  {showSuggest ? (
                    <div className="bp-suggest">
                      {suggestLoading && suggestions.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                          Searching people…
                        </p>
                      ) : null}
                      {suggestions.map((hit) => (
                        <button
                          className="bp-suggest-item"
                          key={`${hit.kind}-${hit.username}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateRow(row.id, {
                              avatarUrl: hit.avatarUrl,
                              displayName: hit.displayName,
                              query: hit.username,
                              resolvedAddress: null,
                              username: hit.username,
                            });
                            setActiveSuggestId(null);
                            window.setTimeout(
                              () => amountRefs.current[row.id]?.focus(),
                              20,
                            );
                          }}
                          type="button"
                        >
                          <span className="bp-avatar bp-avatar-sm">
                            {hit.avatarUrl ? (
                              <img alt="" src={hit.avatarUrl} />
                            ) : (
                              <UserRound className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              {hit.displayName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {formatUsernameLabel(hit.username)}
                              {hit.kind === "business" ? " · Business" : ""}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {row.query.trim() ? (
                    <RecipientStatus
                      className="mt-1.5"
                      id={`bp-recipient-status-${row.id}`}
                      resolution={{
                        error: row.resolveError,
                        isResolving: row.resolving,
                        isValid: Boolean(row.resolvedAddress && !row.resolving && !row.resolveError),
                        resolvedAddress: row.resolvedAddress,
                        resolvedUsername: row.username,
                      }}
                    />
                  ) : (
                    <p className="mt-1.5 truncate text-xs text-muted-foreground">
                      Enter a username or wallet address
                    </p>
                  )}
                </div>
                <div className="bp-amount-col">
                  <label className="bp-field">
                    <TokenIcon className="h-4 w-4" symbol={token} />
                    <input
                      inputMode="decimal"
                      onChange={(event) =>
                        updateRow(row.id, { amount: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (index === rows.length - 1) {
                            addRow();
                            window.setTimeout(() => {
                              const last = document.querySelector<HTMLInputElement>(
                                ".bp-card:last-of-type input[autocomplete='off']",
                              );
                              last?.focus();
                            }, 40);
                          }
                        }
                      }}
                      placeholder="0.00"
                      ref={(node) => {
                        amountRefs.current[row.id] = node;
                      }}
                      value={row.amount}
                    />
                    <span className="pr-1 text-xs font-bold text-muted-foreground">
                      {token}
                    </span>
                  </label>
                  <Input
                    className="mt-2 h-8 border-dashed text-xs"
                    onChange={(event) =>
                      updateRow(row.id, { note: event.target.value })
                    }
                    placeholder="Note · optional"
                    value={row.note}
                  />
                </div>
                <button
                  aria-label="Remove person"
                  className="bp-remove"
                  onClick={() => removeRow(row.id)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </div>

      <button
        className="bp-add mt-3"
        disabled={rows.length >= maxRecipients}
        onClick={addRow}
        type="button"
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Plus className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Add another person</span>
          <span className="block text-xs text-muted-foreground">
            {rows.length}/{maxRecipients} in this batch
          </span>
        </span>
      </button>

      {result.recipients.length > 0 ? (
        <div className="bp-total mt-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-primary" />
            {result.recipients.length}{" "}
            {result.recipients.length === 1 ? "person" : "people"} ready
          </div>
          <div className="flex -space-x-2">
            {result.recipients.slice(0, 6).map((payee) => (
              <span className="bp-avatar bp-avatar-sm ring-2 ring-background" key={payee.id}>
                {payee.avatarUrl ? (
                  <img alt="" src={payee.avatarUrl} />
                ) : (
                  <UserRound className="h-3 w-3" />
                )}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Search className="h-4 w-4" />
          Type @username or paste a 0x… wallet address to get started.
        </div>
      )}

      <BeneficiaryPickerSheet
        auth={beneficiaryAuth}
        onClose={() => setPickingFor(null)}
        onSelect={(contact) => {
          if (!pickingFor) return;
          updateRow(pickingFor, {
            displayName: contact.name,
            query: contact.username ?? contact.beneficiary_wallet,
            resolvedAddress: null,
            username: contact.username ?? null,
          });
          setActiveSuggestId(null);
        }}
        open={pickingFor !== null}
      />
    </div>
  );
});
