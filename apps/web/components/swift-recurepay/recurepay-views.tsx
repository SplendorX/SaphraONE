"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Loader2,
  Pause,
  Play,
  Plus,
  Repeat,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { BeneficiaryPickerSheet } from "@/components/beneficiary-picker-sheet";
import { RecurepayIllustration } from "@/components/swift-recurepay/recurepay-illustration";
import { RecipientSpinner, RecipientStatus } from "@/components/recipient-status";
import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import type { BeneficiaryAuth } from "@/lib/beneficiaries";
import { arcChain } from "@/lib/chains";
import {
  describeCadence,
  isOneTime,
  monthlyCommitment,
  projectRuns,
  runsLeft,
  type ComposeSchedule,
} from "@/lib/recurepay-plan";
import {
  formatAuthorizationStatusLabel,
  formatExecutionStatusLabel,
  formatFrequencyLabel,
  formatScheduleRecipient,
  isCompletedDisplayStatus,
  isFailedDisplayStatus,
  recurringFrequencies,
  type RecurringExecutionRecord,
  type RecurringFrequency,
  type RecurringScheduleRecord,
} from "@/lib/recurring-utils";
import { recurringFeeForAmount, recurringFeeRateNote } from "@/lib/fees";
import { arcTokenSymbols, type ArcTokenSymbol } from "@/lib/tokens";
import { useSheetSide } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

import "./recurepay-fields.css";

