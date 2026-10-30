"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import "./transfer-progress.css";

export type CoinSymbol = "USDC" | "EURC";

/** The coin that travels: the USDC (or EURC) mark, white on a blue gradient. */
function Coin({ className, symbol = "USDC" }: { className?: string; symbol?: CoinSymbol }) {
  return (
    <span aria-hidden className={cn("tp-coin", className)}>
      <svg fill="none" viewBox="0 0 96 96">
        <path
          d="M56.46 13.78v6.05C68.53 23.47 77.38 34.69 77.38 48c0 13.31-8.85 24.53-20.92 28.17v6.05C71.85 78.46 83.25 64.57 83.25 48S71.85 17.54 56.46 13.78Z"
          fill="currentColor"
        />
        <path
          d="M18.63 48c0-13.31 8.84-24.53 20.91-28.17v-6.05C24.15 17.54 12.75 31.43 12.75 48s11.4 30.46 26.79 34.22v-6.05C27.47 72.56 18.63 61.31 18.63 48Z"
          fill="currentColor"
        />
        {symbol === "EURC" ? (
          <text
            dominantBaseline="central"
            fill="currentColor"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize="40"
            fontWeight="700"
            textAnchor="middle"
            x="48"
            y="50"
          >
            €
          </text>
        ) : (
          <path
            d="M60.63 54.55c0-12.01-18.83-7.08-18.83-13.72 0-2.38 1.91-3.9 5.55-3.9 4.35 0 5.85 2.11 6.32 4.96h5.99c-.53-5.35-3.6-8.72-8.72-9.73v-4.72h-5.88v4.55c-5.61.72-9.14 3.98-9.14 8.84 0 12.07 18.86 7.55 18.86 14.07 0 2.47-2.38 4.11-6.4 4.11-5.26 0-6.99-2.32-7.64-5.52h-5.84c.38 5.86 3.99 9.52 10.16 10.44v4.63h5.88v-4.57c6.02-.78 9.69-4.28 9.69-9.44Z"
            fill="currentColor"
          />
        )}
      </svg>
    </span>
  );
}

export type TransferProgressState = "running" | "done" | "hold";

/**
 * The moving-money animation for a multi-step transfer: the coin starts big
 * between the two ends, shrinks to the start of a track, then travels along
 * it step by step with a gradient trailing behind. At the end it turns into a
 * check (or a warning, when the transfer is on hold).
 */
/** What the finished screen shows under the check (what the old success popup showed). */
export type TransferDetails = {
  /** The headline amount, e.g. "5.00 USDC". */
  amount?: string;
  /** Small label above the title, e.g. "Swap". */
  eyebrow?: string;
  explorerLabel?: string;
  explorerUrl?: string;
  /** Anything else: links, notes. */
  extra?: ReactNode;
  rows?: Array<{ label: string; value: string }>;
};

export type TransferProgressProps = {
  /** Index into `steps` of the step in progress; -1 before the first. */
  current: number;
  coin?: CoinSymbol;
  /** Shown on the finished screen (done or on hold). */
  details?: TransferDetails;
  doneSubtitle?: ReactNode;
  doneTitle: string;
  from: ReactNode;
  holdSubtitle?: ReactNode;
  holdTitle?: string;
  /** A Done button on the finished screen. */
  onClose?: () => void;
  /** Start on the track (e.g. when this screen opens mid-transfer). */
  skipIntro?: boolean;
  state: TransferProgressState;
  steps: readonly string[];
  title?: string;
  to: ReactNode;
};

