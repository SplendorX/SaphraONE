"use client";

import { RecipientSpinner, RecipientStatus } from "@/components/recipient-status";
import { useResolvedRecipient } from "@/lib/use-resolved-recipient";
import {
  Check,
  Copy,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  ShieldAlert,
  Crown,
  Wallet,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AllieMark } from "@/components/allie/AllieMark";
import { ConfirmationModal } from "@/components/allie/ConfirmationModal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fundAgentWalletOnchain,
  forgetPendingProPayment,
  payAllieProFee,
  readPendingProPayment,
} from "@/lib/allie/fund-agent-wallet";
import { useSigningWallet } from "@/lib/use-signing-wallet";
import {
  ProPaymentRejectedError,
  activateAlliePro,
  activateAllieProWithPoints,
  createAgentWalletRequest,
  displayToUnits,
  fetchAlliePlan,
  explorerTxUrl,
  fetchAgentWallet,
  fetchAlliePolicy,
  revokeAgentWallet,
  saveAlliePolicy,
  setAgentWalletStatus,
  shortenAddress,
  unitsToDisplay,
  type AgentWalletRecord,
  type AllieSubscriptionState,
  type PolicyRecord,
} from "@/lib/allie/client";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { emitOnePointsUpdated, useOnePoints } from "@/lib/referral/use-one-points";
import { rewardsV2Enabled } from "@/lib/rewards/config";
import { markAgentWalletActive } from "@/lib/wallet-mode";
import { cn } from "@/lib/utils";
import { userFacingErrorMessage } from "@/lib/circle-session";

type Feedback = { tone: "error" | "success"; text: string } | null;

/** True inside the Settings hub panel: sections render flat, not as cards. */
const EmbeddedContext = createContext(false);

