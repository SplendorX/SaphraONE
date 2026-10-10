"use client";

import {
  AlertCircle,
  CalendarClock,
  Check,
  Loader2,
  Crown,
  Lock,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  AutoDepositFrequency,
  AutoDepositMode,
} from "@/lib/earn/auto-deposit";
import {
  APPROVED_RUNS,
  approveAutoDeposit,
  autoDepositAllowanceUsdc,
} from "@/lib/earn/auto-deposit-approval";
import { useAutoDeposit } from "@/lib/earn/use-auto-deposit";
import { FEATURE_UNLOCK_TERM_LABEL } from "@/lib/referral/types";
import { useSigningWallet } from "@/lib/use-signing-wallet";
import { rewardsV2Enabled, USD_PER_POINT } from "@/lib/rewards/config";
import { usePremiumPayment } from "@/lib/rewards/use-premium-payment";
import { cn } from "@/lib/utils";

const FREQUENCIES: Array<{ id: AutoDepositFrequency; label: string }> = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

type AutoDepositPanelProps = {
  circleSocialUuid?: string;
  vaultAddress?: string | null;
  walletAddress?: string | null;
};

export function AutoDepositPanel({
  circleSocialUuid,
  vaultAddress,
  walletAddress,
}: AutoDepositPanelProps) {
  const state = useAutoDeposit({ circleSocialUuid, walletAddress });
  const signingWallet = useSigningWallet();
  const premium = usePremiumPayment();
  // Rewards v2: paid in USDC at the points' value (100 points = $1).
  const usdcPrice = rewardsV2Enabled() ? state.unlockCost * USD_PER_POINT : null;
  const priceLabel = usdcPrice !== null ? `${usdcPrice.toFixed(2)} USDC` : `${state.unlockCost} points`;
  async function payAndUnlock() {
    const txHash =
      usdcPrice !== null
        ? await premium.pay({ amountUsdc: usdcPrice, title: `Automatic deposits, ${FEATURE_UNLOCK_TERM_LABEL.EARN_AUTO_DEPOSIT}` })
        : undefined;
    await state.unlock(txHash);
  }
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [mode, setMode] = useState<AutoDepositMode>("SWEEP");
  const [frequency, setFrequency] = useState<AutoDepositFrequency>("weekly");
  const [amount, setAmount] = useState("25");
  const [floor, setFloor] = useState("0");
  const [saved, setSaved] = useState(false);

  // Adopt the stored rule once it loads so the form edits rather than resets.
  useEffect(() => {
    if (!state.rule) return;
    setMode(state.rule.mode);
    setFrequency(state.rule.frequency);
    setAmount(String(state.rule.amount_usdc));
    setFloor(String(state.rule.min_balance_floor));
  }, [state.rule]);

  // Each vault has its own executor; a vault without one offers Sweep only.
  const executor = state.executorFor(vaultAddress);
  const executorReady = Boolean(executor);
  const amountValid = Number(amount) > 0;
  const floorValid = Number(floor) >= 0;
  const amountLabel = amountValid ? Number(amount).toFixed(2) : "—";
  const floorLabel = floorValid ? Number(floor).toFixed(2) : "—";
  const expiryDate = state.expiresAt ? new Date(state.expiresAt) : null;
  const expiryLabel =
    expiryDate && Number.isFinite(expiryDate.getTime())
      ? expiryDate.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;
  const daysLeft = expiryDate
    ? Math.ceil((expiryDate.getTime() - Date.now()) / 86_400_000)
    : null;
  const cadence =
    frequency === "daily"
      ? "Each day"
      : frequency === "weekly"
        ? "Once a week when"
        : "Once a month when";
  const canSave =
    Boolean(vaultAddress) &&
    amountValid &&
    floorValid &&
    !state.saving &&
    !approving &&
    (mode === "SWEEP" || (executorReady && Boolean(signingWallet.resolveProvider)));

  if (!walletAddress) {
    return (
      <p className="earn-footnote">
        Sign in to set up automatic deposits.
      </p>
    );
  }

  if (state.loading && !state.rule) {
    return (
      <p className="earn-footnote inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading your automation…
      </p>
    );
  }

  if (!state.unlocked) {
    return (
      <div className="earn-auto-lock">
        <div className="earn-auto-lock-badge">
          <Crown className="h-3.5 w-3.5" />
          Premium
        </div>
        <h3 className="earn-auto-lock-title">
          {state.expired ? "Renew automatic deposits" : "Automatic deposits"}
        </h3>
        <p className="earn-auto-lock-copy">
          {state.expired
            ? `Your automatic deposits access ended${
                expiryLabel ? ` on ${expiryLabel}` : ""
              }. Renew to start the schedule again — your settings are still here.`
            : "Move a set amount into a vault on a schedule, while keeping a reserve you choose untouched."}
        </p>
        <div className="earn-auto-lock-price">
          <span className="earn-auto-lock-points">{usdcPrice !== null ? usdcPrice.toFixed(2) : state.unlockCost}</span>
          <span className="earn-auto-lock-unit">{usdcPrice !== null ? "USDC" : "OnePoints"} / {FEATURE_UNLOCK_TERM_LABEL.EARN_AUTO_DEPOSIT}</span>
        </div>
        {approvalError ? (
        <p className="earn-error mt-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {approvalError}
        </p>
      ) : null}

      {state.error ? (
          <p className="earn-error mb-3">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {state.error}
          </p>
        ) : null}
        <Button
          className="h-11 w-full"
          disabled={state.saving}
          onClick={() => void payAndUnlock().catch(() => undefined)}
          type="button"
        >
          {state.saving || approving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
          {state.expired ? "Renew" : "Unlock"} for {priceLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="earn-form earn-panel-form">
      {expiryLabel ? (
        <div className="earn-auto-term">
          <span className="earn-auto-term-text">
            {daysLeft !== null && daysLeft <= 30
              ? `Access ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} · ${expiryLabel}`
              : `Access active until ${expiryLabel}`}
          </span>
          {daysLeft !== null && daysLeft <= 30 ? (
            <button
              className="earn-auto-term-renew"
              disabled={state.saving}
              onClick={() => void payAndUnlock().catch(() => undefined)}
              type="button"
            >
              Renew for {priceLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="earn-auto-modes">
        <button
          className={cn("earn-auto-mode", mode === "SWEEP" && "is-active")}
          onClick={() => setMode("SWEEP")}
          type="button"
        >
          <CalendarClock className="h-4 w-4" />
          <span className="earn-auto-mode-title">Sweep on visit</span>
          <span className="earn-auto-mode-copy">
            Offered as one tap next time you open SaphraONE. You sign each
            deposit.
          </span>
        </button>
        <button
          className={cn(
            "earn-auto-mode",
            mode === "UNATTENDED" && "is-active",
            !executorReady && "is-disabled",
          )}
          disabled={!executorReady}
          onClick={() => setMode("UNATTENDED")}
          type="button"
        >
          <Zap className="h-4 w-4" />
          <span className="earn-auto-mode-title">Fully automatic</span>
          <span className="earn-auto-mode-copy">
            {executorReady
              ? "Runs on schedule, no prompt. Needs one approval up front."
              : "Not available for this vault."}
          </span>
        </button>
      </div>

      <div className="earn-auto-grid">
        <label className="grid gap-1.5">
          <span className="earn-label">Amount per deposit</span>
          <input
            className="earn-input"
            inputMode="decimal"
            onChange={(event) => {
              setAmount(event.target.value);
              setSaved(false);
            }}
            placeholder="25"
            value={amount}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="earn-label">Keep at least</span>
          <input
            className="earn-input"
            inputMode="decimal"
            onChange={(event) => {
              setFloor(event.target.value);
              setSaved(false);
            }}
            placeholder="0"
            value={floor}
          />
        </label>
      </div>

      <div className="mt-3">
        <span className="earn-label">How often</span>
        <div className="earn-auto-freq">
          {FREQUENCIES.map((option) => (
            <button
              className={cn(
                "earn-auto-freq-chip",
                frequency === option.id && "is-active",
              )}
              key={option.id}
              onClick={() => {
                setFrequency(option.id);
                setSaved(false);
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="earn-footnote mt-3">
        {mode === "SWEEP" ? (
          <>
            {cadence} you open SaphraONE, you will be offered a{" "}
            {amountLabel} USDC deposit, as long as {floorLabel} USDC stays
            liquid. It waits for your visit, so the schedule is a minimum, not
            a guarantee.
          </>
        ) : (
          <>
            Runs {frequency} with no prompt. You approve up to{" "}
            {amountValid ? autoDepositAllowanceUsdc(Number(amount)).toFixed(2) : "—"} USDC
            ({APPROVED_RUNS} runs) once; approve again when it runs out.
            Skipped automatically if it would drop you below {floorLabel} USDC.
          </>
        )}
      </p>

      {state.rule?.last_error ? (
        <p className="earn-error mt-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Last run: {state.rule.last_error}
        </p>
      ) : null}

      {state.error ? (
        <p className="earn-error mt-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          className="h-11 w-full sm:w-auto sm:flex-1"
          disabled={!canSave}
          onClick={() => {
            void (async () => {
              setApprovalError(null);
              // Fully automatic runs pull through the executor, so approve it
              // before saving a rule that would otherwise only ever skip.
              if (mode === "UNATTENDED" && executor && signingWallet.resolveProvider) {
                setApproving(true);
                try {
                  await approveAutoDeposit({
                    amountUsdc: Number(amount),
                    executor,
                    resolveProvider: signingWallet.resolveProvider,
                    walletAddress,
                  });
                } catch (cause) {
                  setApprovalError(
                    cause instanceof Error ? cause.message.split("\n")[0] : "Approval failed.",
                  );
                  return;
                } finally {
                  setApproving(false);
                }
              }
              await state.saveRule({
                amountUsdc: Number(amount),
                frequency,
                minBalanceFloor: Number(floor),
                mode,
                vaultAddress: vaultAddress ?? "",
              });
              setSaved(true);
            })().catch(() => undefined);
          }}
          type="button"
        >
          {state.saving || approving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {state.rule ? "Update automation" : "Turn on automation"}
        </Button>
        {state.rule ? (
          <Button
            className="h-11"
            disabled={state.saving}
            onClick={() => void state.removeRule()}
            type="button"
            variant="outline"
          >
            <Trash2 className="h-4 w-4" />
            Turn off
          </Button>
        ) : null}
      </div>

      {!vaultAddress ? (
        <p className="earn-footnote mt-2">
          Pick a vault on the Vaults tab first — automation deposits into the
          vault you select.
        </p>
      ) : null}
    </div>
  );
}
