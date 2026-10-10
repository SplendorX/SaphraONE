"use client";

import { arcChain } from "@/lib/chains";
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Share2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { OneWatermark } from "@/components/brand/one-watermark";
import { PlatformLogoMark } from "@/components/brand/platform-logo-mark";
import { PlatformWordmark } from "@/components/brand/platform-wordmark";
import { TokenIcon } from "@/components/token-icon";
import { useWalletUsernames } from "@/lib/activity/usernames";
import type { ArcTokenSymbol } from "@/lib/tokens";

export type BatchReceiptRecipient = {
  address: string;
  amount: string;
  label?: string;
  line: number;
};

export type BatchReceiptData = {
  explorerUrl: string | null;
  feeAmount: string;
  mode: string;
  payoutTotal: string;
  recipientCount: number;
  recipients: BatchReceiptRecipient[];
  submittedAt: string;
  token: ArcTokenSymbol;
  txHash: string | null;
  walletAddress: string;
  /** A payroll run reuses this receipt, worded for a team. */
  kind?: "batch" | "payroll";
  /** The payroll run's name. */
  runName?: string | null;
};

function short(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function CopyButton({ value, label }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label}
      className="tx-receipt-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          },
          () => undefined,
        );
      }}
      type="button"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Fill in names for recipients entered by address only, from their SaphraONE
 * @usernames, so the receipt (and the PNG built from it) names everyone paid.
 */
export function useNamedBatchReceipt<T extends BatchReceiptData>(receipt: T): T {
  const usernameFor = useWalletUsernames(receipt.recipients.map((r) => r.address));
  return {
    ...receipt,
    recipients: receipt.recipients.map((recipient) => {
      if (recipient.label) return recipient;
      const username = usernameFor(recipient.address);
      return username ? { ...recipient, label: `@${username}` } : recipient;
    }),
  };
}

/**
 * BulkPay receipt: every recipient with name, address and amount, so a batch
 * can be traced back later. Portalled to <body> so it always opens in view.
 */
export function BatchReceiptModal<T extends BatchReceiptData>({
  onClose,
  onDownload,
  onShare,
  receipt: rawReceipt,
}: {
  onClose: () => void;
  onDownload: (receipt: T) => void;
  onShare: (receipt: T) => void;
  receipt: T;
}) {
  const receipt = useNamedBatchReceipt(rawReceipt);
  const isPayroll = receipt.kind === "payroll";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  const submitted = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(receipt.submittedAt));

  return createPortal(
    <div className="tx-receipt-backdrop" onClick={onClose}>
      {/* Dialog role on the card so the backdrop stays blurred in themes that
          style [role="dialog"] as a solid panel. */}
      <div
        aria-label={isPayroll ? "Payroll receipt" : "BulkPay receipt"}
        aria-modal="true"
        className="tx-receipt batch-receipt"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <OneWatermark className="one-watermark-center one-watermark-behind tx-receipt-one" />

        <header className="tx-receipt-head">
          <span className="tx-receipt-brand">
            <PlatformLogoMark className="tx-receipt-mark" />
            <PlatformWordmark className="tx-receipt-wordmark" />
          </span>
          <button
            aria-label="Close receipt"
            className="tx-receipt-close"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="batch-receipt-hero">
          <p className="tx-receipt-kicker">
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
            {isPayroll ? "Payroll complete" : "BulkPay complete"}
          </p>
          {isPayroll && receipt.runName ? (
            <p className="batch-receipt-run">{receipt.runName}</p>
          ) : null}
          <p className="batch-receipt-total">
            {receipt.payoutTotal}
            <TokenIcon className="h-7 w-7 rounded-full" symbol={receipt.token} />
          </p>
          <p className="batch-receipt-sub">
            Paid to {receipt.recipientCount.toLocaleString()}{" "}
            {isPayroll
              ? receipt.recipientCount === 1
                ? "team member"
                : "team members"
              : receipt.recipientCount === 1
                ? "recipient"
                : "recipients"}{" "}
            in one transaction
          </p>
        </div>

        <div className="tx-receipt-perforation" aria-hidden />

        <div className="batch-receipt-body">
          <p className="batch-receipt-label">
            {isPayroll ? "Team members" : "Recipients"} <span>{receipt.recipientCount}</span>
          </p>
          <ol className="batch-receipt-list">
            {receipt.recipients.map((recipient) => (
              <li key={`${recipient.line}-${recipient.address}`}>
                <span className="batch-receipt-index">{recipient.line}</span>
                <span className="batch-receipt-who">
                  <strong data-unnamed={recipient.label ? undefined : "true"}>
                    {recipient.label ?? (isPayroll ? "Team member" : "Unnamed recipient")}
                  </strong>
                  <span className="batch-receipt-address">
                    <span title={recipient.address}>{short(recipient.address)}</span>
                    <CopyButton label="Copy recipient address" value={recipient.address} />
                  </span>
                </span>
                <span className="batch-receipt-amount">
                  {recipient.amount} <small>{receipt.token}</small>
                </span>
              </li>
            ))}
          </ol>

          <dl className="tx-receipt-rows batch-receipt-meta">
            <div className="tx-receipt-row">
              <dt>Service fee</dt>
              <dd>{receipt.feeAmount}</dd>
            </div>
            <div className="tx-receipt-row">
              <dt>From wallet</dt>
              <dd className="tx-receipt-mono">
                <span title={receipt.walletAddress}>{short(receipt.walletAddress)}</span>
                <CopyButton label="Copy wallet address" value={receipt.walletAddress} />
              </dd>
            </div>
            <div className="tx-receipt-row">
              <dt>Transaction</dt>
              <dd className="tx-receipt-mono">
                {receipt.txHash ? (
                  <>
                    <span title={receipt.txHash}>{short(receipt.txHash)}</span>
                    <CopyButton label="Copy transaction hash" value={receipt.txHash} />
                  </>
                ) : (
                  "Pending from wallet provider"
                )}
              </dd>
            </div>
            <div className="tx-receipt-row">
              <dt>Submitted</dt>
              <dd>{submitted}</dd>
            </div>
            <div className="tx-receipt-row">
              <dt>Paid with</dt>
              <dd>{receipt.mode} · {arcChain.name}</dd>
            </div>
          </dl>
        </div>

        <footer className="tx-receipt-actions">
          <button className="tx-receipt-btn" onClick={() => onShare(receipt)} type="button">
            <Share2 className="h-4 w-4" />
            Share
          </button>
          <button
            className="tx-receipt-btn tx-receipt-btn-primary"
            onClick={() => onDownload(receipt)}
            type="button"
          >
            <Download className="h-4 w-4" />
            PNG
          </button>
          {receipt.explorerUrl ? (
            <a className="tx-receipt-btn" href={receipt.explorerUrl} rel="noreferrer" target="_blank">
              ArcScan
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <button className="tx-receipt-btn" disabled type="button">
              ArcScan pending
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