const statusTone = {
  active: {
    label: "Active",
    dot: "bg-emerald-500",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  paused: {
    label: "Paused",
    dot: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  revoked: {
    label: "Revoked",
    dot: "bg-destructive",
    chip: "border-destructive/30 bg-destructive/10 text-destructive",
  },
} as const;

function Section({
  children,
  description,
  id,
  title,
  tone = "default",
}: {
  children: ReactNode;
  description?: string;
  id?: string;
  title: string;
  tone?: "default" | "danger";
}) {
  const embedded = useContext(EmbeddedContext);
  return (
    <section
      className={cn(
        embedded
          ? "border-t border-border/60 pt-5 first:border-t-0 first:pt-0"
          : "rounded-2xl border bg-card p-5",
        !embedded && (tone === "danger" ? "border-destructive/30" : "border-border"),
      )}
      id={id}
    >
      <h3
        className={cn(
          "text-sm font-semibold",
          tone === "danger" && "text-destructive",
        )}
      >
        {title}
      </h3>
      {description ? (
        <p className="mt-1 max-w-[52ch] text-[0.83rem] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AmountField({
  hint,
  label,
  onChange,
  suffix = "USDC",
  value,
}: {
  hint?: string;
  label: string;
  onChange: (next: string) => void;
  suffix?: string;
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[0.8rem] font-medium">{label}</span>
      <span className="allie-field">
        <input
          className="allie-field-input"
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
          value={value}
        />
        <span className="allie-field-suffix">{suffix}</span>
      </span>
      {hint ? (
        <span className="text-[0.72rem] text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.7rem] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="truncate font-mono text-xl font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

/**
 * `embedded` renders inside the Settings hub panel, which already shows the
 * section's icon, title and description: a compact summary, then tabs, with
 * flat sections instead of cards in a card. The standalone page keeps the
 * full layout.
 */
export function AgentWalletSettings({ embedded = false }: { embedded?: boolean } = {}) {
  const { address, circleSocialUuid } = usePlatformWallet();
  const signingWallet = useSigningWallet();
  const onePoints = useOnePoints();

  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<AgentWalletRecord | null>(null);
  const [balances, setBalances] = useState<{
    USDC: string;
    EURC: string;
  } | null>(null);
  const [serviceConfigured, setServiceConfigured] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastFundingTx, setLastFundingTx] = useState<string | null>(null);
  const [plan, setPlan] = useState<AllieSubscriptionState | null>(null);

  const [fundAmount, setFundAmount] = useState("");
  const [perTx, setPerTx] = useState("");
  const [daily, setDaily] = useState("");
  const [approvalAbove, setApprovalAbove] = useState("");
  const [assets, setAssets] = useState<("USDC" | "EURC")[]>(["USDC"]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientDraft, setRecipientDraft] = useState("");
  // Checked like every recipient field: the username must exist before it can
  // be approved for ALLIE.
  const recipientResolution = useResolvedRecipient(recipientDraft);
  const [dailySpent, setDailySpent] = useState("0");

  const context = useMemo(
    () => (address ? { ownerWallet: address, circleSocialUuid } : null),
    [address, circleSocialUuid],
  );

  const applyPolicy = useCallback((policy: PolicyRecord) => {
    setPerTx(unitsToDisplay(policy.perTxLimitUnits));
    setDaily(unitsToDisplay(policy.dailyLimitUnits));
    setApprovalAbove(unitsToDisplay(policy.requiresApprovalAboveUnits));
    setAssets(policy.approvedAssets);
    setRecipients(policy.approvedRecipients);
  }, []);

  const refresh = useCallback(async () => {
    if (!context) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [walletPayload, policyPayload, planPayload] = await Promise.all([
        fetchAgentWallet(context),
        fetchAlliePolicy(context),
        fetchAlliePlan(context).catch(() => null),
      ]);

      setPlan(planPayload);

      setWallet(walletPayload.agentWallet);
      setBalances(walletPayload.balances);
      setServiceConfigured(walletPayload.configured);
      markAgentWalletActive(walletPayload.agentWallet?.status === "active");
      applyPolicy(policyPayload.policy);
      setDailySpent(policyPayload.dailySpentUnits);
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "ALLIE settings could not be loaded.",
      });
    } finally {
      setLoading(false);
    }
  }, [applyPolicy, context]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // "Upgrade to Pro" in ALLIE links here with ?focus=allie-pro. The hash
  // belongs to the settings hub, so scroll to the plan once it has rendered.
  const focusedPro = useRef(false);
  useEffect(() => {
    if (loading || !plan || focusedPro.current) return;
    if (new URLSearchParams(window.location.search).get("focus") !== "allie-pro") return;
    focusedPro.current = true;
    requestAnimationFrame(() =>
      document
        .getElementById("allie-pro")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, [loading, plan]);

  const runTask = useCallback(
    async (key: string, task: () => Promise<string>) => {
      setBusy(key);
      setFeedback(null);

      try {
        setFeedback({ tone: "success", text: await task() });
      } catch (error) {
        const text = userFacingErrorMessage(error, "That action didn't go through. Nothing was moved — try again.");
        // Submitted but still confirming isn't a failure: say so, and pick
        // up the new balance as it lands.
        const pending = /still confirming/i.test(text);
        setFeedback({ tone: pending ? "success" : "error", text });
        if (pending) {
          window.setTimeout(() => void refresh(), 10_000);
          window.setTimeout(() => void refresh(), 30_000);
        }
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const handleCreate = () =>
    runTask("create", async () => {
      if (!context) throw new Error("Connect a wallet first.");
      await createAgentWalletRequest(context);
      await refresh();
      return "Your ALLIE Agent Wallet is ready.";
    });

  const handleFund = () =>
    runTask("fund", async () => {
      if (!context) throw new Error("Connect a wallet first.");

      const units = displayToUnits(fundAmount);
      if (!units || BigInt(units) <= 0n) {
        throw new Error("Enter an amount greater than zero.");
      }

      if (!signingWallet.resolveProvider || !signingWallet.address) {
        throw new Error(
          signingWallet.reason ??
            "Connect a wallet that can sign before funding ALLIE.",
        );
      }

      const amount = fundAmount.trim();
      const result = await fundAgentWalletOnchain({
        ...context,
        amountUsdc: amount,
        fromAddress: signingWallet.address,
        resolveProvider: signingWallet.resolveProvider,
      });

      setFundAmount("");
      setLastFundingTx(result.txHash);

      // Circle indexes the incoming transfer a beat after it lands.
      window.setTimeout(() => void refresh(), 4000);

      return `Sent ${result.amountDisplay} ${result.asset} to your Agent Wallet.`;
    });

  const handleSavePolicy = () =>
    runTask("policy", async () => {
      if (!context) throw new Error("Connect a wallet first.");

      const perTxUnits = displayToUnits(perTx);
      const dailyUnits = displayToUnits(daily);
      const approvalUnits = displayToUnits(approvalAbove || "0");

      if (!perTxUnits || !dailyUnits || approvalUnits === null) {
        throw new Error("Limits must be plain amounts, like 25 or 25.50.");
      }

      if (assets.length === 0) {
        throw new Error("Approve at least one asset.");
      }

      const { policy } = await saveAlliePolicy({
        ...context,
        perTxLimitUnits: perTxUnits,
        dailyLimitUnits: dailyUnits,
        requiresApprovalAboveUnits: approvalUnits,
        approvedRecipients: recipients,
        approvedAssets: assets,
        // A revoked wallet stays revoked — saving limits never reactivates it.
        status: wallet?.status ?? "active",
      });

      applyPolicy(policy);
      return "Policy saved. ALLIE is bound by these limits from now on.";
    });

  const handleToggleStatus = () =>
    runTask("status", async () => {
      if (!context || !wallet) throw new Error("No agent wallet yet.");

      const next = wallet.status === "active" ? "paused" : "active";
      await setAgentWalletStatus({ ...context, status: next });
      await refresh();

      return next === "paused"
        ? "ALLIE is paused. No funds can move until you resume her."
        : "ALLIE is active again.";
    });

  const handleUpgrade = () =>
    runTask("upgrade", async () => {
      if (!context || !plan) throw new Error("Connect a wallet first.");

      if (!signingWallet.resolveProvider || !signingWallet.address) {
        throw new Error(
          signingWallet.reason ?? "Connect a wallet that can sign.",
        );
      }

      // A payment already made whose activation failed is used again rather
      // than charging a second time.
      const txHash =
        readPendingProPayment(signingWallet.address) ??
        (await payAllieProFee({
          feeRecipient: plan.plan.feeRecipient,
          fromAddress: signingWallet.address,
          monthlyFeeUsdc: plan.plan.monthlyFeeUsdc,
          resolveProvider: signingWallet.resolveProvider,
        }));

      try {
        await activateAlliePro({ ...context, txHash });
      } catch (error) {
        // Keep the payment for a retry unless the server ruled it out.
        if (error instanceof ProPaymentRejectedError) {
          forgetPendingProPayment(signingWallet.address);
        }
        throw error;
      }
      forgetPendingProPayment(signingWallet.address);
      await refresh();

      return "ALLIE Pro is active. She can handle free-form instructions now.";
    });

  // The same Pro term, paid from OnePoints: no wallet signature needed.
  // While Pro is active this adds another term after the current one.
  const handlePayWithPoints = () =>
    runTask("points", async () => {
      if (!context || !plan) throw new Error("Connect a wallet first.");
      const extending = plan.tier === "pro";
      const paid = await activateAllieProWithPoints(context);
      emitOnePointsUpdated();
      await refresh();
      return extending
        ? `ALLIE Pro extended by ${plan.plan.termDays} days for ${paid.paidPoints} OnePoints.`
        : `ALLIE Pro is active, paid with ${paid.paidPoints} OnePoints.`;
    });

  const handleRevoke = () =>
    runTask("revoke", async () => {
      if (!context) throw new Error("Connect a wallet first.");
      await revokeAgentWallet(context);
      setRevokeOpen(false);
      await refresh();
      return "ALLIE is revoked. She can no longer move funds.";
    });

  const copyAddress = () => {
    if (!wallet) return;

    void navigator.clipboard
      ?.writeText(wallet.walletAddress)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  };

  const addRecipient = () => {
    if (!recipientDraft.trim()) return;
    if (recipientResolution.isResolving) return;

    if (!recipientResolution.isValid || !recipientResolution.resolvedAddress) {
      setFeedback({
        tone: "error",
        text: recipientResolution.error ?? "Enter a wallet address or a ONE ID that exists.",
      });
      return;
    }

    // Stored as @username or the wallet; the policy check matches either
    // case-insensitively, against the payee and its resolved wallet.
    const value = recipientResolution.resolvedUsername
      ? `@${recipientResolution.resolvedUsername}`
      : recipientResolution.resolvedAddress;

    setRecipients((current) =>
      current.some((entry) => entry.toLowerCase() === value.toLowerCase())
        ? current
        : [...current, value],
    );
    setRecipientDraft("");
  };

  if (!address) {
    return (
      <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Connect a wallet to set up ALLIE.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading your Agent Wallet…
      </div>
    );
  }

  const tone = wallet ? statusTone[wallet.status] : null;

  const heroBlock = (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="allie-hero">
        <div className="flex flex-wrap items-start gap-4">
          <AllieMark size={64} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">ALLIE Agent Wallet</h2>
              {tone ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-semibold",
                    tone.chip,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                  {tone.label}
                </span>
              ) : null}
            </div>

            <p className="mt-1.5 max-w-[56ch] text-[0.85rem] leading-relaxed text-muted-foreground">
              A wallet that holds only what you put in it. ALLIE can never reach
              your primary wallet, and every payment still waits for your
              confirmation.
            </p>

            {wallet ? (
              <button
                className="allie-address mt-3"
                onClick={copyAddress}
                title="Copy address"
                type="button"
              >
                <Wallet className="h-3.5 w-3.5 opacity-60" />
                <span className="truncate font-mono">
                  {wallet.walletAddress}
                </span>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 opacity-60" />
                )}
              </button>
            ) : null}
          </div>
        </div>

        {wallet ? (
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-3">
            <Stat
              label="USDC"
              value={balances ? unitsToDisplay(balances.USDC) : "—"}
            />
            <Stat
              label="EURC"
              value={balances ? unitsToDisplay(balances.EURC) : "—"}
            />
            <Stat label="Spent today" value={unitsToDisplay(dailySpent)} />
          </div>
        ) : null}
      </section>
    </>
  );

  const noticesBlock = (
    <>
      {feedback ? (
        <p
          className={cn(
            "rounded-xl border px-3.5 py-2.5 text-[0.83rem] font-medium",
            feedback.tone === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {feedback.text}
        </p>
      ) : null}

      {!serviceConfigured ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[0.83rem] font-medium text-amber-600 dark:text-amber-400">
          Agent Wallets are not configured on this deployment yet.
        </p>
      ) : null}
    </>
  );

  const createBlock = (
    <>
      {/* ── 1. Create ────────────────────────────────────────────────────── */}
      {!wallet ? (
        <Section
          description="Creates a Circle developer-controlled wallet on Arc, separate from your primary wallet. ALLIE can only ever spend what you fund it with, inside the limits you set below."
          title="Create your Agent Wallet"
        >
          <Button
            disabled={busy === "create" || !serviceConfigured}
            onClick={() => void handleCreate()}
            type="button"
          >
            {busy === "create" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Create Agent Wallet
          </Button>
        </Section>
      ) : null}
    </>
  );

  const fundBlock = (
    <>
      {/* ── 2. Fund ──────────────────────────────────────────────────────── */}
      {wallet ? (
        <Section
          description="Moves USDC from your primary wallet into ALLIE's. You sign it — SaphraONE never holds those keys. On Arc, USDC is the native gas token, so this also covers ALLIE's gas."
          title="Add funds"
        >
          <div className="grid gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[11rem] flex-1">
                <AmountField
                  label="Amount"
                  onChange={setFundAmount}
                  value={fundAmount}
                />
              </div>
              <Button
                disabled={
                  busy === "fund" ||
                  wallet.status === "revoked" ||
                  !signingWallet.canSign
                }
                onClick={() => void handleFund()}
                type="button"
              >
                {busy === "fund" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {busy === "fund" ? "Confirm in wallet…" : "Deposit"}
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {["5", "10", "25", "50"].map((preset) => (
                <button
                  className="allie-chip"
                  key={preset}
                  onClick={() => setFundAmount(preset)}
                  type="button"
                >
                  ${preset}
                </button>
              ))}
            </div>

            {!signingWallet.canSign && signingWallet.reason ? (
              <p className="text-[0.75rem] text-muted-foreground">
                {signingWallet.reason}
              </p>
            ) : null}

            {lastFundingTx ? (
              <a
                className="text-[0.75rem] font-medium text-primary underline-offset-4 hover:underline"
                href={explorerTxUrl(lastFundingTx)}
                rel="noreferrer noopener"
                target="_blank"
              >
                View deposit on Arcscan ({shortenAddress(lastFundingTx)})
              </a>
            ) : null}
          </div>
        </Section>
      ) : null}
    </>
  );

  const planBlock = (
    <>
      {/* ── 3. Plan ──────────────────────────────────────────────────────── */}
      {plan ? (
        <section
          className={cn(
            "rounded-2xl border p-5",
            plan.tier === "pro"
              ? "border-primary/40 bg-primary/5"
              : embedded
                ? "border-border bg-muted/30"
                : "border-border bg-card",
          )}
          id="allie-pro"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">
                  {plan.tier === "pro" ? "ALLIE Pro" : "Your plan: Free"}
                </h3>
                {plan.tier === "pro" ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[0.7rem] font-semibold text-primary">
                    <Crown className="h-3 w-3" />
                    Active
                  </span>
                ) : null}
              </div>
              <p className="mt-1 max-w-[52ch] text-[0.83rem] leading-relaxed text-muted-foreground">
                {plan.tier === "pro"
                  ? "ALLIE understands free-form instructions — amounts she has to work out, recipients she has to infer, questions about your spending."
                  : "Free covers direct instructions like “send $20 to @alex”. Pro adds language understanding for anything less literal."}
              </p>
            </div>

            <div className="shrink-0 text-right">
              {plan.tier === "pro" ? null : (
                <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-primary">
                  ALLIE Pro
                </p>
              )}
              <p className="font-mono text-2xl font-semibold tabular-nums">
                ${plan.plan.monthlyFeeUsdc.toFixed(2)}
              </p>
              <p className="text-[0.7rem] text-muted-foreground">per month</p>
            </div>
          </div>

          <p className="mt-4 text-[0.72rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {plan.tier === "pro" ? "Your plan includes" : "Pro adds"}
          </p>

          <ul className="mt-2 grid gap-1.5 text-[0.82rem] text-muted-foreground">
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              Free-form instructions — &ldquo;split 300 between my teammates&rdquo;
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {plan.plan.dailyCallBudget} requests a day, up to{" "}
              {plan.plan.dailyEscalationBudget} on the deepest tier
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              Keep going past {plan.plan.dailyCallBudget}: each extra request is{" "}
              {plan.plan.overageFeePoints} OnePoints, taken from your OnePoints
              balance. With no points left, ALLIE pauses until tomorrow
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              No per-payment fee — Free pays{" "}
              {unitsToDisplay(plan.plan.perPaymentFeeUnits)} USDC on every
              payment ALLIE sends
            </li>
          </ul>

          {plan.tier === "pro" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {/* Pro is a prepaid term that never renews, so there is nothing
                  to cancel: switching to Free early would only forfeit it. */}
              {rewardsV2Enabled() ? (
                // Rewards v2: Pro is paid in USDC only.
                <Button
                  disabled={busy === "upgrade" || !signingWallet.canSign}
                  onClick={() => void handleUpgrade()}
                  type="button"
                  variant="outline"
                >
                  {busy === "upgrade" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Add {plan.plan.termDays} days · ${plan.plan.monthlyFeeUsdc.toFixed(2)}
                </Button>
              ) : (
                <Button
                  disabled={busy === "points" || onePoints.points < plan.plan.monthlyFeePoints}
                  onClick={() => void handlePayWithPoints()}
                  title={`Your balance: ${onePoints.points.toLocaleString()} OnePoints`}
                  type="button"
                  variant="outline"
                >
                  {busy === "points" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Add {plan.plan.termDays} days · {plan.plan.monthlyFeePoints.toLocaleString()} OnePoints
                </Button>
              )}
              <span className="text-[0.75rem] text-muted-foreground">
                {plan.usageToday.calls} of {plan.plan.dailyCallBudget} requests
                used today
                {plan.subscription?.expiresAt
                  ? ` · active until ${new Date(plan.subscription.expiresAt).toLocaleDateString()}, then back to Free automatically — nothing renews`
                  : ""}
              </span>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                disabled={busy === "upgrade" || !signingWallet.canSign}
                onClick={() => void handleUpgrade()}
                type="button"
              >
                {busy === "upgrade" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {busy === "upgrade"
                  ? "Confirm in wallet…"
                  : `Upgrade — $${plan.plan.monthlyFeeUsdc.toFixed(2)}/mo`}
              </Button>
              {rewardsV2Enabled() ? (
                <span className="text-[0.75rem] text-muted-foreground">
                  {plan.plan.termDays} days, in USDC from your primary wallet.
                </span>
              ) : (
                <>
                  <Button
                    disabled={busy === "points" || onePoints.points < plan.plan.monthlyFeePoints}
                    onClick={() => void handlePayWithPoints()}
                    type="button"
                    variant="outline"
                  >
                    {busy === "points" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Pay with {plan.plan.monthlyFeePoints.toLocaleString()} OnePoints
                  </Button>
                  <span className="text-[0.75rem] text-muted-foreground">
                    {plan.plan.termDays} days, in USDC from your primary wallet or from
                    OnePoints (you have {onePoints.points.toLocaleString()}).
                  </span>
                </>
              )}
            </div>
          )}
        </section>
      ) : null}
    </>
  );

  const policyBlock = (
    <>
      {/* ── 3. Policy ────────────────────────────────────────────────────── */}
      <Section
        description="Every intent ALLIE creates is checked against these rules before it can execute. Any evaluation error fails closed."
        id="allie-policy"
        title="Spending policy"
      >
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <AmountField
              hint="Max for a single payment."
              label="Per transaction"
              onChange={setPerTx}
              value={perTx}
            />
            <AmountField
              hint="Resets at midnight, your time."
              label="Daily limit"
              onChange={setDaily}
              value={daily}
            />
            <AmountField
              hint="0 means always ask me."
              label="Ask me above"
              onChange={setApprovalAbove}
              value={approvalAbove}
            />
          </div>

          <div className="grid gap-2">
            <div>
              <span className="text-[0.8rem] font-medium">
                Approved recipients
              </span>
              <p className="text-[0.72rem] text-muted-foreground">
                Leave empty to allow any recipient.
              </p>
            </div>

            {recipients.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((entry) => (
                  <span className="allie-tag" key={entry}>
                    <span className="max-w-[11rem] truncate">
                      {shortenAddress(entry)}
                    </span>
                    <button
                      aria-label={`Remove ${entry}`}
                      onClick={() =>
                        setRecipients((current) =>
                          current.filter((value) => value !== entry),
                        )
                      }
                      type="button"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="flex gap-2">
              <span className="allie-field relative flex-1">
                <input
                  aria-describedby="allie-recipient-status"
                  autoComplete="off"
                  className="allie-field-input pr-8"
                  onChange={(event) => setRecipientDraft(event.target.value)}
                  spellCheck={false}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addRecipient();
                    }
                  }}
                  placeholder="0x… or ONE ID"
                  value={recipientDraft}
                />
                <RecipientSpinner resolution={recipientResolution} />
              </span>
              <Button
                aria-label="Add recipient"
                disabled={
                  Boolean(recipientDraft.trim()) &&
                  (recipientResolution.isResolving || !recipientResolution.isValid)
                }
                onClick={addRecipient}
                size="icon"
                type="button"
                variant="outline"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {recipientDraft.trim() ? (
              <RecipientStatus id="allie-recipient-status" resolution={recipientResolution} />
            ) : null}
          </div>

          <div className="grid gap-2">
            <span className="text-[0.8rem] font-medium">Allowed assets</span>
            <div className="flex flex-wrap gap-2">
              {(["USDC", "EURC"] as const).map((asset) => {
                const enabled = assets.includes(asset);

                return (
                  <button
                    aria-pressed={enabled}
                    className={cn("allie-toggle", enabled && "is-on")}
                    key={asset}
                    onClick={() =>
                      setAssets((current) =>
                        current.includes(asset)
                          ? current.filter((value) => value !== asset)
                          : [...current, asset],
                      )
                    }
                    type="button"
                  >
                    {asset}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Button
              disabled={busy === "policy"}
              onClick={() => void handleSavePolicy()}
              type="button"
            >
              {busy === "policy" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save policy
            </Button>
          </div>
        </div>
      </Section>
    </>
  );

  const dangerBlock = (
    <>
      {/* ── 4. Danger zone ───────────────────────────────────────────────── */}
      {wallet ? (
        <Section
          description="Pausing stops ALLIE immediately and can be undone. Revoking is permanent — both the wallet and its policy are marked revoked."
          title="Danger zone"
          tone="danger"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy === "status" || wallet.status === "revoked"}
              onClick={() => void handleToggleStatus()}
              type="button"
              variant="outline"
            >
              {wallet.status === "active" ? (
                <PauseCircle className="h-4 w-4" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              {wallet.status === "active" ? "Pause ALLIE" : "Resume ALLIE"}
            </Button>
            <Button
              disabled={busy === "revoke" || wallet.status === "revoked"}
              onClick={() => setRevokeOpen(true)}
              type="button"
              variant="destructive"
            >
              <ShieldAlert className="h-4 w-4" />
              Revoke wallet
            </Button>
          </div>
        </Section>
      ) : null}
    </>
  );

  const revokeModal = (
    <>
      <ConfirmationModal
        busy={busy === "revoke"}
        confirmLabel="Revoke ALLIE"
        description="ALLIE will stop immediately and cannot be restarted on this wallet. Funds already in the agent wallet stay where they are."
        onCancel={() => setRevokeOpen(false)}
        onConfirm={() => void handleRevoke()}
        open={revokeOpen}
        title="Revoke your Agent Wallet?"
        tone="destructive"
      />
    </>
  );

  if (embedded) {
    return (
      <EmbeddedContext.Provider value>
        <EmbeddedAgentWallet
          balances={balances}
          copied={copied}
          createBlock={createBlock}
          dailyLimit={daily}
          dailySpent={dailySpent}
          dangerBlock={dangerBlock}
          fundBlock={fundBlock}
          noticesBlock={noticesBlock}
          onCopyAddress={copyAddress}
          plan={plan}
          planBlock={planBlock}
          policyBlock={policyBlock}
          wallet={wallet}
        />
        {revokeModal}
      </EmbeddedContext.Provider>
    );
  }

  return (
    <div className="grid gap-4">
      {heroBlock}
      {noticesBlock}
      {createBlock}
      {fundBlock}
      {planBlock}
      {policyBlock}
      {dangerBlock}
      {revokeModal}
    </div>
  );
}

const embeddedTabs = [
  { value: "wallet", label: "Wallet" },
  { value: "plan", label: "Plan" },
  { value: "limits", label: "Limits" },
  { value: "controls", label: "Controls" },
] as const;

/**
 * The Settings-hub layout: a summary of the wallet on top (status, plan,
 * address, balances, today's spend against the limit), then one tab at a time.
 */
function EmbeddedAgentWallet({
  balances,
  copied,
  createBlock,
  dailyLimit,
  dailySpent,
  dangerBlock,
  fundBlock,
  noticesBlock,
  onCopyAddress,
  plan,
  planBlock,
  policyBlock,
  wallet,
}: {
  balances: { USDC: string; EURC: string } | null;
  copied: boolean;
  createBlock: ReactNode;
  dailyLimit: string;
  dailySpent: string;
  dangerBlock: ReactNode;
  fundBlock: ReactNode;
  noticesBlock: ReactNode;
  onCopyAddress: () => void;
  plan: AllieSubscriptionState | null;
  planBlock: ReactNode;
  policyBlock: ReactNode;
  wallet: AgentWalletRecord | null;
}) {
  const tone = wallet ? statusTone[wallet.status] : null;
  const spent = Number(unitsToDisplay(dailySpent));
  const limit = Number(dailyLimit);
  const spentPercent = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
  // Controls only exist once there is a wallet to pause or revoke.
  const tabs = wallet ? embeddedTabs : embeddedTabs.filter((tab) => tab.value !== "controls");

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <AllieMark size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">ALLIE Agent Wallet</span>
              {tone ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold",
                    tone.chip,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
                  {tone.label}
                </span>
              ) : (
                <span className="rounded-full border border-border px-2 py-0.5 text-[0.68rem] font-semibold text-muted-foreground">
                  Not created
                </span>
              )}
              {plan ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold",
                    plan.tier === "pro"
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {plan.tier === "pro" ? <Crown className="h-3 w-3" /> : null}
                  {plan.tier === "pro" ? "Pro" : "Free"}
                </span>
              ) : null}
            </div>
            {wallet ? (
              <button
                className="mt-1 inline-flex max-w-full items-center gap-1.5 text-[0.75rem] text-muted-foreground transition hover:text-foreground"
                onClick={onCopyAddress}
                title="Copy address"
                type="button"
              >
                <span className="truncate font-mono">{shortenAddress(wallet.walletAddress)}</span>
                {copied ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0 opacity-60" />
                )}
              </button>
            ) : (
              <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
                Holds only what you fund it with. Never touches your primary wallet.
              </p>
            )}
          </div>
        </div>

        {wallet ? (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 sm:grid-cols-3">
            <Stat label="USDC" value={balances ? unitsToDisplay(balances.USDC) : "—"} />
            <Stat label="EURC" value={balances ? unitsToDisplay(balances.EURC) : "—"} />
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <p className="text-[0.7rem] tracking-wide text-muted-foreground uppercase">
                Spent today
              </p>
              <p className="truncate font-mono text-xl font-semibold tabular-nums">
                {unitsToDisplay(dailySpent)}
                {limit > 0 ? (
                  <span className="text-sm font-normal text-muted-foreground"> / {dailyLimit}</span>
                ) : null}
              </p>
              {limit > 0 ? (
                <div
                  aria-label={`${spentPercent}% of today's limit used`}
                  className="mt-1.5 h-1 overflow-hidden rounded-full bg-border"
                  role="img"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      spentPercent >= 90 ? "bg-destructive" : "bg-primary",
                    )}
                    style={{ width: `${spentPercent}%` }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {noticesBlock}

      <Tabs defaultValue="wallet">
        <TabsList className="w-full sm:w-fit">
          {tabs.map((tab) => (
            <TabsTrigger className="flex-1 sm:flex-none" key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent className="pt-3" value="wallet">
          <div className="grid gap-5">
            {createBlock}
            {fundBlock}
          </div>
        </TabsContent>
        <TabsContent className="pt-3" value="plan">
          {planBlock}
        </TabsContent>
        <TabsContent className="pt-3" value="limits">
          {policyBlock}
        </TabsContent>
        {wallet ? (
          <TabsContent className="pt-3" value="controls">
            {dangerBlock}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
