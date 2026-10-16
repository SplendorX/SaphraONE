"use client";

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileUp,
  Loader2,
  Send,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BulkpayIllustration } from "@/components/bulkpay/bulkpay-illustration";
import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import { arcTokenSymbols, type ArcTokenSymbol } from "@/lib/tokens";
import { cn } from "@/lib/utils";

import "./bulkpay.css";

export function shortAddress(value?: string | null) {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Header: a round back button (a link or a step back), the title, an optional action. */
export function BulkpayBar({
  action,
  backHref,
  onBack,
  title,
}: {
  action?: ReactNode;
  backHref?: string;
  onBack?: () => void;
  title: string;
}) {
  return (
    <header className="bulkpay-bar">
      {onBack ? (
        <button aria-label="Back" className="bulkpay-round" onClick={onBack} type="button">
          <ArrowLeft className="h-5 w-5" />
        </button>
      ) : (
        <Link aria-label="Back to Send" className="bulkpay-round" href={backHref ?? "/send"}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <h1 className="bulkpay-title">{title}</h1>
      <span className="flex justify-end">{action}</span>
    </header>
  );
}

/** Where the flow is: people, then the summary. */
export function BulkpaySteps({ step }: { step: 1 | 2 }) {
  return (
    <ol aria-label="Steps" className="bulkpay-steps">
      {["Add people", "Summary"].map((label, index) => (
        <li className={cn(index + 1 === step && "is-current", index + 1 < step && "is-done")} key={label}>
          <span aria-hidden className="bulkpay-step-bar" />
          {label}
        </li>
      ))}
    </ol>
  );
}

/** The first page: what BulkPay is, and the way in. */
export function BulkpayIntro({
  feeNote,
  maxRecipients,
  onStart,
}: {
  feeNote: string;
  maxRecipients: number;
  onStart: () => void;
}) {
  return (
    <div className="bulkpay-intro">
      <BulkpayIllustration className="bulkpay-illustration" />
      <h2 className="bulkpay-intro-title">Pay everyone in one go.</h2>
      <p className="bulkpay-intro-body">
        Send USDC or EURC to up to {maxRecipients.toLocaleString()} people in a single transaction. Salaries,
        contractors, a team payout or a group refund, all paid at once.
      </p>
      <ul className="bulkpay-intro-points">
        <li>
          <Users className="h-4 w-4" /> Pay by ONE ID or wallet, or import a CSV
        </li>
        <li>
          <ShieldCheck className="h-4 w-4" /> {feeNote}
        </li>
        <li>
          <Zap className="h-4 w-4" /> One transaction for everyone, settled in seconds
        </li>
      </ul>
      <Button className="bulkpay-intro-cta" onClick={onStart}>
        Start a bulk payment
      </Button>
    </div>
  );
}

/** The token being paid and what the wallet holds of it. */
export function BulkpayTokenStrip({
  available,
  onTokenChange,
  token,
  walletAddress,
  walletLabel,
}: {
  available: string;
  onTokenChange: (token: ArcTokenSymbol) => void;
  token: ArcTokenSymbol;
  walletAddress?: string;
  walletLabel: string;
}) {
  return (
    <section className="bulkpay-strip">
      <div className="min-w-0">
        <p className="bulkpay-strip-label">
          <Wallet className="h-3.5 w-3.5" />
          {walletLabel} · {shortAddress(walletAddress)}
        </p>
        <p className="bulkpay-strip-value">
          Available <strong>{available}</strong>
        </p>
      </div>
      <div aria-label="Token" className="bulkpay-tokens" role="radiogroup">
        {arcTokenSymbols.map((symbol) => (
          <button
            aria-checked={symbol === token}
            className="bulkpay-token"
            key={symbol}
            onClick={() => onTokenChange(symbol)}
            role="radio"
            type="button"
          >
            <TokenIcon className="h-4 w-4" symbol={symbol} />
            {symbol}
          </button>
        ))}
      </div>
    </section>
  );
}

/** The composer's frame, with any problems in the list below it. */
export function BulkpayPeopleCard({ children, errors }: { children: ReactNode; errors: string[] }) {
  return (
    <section className="bulkpay-card bulkpay-people">
      {children}
      {errors.length > 0 ? (
        <div className="bulkpay-alert is-error mt-4" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            {errors.slice(0, 4).map((rowError) => (
              <p className="break-words" key={rowError}>
                {rowError}
              </p>
            ))}
            {errors.length > 4 ? <p>{errors.length - 4} more issue(s)</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The composer's import and clear actions. */
export function BulkpayComposerTools({ onClear, onImport }: { onClear: () => void; onImport: () => void }) {
  return (
    <>
      <button className="bulkpay-chip" onClick={onImport} type="button">
        <FileUp className="h-4 w-4" />
        Import CSV
      </button>
      <button className="bulkpay-chip is-danger" onClick={onClear} type="button">
        Clear
      </button>
    </>
  );
}

/** Stays at the bottom while adding people: who's in and the way on. */
export function BulkpayContinueBar({
  canContinue,
  insufficient,
  onContinue,
  people,
  resolving,
  total,
}: {
  canContinue: boolean;
  insufficient: boolean;
  onContinue: () => void;
  people: number;
  resolving: boolean;
  total: string;
}) {
  return (
    <div className="bulkpay-dock">
      <div className="min-w-0">
        <p className="bulkpay-dock-total">{total}</p>
        <p className={cn("bulkpay-dock-sub", insufficient && "is-error")}>
          {insufficient
            ? "More than your balance"
            : `${people.toLocaleString()} ${people === 1 ? "person" : "people"} · fee included`}
        </p>
      </div>
      <Button className="bulkpay-dock-cta" disabled={!canContinue} onClick={onContinue} type="button">
        {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {resolving ? "Checking people" : "Continue"}
      </Button>
    </div>
  );
}

export type BulkpayBreakdown = {
  available: string;
  fee: string;
  feeLabel: string;
  payout: string;
  people: number;
  total: string;
};

function BreakdownRows({ breakdown }: { breakdown: BulkpayBreakdown }) {
  return (
    <dl className="bulkpay-rows">
      <div>
        <dt>People</dt>
        <dd>{breakdown.people.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Payout total</dt>
        <dd>{breakdown.payout}</dd>
      </div>
      <div>
        <dt>{breakdown.feeLabel}</dt>
        <dd>{breakdown.fee}</dd>
      </div>
      <div className="is-total">
        <dt>Total</dt>
        <dd>{breakdown.total}</dd>
      </div>
      <div>
        <dt>Available</dt>
        <dd>{breakdown.available}</dd>
      </div>
    </dl>
  );
}

function StatusLine({ error, pending, status }: { error: string | null; pending: boolean; status: string }) {
  return (
    <p className={cn("bulkpay-status", error && "is-error")} role="status">
      {error ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : pending ? (
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      )}
      <span className="min-w-0 break-words">{error ?? status}</span>
    </p>
  );
}

export type BulkpayReviewPerson = {
  address: string;
  amount: string;
  line: number;
  name: string;
  note?: string;
};

/** The last page: the total, everyone being paid, the cost, then send. */
export function BulkpaySummary({
  breakdown,
  canSend,
  contract,
  contractLabel,
  contractMissing,
  error,
  explorerUrl,
  insufficient,
  onCopy,
  onSend,
  pending,
  people,
  status,
  token,
  walletAddress,
  walletLabel,
}: {
  breakdown: BulkpayBreakdown;
  canSend: boolean;
  contract: string;
  contractLabel: string;
  contractMissing: boolean;
  error: string | null;
  explorerUrl: string;
  insufficient: boolean;
  onCopy: () => void;
  onSend: () => void;
  pending: boolean;
  people: BulkpayReviewPerson[];
  status: string;
  token: ArcTokenSymbol;
  walletAddress?: string;
  walletLabel: string;
}) {
  return (
    <div className="bulkpay-summary">

      <section className="bulkpay-card">
        <div className="bulkpay-card-head">
          <h2>
            Who you&apos;re paying <span className="bulkpay-count">{people.length}</span>
          </h2>
          <button aria-label="Copy summary" className="bulkpay-icon-button" onClick={onCopy} title="Copy summary" type="button">
            <Copy className="h-4 w-4" />
          </button>
        </div>
        <ol className="bulkpay-review-list">
          {people.slice(0, 500).map((person) => (
            <li key={`${person.line}-${person.address}`}>
              <span className="bulkpay-review-avatar">
                <UserRound className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{person.name}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {person.note ? `${person.note} · ` : ""}
                  {shortAddress(person.address)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums">
                {person.amount} {token}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="bulkpay-card">
        <BreakdownRows breakdown={breakdown} />
        <dl className="bulkpay-rows bulkpay-facts">
          <div>
            <dt>Paying from</dt>
            <dd>
              {walletLabel} · <span className="font-mono">{shortAddress(walletAddress)}</span>
            </dd>
          </div>
          <div>
            <dt>{contractLabel}</dt>
            <dd className="font-mono">{contract}</dd>
          </div>
        </dl>
        <p className="bulkpay-facts-note">Batches are signed by your signed-in profile&apos;s wallet only.</p>

        {contractMissing ? (
          <p className="bulkpay-alert is-warn">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Set NEXT_PUBLIC_SAPHRA_BULKPAY_ADDRESS after deploying the contract.
          </p>
        ) : null}
        {insufficient ? (
          <p className="bulkpay-alert is-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Your balance must cover the payouts plus the service fee.
          </p>
        ) : null}
      </section>

      {error || status !== "Ready" ? <StatusLine error={error} pending={pending} status={status} /> : null}

      <Button className="bulkpay-cta" disabled={!canSend} onClick={onSend} type="button">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {pending ? "Processing" : `Send ${breakdown.total}`}
      </Button>

      {explorerUrl ? (
        <a className="bulkpay-link" href={explorerUrl} rel="noreferrer" target="_blank">
          <ExternalLink className="h-4 w-4" />
          View on ArcScan
        </a>
      ) : null}
    </div>
  );
}


