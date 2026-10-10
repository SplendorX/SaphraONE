"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
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
import type { WalletTransfer } from "@/lib/arcscan-history";

export type TransactionReceiptRow = {
  label: string;
  value: string;
  /** Full value for copying when `value` is shortened. */
  copy?: string;
  mono?: boolean;
};

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label="Copy"
      className="tx-receipt-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
      type="button"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * The on-screen receipt. Portalled to <body> so it covers the whole viewport
 * instead of being clipped by the dashboard layout, and sized to fit the
 * screen without scrolling on common heights.
 */
export function TransactionReceipt({
  amount,
  counterpartyName,
  explorerUrl,
  labels,
  onClose,
  onDownload,
  onShare,
  rows,
  transfer,
}: {
  amount: string;
  /** "@username" for a SaphraONE account, otherwise a short address or label. */
  counterpartyName: string;
  explorerUrl: string;
  labels: { received: string; sent: string; title: string };
  onClose: () => void;
  onDownload: () => void;
  onShare: () => void;
  rows: TransactionReceiptRow[];
  transfer: WalletTransfer;
}) {
  const [mounted, setMounted] = useState(false);
  const isOut = transfer.direction === "out";

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

  return createPortal(
    <div className="tx-receipt-backdrop" onClick={onClose}>
      {/* Dialog role on the card so the backdrop stays blurred in themes that
          style [role="dialog"] as a solid panel. */}
      <div
        aria-label={labels.title}
        aria-modal="true"
        className="tx-receipt"
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

        <div className="tx-receipt-hero">
          <span className="tx-receipt-direction" data-direction={transfer.direction}>
            {isOut ? (
              <ArrowUpRight className="h-5 w-5" />
            ) : (
              <ArrowDownLeft className="h-5 w-5" />
            )}
          </span>
          <p className="tx-receipt-kicker">{labels.title}</p>
          <p className="tx-receipt-amount" data-direction={transfer.direction}>
            {isOut ? "−" : "+"}
            {amount} <span>{transfer.symbol}</span>
          </p>
          <p className="tx-receipt-party">
            {isOut ? labels.sent : labels.received}{" "}
            {isOut ? "to" : "from"} <strong>{counterpartyName}</strong>
          </p>
          <span className="tx-receipt-status">Confirmed on Arc</span>
        </div>

        <div className="tx-receipt-perforation" aria-hidden />

        <dl className="tx-receipt-rows">
          {rows.map((row) => (
            <div className="tx-receipt-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd className={row.mono ? "tx-receipt-mono" : undefined}>
                <span title={row.copy ?? row.value}>{row.value}</span>
                {row.copy ? <CopyValue value={row.copy} /> : null}
              </dd>
            </div>
          ))}
        </dl>

        <footer className="tx-receipt-actions">
          <button className="tx-receipt-btn tx-receipt-btn-primary" onClick={onDownload} type="button">
            <Download className="h-4 w-4" />
            PNG
          </button>
          <button className="tx-receipt-btn" onClick={onShare} type="button">
            <Share2 className="h-4 w-4" />
            Share
          </button>
          <a className="tx-receipt-btn" href={explorerUrl} rel="noreferrer" target="_blank">
            ArcScan
            <ExternalLink className="h-4 w-4" />
          </a>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
