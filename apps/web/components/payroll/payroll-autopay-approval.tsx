"use client";

import {
  AlertCircle,
  CalendarClock,
  Check,
  Crown,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Chain,
} from "viem";

import { PayrollTeamRegistration } from "@/components/payroll/payroll-team-registration";
import { Button } from "@/components/ui/button";
import { erc20Abi } from "@/lib/contracts";
import { onchainFacts } from "@/lib/onchain-facts";
import { useSigningWallet } from "@/lib/use-signing-wallet";
import { rewardsV2Enabled, USD_PER_POINT } from "@/lib/rewards/config";
import { usePremiumPayment } from "@/lib/rewards/use-premium-payment";
import {
  FEATURE_UNLOCK_COST,
  FEATURE_UNLOCK_TERM_LABEL,
} from "@/lib/referral/types";
import { emitOnePointsUpdated } from "@/lib/referral/use-one-points";
import { arcTransport } from "@/lib/chains";

/**
 * Lets a business authorise unattended payroll.
 *
 * The schedule can create runs on its own, but paying one without anybody
 * present needs a standing USDC allowance to the payroll executor. That is a
 * real grant of spending authority, so it is made explicit here — how much,
 * to whom, and revocable in one click — rather than buried in a toggle.
 */

function executorAddress(): Address | null {
  const value = process.env.NEXT_PUBLIC_SWIFTPAY_PAYROLL_EXECUTOR_ADDRESS?.trim();
  return value && isAddress(value) ? getAddress(value) : null;
}

