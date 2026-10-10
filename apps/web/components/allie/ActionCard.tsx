"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  ShieldAlert,
} from "lucide-react";

import { AllieMark } from "@/components/allie/AllieMark";
import { AllieProcessing, AllieSettledCheck } from "@/components/allie/AllieProcessing";
import { ProTierBadge, isProTier } from "@/components/allie/ProTierBadge";
import { OneWatermark } from "@/components/brand/one-watermark";
import { Badge } from "@/components/ui/badge";
import {
  explorerTxUrl,
  shortenAddress,
  unitsToDisplay,
  type AllieChatResponse,
  type AllieExecutionResponse,
} from "@/lib/allie/client";
import { cn } from "@/lib/utils";

import "./allie-confirm.css";

const railLabels: Record<string, string> = {
  "arc-native": "Arc native",
  "agent-direct": "Agent Wallet (Arc)",
  batch: "BulkPay",
  recurring: "RecurePay",
  cctp: "CCTP bridge",
  "not-yet-available": "Unavailable",
};

function formatSeconds(seconds?: number) {
  if (!seconds) {
    return "—";
  }

  if (seconds < 60) {
    return `~${seconds}s`;
  }

  return `~${Math.round(seconds / 60)} min`;
}

function Line({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className={cn("allie-confirm-line", muted && "allie-confirm-line-muted")}>
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** "20 USDC": amounts are in the token itself, never dollars. */
export function allieMoney(units: string | null | undefined, asset: string) {
  return units ? `${unitsToDisplay(units)} ${asset}` : `— ${asset}`;
}

export type ActionCardState =
  | "idle"
  | "executing"
  | "settled"
  | "error"
  | "cancelled";

export function ActionCard({
  busy,
  execution,
  executionError,
  onCancel,
  onConfirm,
  onEdit,
  response,
  state,
}: {
  busy?: boolean;
  execution?: AllieExecutionResponse | null;
  executionError?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  /** Withdraws the card and hands the request back to the composer. */
  onEdit?: () => void;
  response: AllieChatResponse;
  state: ActionCardState;
}) {
  if (
    response.action.type !== "PaymentIntent" &&
    response.action.type !== "BatchPay"
  ) {
    return null;
  }

  const { action } = response;
  const legs = response.legs ?? [];
  const isBatch = action.type === "BatchPay";
  const blocked = !response.allowed;
  const txHash = execution?.result.txHash;
  const explorerUrl = txHash ? explorerTxUrl(txHash) : "";
  // `submitted` counts payments only — fee transfers ride along as extra legs
  // and must not inflate the denominator, or a clean single send reports
  // "1 of 2 submitted".
  const paymentLegCount =
    execution?.batch?.legs.filter((leg) => leg.kind === "payment").length ?? 0;
  const amountLabel = `${
    response.amountUnits ? unitsToDisplay(response.amountUnits) : "—"
  } ${action.asset}`;
  const recipientLabel = isBatch
    ? `${legs.length} recipients`
    : response.recipientLabel ??
      (response.resolvedRecipient
        ? shortenAddress(response.resolvedRecipient)
        : action.recipient);

  const confirmLabel = busy
    ? "Paying…"
    : isBatch
      ? legs.length === 2
        ? "Confirm both"
        : `Confirm all ${legs.length}`
      : "Confirm";
  const footnote = [
    !isBatch &&
    response.resolvedRecipient &&
    response.recipientLabel !== response.resolvedRecipient
      ? shortenAddress(response.resolvedRecipient)
      : null,
    railLabels[response.rail ?? ""] ?? null,
    response.estimatedSeconds ? formatSeconds(response.estimatedSeconds) : null,
    action.note ? `“${action.note}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "allie-confirm-card one-watermark-host",
        blocked && "allie-confirm-card-blocked",
        state === "cancelled" && "opacity-60",
      )}
    >
      <OneWatermark />

      <div className="mb-1 flex items-center gap-2.5">
        <AllieMark className="allie-confirm-avatar" size={36} />
        <p className="allie-confirm-name">Allie</p>
        {isProTier(response.tier) ? (
          <ProTierBadge
            className="ml-auto"
            overagePoints={response.overagePoints}
          />
        ) : (
          <Badge className="ml-auto" variant="outline">
            Tier {response.tier}
          </Badge>
        )}
      </div>

      {blocked ? (
        <div className="my-2 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{response.reason ?? "Your policy blocked this payment."}</span>
        </div>
      ) : null}

      {response.requiresApproval && !blocked && state === "idle" ? (
        <div className="my-2 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Above your auto-approve threshold — confirming here opens one more
            explicit go-ahead before anything moves.
          </span>
        </div>
      ) : null}

      <div className="allie-confirm-lines">
        {isBatch ? (
          legs.map((leg, index) => (
            <Line
              key={`${index}-${leg.address}`}
              label={`Send to ${leg.label}`}
              value={allieMoney(leg.amountUnits, action.asset)}
            />
          ))
        ) : (
          <Line
            label={`Send to ${recipientLabel}`}
            value={allieMoney(response.amountUnits, action.asset)}
          />
        )}

        {(response.fees?.fees ?? []).map((fee) => (
          <Line
            key={fee.kind}
            label={fee.label}
            muted
            value={allieMoney(fee.units, action.asset)}
          />
        ))}

        {response.plan === "pro" &&
        !(response.fees?.fees ?? []).some((fee) => fee.kind === "allie") ? (
          <Line label="ALLIE fee" muted value="Included with Pro" />
        ) : null}

        {response.totalDebitUnits &&
        response.totalDebitUnits !== response.amountUnits ? (
          <Line
            label="Total from your Agent Wallet"
            value={allieMoney(response.totalDebitUnits, action.asset)}
          />
        ) : null}
      </div>

      {footnote ? <p className="allie-confirm-foot">{footnote}</p> : null}

      {state === "settled" && execution ? (
        <div className="mt-3 min-w-0 overflow-hidden rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
          <p className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <AllieSettledCheck />
            {execution.batch && paymentLegCount > 1
              ? `${execution.batch.submitted} of ${paymentLegCount} payments submitted to Arc`
              : "Submitted to Arc"}
          </p>
          {txHash ? (
            explorerUrl ? (
              <a
                className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-primary underline-offset-4 hover:underline"
                href={explorerUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                {shortenAddress(txHash)}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {shortenAddress(txHash)}
              </p>
            )
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Awaiting a transaction hash from Circle.
            </p>
          )}
        </div>
      ) : null}

      {state === "cancelled" ? (
        <p className="mt-3 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
          Cancelled — nothing was sent. Ask again if you want to retry.
        </p>
      ) : null}

      {state === "error" && executionError ? (
        <p className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {executionError}
        </p>
      ) : null}

      {state === "executing" ? (
        <AllieProcessing amountLabel={amountLabel} recipientLabel={recipientLabel} />
      ) : null}

      {blocked || state === "settled" || state === "cancelled" || state === "executing" ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            className="allie-confirm-primary"
            disabled={busy || !response.intentId}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
          <button
            className="allie-confirm-secondary"
            disabled={busy}
            onClick={onEdit ?? onCancel}
            type="button"
          >
            {onEdit ? "Edit" : "Cancel"}
          </button>
          {onEdit ? (
            <button
              className="allie-confirm-ghost"
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
