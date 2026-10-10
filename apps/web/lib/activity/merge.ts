import type { WalletTransfer } from "@/lib/arcscan-history";
import type { AccountActivityEntry } from "@/lib/activity/types";

export type AccountActivityItem = AccountActivityEntry & {
  /** The on-chain transfer behind this activity, when the wallet saw one. */
  transfer?: WalletTransfer;
};

function time(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function walletEntry(transfer: WalletTransfer): AccountActivityItem {
  const other = shortAddress(transfer.counterparty);
  return {
    // Direction too: a transfer between your own wallets is one log seen both
    // as money out and money in, and each side is its own row.
    id: `wallet:${transfer.hash}:${transfer.logIndex}:${transfer.direction}`,
    // The ALLIE Agent Wallet only moves money on ALLIE's instruction.
    source: transfer.viaAgentWallet ? "agent" : "wallet",
    direction: transfer.direction,
    title: transfer.direction === "in" ? `Received from ${other}` : `Sent to ${other}`,
    counterparty: transfer.counterparty,
    amount: transfer.amount,
    token: transfer.symbol,
    txHashes: [transfer.hash.toLowerCase()],
    occurredAt: transfer.timestamp,
    transfer,
  };
}

function sameAmount(a: string | null | undefined, b: string) {
  const left = Number(a);
  const right = Number(b);
  return a != null && Number.isFinite(left) && Math.abs(left - right) < 1e-9;
}

/**
 * Which of the activities sharing a transaction this transfer belongs to.
 * A bundled Send & Save is one transaction with a payment leg and a round-up
 * leg, recorded as two activities; each leg goes to its own row.
 */
function claimantFor(candidates: AccountActivityItem[], transfer: WalletTransfer) {
  const wallet = transfer.counterparty.toLowerCase();
  const byWallet = candidates.find((item) => item.counterparty?.toLowerCase() === wallet);
  if (byWallet) return byWallet;

  const byAmount =
    candidates.find((item) => !item.transfer && sameAmount(item.amount, transfer.amount)) ??
    candidates.find((item) => sameAmount(item.amount, transfer.amount));
  if (byAmount) return byAmount;

  // Otherwise it is another leg of the same activity (a swap's return leg).
  // A saving only owns its own deposit: an outgoing leg of another amount is
  // the payment that triggered the round-up, not part of the saving.
  return (
    candidates.find(
      (item) => !(item.source === "save" && transfer.direction === "out"),
    ) ?? null
  );
}

/** How far apart a record and its on-chain transfer may be, in time. */
const sameMoveWindowMs = 15 * 60 * 1000;

/**
 * A feature record with no transfer yet that is the same money movement as
 * `transfer`: same direction, amount and token, within a few minutes. The
 * closest in time wins.
 */
function sameMoveMatch(items: AccountActivityItem[], transfer: WalletTransfer) {
  const at = time(transfer.timestamp);
  if (!at) return null;
  let best: AccountActivityItem | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.source === "wallet" || item.transfer || item.direction !== transfer.direction) continue;
    if (!sameAmount(item.amount, transfer.amount)) continue;
    if (item.token && item.token.toUpperCase() !== transfer.symbol) continue;
    const itemAt = time(item.occurredAt);
    if (!itemAt) continue;
    const gap = Math.abs(itemAt - at);
    if (gap <= sameMoveWindowMs && gap < bestGap) {
      best = item;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * One list of account activity: each feature's records, with the wallet's
 * on-chain transfers folded into the feature that produced them. A transfer
 * no feature claims (an external deposit, a pre-ledger payment) stays in the
 * list as plain wallet activity, so nothing on-chain goes missing.
 */
export function mergeAccountActivity(
  entries: AccountActivityEntry[],
  transfers: WalletTransfer[],
): AccountActivityItem[] {
  const items: AccountActivityItem[] = [];
  const byHash = new Map<string, AccountActivityItem[]>();
  const mirroredByHash = new Map<string, AccountActivityEntry>();

  for (const entry of entries) {
    if (entry.mirrored) {
      entry.txHashes.forEach((hash) => mirroredByHash.set(hash, entry));
      continue;
    }
    const item: AccountActivityItem = { ...entry };
    items.push(item);
    item.txHashes.forEach((hash) => {
      byHash.set(hash, [...(byHash.get(hash) ?? []), item]);
    });
  }

  // The same log can arrive twice (the RPC store and Circle's history, or an
  // overlapping page); count it once.
  const seenTransfers = new Set<string>();

  for (const transfer of transfers) {
    const hash = transfer.hash.toLowerCase();
    const transferKey = `${hash}:${transfer.logIndex}:${transfer.direction}`;
    if (seenTransfers.has(transferKey)) continue;
    seenTransfers.add(transferKey);
    const candidates = byHash.get(hash);
    let item = candidates ? claimantFor(candidates, transfer) : null;

    if (!item && !candidates) {
      const mirrored = mirroredByHash.get(hash);
      if (mirrored) {
        item = { ...mirrored, mirrored: false };
        items.push(item);
        byHash.set(hash, [item]);
      }
    }

    // No record shares this hash: a Circle smart-wallet payment can be
    // recorded with the hash it was submitted under, while the chain shows
    // the bundle's. Claim the record that is clearly the same payment.
    if (!item && !candidates) {
      item = sameMoveMatch(items, transfer);
      if (item) byHash.set(hash, [item]);
    }

    if (!item) {
      items.push(walletEntry(transfer));
      continue;
    }

    // A swap or fee leg is part of the same activity, not a new row. Keep
    // the transfer that matches the activity's own direction for the receipt.
    if (!item.transfer || (item.transfer.direction !== item.direction && transfer.direction === item.direction)) {
      item.transfer = transfer;
    }
    item.occurredAt ??= transfer.timestamp;
    item.amount ??= transfer.amount;
    item.token ??= transfer.symbol;
  }

  return items.sort((a, b) => time(b.occurredAt) - time(a.occurredAt));
}

const receiptTokens = new Set(["USDC", "EURC"]);

/**
 * The transfer a row's receipt shows. When ArcScan has not returned the
 * transfer (not indexed yet, or past the history window), the receipt is
 * built from the activity's own record of the confirmed transaction.
 */
export function receiptTransferFor(item: AccountActivityItem): WalletTransfer | null {
  if (item.transfer) return item.transfer;
  const hash = item.txHashes[0];
  const token = item.token?.toUpperCase();
  if (!hash || !item.amount || !token || !receiptTokens.has(token)) return null;
  if (item.direction === "internal") return null;
  const counterparty = item.counterparty ?? "Unknown";
  return {
    amount: item.amount,
    blockNumber: 0,
    counterparty: counterparty as WalletTransfer["counterparty"],
    counterpartyIsContract: false,
    counterpartyLabel: /^0x[0-9a-fA-F]{40}$/.test(counterparty) ? undefined : counterparty,
    direction: item.direction,
    hash: hash as WalletTransfer["hash"],
    logIndex: 0,
    method: null,
    symbol: token as WalletTransfer["symbol"],
    timestamp: item.occurredAt,
  };
}