// ── Small helpers ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export function formatTokenAmount(value: string | number, token: string) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return `${value} ${token}`;
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 2 })} ${token}`;
}

function relativeDay(date: Date, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(date).setHours(0, 0, 0, 0) - start.getTime()) / DAY_MS);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Today · Mon, 5 Oct" for the next few days, just the date after that. */
function dayHeading(date: Date, now = Date.now()) {
  const full = date.toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" });
  const relative = relativeDay(date, now);
  return /^(Today|Tomorrow|In \d+ days)$/.test(relative) ? `${relative} · ${full}` : full;
}

function timeOf(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function initials(schedule: RecurringScheduleRecord) {
  const name = formatScheduleRecipient(schedule).replace(/^@/, "");
  return /^0x/i.test(name) ? name.slice(2, 4).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function recipientName(schedule: RecurringScheduleRecord) {
  const name = formatScheduleRecipient(schedule);
  return /^0x[0-9a-fA-F]{40}$/.test(name) ? `${name.slice(0, 6)}…${name.slice(-4)}` : name;
}

function hasAutopay(schedule: RecurringScheduleRecord) {
  return schedule.autopay_enabled && schedule.authorization_status === "AUTHORIZED";
}

function cadenceOf(schedule: RecurringScheduleRecord) {
  return describeCadence({
    frequency: schedule.frequency,
    intervalDays: schedule.interval_days,
    oneTime: isOneTime(schedule),
    startsAt: new Date(schedule.starts_at),
  });
}

/** The avatar every recipient wears: initials on a tint picked from their wallet. */
function Avatar({ schedule, size = "md" }: { schedule: RecurringScheduleRecord; size?: "md" | "lg" }) {
  const hue = parseInt(schedule.beneficiary_wallet.slice(2, 6), 16) % 360;
  return (
    <span
      aria-hidden
      className={cn("recurepay-avatar", size === "lg" && "is-large")}
      style={{ ["--avatar-hue" as string]: String(hue) }}
    >
      {initials(schedule)}
    </span>
  );
}

function StatusChip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "brand" }) {
  return <span className={cn("recurepay-chip", `is-${tone}`)}>{children}</span>;
}

/** A list picker that slides up from the bottom on phones, like a native sheet. */
export function PickerSheet<T extends string>({
  onClose,
  onPick,
  open,
  options,
  title,
  value,
}: {
  onClose: () => void;
  onPick: (value: T) => void;
  open: boolean;
  options: Array<{ value: T; label: string; hint?: string }>;
  title: string;
  value?: T;
}) {
  const side = useSheetSide();
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className={cn("gap-0 p-0", side === "bottom" ? "rounded-t-[1.75rem] border-t-0 pb-[max(1rem,env(safe-area-inset-bottom))]" : "sm:max-w-sm")}
        showCloseButton={false}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        <SheetTitle className="px-5 pb-2 pt-7 text-center text-lg font-bold">{title}</SheetTitle>
        <SheetDescription className="sr-only">Choose one</SheetDescription>
        <ul className="recurepay-picker">
          {options.map((option) => (
            <li key={option.value}>
              <button
                aria-pressed={value === option.value}
                onClick={() => {
                  onPick(option.value);
                  onClose();
                }}
                type="button"
              >
                <span>
                  <span className="block font-medium">{option.label}</span>
                  {option.hint ? <span className="block text-xs text-muted-foreground">{option.hint}</span> : null}
                </span>
                {value === option.value ? <Check className="h-4 w-4 text-primary" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

/** A page header in the SaphraONE style: round back button, centred title, an action. */
export function RecurepayBar({
  action,
  backHref,
  onBack,
  title,
}: {
  action?: ReactNode;
  /** Where the back button leads when there is no in-page step to go back to. */
  backHref?: string;
  onBack?: () => void;
  title: string;
}) {
  return (
    <header className="recurepay-bar">
      {onBack ? (
        <button aria-label="Back" className="recurepay-round" onClick={onBack} type="button">
          <ArrowLeft className="h-5 w-5" />
        </button>
      ) : backHref ? (
        <Link aria-label="Back" className="recurepay-round" href={backHref}>
          <ArrowLeft className="h-5 w-5" />
        </Link>
      ) : (
        <span />
      )}
      <h1 className="recurepay-title">{title}</h1>
      <span className="flex justify-end">{action}</span>
    </header>
  );
}

// ── Home ────────────────────────────────────────────────────────────────────

export function RecurepayEmpty({ disabled, onStart }: { disabled: boolean; onStart: () => void }) {
  return (
    <div className="recurepay-empty">
      <RecurepayIllustration className="recurepay-illustration" />
      <h2 className="recurepay-empty-title">Plan your payments with ease.</h2>
      <p className="recurepay-empty-body">
        Set up one-time or recurring payments in USDC or EURC, and never miss rent, salaries or a subscription again.
      </p>
      <ul className="recurepay-empty-points">
        <li>
          <Repeat className="h-4 w-4" /> Daily, weekly, monthly or your own rhythm
        </li>
        <li>
          <ShieldCheck className="h-4 w-4" /> Autopay pays on time, within limits you set on-chain
        </li>
        <li>
          <Zap className="h-4 w-4" /> Settles on {arcChain.name} in seconds
        </li>
      </ul>
      <Button className="recurepay-cta" disabled={disabled} onClick={onStart}>
        Schedule a payment
      </Button>
    </div>
  );
}

export function RecurepayDashboard({
  dueExecutions,
  executions,
  historyExecutions,
  onCompose,
  onOpenSchedule,
  onPay,
  payingExecutionId,
  processingExecutions,
  scheduleMap,
  schedules,
}: {
  dueExecutions: RecurringExecutionRecord[];
  executions: RecurringExecutionRecord[];
  historyExecutions: RecurringExecutionRecord[];
  onCompose: () => void;
  onOpenSchedule: (id: string) => void;
  onPay: (execution: RecurringExecutionRecord) => void;
  payingExecutionId: string | null;
  processingExecutions: RecurringExecutionRecord[];
  scheduleMap: Map<string, RecurringScheduleRecord>;
  schedules: RecurringScheduleRecord[];
}) {
  const [showHistory, setShowHistory] = useState(false);
  const now = Date.now();

  // Every run in the next 30 days, across schedules, soonest first.
  const upcoming = useMemo(() => {
    const until = new Date(now + 30 * DAY_MS);
    return schedules
      .flatMap((schedule) => projectRuns(schedule, { limit: 31, until }).map((at) => ({ at, schedule })))
      .sort((left, right) => left.at.getTime() - right.at.getTime());
  }, [now, schedules]);

  const next = upcoming[0] ?? null;
  const commitment = monthlyCommitment(schedules);
  const active = schedules.filter((schedule) => schedule.status === "active").length;
  const completed = executions.filter((execution) => isCompletedDisplayStatus(execution.status));

  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; items: typeof upcoming }> = [];
    for (const run of upcoming.slice(0, 12)) {
      const key = run.at.toDateString();
      const last = out.at(-1);
      if (last?.key === key) last.items.push(run);
      else
        out.push({
          items: [run],
          key,
          label: dayHeading(run.at, now),
        });
    }
    return out;
  }, [now, upcoming]);

  return (
    <div className="recurepay-dashboard">
      {next ? (
        <button className="recurepay-hero" onClick={() => onOpenSchedule(next.schedule.id)} type="button">
          <span className="recurepay-hero-glow" aria-hidden />
          <span className="recurepay-hero-top">
            <span className="recurepay-hero-eyebrow">
              <CalendarClock className="h-4 w-4" /> Next payment
            </span>
            <span className="recurepay-hero-when">{relativeDay(next.at, now)}</span>
          </span>
          <span className="recurepay-hero-amount">{formatTokenAmount(next.schedule.amount, next.schedule.token_symbol)}</span>
          <span className="recurepay-hero-to">
            to <strong>{recipientName(next.schedule)}</strong> · {cadenceOf(next.schedule)}
          </span>
          <span className="recurepay-hero-foot">
            <span className="recurepay-hero-date">
              {next.at.toLocaleDateString(undefined, { day: "numeric", month: "long", weekday: "long" })} at {timeOf(next.at)}
            </span>
            <span className="recurepay-hero-pill">
              {hasAutopay(next.schedule) ? (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" /> Autopay on
                </>
              ) : (
                <>
                  <Clock3 className="h-3.5 w-3.5" /> You confirm it
                </>
              )}
            </span>
          </span>
        </button>
      ) : (
        <div className="recurepay-card recurepay-quiet">
          <CalendarClock className="h-5 w-5 text-muted-foreground" />
          <span>Nothing scheduled in the next 30 days. Paused schedules don&rsquo;t run until you resume them.</span>
        </div>
      )}

      <div className="recurepay-stats">
        <div className="recurepay-card recurepay-stat">
          <span className="recurepay-stat-value">{active}</span>
          <span className="recurepay-stat-label">Active</span>
        </div>
        <div className="recurepay-card recurepay-stat">
          {Object.keys(commitment).length === 0 ? (
            <span className="recurepay-stat-value">—</span>
          ) : (
            Object.entries(commitment).map(([token, value]) => (
              <span className="recurepay-stat-value" key={token}>
                {(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}{" "}
                <span className="recurepay-stat-unit">{token}</span>
              </span>
            ))
          )}
          <span className="recurepay-stat-label">A month, on average</span>
        </div>
        <div className="recurepay-card recurepay-stat">
          <span className="recurepay-stat-value">{completed.length}</span>
          <span className="recurepay-stat-label">Payments made</span>
        </div>
      </div>

      {dueExecutions.length > 0 ? (
        <section className="recurepay-section">
          <h2 className="recurepay-section-title">
            Waiting for you <StatusChip tone="warn">{dueExecutions.length}</StatusChip>
          </h2>
          <div className="grid gap-2.5">
            {dueExecutions.map((execution) => {
              const schedule = scheduleMap.get(execution.schedule_id);
              if (!schedule) return null;
              return (
                <div className="recurepay-card recurepay-due" key={execution.id}>
                  <Avatar schedule={schedule} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{recipientName(schedule)}</p>
                    <p className="text-sm text-muted-foreground">
                      Due {new Date(execution.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} at{" "}
                      {timeOf(new Date(execution.due_at))}
                    </p>
                    {execution.error_message ? (
                      <p className="mt-1 text-xs text-destructive">{execution.error_message}</p>
                    ) : null}
                  </div>
                  <div className="grid justify-items-end gap-1.5">
                    <span className="font-semibold tabular-nums">{formatTokenAmount(schedule.amount, schedule.token_symbol)}</span>
                    <Button disabled={Boolean(payingExecutionId)} onClick={() => onPay(execution)} size="sm">
                      {payingExecutionId === execution.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Pay now
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {processingExecutions.length > 0 ? (
        <section className="recurepay-section">
          <h2 className="recurepay-section-title">On its way</h2>
          <div className="recurepay-card divide-y divide-border p-0">
            {processingExecutions.map((execution) => {
              const schedule = scheduleMap.get(execution.schedule_id);
              return (
                <div className="flex items-center justify-between gap-3 px-4 py-3" key={execution.id}>
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    <span className="truncate">{schedule ? recipientName(schedule) : "Scheduled payment"}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatTokenAmount(execution.amount ?? schedule?.amount ?? "0", schedule?.token_symbol ?? "")}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section className="recurepay-section">
          <h2 className="recurepay-section-title">Coming up</h2>
          <ol className="recurepay-timeline">
            {groups.map((group) => (
              <li key={group.key}>
                <p className="recurepay-timeline-day">{group.label}</p>
                {group.items.map(({ at, schedule }) => (
                  <button
                    className="recurepay-timeline-item"
                    key={`${schedule.id}-${at.getTime()}`}
                    onClick={() => onOpenSchedule(schedule.id)}
                    type="button"
                  >
                    <Avatar schedule={schedule} />
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-medium">{recipientName(schedule)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {timeOf(at)} · {hasAutopay(schedule) ? "Autopay" : "You confirm"}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatTokenAmount(schedule.amount, schedule.token_symbol)}</span>
                  </button>
                ))}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="recurepay-section">
        <div className="flex items-center justify-between gap-3">
          <h2 className="recurepay-section-title">Your schedules</h2>
          <button className="recurepay-link" onClick={onCompose} type="button">
            <Plus className="h-4 w-4" /> New
          </button>
        </div>
        <div className="grid gap-2.5">
          {schedules.map((schedule) => {
            const left = runsLeft(schedule);
            const total = schedule.max_runs ?? 0;
            return (
              <button
                className={cn("recurepay-card recurepay-schedule", schedule.status !== "active" && "is-inactive")}
                key={schedule.id}
                onClick={() => onOpenSchedule(schedule.id)}
                type="button"
              >
                <Avatar schedule={schedule} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{recipientName(schedule)}</span>
                    {schedule.status === "paused" ? <StatusChip tone="warn">Paused</StatusChip> : null}
                    {schedule.status === "cancelled" ? <StatusChip tone="bad">Cancelled</StatusChip> : null}
                    {schedule.status === "completed" ? <StatusChip tone="good">Done</StatusChip> : null}
                    {schedule.status === "active" && hasAutopay(schedule) ? <StatusChip tone="brand">Autopay</StatusChip> : null}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {cadenceOf(schedule)}
                    {schedule.beneficiary_label && schedule.beneficiary_username ? ` · ${schedule.beneficiary_label}` : ""}
                  </span>
                  {total > 1 ? (
                    <span className="recurepay-progress" aria-label={`${schedule.run_count} of ${total} payments made`}>
                      <span style={{ width: `${Math.min(100, (schedule.run_count / total) * 100)}%` }} />
                    </span>
                  ) : null}
                </span>
                <span className="grid justify-items-end gap-0.5">
                  <span className="font-semibold tabular-nums">{formatTokenAmount(schedule.amount, schedule.token_symbol)}</span>
                  <span className="text-xs text-muted-foreground">
                    {left !== null && total > 1 ? `${left} left` : isOneTime(schedule) ? "One-time" : "Ongoing"}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="recurepay-section">
        <button
          aria-expanded={showHistory}
          className="recurepay-section-title recurepay-toggle"
          onClick={() => setShowHistory((current) => !current)}
          type="button"
        >
          Payment history
          <span className="text-sm font-normal text-muted-foreground">{historyExecutions.length}</span>
          <ChevronDown className={cn("ml-auto h-4 w-4 transition", showHistory && "rotate-180")} />
        </button>
        {showHistory ? <HistoryList executions={historyExecutions.slice(0, 25)} scheduleMap={scheduleMap} /> : null}
      </section>
    </div>
  );
}

function HistoryList({
  executions,
  scheduleMap,
}: {
  executions: RecurringExecutionRecord[];
  scheduleMap: Map<string, RecurringScheduleRecord>;
}) {
  if (executions.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">No payments yet. Completed and failed runs appear here.</p>;
  }
  return (
    <div className="recurepay-card divide-y divide-border p-0">
      {executions.map((execution) => {
        const schedule = scheduleMap.get(execution.schedule_id);
        const done = isCompletedDisplayStatus(execution.status);
        const failed = isFailedDisplayStatus(execution.status);
        return (
          <div className="flex items-start gap-3 px-4 py-3" key={execution.id}>
            <span className={cn("recurepay-history-dot", done ? "is-good" : failed ? "is-bad" : "is-warn")}>
              {done ? <Check className="h-3.5 w-3.5" /> : failed ? <X className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{schedule ? recipientName(schedule) : "Scheduled payment"}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(execution.completed_at ?? execution.due_at).toLocaleString(undefined, {
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  month: "short",
                })}{" "}
                · {formatExecutionStatusLabel(execution.status)}
              </p>
              {execution.error_message ? <p className="mt-0.5 text-xs text-destructive">{execution.error_message}</p> : null}
            </div>
            <div className="grid justify-items-end">
              <span className="text-sm font-semibold tabular-nums">
                {formatTokenAmount(execution.amount ?? schedule?.amount ?? "0", schedule?.token_symbol ?? "")}
              </span>
              {execution.tx_hash ? (
                <a
                  className="text-xs font-medium text-primary hover:underline"
                  href={`${arcChain.blockExplorers.default.url}/tx/${execution.tx_hash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  View
                </a>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Compose ─────────────────────────────────────────────────────────────────

type RecipientResolution = Parameters<typeof RecipientStatus>[0]["resolution"];

const frequencyHints: Partial<Record<RecurringFrequency, string>> = {
  biweekly: "Every two weeks",
  custom: "Every few days, you choose",
  daily: "Every day",
  monthly: "Same date every month",
  quarterly: "Every three months",
  weekly: "Same weekday every week",
};

function Field({
  children,
  extra,
  label,
}: {
  children: ReactNode;
  extra?: ReactNode;
  label: string;
}) {
  return (
    <div className="recurepay-field">
      <div className="recurepay-field-head">
        <span className="recurepay-label">{label}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

function SelectButton({ onClick, placeholder, value }: { onClick: () => void; placeholder: string; value?: string }) {
  return (
    <button className={cn("recurepay-input recurepay-select", !value && "is-placeholder")} onClick={onClick} type="button">
      <span className="truncate">{value || placeholder}</span>
      <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ClearableInput({
  onChange,
  type,
  value,
  ...rest
}: {
  onChange: (value: string) => void;
  type: "date" | "time";
  value: string;
  min?: string;
  "aria-label": string;
}) {
  return (
    <div className="recurepay-input-wrap">
      <input className="recurepay-input" onChange={(event) => onChange(event.target.value)} type={type} value={value} {...rest} />
      {value ? (
        <button aria-label="Clear" className="recurepay-clear" onClick={() => onChange("")} type="button">
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function RecurepayCompose({
  amount,
  autopay,
  beneficiaryAuth,
  canAutopay,
  compose,
  error,
  label,
  narration,
  onAmount,
  onAutopay,
  onBack,
  onCompose,
  onLabel,
  onNarration,
  onNext,
  onRecipient,
  onToken,
  recipient,
  resolution,
  token,
}: {
  amount: string;
  autopay: boolean;
  beneficiaryAuth: BeneficiaryAuth | null;
  canAutopay: boolean;
  compose: ComposeSchedule;
  error: string | null;
  label: string;
  narration: string;
  onAmount: (value: string) => void;
  onAutopay: (value: boolean) => void;
  onBack: () => void;
  onCompose: (next: ComposeSchedule) => void;
  onLabel: (value: string) => void;
  onNarration: (value: string) => void;
  onNext: () => void;
  onRecipient: (value: string) => void;
  onToken: (value: ArcTokenSymbol) => void;
  recipient: string;
  resolution: RecipientResolution;
  token: ArcTokenSymbol;
}) {
  const [picker, setPicker] = useState<"type" | "frequency" | "beneficiary" | null>(null);
  const today = useMemo(() => {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }, []);
  const patch = (next: Partial<ComposeSchedule>) => onCompose({ ...compose, ...next });
  const numericAmount = Number(amount);
  const fee = recurringFeeForAmount(numericAmount);

  const next = (
    <Button className="recurepay-next" onClick={onNext} size="sm">
      Next
    </Button>
  );

  return (
    <div className="recurepay-compose">
      <RecurepayBar action={next} onBack={onBack} title="Schedule payment" />

      <div className="recurepay-form">
        <Field label="Schedule type">
          <SelectButton
            onClick={() => setPicker("type")}
            placeholder="Choose one"
            value={compose.type === "one-time" ? "One-time payment" : "Recurring payment"}
          />
        </Field>

        {compose.type === "recurring" ? (
          <>
            <Field label="Frequency">
              <SelectButton
                onClick={() => setPicker("frequency")}
                placeholder="Choose"
                value={formatFrequencyLabel(compose.frequency, Number(compose.intervalDays) || null)}
              />
            </Field>
            {compose.frequency === "custom" ? (
              <Field label="Repeat every (days)">
                <input
                  className="recurepay-input"
                  inputMode="numeric"
                  onChange={(event) => patch({ intervalDays: event.target.value.replace(/\D/g, "").slice(0, 3) })}
                  placeholder="30"
                  value={compose.intervalDays}
                />
              </Field>
            ) : null}
          </>
        ) : null}

        <div className="recurepay-grid-2">
          <Field label={compose.type === "one-time" ? "Date" : "Start date"}>
            <input
              aria-label={compose.type === "one-time" ? "Date" : "Start date"}
              className="recurepay-input"
              min={today}
              onChange={(event) => patch({ date: event.target.value })}
              type="date"
              value={compose.date}
            />
          </Field>
          <Field label="Time (optional)">
            <ClearableInput aria-label="Time" onChange={(time) => patch({ time })} type="time" value={compose.time} />
          </Field>
        </div>

        {compose.type === "recurring" ? (
          <div className="recurepay-grid-2">
            <Field label="End date (optional)">
              <ClearableInput
                aria-label="End date"
                min={compose.date || today}
                onChange={(endDate) => patch({ endDate })}
                type="date"
                value={compose.endDate}
              />
            </Field>
            <Field label="Payments (optional)">
              <input
                className="recurepay-input"
                inputMode="numeric"
                onChange={(event) => patch({ payments: event.target.value.replace(/\D/g, "").slice(0, 4) })}
                placeholder="No limit"
                value={compose.payments}
              />
            </Field>
          </div>
        ) : null}

        <Field
          extra={
            <button className="recurepay-link is-green" onClick={() => setPicker("beneficiary")} type="button">
              Choose beneficiary
            </button>
          }
          label="Recipient"
        >
          <div className="relative">
            <Input
              aria-describedby="recurepay-recipient-status"
              autoComplete="off"
              className="recurepay-input pr-10"
              onChange={(event) => onRecipient(event.target.value)}
              placeholder="ONE ID or 0x wallet address"
              spellCheck={false}
              value={recipient}
            />
            <RecipientSpinner resolution={resolution} />
          </div>
          <RecipientStatus id="recurepay-recipient-status" resolution={resolution} />
        </Field>

        <Field label="Amount">
          <div className="recurepay-amount">
            <div className="recurepay-token-switch" role="radiogroup" aria-label="Currency">
              {arcTokenSymbols.map((symbol) => (
                <button
                  aria-checked={token === symbol}
                  key={symbol}
                  onClick={() => onToken(symbol)}
                  role="radio"
                  type="button"
                >
                  <TokenIcon className="h-4 w-4 rounded-full" symbol={symbol} />
                  {symbol}
                </button>
              ))}
            </div>
            <input
              className="recurepay-input recurepay-amount-input"
              inputMode="decimal"
              onChange={(event) => {
                const value = event.target.value.replace(/[^\d.]/g, "");
                if (/^\d*(\.\d{0,6})?$/.test(value)) onAmount(value);
              }}
              placeholder="0.00"
              value={amount}
            />
          </div>
          {numericAmount > 0 ? (
            <p className="recurepay-fee">
              + {formatTokenAmount(fee, token)} service fee{recurringFeeRateNote()} ·{" "}
              <strong>{formatTokenAmount(numericAmount + fee, token)}</strong> each payment
            </p>
          ) : null}
        </Field>

        <Field label="Name this payment (optional)">
          <input
            className="recurepay-input"
            maxLength={40}
            onChange={(event) => onLabel(event.target.value)}
            placeholder="Rent, salary, Netflix…"
            value={label}
          />
        </Field>

        <Field extra={<span className="text-sm text-muted-foreground tabular-nums">{narration.length}/50</span>} label="Narration">
          <textarea
            className="recurepay-input recurepay-textarea"
            maxLength={50}
            onChange={(event) => onNarration(event.target.value)}
            placeholder="Add a message"
            value={narration}
          />
        </Field>

        {canAutopay ? (
          <button
            aria-pressed={autopay}
            className={cn("recurepay-autopay", autopay && "is-on")}
            onClick={() => onAutopay(!autopay)}
            type="button"
          >
            <span className="recurepay-autopay-icon">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block font-semibold">Autopay</span>
              <span className="block text-sm text-muted-foreground">
                Pay automatically when due, even with SaphraONE closed. You approve a limit on-chain once; it only ever pays this
                recipient this amount.
              </span>
            </span>
            <span className="recurepay-switch" aria-hidden>
              <span />
            </span>
          </button>
        ) : null}

        {error ? (
          <p className="recurepay-error">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <Button className="recurepay-cta" onClick={onNext}>
          Continue
        </Button>
      </div>

      <PickerSheet
        onClose={() => setPicker(null)}
        onPick={(value) => patch({ type: value })}
        open={picker === "type"}
        options={[
          { hint: "Pay once, on a date you choose", label: "One-time payment", value: "one-time" },
          { hint: "Repeat on a schedule until you stop it", label: "Recurring payment", value: "recurring" },
        ]}
        title="Schedule type"
        value={compose.type}
      />
      <PickerSheet
        onClose={() => setPicker(null)}
        onPick={(value) => patch({ frequency: value, intervalDays: value === "custom" ? compose.intervalDays || "30" : compose.intervalDays })}
        open={picker === "frequency"}
        options={recurringFrequencies.map((frequency) => ({
          hint: frequencyHints[frequency],
          label: frequency === "custom" ? "Custom" : formatFrequencyLabel(frequency),
          value: frequency,
        }))}
        title="Frequency"
        value={compose.frequency}
      />
      <BeneficiaryPickerSheet
        auth={beneficiaryAuth}
        onClose={() => setPicker(null)}
        onSelect={(contact) => {
          onRecipient(contact.username ? `@${contact.username}` : contact.beneficiary_wallet);
          if (!label) onLabel(contact.name);
        }}
        open={picker === "beneficiary"}
      />
    </div>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────

export function RecurepayReview({
  amount,
  autopay,
  cadence,
  ends,
  error,
  label,
  narration,
  onBack,
  onConfirm,
  recipientLabel,
  runs,
  saving,
  status,
  token,
}: {
  amount: string;
  autopay: boolean;
  cadence: string;
  ends: string;
  error: string | null;
  label: string;
  narration: string;
  onBack: () => void;
  onConfirm: () => void;
  recipientLabel: string;
  runs: Date[];
  saving: boolean;
  status: string | null;
  token: ArcTokenSymbol;
}) {
  const numeric = Number(amount);
  const fee = recurringFeeForAmount(numeric);
  return (
    <div className="recurepay-compose">
      <RecurepayBar onBack={saving ? undefined : onBack} title="Review" />
      <div className="recurepay-form">
        <div className="recurepay-receipt">
          <span className="recurepay-receipt-eyebrow">{runs.length === 1 && ends === "After 1 payment" ? "One-time payment" : "Recurring payment"}</span>
          <span className="recurepay-receipt-amount">
            <TokenIcon className="h-7 w-7 rounded-full" symbol={token} />
            {formatTokenAmount(numeric, token)}
          </span>
          <span className="recurepay-receipt-to">to {recipientLabel}</span>
          <span className="recurepay-receipt-cadence">
            <Repeat className="h-4 w-4" /> {cadence}
          </span>
        </div>

        <dl className="recurepay-facts">
          {label ? <Fact label="For" value={label} /> : null}
          <Fact label="First payment" value={runs[0] ? `${runs[0].toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short", year: "numeric" })} at ${timeOf(runs[0])}` : "—"} />
          <Fact label="Ends" value={ends} />
          <Fact label="Service fee" value={`${formatTokenAmount(fee, token)}${recurringFeeRateNote()}`} />
          <Fact label="Each payment costs" strong value={formatTokenAmount(numeric + fee, token)} />
          {narration ? <Fact label="Narration" value={narration} /> : null}
          <Fact label="How it's paid" value={autopay ? "Autopay, within an on-chain limit" : "You confirm each payment"} />
        </dl>

        {runs.length > 1 ? (
          <div className="recurepay-card">
            <p className="recurepay-label">Next payments</p>
            <ul className="recurepay-run-chips">
              {runs.slice(0, 6).map((run) => (
                <li key={run.getTime()}>{run.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</li>
              ))}
              {runs.length > 6 ? <li className="is-more">+ more</li> : null}
            </ul>
          </div>
        ) : null}

        {autopay ? (
          <p className="recurepay-note">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
            Your wallet will ask you to approve a spending limit and an Autopay mandate. The mandate fixes this recipient, token and
            amount, so nothing else can ever be paid under it. You can revoke it any time.
          </p>
        ) : null}

        {status ? (
          <p className="recurepay-status">
            <Loader2 className="h-4 w-4 animate-spin" /> {status}
          </p>
        ) : null}
        {error ? (
          <p className="recurepay-error">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <Button className="recurepay-cta" disabled={saving} onClick={onConfirm}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {autopay ? "Schedule and authorize Autopay" : "Schedule payment"}
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, strong, value }: { label: string; strong?: boolean; value: string }) {
  return (
    <div className="recurepay-fact">
      <dt>{label}</dt>
      <dd className={cn(strong && "font-bold")}>{value}</dd>
    </div>
  );
}

// ── Schedule detail ─────────────────────────────────────────────────────────

export function ScheduleSheet({
  busy,
  canAct,
  executions,
  onAutopay,
  onCancel,
  onClose,
  onDelete,
  onPause,
  onResume,
  onRevoke,
  onRunNow,
  schedule,
}: {
  busy: string | null;
  canAct: boolean;
  executions: RecurringExecutionRecord[];
  onAutopay: () => void;
  onCancel: () => void;
  onClose: () => void;
  onDelete: () => void;
  onPause: () => void;
  onResume: () => void;
  onRevoke: () => void;
  onRunNow: () => void;
  schedule: RecurringScheduleRecord | null;
}) {
  const side = useSheetSide();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const open = Boolean(schedule);

  return (
    <Sheet
      onOpenChange={(next) => {
        if (!next) {
          setConfirmDelete(false);
          onClose();
        }
      }}
      open={open}
    >
      <SheetContent
        className={cn(
          "w-full gap-0 overflow-hidden p-0 sm:max-w-md",
          side === "bottom" && "max-h-[92dvh] rounded-t-[1.75rem] border-t-0 sm:max-w-none",
        )}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        {schedule ? (
          <div className="overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8">
            <div className="flex items-center gap-3.5">
              <Avatar schedule={schedule} size="lg" />
              <div className="min-w-0">
                <SheetTitle className="truncate text-lg font-bold">{recipientName(schedule)}</SheetTitle>
                <SheetDescription>{cadenceOf(schedule)}</SheetDescription>
              </div>
            </div>
            <p className="mt-5 font-heading text-3xl font-bold tabular-nums">{formatTokenAmount(schedule.amount, schedule.token_symbol)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusChip tone={schedule.status === "active" ? "good" : schedule.status === "paused" ? "warn" : "neutral"}>
                {schedule.status[0].toUpperCase() + schedule.status.slice(1)}
              </StatusChip>
              <StatusChip tone={hasAutopay(schedule) ? "brand" : "neutral"}>
                {hasAutopay(schedule) ? "Autopay on" : formatAuthorizationStatusLabel(schedule.authorization_status)}
              </StatusChip>
              {isOneTime(schedule) ? <StatusChip>One-time</StatusChip> : null}
            </div>

            <dl className="recurepay-facts mt-5">
              {schedule.status === "active" ? (
                <Fact
                  label="Next payment"
                  value={`${new Date(schedule.next_run_at).toLocaleDateString(undefined, { day: "numeric", month: "short", weekday: "short" })} at ${timeOf(new Date(schedule.next_run_at))}`}
                />
              ) : null}
              <Fact label="Started" value={new Date(schedule.starts_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} />
              <Fact
                label="Ends"
                value={
                  schedule.ends_at
                    ? new Date(schedule.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
                    : schedule.max_runs
                      ? `After ${schedule.max_runs} payment${schedule.max_runs === 1 ? "" : "s"}`
                      : "When you stop it"
                }
              />
              <Fact label="Payments made" value={schedule.max_runs ? `${schedule.run_count} of ${schedule.max_runs}` : String(schedule.run_count)} />
              {schedule.beneficiary_label ? <Fact label="For" value={schedule.beneficiary_label} /> : null}
              {schedule.narration ? <Fact label="Narration" value={schedule.narration} /> : null}
              <Fact label="Wallet" value={`${schedule.beneficiary_wallet.slice(0, 8)}…${schedule.beneficiary_wallet.slice(-6)}`} />
            </dl>

            {schedule.status !== "cancelled" && schedule.status !== "completed" ? (
              <div className="recurepay-actions">
                {schedule.status === "active" ? (
                  <ActionButton disabled={!canAct} icon={Play} label="Pay now" onClick={onRunNow} />
                ) : null}
                {schedule.status === "active" ? (
                  <ActionButton disabled={!canAct} icon={Pause} label="Pause" onClick={onPause} />
                ) : (
                  <ActionButton disabled={!canAct} icon={Play} label="Resume" onClick={onResume} />
                )}
                {hasAutopay(schedule) ? (
                  <ActionButton disabled={!canAct} icon={ShieldCheck} label="Turn off Autopay" onClick={onRevoke} />
                ) : (
                  <ActionButton
                    busy={busy === "autopay"}
                    disabled={!canAct}
                    icon={ShieldCheck}
                    label="Turn on Autopay"
                    onClick={onAutopay}
                  />
                )}
                <ActionButton disabled={!canAct} icon={X} label="Cancel schedule" onClick={onCancel} />
              </div>
            ) : null}

            {executions.length > 0 ? (
              <div className="mt-6">
                <p className="recurepay-label mb-2">Recent payments</p>
                <ul className="grid gap-1.5">
                  {executions.slice(0, 6).map((execution) => (
                    <li className="flex items-center justify-between gap-3 text-sm" key={execution.id}>
                      <span className="text-muted-foreground">
                        {new Date(execution.completed_at ?? execution.due_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </span>
                      <span>{formatExecutionStatusLabel(execution.status)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 border-t border-border pt-4">
              {confirmDelete ? (
                <div className="grid gap-2">
                  <p className="text-sm">Delete this schedule? Any Autopay mandate is cancelled on-chain first. This can&rsquo;t be undone.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => setConfirmDelete(false)} variant="outline">
                      Keep it
                    </Button>
                    <Button disabled={busy === "delete" || !canAct} onClick={onDelete} variant="destructive">
                      {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <button className="recurepay-danger-link" onClick={() => setConfirmDelete(true)} type="button">
                  <Trash2 className="h-4 w-4" /> Delete schedule
                </button>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ActionButton({
  busy,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  busy?: boolean;
  disabled?: boolean;
  icon: typeof Play;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="recurepay-action" disabled={disabled || busy} onClick={onClick} type="button">
      <span className="recurepay-action-icon">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}</span>
      <span>{label}</span>
    </button>
  );
}