function shorten(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function PayrollAutopayApproval({
  circleSocialUuid,
  ownerWallet,
  workspaceId,
}: {
  circleSocialUuid?: string;
  ownerWallet?: string | null;
  workspaceId?: string;
}) {
  const wallet = useSigningWallet();
  const premium = usePremiumPayment();
  const executor = executorAddress();
  const token = onchainFacts.usdcAddress;

  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"approve" | "revoke" | null>(null);
  const [amount, setAmount] = useState("5000");
  // Automatic payment is the premium part; scheduling runs is free.
  const [entitled, setEntitled] = useState<boolean | null>(null);
  // Kept even once lapsed, so the card can say when access ended and offer a
  // renewal rather than presenting itself as never bought.
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const payer = ownerWallet && isAddress(ownerWallet) ? getAddress(ownerWallet) : null;

  const readAllowance = useCallback(async () => {
    if (!executor || !token || !payer) {
      setAllowance(null);
      return;
    }

    setLoading(true);
    try {
      const client = createPublicClient({
        chain: onchainFacts.chain as Chain,
        transport: arcTransport(),
      });
      const value = (await client.readContract({
        abi: erc20Abi,
        address: token,
        args: [payer, executor],
        functionName: "allowance",
      })) as bigint;
      setAllowance(value);
    } catch {
      setAllowance(null);
    } finally {
      setLoading(false);
    }
  }, [executor, payer, token]);

  useEffect(() => {
    void readAllowance();
  }, [readAllowance]);

  const readEntitlement = useCallback(async () => {
    if (!ownerWallet) return;
    const params = new URLSearchParams({ wallet: ownerWallet });
    if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);
    try {
      const response = await fetch(
        `/api/one-points/entitlements?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) return setEntitled(false);
      const payload = (await response.json()) as {
        entitlements?: Array<{ expires_at: string; feature: string }>;
      };
      const row = (payload.entitlements ?? []).find(
        (entry) => entry.feature === "PAYROLL_AUTO_SCHEDULE",
      );
      setExpiresAt(row?.expires_at ?? null);
      setEntitled(
        Boolean(row && new Date(row.expires_at).getTime() > Date.now()),
      );
    } catch {
      setEntitled(false);
    }
  }, [circleSocialUuid, ownerWallet]);

  useEffect(() => {
    void readEntitlement();
  }, [readEntitlement]);

  const expiryDate = expiresAt ? new Date(expiresAt) : null;
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
  // A lapsed term is a renewal, not a first purchase — the distinction decides
  // the wording and tells the business its settings survived.
  const lapsed = entitled === false && expiryLabel !== null;
  const unlockCost = FEATURE_UNLOCK_COST.PAYROLL_AUTO_SCHEDULE;
  // Rewards v2: paid in USDC at the points' value (100 points = $1).
  const usdcPrice = rewardsV2Enabled() ? unlockCost * USD_PER_POINT : null;
  const priceLabel = usdcPrice !== null ? `${usdcPrice.toFixed(2)} USDC` : `${unlockCost.toLocaleString()} points`;

  async function unlock(renew = false) {
    setUnlocking(true);
    setUnlockError(null);
    try {
      const txHash =
        usdcPrice !== null
          ? await premium.pay({ amountUsdc: usdcPrice, title: `Automatic payroll, ${FEATURE_UNLOCK_TERM_LABEL.PAYROLL_AUTO_SCHEDULE}` })
          : undefined;
      const response = await fetch("/api/one-points/entitlements", {
        body: JSON.stringify({
          circleSocialUuid,
          feature: "PAYROLL_AUTO_SCHEDULE",
          txHash,
          // Renewing before the term ends has to be explicit, otherwise the
          // server sees an active entitlement and extends nothing.
          renew,
          walletAddress: ownerWallet,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.message || "Could not unlock.");

      toast.success(
        renew || lapsed
          ? "Automatic payment renewed"
          : "Automatic payment unlocked",
        {
          description: renew
            ? `Another ${FEATURE_UNLOCK_TERM_LABEL.PAYROLL_AUTO_SCHEDULE} added to the time you had left.`
            : `Active for the next ${FEATURE_UNLOCK_TERM_LABEL.PAYROLL_AUTO_SCHEDULE}.`,
        },
      );
      emitOnePointsUpdated();
      await readEntitlement();
    } catch (cause) {
      setUnlockError(
        cause instanceof Error ? cause.message : "Could not unlock.",
      );
    } finally {
      setUnlocking(false);
    }
  }

  async function setApproval(next: bigint, label: "approve" | "revoke") {
    if (!executor || !token || !payer) return;

    if (!wallet.resolveProvider) {
      toast.error(wallet.reason ?? "Connect the business wallet to approve.");
      return;
    }

    setBusy(label);
    try {
      const provider = await wallet.resolveProvider();
      const walletClient = createWalletClient({
        account: payer,
        chain: onchainFacts.chain as Chain,
        transport: custom(
          provider as { request: (args: unknown) => Promise<unknown> },
        ),
      });

      const hash = await walletClient.sendTransaction({
        data: encodeFunctionData({
          abi: erc20Abi,
          args: [executor, next],
          functionName: "approve",
        }),
        to: token,
      });

      const client = createPublicClient({
        chain: onchainFacts.chain as Chain,
        transport: arcTransport(),
      });
      await client.waitForTransactionReceipt({ hash });

      toast.success(
        label === "revoke"
          ? "Automatic payroll turned off"
          : "Automatic payroll authorised",
      );
      await readAllowance();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message.split("\n")[0] : "Approval failed.";
      // A declined signature is a choice, not an error worth shouting about.
      if (!/user rejected|denied|4001/i.test(message)) {
        toast.error(message);
      }
    } finally {
      setBusy(null);
    }
  }

  if (!executor) {
    return (
      <section className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Automatic payment is not available on this network yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Schedules still create payroll runs on their due date — someone
              approves and pays them. Deploying the payroll executor enables
              hands-off payment.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (entitled === false) {
    return (
      <section className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">
                {lapsed
                  ? "Automatic payment has expired"
                  : "Automatic payment is off"}
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.6rem] font-extrabold uppercase tracking-wider text-primary">
                  <Crown className="h-3 w-3" />
                  Premium
                </span>
              </p>
              <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                {lapsed ? (
                  <>
                    Access ended on {expiryLabel}. Your schedules still build
                    each pay run on its due date, and your spending cap is
                    untouched — renew and unattended payment picks up again.
                  </>
                ) : (
                  <>
                    Your schedules already build each pay run on its due date —
                    that stays free. Unlock this to have approved runs paid
                    without anyone having to sign.
                  </>
                )}
              </p>
              {unlockError ? (
                <p className="mt-2 inline-flex items-start gap-1.5 text-xs font-semibold text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {unlockError}
                </p>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-heading text-xl font-bold tabular-nums">
              {usdcPrice !== null ? usdcPrice.toFixed(2) : unlockCost.toLocaleString()}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {usdcPrice !== null ? "USDC" : "OnePoints"} / {FEATURE_UNLOCK_TERM_LABEL.PAYROLL_AUTO_SCHEDULE}
            </p>
            <Button
              className="mt-2 h-9"
              disabled={unlocking || !ownerWallet}
              onClick={() => void unlock(false)}
              size="sm"
              type="button"
            >
              {unlocking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : lapsed ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              {lapsed ? "Renew" : "Unlock"}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const approved = allowance ?? BigInt(0);
  const isApproved = approved > BigInt(0);
  const approvedLabel = formatUnits(approved, 6);
  const amountValid = Number(amount) > 0;

  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {isApproved ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          ) : (
            <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {isApproved
                ? "Automatic payment is on"
                : "Automatic payment is off"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isApproved ? (
                <>
                  SaphraONE may pay approved scheduled runs from this wallet, up
                  to{" "}
                  <strong className="text-foreground">
                    {Number(approvedLabel).toLocaleString()} USDC
                  </strong>{" "}
                  in total. Revoke any time.
                </>
              ) : (
                <>
                  Schedules create runs but someone has to pay them. Authorise
                  the payroll executor to have approved runs paid on their due
                  date.
                </>
              )}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Executor {shorten(executor)} · spends only what you approve here
            </p>
          </div>
        </div>

        {loading && allowance === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {expiryLabel ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            {daysLeft !== null && daysLeft <= 30
              ? `Premium access ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"} · ${expiryLabel}`
              : `Premium access active until ${expiryLabel}`}
          </span>
          {daysLeft !== null && daysLeft <= 30 ? (
            <button
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary disabled:opacity-60"
              disabled={unlocking}
              onClick={() => void unlock(true)}
              type="button"
            >
              {unlocking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Renew for {priceLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {unlockError ? (
        <p className="mt-2 inline-flex items-start gap-1.5 text-xs font-semibold text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {unlockError}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Spending cap
          <input
            className="h-9 w-28 rounded-lg border border-border bg-background px-2 text-sm font-medium text-foreground outline-none focus:border-primary"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            value={amount}
          />
          USDC
        </label>

        <Button
          className="h-9"
          disabled={!amountValid || busy !== null}
          onClick={() => void setApproval(parseUnits(amount || "0", 6), "approve")}
          size="sm"
          type="button"
        >
          {busy === "approve" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {isApproved ? "Update cap" : "Authorise"}
        </Button>

        {isApproved ? (
          <Button
            className="h-9"
            disabled={busy !== null}
            onClick={() => void setApproval(BigInt(0), "revoke")}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy === "revoke" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldOff className="h-4 w-4" />
            )}
            Turn off
          </Button>
        ) : null}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        A cap rather than unlimited: SaphraONE can never pull more than this, and
        each run still has to be approved before it is paid.
      </p>

      {token && payer ? (
        <PayrollTeamRegistration
          circleSocialUuid={circleSocialUuid}
          executor={executor}
          payer={payer}
          token={token}
          workspaceId={workspaceId}
        />
      ) : null}
    </section>
  );
}
