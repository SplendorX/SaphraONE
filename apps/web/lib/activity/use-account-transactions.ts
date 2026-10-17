"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchCircleWalletTransfers, mergeTransferSources } from "@/lib/activity/circle-history";
import { accountActivityChangedEventName, fetchAccountActivity } from "@/lib/activity/client";
import { mergeAccountActivity, shortAddress, type AccountActivityItem } from "@/lib/activity/merge";
import type { WalletTransfer } from "@/lib/arcscan-history";
import { activityWindowStart, type AccountActivityEntry } from "@/lib/activity/types";
import { allieSenderLabel, useWalletUsernames } from "@/lib/activity/usernames";
import { useWalletTransfers } from "@/lib/use-wallet-transfers";

/**
 * Everything the account did in the last `days` days: SaphraONE's own records
 * (which feature made each payment) merged with the wallet's on-chain
 * transfers, newest first. Shared by the dashboard's Transactions card,
 * Transaction History and Insights, so they always agree.
 *
 * Either source can fail on its own: without the records the transfers still
 * show (as wallet activity), and without the transfers the records still do.
 */
export function useAccountTransactions(ownerWallet: string | null | undefined, days: number, refreshKey = "") {
  const {
    error: storeError,
    isLoading: transfersLoading,
    transfers: storeTransfers,
  } = useWalletTransfers(ownerWallet, refreshKey, days);
  // A Circle wallet's full list, for history the RPC store hasn't filled yet.
  const [circleTransfers, setCircleTransfers] = useState<WalletTransfer[]>([]);
  useEffect(() => {
    if (!ownerWallet) {
      setCircleTransfers([]);
      return;
    }
    let cancelled = false;
    void fetchCircleWalletTransfers(ownerWallet, activityWindowStart(Date.now(), days))
      .then((next) => {
        if (!cancelled) setCircleTransfers(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [days, ownerWallet, refreshKey]);
  const transfers = useMemo(
    () => mergeTransferSources(storeTransfers, circleTransfers),
    [circleTransfers, storeTransfers],
  );
  // The store failing matters only when Circle had nothing either.
  const transfersError = circleTransfers.length > 0 ? null : storeError;
  const [entries, setEntries] = useState<AccountActivityEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [labelsLocked, setLabelsLocked] = useState(false);

  const loadEntries = useCallback(
    async (signal?: { cancelled: boolean }) => {
      if (!ownerWallet) {
        setEntries([]);
        return;
      }
      setEntriesLoading(true);
      try {
        const next = await fetchAccountActivity(ownerWallet, { days });
        if (!signal?.cancelled) {
          setEntries(next);
          setLabelsLocked(false);
        }
      } catch (error) {
        if (!signal?.cancelled) {
          setEntries([]);
          setLabelsLocked(error instanceof Error && /authorize this wallet/i.test(error.message));
        }
      } finally {
        if (!signal?.cancelled) setEntriesLoading(false);
      }
    },
    [days, ownerWallet],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void loadEntries(signal);
    const refresh = () => void loadEntries(signal);
    window.addEventListener(accountActivityChangedEventName, refresh);
    return () => {
      signal.cancelled = true;
      window.removeEventListener(accountActivityChangedEventName, refresh);
    };
  }, [loadEntries]);

  // A just-confirmed transfer may belong to a record written moments ago.
  const transferCount = transfers.length;
  useEffect(() => {
    if (transferCount > 0) void loadEntries();
  }, [loadEntries, transferCount]);

  const items = useMemo(() => {
    const from = activityWindowStart(Date.now(), days).getTime();
    return mergeAccountActivity(entries, transfers).filter((item) => {
      const at = item.occurredAt ? Date.parse(item.occurredAt) : Number.NaN;
      // Undated rows are just-confirmed payments still waiting for a block time.
      return Number.isNaN(at) || at >= from;
    });
  }, [days, entries, transfers]);

  const usernameFor = useWalletUsernames([
    ...items.map((item) => item.transfer?.counterparty ?? item.counterparty),
    ...items.flatMap((item) => item.batch?.recipients.map((recipient) => recipient.wallet) ?? []),
  ]);

  /** A row's title, naming SaphraONE counterparties by @username. */
  const titleFor = useCallback(
    (item: AccountActivityItem) => {
      // BulkPay names who was paid; a payroll run keeps its own title.
      if (item.batch?.recipients.length && item.batch.kind !== "payroll") {
        const names = item.batch.recipients.map((recipient) => {
          const username = usernameFor(recipient.wallet);
          return recipient.label ?? (username ? `${username}.one` : shortAddress(recipient.wallet));
        });
        const shown = names.slice(0, 2).join(", ");
        return `Batch payment to ${shown}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
      }
      const wallet = item.transfer?.counterparty ?? item.counterparty;
      // Money ALLIE sent comes from the sender's Agent Wallet: name the owner.
      const viaAllie = item.source === "wallet" && item.direction === "in" ? allieSenderLabel(wallet) : null;
      if (viaAllie) return `Received from ${viaAllie}`;
      const username = usernameFor(wallet);
      if (!wallet || !username || !item.title) return item.title;
      return item.title.replace(shortAddress(wallet), `${username}.one`);
    },
    [usernameFor],
  );

  return {
    error: transfersError,
    items,
    labelsLocked,
    loading: (transfersLoading || entriesLoading) && items.length === 0,
    titleFor,
  };
}
