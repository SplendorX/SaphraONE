"use client";

import {
  ArrowDownToLine,
  ArrowLeftRight,
  Banknote,
  CalendarClock,
  Coins,
  FileText,
  HandCoins,
  Landmark,
  PiggyBank,
  Send,
  Store,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { WalletReceiptModal } from "@/components/activity/wallet-receipt-modal";
import { AllieMark } from "@/components/allie/AllieMark";
import { BatchReceiptModal, type BatchReceiptData } from "@/components/batch/batch-receipt-modal";
import { receiptTransferFor, type AccountActivityItem } from "@/lib/activity/merge";
import { activityFeatureMeta, type ActivityFeed } from "@/lib/activity/types";
import type { WalletTransfer } from "@/lib/arcscan-history";
import { downloadBatchReceiptImage, shareBatchReceiptImage } from "@/lib/batch-receipt";
import { arcChain } from "@/lib/chains";
import type { ArcTokenSymbol } from "@/lib/tokens";
import { cn } from "@/lib/utils";

import "./transactions.css";

export const featureIcons: Record<ActivityFeed, LucideIcon | null> = {
  agent: null,
  batch: Users,
  checkout: Store,
  deposit: ArrowDownToLine,
  circle: UsersRound,
  earn: TrendingUp,
  invoice: FileText,
  payroll: Banknote,
  points: Coins,
  ramp: Landmark,
  recurepay: CalendarClock,
  request: HandCoins,
  save: PiggyBank,
  send: Send,
  swap: ArrowLeftRight,
  wallet: Wallet,
};

/** A feature's round icon; ALLIE shows her own mark. */
export function TransactionIcon({ source, size = "md" }: { source: ActivityFeed; size?: "md" | "sm" }) {
  const Icon = featureIcons[source];
  return (
    <span aria-hidden className={cn("tx-icon", size === "sm" && "is-sm")} data-feature={source}>
      {Icon ? <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} /> : <AllieMark size={size === "sm" ? 32 : 44} />}
    </span>
  );
}

function formatAmount(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 2 });
}

export function transactionAmount(item: AccountActivityItem) {
  if (!item.amount) return null;
  const sign = item.direction === "in" ? "+" : item.direction === "out" ? "−" : "";
  return `${sign}${formatAmount(item.amount)} ${item.token ?? ""}`.trim();
}

/** "8:34 AM • 15 Aug 2026" (or "Awaiting timestamp" for a just-confirmed row). */
export function transactionWhen(value: string | null) {
  if (!value) return "Awaiting timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Awaiting timestamp";
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  const day = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(date);
  return `${time} • ${day}`;
}

/** One transaction, Kuda style: icon, title, when; amount and feature on the right. */
export function TransactionRow({
  item,
  onOpen,
  title,
}: {
  item: AccountActivityItem;
  onOpen: (() => void) | null;
  title: string;
}) {
  const amount = transactionAmount(item);
  const swapIn = item.source === "swap" && item.amountIn && item.tokenIn
    ? `+${formatAmount(item.amountIn)} ${item.tokenIn}`
    : null;
  const body = (
    <>
      <TransactionIcon source={item.source} />
      <span className="tx-main">
        <span className="tx-title">{title}</span>
        <span className="tx-when">{transactionWhen(item.occurredAt)}</span>
      </span>
      <span className="tx-side">
        {amount ? (
          <span className={cn("tx-amount", item.direction === "in" && "is-in")}>{amount}</span>
        ) : null}
        <span className="tx-feature">{swapIn ?? activityFeatureMeta[item.source]?.label ?? "Wallet"}</span>
      </span>
    </>
  );
  return onOpen ? (
    <button className="tx-row" onClick={onOpen} type="button">
      {body}
    </button>
  ) : (
    <div className="tx-row">{body}</div>
  );
}

/** Rebuild a BulkPay or payroll receipt from the batch details kept with the activity. */
function batchReceiptFrom(item: AccountActivityItem, wallet: string): BatchReceiptData | null {
  const batch = item.batch;
  if (!batch?.recipients.length) return null;
  const token = (item.token ?? "USDC") as ArcTokenSymbol;
  const hash = item.transfer?.hash ?? item.txHashes[0] ?? null;
  return {
    explorerUrl: hash ? `${arcChain.blockExplorers.default.url}/tx/${hash}` : null,
    feeAmount: batch.fee ?? "Not recorded",
    kind: batch.kind ?? "batch",
    mode: batch.mode ?? "BulkPay",
    payoutTotal: `${item.amount ?? "0"} ${token}`,
    recipientCount: batch.recipients.length,
    recipients: batch.recipients.map((recipient, index) => ({
      address: recipient.wallet,
      amount: recipient.amount,
      label: recipient.label ?? undefined,
      line: index + 1,
    })),
    runName: batch.name ?? null,
    submittedAt: item.occurredAt ?? new Date().toISOString(),
    token,
    txHash: hash,
    walletAddress: wallet,
  };
}

/**
 * Receipts for transaction rows: `openerFor(item)` is what a row does when
 * tapped (null when there is nothing to show), `modals` renders them.
 */
export function useTransactionReceipts(wallet?: string | null) {
  const [receipt, setReceipt] = useState<WalletTransfer | null>(null);
  const [batchReceipt, setBatchReceipt] = useState<BatchReceiptData | null>(null);
  const closeReceipt = useCallback(() => setReceipt(null), []);
  const closeBatch = useCallback(() => setBatchReceipt(null), []);

  const openerFor = useCallback(
    (item: AccountActivityItem): (() => void) | null => {
      if (!wallet) return null;
      const batch = batchReceiptFrom(item, wallet);
      if (batch) return () => setBatchReceipt(batch);
      const transfer = receiptTransferFor(item);
      return transfer ? () => setReceipt(transfer) : null;
    },
    [wallet],
  );

  const modals: ReactNode = (
    <>
      {batchReceipt ? (
        <BatchReceiptModal
          onClose={closeBatch}
          onDownload={(named) => void downloadBatchReceiptImage(named).catch(() => undefined)}
          onShare={(named) => void shareBatchReceiptImage(named).catch(() => undefined)}
          receipt={batchReceipt}
        />
      ) : null}
      {receipt && wallet ? <WalletReceiptModal onClose={closeReceipt} transfer={receipt} walletAddress={wallet} /> : null}
    </>
  );

  return { modals, openerFor };
}