export function TransferProgress({
  coin,
  current,
  details,
  doneSubtitle,
  doneTitle,
  from,
  holdSubtitle,
  holdTitle = "On hold",
  onClose,
  skipIntro = false,
  state,
  steps,
  title = "Sending",
  to,
}: TransferProgressProps) {
  const [phase, setPhase] = useState<"intro" | "track" | "end">(skipIntro ? "track" : "intro");

  // Intro, then the track; the end screen follows a moment after the coin
  // reaches the far side, so the last stretch is seen.
  useEffect(() => {
    if (phase !== "intro") return;
    const timer = window.setTimeout(() => setPhase("track"), 1_300);
    return () => window.clearTimeout(timer);
  }, [phase]);
  // Finish only once the coin is on the track, so the last stretch (or, for a
  // payment that was already done, the whole run) is always seen.
  useEffect(() => {
    if (state === "running") {
      setPhase((value) => (value === "end" ? "track" : value));
      return;
    }
    if (phase !== "track") return;
    const timer = window.setTimeout(() => setPhase("end"), state === "done" ? 1_200 : 400);
    return () => window.clearTimeout(timer);
  }, [phase, state]);

  const total = steps.length;
  const index = Math.min(Math.max(current, 0), total - 1);
  // Each step moves the coin an equal share; done fills the track.
  const progress = state === "done" ? 1 : (Math.max(current, -1) + 1) / (total + 1);
  // The track starts empty and grows to `progress`, so the fill is animated
  // even when the screen opens on an already-finished payment.
  const [shownProgress, setShownProgress] = useState(0);
  useEffect(() => {
    if (phase !== "track") return;
    const frame = window.requestAnimationFrame(() => setShownProgress(progress));
    return () => window.cancelAnimationFrame(frame);
  }, [phase, progress]);
  const label = state === "done" ? doneTitle : steps[index];

  if (phase === "end") {
    const done = state === "done";
    return (
      <div aria-live="polite" className="tp" role="status">
        <div className="tp-stage">
          <span className={cn("tp-result", done ? "is-done" : "is-hold")}>
            {done ? (
              <svg aria-hidden fill="none" viewBox="0 0 48 48">
                <path className="tp-check" d="M13 25.5 20.5 33 35 16" stroke="currentColor" strokeWidth="4.5" />
              </svg>
            ) : (
              <span aria-hidden className="tp-bang">
                !
              </span>
            )}
          </span>
        </div>
        {details?.eyebrow ? <p className="tp-eyebrow">{details.eyebrow}</p> : null}
        <p className="tp-title">{done ? doneTitle : holdTitle}</p>
        {done ? (
          doneSubtitle ? <p className="tp-sub">{doneSubtitle}</p> : null
        ) : holdSubtitle ? (
          <p className="tp-sub">{holdSubtitle}</p>
        ) : null}
        {details?.amount ? <p className="tp-amount">{details.amount}</p> : null}
        {details?.rows?.length ? (
          <dl className="tp-rows">
            {details.rows.map((row) => (
              <div key={`${row.label}-${row.value}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {details?.extra}
        {details?.explorerUrl || onClose ? (
          <div className="tp-actions">
            {details?.explorerUrl ? (
              <a className="tp-link" href={details.explorerUrl} rel="noreferrer" target="_blank">
                {details.explorerLabel ?? "View on ArcScan"}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            {onClose ? (
              <button className="tp-done" onClick={onClose} type="button">
                Done
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div aria-live="polite" className="tp" role="status">
      <div className="tp-stage">
        {phase === "intro" ? (
          <div className="tp-intro">
            <span className="tp-end tp-end-from">{from}</span>
            <Coin className="tp-intro-coin" symbol={coin} />
            <span className="tp-end tp-end-to">{to}</span>
          </div>
        ) : (
          <div className="tp-track" style={{ ["--tp-progress" as string]: shownProgress }}>
            <span className="tp-fill">
              <Coin className="tp-track-coin" symbol={coin} />
            </span>
            <span className="tp-end tp-track-to">{to}</span>
          </div>
        )}
      </div>
      {phase === "track" ? (
        <div className="tp-step" key={`${state}-${index}`}>
          {state === "running" && total > 1 ? (
            <p className="tp-count">
              Step <strong>{index + 1}</strong> of {total}
            </p>
          ) : null}
          <p className="tp-label">{label}</p>
        </div>
      ) : (
        <div className="tp-step" />
      )}
      <p className="tp-title">{title}</p>
    </div>
  );
}

/** How long the finished check stays up before the overlay hands back. */
const DONE_LINGER_MS = 2_600;

/**
 * TransferProgress over the whole page while a payment runs, under the
 * confirmation sheet and Circle's window (so PIN entry still works). It
 * shows while `active`. When the payment ends ("done", or "hold") it plays
 * the finish: with `details` it stays on the receipt until Done, otherwise it
 * hands back on its own after a moment. Either way `onDone` follows. Ending
 * while still "running" (an error or a cancel) closes it at once.
 */
export function TransferProgressOverlay({
  active,
  onDone,
  ...progress
}: TransferProgressProps & { active: boolean; onDone?: () => void }) {
  const [shown, setShown] = useState(false);
  const waitsForDone = Boolean(progress.details);

  useEffect(() => {
    if (active) setShown(true);
    else if (progress.state === "running") setShown(false);
  }, [active, progress.state]);

  function close() {
    setShown(false);
    onDone?.();
  }

  useEffect(() => {
    if (!shown || progress.state === "running" || waitsForDone) return;
    const timer = window.setTimeout(close, DONE_LINGER_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, progress.state, waitsForDone]);

  // Escape closes a finished receipt, like the old popup did.
  useEffect(() => {
    if (!shown || progress.state === "running" || !waitsForDone) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, progress.state, waitsForDone]);

  if (!shown || typeof document === "undefined") return null;

  // A Radix Sheet disables pointer events outside its content while it is
  // open. Invest renders this overlay from inside such a sheet, so portalling
  // to document.body makes a visible receipt that cannot receive Done or
  // explorer taps. Keep the receipt in the active sheet's DOM subtree when
  // there is one; standalone transfer flows still portal to the page body.
  const portalTarget =
    document.querySelector<HTMLElement>("[data-slot='sheet-content'][data-state='open']") ?? document.body;

  return createPortal(
    <div aria-modal="true" className="tp-overlay" role="dialog">
      <TransferProgress {...progress} onClose={waitsForDone ? close : progress.onClose} />
    </div>,
    portalTarget,
  );
}
