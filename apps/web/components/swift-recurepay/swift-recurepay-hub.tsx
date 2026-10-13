"use client";

import { recurringFeeUnits } from "@/lib/fees";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Plus, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordPlatformTransactionActivity } from "@/lib/referral/activity-client";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  isAddress,
  type Address,
  type Hash,
} from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import {
  isoToDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/components/recurring-schedule-fields";
import { showSuccess } from "@/components/success-popup";
import {
  RecurepayBar,
  RecurepayCompose,
  RecurepayDashboard,
  RecurepayEmpty,
  RecurepayReview,
  ScheduleSheet,
} from "@/components/swift-recurepay/recurepay-views";
import { Button } from "@/components/ui/button";
import {
  describeCadence,
  projectRuns,
  scheduleFromCompose,
  type ComposeSchedule,
} from "@/lib/recurepay-plan";
import { personalCircleWallet } from "@/lib/business/provision-wallet";
import {
  circleSessionEventName,
  currentCircleAuth,
  callCircleWalletApi,
  getCircleErrorMessage,
  findCircleTokenBalance,
  getCircleLoginIdentity,
  readCircleLogin,
  readCircleWallets,
  type CircleLoginResult,
  type CircleTokenBalance,
  type CircleWallet,
} from "@/lib/circle-session";
import {
  erc20Abi,
  swiftBatchFeeRecipient,
  swiftRecurepayExecutorAbi,
  swiftRecurepayExecutorAddress,
} from "@/lib/contracts";
import { formatUnitsToDecimal } from "@/lib/save/decimal";
import { useResolvedRecipient } from "@/lib/use-resolved-recipient";
import {
  authorizeRecurringSchedule,
  createRecurringSchedule,
  deleteRecurringSchedule,
  fetchRecurringExecutions,
  fetchRecurringSchedules,
  runRecurringScheduleNow,
  updateRecurringExecution,
  updateRecurringSchedule,
} from "@/lib/recurring-schedules";
import {
  isCompletedDisplayStatus,
  isDueDisplayStatus,
  isProcessingDisplayStatus,
  mandatePeriodSeconds,
  recurringFrequencies,
  type RecurringExecutionRecord,
  type RecurringFrequency,
  type RecurringScheduleRecord,
} from "@/lib/recurring-utils";
import { ensureProfile, fetchProfile } from "@/lib/profile";
import { recoverCircleTxHash as recoverCircleTxHashFor } from "@/lib/circle-tx";
import { arcTokens, arcTokenSymbols, type ArcTokenSymbol } from "@/lib/tokens";
import { confirmFlow } from "@/lib/tx-approval/client";
import {
  fetchWalletSession,
  signInWalletSession,
} from "@/lib/wallet-auth-client";
import { arcChain, arcCircleBlockchain, arcTransport } from "@/lib/chains";

type CircleTransferChallenge = { challengeId?: string };
type CircleChallengeResult = {
  data?: {
    id?: string;
    transaction?: { txHash?: string; transactionHash?: string; hash?: string };
    transactionHash?: string;
    transactionId?: string;
    txHash?: string;
    hash?: string;
  };
  hash?: string;
  id?: string;
  transactionHash?: string;
  transactionId?: string;
  txHash?: string;
};

function isTxHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/i.test(value);
}

function extractCircleTxHash(result: CircleChallengeResult | undefined) {
  if (!result) return undefined;
  const data = result.data;
  const nested = data?.transaction;
  const candidates = [
    data?.txHash,
    data?.transactionHash,
    data?.hash,
    nested?.txHash,
    nested?.transactionHash,
    nested?.hash,
    result.txHash,
    result.transactionHash,
    result.hash,
  ];
  return candidates.find(isTxHash);
}

function extractCircleTransactionId(result: CircleChallengeResult | undefined) {
  if (!result) return undefined;
  const candidates = [
    result.data?.transactionId,
    result.data?.id,
    result.transactionId,
    result.id,
  ];
  return candidates.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function shortenAddress(value?: string) {
  if (!value) return "n/a";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/** The configured executor's fee on one payment (bands on SaphraRecurePay). */
function computePlatformFeeUnits(amountUnits: bigint) {
  return recurringFeeUnits(amountUnits);
}

/**
 * Circle's PIN SDK rejects with plain `{ code, message }` objects, not Errors;
 * reading only Errors hid the real reason as "Something went wrong."
 */
const arcReader = createPublicClient({
  chain: arcChain,
  transport: arcTransport(),
});

/**
 * The server re-reads the executor allowance on-chain as soon as it is told
 * about the approval. A Circle wallet can hand back the hash before the
 * transaction is mined, so wait for the receipt and for the allowance to be
 * visible first; otherwise authorization is refused as "not approved".
 */
async function waitForExecutorApproval(input: {
  owner: string;
  requiredUnits: bigint;
  token: Address;
  txHash: string;
}) {
  if (/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
    await arcReader
      .waitForTransactionReceipt({ hash: input.txHash as Hash, timeout: 30_000 })
      .catch(() => undefined);
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const allowance = await arcReader
      .readContract({
        abi: erc20Abi,
        address: input.token,
        args: [input.owner as Address, swiftRecurepayExecutorAddress as Address],
        functionName: "allowance",
      })
      .catch(() => 0n);
    if (allowance >= input.requiredUnits) return;
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
}

function getErrorMessage(error: unknown) {
  return getCircleErrorMessage(error, "Something went wrong.");
}

export function SwiftRecurepayHub() {
  const { address, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync, isPending: isSigningIn } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { isPending: isWritePending, writeContractAsync } = useWriteContract();
  const circleSdkRef = useRef<W3SSdk | null>(null);

  const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(null);
  const [circleWallet, setCircleWallet] = useState<CircleWallet | null>(null);
  const [circleBalances, setCircleBalances] = useState<CircleTokenBalance[]>([]);
  const [schedules, setSchedules] = useState<RecurringScheduleRecord[]>([]);
  const [executions, setExecutions] = useState<RecurringExecutionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [payingExecutionId, setPayingExecutionId] = useState<string | null>(null);
  const [authWallet, setAuthWallet] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isProfileReady, setIsProfileReady] = useState(false);
  // The wallet whose profile and session check has finished; until then the
  // page doesn't know yet whether to ask for authorization.
  const [checkedWallet, setCheckedWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [recipientInput, setRecipientInput] = useState("");
  const [beneficiaryLabel, setBeneficiaryLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);
  const [token, setToken] = useState<ArcTokenSymbol>("USDC");
  const [narration, setNarration] = useState("");
  // The page is a small flow: home → compose → review, plus a detail sheet.
  const [view, setView] = useState<"home" | "compose" | "review">("home");
  const [compose, setCompose] = useState<ComposeSchedule>(() => ({
    date: "",
    endDate: "",
    frequency: "monthly",
    intervalDays: "30",
    payments: "",
    time: "",
    type: "recurring",
  }));
  const [autopay, setAutopay] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [openScheduleId, setOpenScheduleId] = useState<string | null>(null);
  const [detailBusy, setDetailBusy] = useState<string | null>(null);

  const [authorizingScheduleId, setAuthorizingScheduleId] = useState<string | null>(
    null,
  );

  // ALLIE's "Review and authorize" carries the schedule in the URL:
  // /recurepay?recipient=@ada&amount=20&token=USDC&frequency=monthly. It
  // fills the form and opens it, so the person only has to check and confirm.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const recipient = params.get("recipient")?.trim();
    const linkAmount = params.get("amount")?.trim();
    const linkToken = params.get("token")?.trim().toUpperCase();
    const frequency = params.get("frequency")?.trim().toLowerCase();

    if (recipient) setRecipientInput(recipient);
    if (linkAmount && /^\d+(\.\d+)?$/.test(linkAmount)) setAmount(linkAmount);
    if (linkToken && arcTokenSymbols.includes(linkToken as ArcTokenSymbol)) {
      setToken(linkToken as ArcTokenSymbol);
    }

    // Schedule bounds from ALLIE: an explicit start, or `startIn` minutes from
    // now so a link opened later still starts in the future.
    const linkStartsAt = params.get("startsAt");
    const startIn = Number(params.get("startIn"));
    const explicitStart = linkStartsAt ? new Date(linkStartsAt) : null;
    const startsAt =
      explicitStart && explicitStart.getTime() > Date.now()
        ? explicitStart
        : Number.isFinite(startIn) && startIn > 0 && startIn <= 24 * 60
          ? new Date(Date.now() + startIn * 60_000)
          : // An explicit start that has already passed: fall back to 30 min.
            linkStartsAt
            ? new Date(Date.now() + 30 * 60_000)
            : null;
    const endsAt = isoToDatetimeLocalValue(params.get("endsAt"));
    const maxRuns = params.get("maxRuns")?.trim();
    const start = startsAt ? toDatetimeLocalValue(startsAt) : "";

    setCompose((current) => ({
      ...current,
      ...(frequency && recurringFrequencies.includes(frequency as RecurringFrequency)
        ? { frequency: frequency as RecurringFrequency }
        : {}),
      ...(start ? { date: start.slice(0, 10), time: start.slice(11, 16) } : {}),
      ...(endsAt ? { endDate: endsAt.slice(0, 10) } : {}),
      ...(maxRuns && /^[1-9]\d{0,3}$/.test(maxRuns)
        ? maxRuns === "1"
          ? { type: "one-time" as const }
          : { payments: maxRuns }
        : {}),
    }));
    if (recipient || linkAmount) setView("compose");
  }, []);

  const circleIdentity = getCircleLoginIdentity(circleLogin);
  const circleAddress =
    circleWallet?.address && isAddress(circleWallet.address)
      ? getAddress(circleWallet.address)
      : undefined;
  const isEmbeddedWalletMode = Boolean(circleLogin && circleAddress);
  const ownerAddress = isEmbeddedWalletMode
    ? circleAddress
    : address && isAddress(address)
      ? getAddress(address)
      : undefined;
  const isArcNetwork =
    isEmbeddedWalletMode || (isConnected && chainId === arcChain.id);
  const tokenInfo = arcTokens[token];
  // Autopay uses the connected wallet (external or Circle) — no env private key.
  const canUseAutopay = Boolean(ownerAddress);
  const isWalletAuthenticated = Boolean(
    isEmbeddedWalletMode ||
      (ownerAddress &&
        authWallet &&
        authWallet.toLowerCase() === ownerAddress.toLowerCase()),
  );
  const canAccessRecurring = Boolean(
    ownerAddress &&
      isProfileReady &&
      (isEmbeddedWalletMode
        ? Boolean(circleIdentity.socialUserUUID)
        : isWalletAuthenticated),
  );
  const isAuthenticatingWallet = isAuthLoading || isSigningIn;

  const { refetch: refetchExecutorAllowance } = useReadContract({
    abi: erc20Abi,
    address: tokenInfo.address,
    args:
      ownerAddress && swiftRecurepayExecutorAddress
        ? [ownerAddress, swiftRecurepayExecutorAddress as Address]
        : undefined,
    chainId: arcChain.id,
    functionName: "allowance",
    query: {
      enabled: Boolean(ownerAddress && swiftRecurepayExecutorAddress),
    },
  });

  const {
    error: recipientResolveError,
    isResolving: isRecipientResolving,
    isValid: isRecipientValid,
    resolvedAddress: resolvedRecipientAddress,
    resolvedUsername: resolvedRecipientUsername,
  } = useResolvedRecipient(recipientInput);
  const recipientResolution = {
    error: recipientResolveError,
    isResolving: isRecipientResolving,
    isValid: isRecipientValid,
    resolvedAddress: resolvedRecipientAddress,
    resolvedUsername: resolvedRecipientUsername,
  };

  const requestContext = useMemo(
    () =>
      ownerAddress
        ? {
            circleSocialUuid: circleIdentity.socialUserUUID,
            ownerWallet: ownerAddress,
          }
        : null,
    [circleIdentity.socialUserUUID, ownerAddress],
  );

  const scheduleMap = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules],
  );

  const dueExecutions = useMemo(
    () =>
      executions.filter(
        (execution) =>
          isDueDisplayStatus(execution.status) &&
          execution.execution_mode !== "autopay",
      ),
    [executions],
  );
  const processingExecutions = useMemo(
    () =>
      executions.filter(
        (execution) =>
          isProcessingDisplayStatus(execution.status) ||
          (execution.execution_mode === "autopay" &&
            isDueDisplayStatus(execution.status)),
      ),
    [executions],
  );
  const historyExecutions = useMemo(
    () =>
      executions.filter(
        (execution) =>
          isCompletedDisplayStatus(execution.status) ||
          execution.status === "FAILED" ||
          execution.status === "FAILED_PERMANENTLY" ||
          execution.status === "failed" ||
          execution.status === "RETRYING",
      ),
    [executions],
  );

  const refreshData = useCallback(async (silent = false) => {
    if (!canAccessRecurring || !requestContext) {
      setSchedules([]);
      setExecutions([]);
      setIsLoading(false);
      return;
    }

    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const [nextSchedules, nextExecutions] = await Promise.all([
        fetchRecurringSchedules(requestContext),
        fetchRecurringExecutions(requestContext),
      ]);
      setSchedules(nextSchedules);
      setExecutions(nextExecutions);
    } catch (refreshError) {
      if (!silent) {
        setError(getErrorMessage(refreshError));
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [canAccessRecurring, requestContext]);

  useEffect(() => {
    const sync = () => {
      setCircleLogin(readCircleLogin());
      setCircleWallet(personalCircleWallet(readCircleWallets()));
    };
    sync();
    // Pick up renewed Circle tokens (they expire after about an hour) so the
    // next action uses the current one rather than the token from page load.
    window.addEventListener(circleSessionEventName, sync);
    return () => window.removeEventListener(circleSessionEventName, sync);
  }, []);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!canAccessRecurring || !requestContext) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshData(true);
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [canAccessRecurring, refreshData, requestContext]);

  useEffect(() => {
    if (!ownerAddress) {
      setAuthWallet(null);
      setIsProfileReady(false);
      return;
    }

    const connectedAddress = ownerAddress;
    let cancelled = false;

    async function bootstrapWalletAccess() {
      setIsAuthLoading(true);

      try {
        await fetchProfile(connectedAddress).catch(() => null);
        await ensureProfile({
          authProvider: isEmbeddedWalletMode ? "google" : "external",
          circleSocialUuid: circleIdentity.socialUserUUID,
          walletAddress: connectedAddress,
        });

        if (!cancelled) {
          setIsProfileReady(true);
        }

        if (!isEmbeddedWalletMode) {
          const session = await fetchWalletSession();
          const sessionWallet = session.ownerWallet;

          if (!cancelled) {
            setAuthWallet(
              session.authenticated &&
                sessionWallet?.toLowerCase() === connectedAddress.toLowerCase()
                ? sessionWallet
                : null,
            );
          }
        }
      } catch {
        if (!cancelled) {
          setIsProfileReady(false);
          setAuthWallet(null);
        }
      } finally {
        if (!cancelled) {
          setIsAuthLoading(false);
          setCheckedWallet(connectedAddress);
        }
      }
    }

    void bootstrapWalletAccess();

    return () => {
      cancelled = true;
    };
  }, [circleIdentity.socialUserUUID, isEmbeddedWalletMode, ownerAddress]);

  async function handleWalletSignIn() {
    if (!ownerAddress || isEmbeddedWalletMode) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsAuthLoading(true);

    try {
      const session = await signInWalletSession({
        connectorName: connector?.name,
        ownerWallet: ownerAddress,
        signMessage: (message) => signMessageAsync({ message }),
      });
      setAuthWallet(session.ownerWallet ?? ownerAddress);
      setSuccess("Wallet authorized for RecurePay.");
    } catch (signInError) {
      setError(getErrorMessage(signInError));
    } finally {
      setIsAuthLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrapCircleSdk() {
      if (!circleLogin?.userToken || !circleWallet?.id) {
        return;
      }

      const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim() ?? "";

      if (!appId) {
        return;
      }

      try {
        const { W3SSdk: CircleW3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");

        if (cancelled) {
          return;
        }

        // One SDK instance for the page's lifetime: each instance adds its own
        // iframe and listeners, and several confuse Circle's PIN screen. The
        // current token is applied before every challenge (currentCircleAuth).
        if (!circleSdkRef.current) {
          circleSdkRef.current = new CircleW3SSdk({
            appSettings: { appId },
            authentication: {
              encryptionKey: circleLogin.encryptionKey,
              userToken: circleLogin.userToken,
            },
          });
        }

        const balancePayload = await callCircleWalletApi<{
          tokenBalances?: CircleTokenBalance[];
        }>("getTokenBalance", {
          userToken: circleLogin.userToken,
          walletId: circleWallet.id,
        });

        if (!cancelled) {
          setCircleBalances(balancePayload.tokenBalances ?? []);
        }
      } catch {
        if (!cancelled) {
          setCircleBalances([]);
        }
      }
    }

    void bootstrapCircleSdk();

    return () => {
      cancelled = true;
    };
    // Keyed on the token, not the login object, which is re-read on every
    // Circle session event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleLogin?.userToken, circleWallet?.id]);

  async function ensureArcNetwork() {
    if (isArcNetwork) {
      return true;
    }

    try {
      await switchChainAsync({ chainId: arcChain.id });
      return true;
    } catch (switchError) {
      setError(getErrorMessage(switchError));
      return false;
    }
  }

  /** The form, checked: what to send to the API, or the first problem. */
  function validateCompose() {
    if (!requestContext || !ownerAddress) {
      return "Connect and authorize a wallet before scheduling a payment.";
    }
    if (!isRecipientValid || !resolvedRecipientAddress) {
      return recipientResolveError ?? "Enter a valid @username or wallet address.";
    }
    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value <= 0) {
      return "Enter an amount.";
    }
    const plan = scheduleFromCompose(compose);
    return plan.ok ? null : plan.error;
  }

  function handleComposeNext() {
    const problem = validateCompose();
    setComposeError(problem);
    setError(null);
    if (!problem) setView("review");
  }

  async function handleCreateSchedule() {
    const plan = scheduleFromCompose(compose);
    if (!requestContext || !ownerAddress || !resolvedRecipientAddress || !plan.ok) {
      setComposeError(validateCompose() ?? "Check the details and try again.");
      setView("compose");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const schedule = await createRecurringSchedule({
        amount,
        autopayEnabled: canUseAutopay ? autopay : undefined,
        beneficiaryLabel: beneficiaryLabel || undefined,
        beneficiaryUsername: resolvedRecipientUsername ?? undefined,
        beneficiaryWallet: resolvedRecipientAddress,
        circleSocialUuid: requestContext.circleSocialUuid,
        endsAt: plan.endsAt?.toISOString(),
        frequency: plan.frequency,
        intervalDays: plan.intervalDays ?? undefined,
        maxRuns: plan.maxRuns ?? undefined,
        narration: narration.trim() || "RecurePay schedule",
        ownerWallet: ownerAddress,
        startsAt: plan.startsAt.toISOString(),
        tokenSymbol: token,
        walletMode: isEmbeddedWalletMode ? "circle" : "external",
      });

      setSchedules((current) => [schedule, ...current]);

      let autopayFailed: string | null = null;
      if (autopay && canUseAutopay) {
        try {
          await authorizeScheduleAutopay(schedule);
          await refreshData();
        } catch (authorizeError) {
          autopayFailed = getErrorMessage(authorizeError);
        }
      }

      setRecipientInput("");
      setBeneficiaryLabel("");
      setAmount("");
      setNarration("");
      setCompose((current) => ({ ...current, date: "", endDate: "", payments: "", time: "" }));
      setAutopay(false);
      setView("home");
      setOpenScheduleId(null);

      showSuccess({
        amount: `${schedule.amount} ${schedule.token_symbol}`,
        eyebrow: "RecurePay",
        rows: [
          { label: "First payment", value: new Date(schedule.starts_at).toLocaleString() },
          {
            label: "Ends",
            value: schedule.ends_at
              ? new Date(schedule.ends_at).toLocaleDateString()
              : schedule.max_runs
                ? `After ${schedule.max_runs} payment${schedule.max_runs === 1 ? "" : "s"}`
                : "When you stop it",
          },
        ],
        subtitle:
          autopay && !autopayFailed
            ? "Autopay is on: it pays on time, even with SaphraONE closed."
            : "We'll remind you here when it's due.",
        title: schedule.max_runs === 1 ? "Payment scheduled" : "Recurring payment scheduled",
      });
      if (autopayFailed) {
        setError(`Scheduled, but Autopay wasn't turned on: ${autopayFailed} Turn it on from the schedule.`);
      }
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setIsSaving(false);
      setSuccess(null);
    }
  }

  async function handleScheduleStatus(
    schedule: RecurringScheduleRecord,
    status: "active" | "paused" | "cancelled",
  ) {
    if (!requestContext) {
      return;
    }

    try {
      const updated = await updateRecurringSchedule(schedule.id, {
        ...requestContext,
        status,
      });
      setSchedules((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSuccess(
        status === "paused"
          ? "Schedule paused."
          : status === "active"
            ? "Schedule resumed."
            : "Schedule cancelled.",
      );
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    }
  }

  async function handleDeleteSchedule(scheduleId: string) {
    if (!requestContext) {
      // Never a silent no-op: say why nothing happened.
      setError("Connect the wallet that owns this schedule to delete it.");
      return;
    }

    setDeletingScheduleId(scheduleId);
    setError(null);
    try {
      const schedule = schedules.find((item) => item.id === scheduleId);
      if (schedule) {
        await cancelScheduleMandate(schedule);
      }
      await deleteRecurringSchedule(scheduleId, requestContext);
      setSchedules((current) => current.filter((item) => item.id !== scheduleId));
      setExecutions((current) => current.filter((item) => item.schedule_id !== scheduleId));
      setSuccess("Schedule deleted.");
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setDeletingScheduleId(null);
    }
  }

  /**
   * Cancels a schedule's on-chain mandate if it is still active, so nothing
   * can be paid under it even if the server were compromised.
   */
  async function cancelScheduleMandate(schedule: RecurringScheduleRecord) {
    if (!schedule.authorization_mandate_id || !swiftRecurepayExecutorAddress) {
      return;
    }
    const executor = swiftRecurepayExecutorAddress as Address;
    const mandate = await arcReader
      .readContract({
        abi: swiftRecurepayExecutorAbi,
        address: executor,
        args: [schedule.authorization_mandate_id as Hash],
        functionName: "mandates",
      })
      .catch(() => null);
    const isActive = mandate?.[6] === true;
    if (!isActive) {
      return;
    }

    setSuccess("Confirm cancelling the Autopay mandate in your wallet…");
    try {
      await sendAutopayCall({
        abi: swiftRecurepayExecutorAbi,
        address: executor,
        args: [schedule.authorization_mandate_id as Hash],
        functionName: "cancelMandate",
        refId: "RecurePay Autopay cancel",
      });
    } finally {
      setSuccess(null);
    }
  }

  /** Sends one contract call from the connected wallet and returns its hash. */
  async function sendAutopayCall(input: {
    abi: typeof erc20Abi | typeof swiftRecurepayExecutorAbi;
    address: Address;
    args: readonly unknown[];
    functionName: string;
    refId: string;
    /** Hashes of earlier calls in this flow, so Circle recovery can't return them. */
    skipHashes?: string[];
  }) {
    if (isEmbeddedWalletMode) {
      if (!circleLogin || !circleWallet?.id || !circleSdkRef.current) {
        throw new Error("Circle wallet is not ready to authorize Autopay.");
      }

      const callData = encodeFunctionData({
        abi: input.abi,
        args: input.args,
        functionName: input.functionName,
      } as Parameters<typeof encodeFunctionData>[0]);
      const challenge = await callCircleWalletApi<{ challengeId?: string }>(
        "createContractExecution",
        {
          callData,
          contractAddress: input.address,
          feeLevel: "MEDIUM",
          refId: input.refId,
          userToken: circleLogin.userToken,
          walletId: circleWallet.id,
        },
      );
      if (!challenge.challengeId) {
        throw new Error("Circle did not return an Autopay challenge.");
      }
      const { txHash } = await executeCircleChallenge(
        challenge.challengeId,
        input.skipHashes,
      );
      return txHash;
    }

    if (!(await ensureArcNetwork())) {
      throw new Error(`Switch to ${arcChain.name} before authorizing Autopay.`);
    }

    return writeContractAsync({
      abi: input.abi,
      address: input.address,
      args: input.args,
      chainId: arcChain.id,
      functionName: input.functionName,
    } as Parameters<typeof writeContractAsync>[0]);
  }

  /**
   * Authorizes a schedule on-chain in two steps:
   * 1. a bounded allowance to the executor (enough for the remaining runs, at
   *    most a year of them), never an unlimited one;
   * 2. a mandate that fixes this schedule's recipient, token and cap per
   *    period, which is all the operator can ever pay under.
   * Returns the mandate transaction's hash for the server to verify.
   */
  /** The spending limit Autopay asks for: up to 12 runs, fee included. */
  function autopayBudget(schedule: RecurringScheduleRecord) {
    const amountUnits = BigInt(schedule.amount_units);
    const perRun = amountUnits + computePlatformFeeUnits(amountUnits);
    const remainingRuns =
      schedule.max_runs && schedule.max_runs > 0
        ? Math.max(1, schedule.max_runs - schedule.run_count)
        : 12;
    return perRun * BigInt(Math.min(remainingRuns, 12));
  }

  /** One confirmation (lib/tx-approval) for the spending limit and the mandate. */
  function createScheduleMandate(schedule: RecurringScheduleRecord) {
    return confirmFlow(
      isEmbeddedWalletMode ? circleWallet?.id : null,
      {
        amount: formatUnitsToDecimal(
          autopayBudget(schedule),
          arcTokens[schedule.token_symbol].decimals,
        ),
        maxUses: 3,
        recipients: [schedule.beneficiary_wallet],
        title: "Turn on Autopay",
        token: schedule.token_symbol,
      },
      () => createScheduleMandateCalls(schedule),
    );
  }

  async function createScheduleMandateCalls(schedule: RecurringScheduleRecord) {
    if (!ownerAddress || !swiftRecurepayExecutorAddress) {
      throw new Error("Autopay executor is not configured.");
    }

    const executor = swiftRecurepayExecutorAddress as Address;
    const token = arcTokens[schedule.token_symbol].address as Address;
    const amountUnits = BigInt(schedule.amount_units);
    const budget = autopayBudget(schedule);

    const currentAllowance = await arcReader
      .readContract({
        abi: erc20Abi,
        address: token,
        args: [ownerAddress as Address, executor],
        functionName: "allowance",
      })
      .catch(() => 0n);

    const earlierHashes: string[] = [];
    if (currentAllowance < budget) {
      setSuccess("Approve the Autopay spending limit in your wallet…");
      const approveHash = await sendAutopayCall({
        abi: erc20Abi,
        address: token,
        // Other schedules share this allowance, so add to it rather than replace it.
        args: [executor, currentAllowance + budget],
        functionName: "approve",
        refId: "RecurePay Autopay approve",
      });
      earlierHashes.push(approveHash);
      await waitForExecutorApproval({
        owner: ownerAddress,
        requiredUnits: currentAllowance + budget,
        token,
        txHash: approveHash,
      });
    }

    const expiresAt = schedule.ends_at
      ? BigInt(Math.floor(new Date(schedule.ends_at).getTime() / 1000) + 24 * 60 * 60)
      : 0n;

    setSuccess("Confirm the Autopay mandate in your wallet…");
    return sendAutopayCall({
      abi: swiftRecurepayExecutorAbi,
      address: executor,
      args: [
        schedule.beneficiary_wallet as Address,
        token,
        amountUnits,
        BigInt(mandatePeriodSeconds(schedule.frequency, schedule.interval_days)),
        expiresAt,
      ],
      functionName: "createMandate",
      refId: "RecurePay Autopay mandate",
      skipHashes: earlierHashes,
    });
  }

  async function authorizeScheduleAutopay(schedule: RecurringScheduleRecord) {
    if (!requestContext) {
      throw new Error("Authorize this wallet before enabling Autopay.");
    }

    setAuthorizingScheduleId(schedule.id);

    setError(null);

    try {
      // A mandate from an earlier attempt that didn't finish saving is reused,
      // so retrying never asks for another signature it doesn't need.
      const existing = await authorizeRecurringSchedule(schedule.id, {
        ...requestContext,
        maxPaymentAmountUnits: schedule.amount_units,
      }).catch(() => null);
      const updated =
        existing ??
        (await (async () => {
          const txHash = await createScheduleMandate(schedule);
          setSuccess(`Confirming the Autopay mandate on ${arcChain.name}…`);
          return authorizeRecurringSchedule(schedule.id, {
            ...requestContext,
            authorizationTxHash: txHash,
            maxPaymentAmountUnits: schedule.amount_units,
          });
        })());
      setSuccess(null);
      setSchedules((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      await refetchExecutorAllowance();
      return updated;
    } catch (authorizeError) {
      setSuccess(null);
      throw authorizeError;
    } finally {
      setAuthorizingScheduleId(null);
    }
  }

  async function handleDisableAutopay(schedule: RecurringScheduleRecord) {
    if (!requestContext) {
      return;
    }

    try {
      await cancelScheduleMandate(schedule);

      const updated = await authorizeRecurringSchedule(schedule.id, {
        ...requestContext,
        action: "revoke",
      });
      setSchedules((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSuccess("Autopay authorization revoked. Background payments will stop.");
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    }
  }

  async function handleRunNow(scheduleId: string) {
    if (!requestContext) {
      return;
    }

    try {
      const execution = await runRecurringScheduleNow(scheduleId, requestContext);
      setExecutions((current) => [execution, ...current]);
      setSuccess("Manual run queued for wallet confirmation.");
    } catch (runError) {
      setError(getErrorMessage(runError));
    }
  }

  async function recoverCircleTxHash(input: {
    skipHashes?: string[];
    transactionId?: string;
  }) {
    if (!circleLogin || !circleWallet?.id) {
      return null;
    }

    // The shared recovery only accepts this transaction's own hash, never
    // the latest one on the wallet (which may be an incoming payment).
    return recoverCircleTxHashFor({
      attempts: 15,
      skipHashes: input.skipHashes,
      transactionId: input.transactionId,
      userToken: circleLogin.userToken,
      walletId: circleWallet.id,
    });
  }

  async function executeCircleChallenge(
    challengeId: string,
    skipHashes: string[] = [],
  ) {
    if (!circleLogin || !circleSdkRef.current) {
      throw new Error("Circle wallet confirmation is not ready.");
    }

    circleSdkRef.current.setAuthentication(currentCircleAuth(circleLogin));

    const executed = await new Promise<{
      transactionId?: string;
      txHash?: string;
    }>((resolve, reject) => {
      circleSdkRef.current?.execute(challengeId, (executeError, result) => {
        if (executeError) {
          // The SDK's error keeps code/message in non-enumerable fields, so a
          // plain log prints "{}". Spell them out. warn, not error: a closed
          // PIN window is not a crash and should not raise the dev overlay.
          const details = executeError as unknown as Record<string, unknown> | null;
          console.warn("[Recurepay] Circle challenge failed", {
            code: details?.code,
            message: details?.message,
            name: details?.name,
            fields: details ? Object.getOwnPropertyNames(details) : [],
          });
          reject(executeError);
          return;
        }

        const challengeResult = result as CircleChallengeResult | undefined;
        resolve({
          transactionId: extractCircleTransactionId(challengeResult),
          txHash: extractCircleTxHash(challengeResult),
        });
      });
    });

    let txHash = executed.txHash;
    if (!txHash) {
      txHash =
        (await recoverCircleTxHash({
          skipHashes,
          transactionId: executed.transactionId,
        })) ?? undefined;
    }

    if (!txHash) {
      throw new Error("Circle transfer completed without a transaction hash.");
    }

    return { txHash };
  }

  /** One confirmation (lib/tx-approval) for the platform fee and the payment. */
  function executePaymentForSchedule(
    schedule: RecurringScheduleRecord,
    executionId: string,
  ) {
    const amountUnits = BigInt(schedule.amount_units);
    const feeRecipient =
      swiftBatchFeeRecipient && isAddress(swiftBatchFeeRecipient) ? swiftBatchFeeRecipient : null;
    return confirmFlow(
      isEmbeddedWalletMode ? circleWallet?.id : null,
      {
        amount: formatUnitsToDecimal(
          amountUnits + (feeRecipient ? computePlatformFeeUnits(amountUnits) : 0n),
          arcTokens[schedule.token_symbol].decimals,
        ),
        maxUses: 3,
        recipients: feeRecipient
          ? [schedule.beneficiary_wallet, feeRecipient]
          : [schedule.beneficiary_wallet],
        title: "Send recurring payment",
        token: schedule.token_symbol,
      },
      () => runPaymentForSchedule(schedule, executionId),
    );
  }

  async function runPaymentForSchedule(
    schedule: RecurringScheduleRecord,
    executionId: string,
  ) {
    if (!ownerAddress) {
      throw new Error("Connect a wallet before paying.");
    }

    if (
      schedule.owner_wallet.toLowerCase() !== ownerAddress.toLowerCase()
    ) {
      throw new Error("Connect the wallet that owns this schedule to autopay.");
    }

    const amountUnits = BigInt(schedule.amount_units);
    const feeUnits = computePlatformFeeUnits(amountUnits);
    const feeRecipient =
      swiftBatchFeeRecipient && isAddress(swiftBatchFeeRecipient)
        ? (getAddress(swiftBatchFeeRecipient) as Address)
        : null;
    const feeAmountText =
      feeUnits > 0n
        ? formatUnitsToDecimal(
            feeUnits,
            arcTokens[schedule.token_symbol].decimals,
          )
        : "0";

    if (isEmbeddedWalletMode) {
      if (!circleLogin || !circleWallet?.id || !circleSdkRef.current) {
        throw new Error("Circle wallet is not ready.");
      }

      const tokenInfo = arcTokens[schedule.token_symbol];
      const tokenBalance = findCircleTokenBalance(
        circleBalances,
        schedule.token_symbol,
      );

      const skipHashes: string[] = [];

      // Platform fee — separate transfer; not shown in user history UI.
      if (feeUnits > 0n && feeRecipient) {
        const feeChallenge = await callCircleWalletApi<CircleTransferChallenge>(
          "createTransfer",
          {
            amount: feeAmountText,
            blockchain: circleWallet.blockchain ?? arcCircleBlockchain,
            destinationAddress: feeRecipient,
            feeLevel: "MEDIUM",
            refId: "RecurePay fee",
            tokenAddress: tokenInfo.address,
            tokenId: tokenBalance?.token?.id,
            userToken: circleLogin.userToken,
            walletId: circleWallet.id,
          },
        );
        if (!feeChallenge.challengeId) {
          throw new Error("Circle did not return a fee transfer challenge.");
        }
        const feeResult = await executeCircleChallenge(feeChallenge.challengeId);
        skipHashes.push(feeResult.txHash);
      }

      const challenge = await callCircleWalletApi<CircleTransferChallenge>(
        "createTransfer",
        {
          amount: schedule.amount,
          blockchain: circleWallet.blockchain ?? arcCircleBlockchain,
          destinationAddress: schedule.beneficiary_wallet,
          feeLevel: "MEDIUM",
          refId: (schedule.narration ?? "RecurePay").slice(0, 50),
          tokenAddress: tokenInfo.address,
          tokenId: tokenBalance?.token?.id,
          userToken: circleLogin.userToken,
          walletId: circleWallet.id,
        },
      );

      if (!challenge.challengeId) {
        throw new Error("Circle did not return a transfer challenge.");
      }

      const { txHash } = await executeCircleChallenge(
        challenge.challengeId,
        skipHashes,
      );

      await updateRecurringExecution(executionId, {
        ...requestContext!,
        ownerWallet: ownerAddress,
        status: "confirmed",
        txHash,
      });

      return txHash;
    }

    if (!(await ensureArcNetwork())) {
      throw new Error(`Switch to ${arcChain.name} before paying.`);
    }

    const tokenInfo = arcTokens[schedule.token_symbol];

    // Platform fee to fee recipient — filtered out of dashboard history.
    if (feeUnits > 0n && feeRecipient) {
      await writeContractAsync({
        address: tokenInfo.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [feeRecipient, feeUnits],
        chainId: arcChain.id,
      });
    }

    const hash = await writeContractAsync({
      address: tokenInfo.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [
        schedule.beneficiary_wallet as Address,
        amountUnits,
      ],
      chainId: arcChain.id,
    });

    await updateRecurringExecution(executionId, {
      ...requestContext!,
      ownerWallet: ownerAddress,
      status: "confirmed",
      txHash: hash,
    });

    return hash;
  }

  async function handleEnableAutopay(schedule: RecurringScheduleRecord) {
    setError(null);
    setSuccess(null);
    try {
      await authorizeScheduleAutopay(schedule);
      setSuccess(
        "Autopay authorized. Due payments execute in the background even if you log out.",
      );
    } catch (updateError) {
      setError(getErrorMessage(updateError));
    }
  }

  async function handlePayExecution(execution: RecurringExecutionRecord) {
    const schedule = scheduleMap.get(execution.schedule_id);

    if (!schedule || !requestContext) {
      setError("Schedule details are unavailable for this payment.");
      return;
    }

    setPayingExecutionId(execution.id);
    setError(null);
    setSuccess(null);

    try {
      const txHash = await executePaymentForSchedule(schedule, execution.id);
      setExecutions((current) =>
        current.map((item) =>
          item.id === execution.id
            ? {
                ...item,
                completed_at: new Date().toISOString(),
                status: "confirmed",
                tx_hash: txHash as Hash,
              }
            : item,
        ),
      );
      setSuccess(`Recurring payment sent (${shortenAddress(txHash)}).`);
      showSuccess({
        explorerUrl: `${arcChain.blockExplorers.default.url}/tx/${txHash}`,
        eyebrow: "RecurePay",
        subtitle: "The scheduled payment was submitted on Arc.",
        title: "Payment successful",
      });

      if (ownerAddress && txHash && schedule.amount) {
        const recipientLabel = schedule.beneficiary_username
          ? `@${schedule.beneficiary_username.replace(/^@/, "")}`
          : schedule.beneficiary_label || shortenAddress(schedule.beneficiary_wallet);
        void recordPlatformTransactionActivity({
          walletAddress: ownerAddress,
          amount: schedule.amount,
          token: schedule.token_symbol ?? "USDC",
          txHash,
          transactionId: execution.id,
          activityType: "TRANSFER",
          showToast: true,
          activity: {
            counterparty: recipientLabel,
            source: "recurepay",
            title: `Scheduled payment to ${recipientLabel}`,
          },
        });
      }
    } catch (payError) {
      const message = getErrorMessage(payError);

      try {
        await updateRecurringExecution(execution.id, {
          ...requestContext,
          errorMessage: message,
          ownerWallet: ownerAddress!,
          status: "failed",
        });
      } catch {
        // ignore secondary failure
      }

      setExecutions((current) =>
        current.map((item) =>
          item.id === execution.id
            ? { ...item, error_message: message, status: "failed" }
            : item,
        ),
      );
      setError(message);
    } finally {
      setPayingExecutionId(null);
    }
  }

  const openSchedule = openScheduleId ? scheduleMap.get(openScheduleId) ?? null : null;
  const reviewPlan = scheduleFromCompose(compose);
  const reviewRuns = reviewPlan.ok
    ? projectRuns(
        {
          amount,
          ends_at: reviewPlan.endsAt?.toISOString() ?? null,
          frequency: reviewPlan.frequency,
          id: "draft",
          interval_days: reviewPlan.intervalDays,
          max_runs: reviewPlan.maxRuns,
          next_run_at: reviewPlan.startsAt.toISOString(),
          run_count: 0,
          status: "active",
          token_symbol: token,
        },
        { limit: 12 },
      )
    : [];

  async function runScheduleAction(action: string, work: () => Promise<void>) {
    setDetailBusy(action);
    setError(null);
    try {
      await work();
    } finally {
      setDetailBusy(null);
    }
  }

  const walletNotice = !ownerAddress ? (
    <div className="recurepay-card recurepay-notice">
      <Wallet className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Connect a wallet</p>
        <p className="text-sm text-muted-foreground">
          Sign in with Google or email, or connect a wallet, to schedule payments.
        </p>
      </div>
    </div>
  ) : !canAccessRecurring && checkedWallet === ownerAddress ? (
    <div className="recurepay-card recurepay-notice">
      <KeyRound className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Authorize this wallet</p>
        <p className="text-sm text-muted-foreground">
          {isEmbeddedWalletMode
            ? "Your session is missing a linked profile. Return to Home, sign in again, then reopen RecurePay."
            : "Sign a one-time message so SaphraONE can manage scheduled payments for this wallet."}
        </p>
      </div>
      {!isEmbeddedWalletMode ? (
        <Button disabled={isAuthenticatingWallet} onClick={() => void handleWalletSignIn()} size="sm">
          {isAuthenticatingWallet ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Authorize
        </Button>
      ) : null}
    </div>
  ) : null;

  const messages = (
    <>
      {error && view === "home" ? (
        <p className="recurepay-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}
      {success && view === "home" && !isSaving ? (
        <p className="recurepay-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </p>
      ) : null}
    </>
  );

  if (view === "compose") {
    return (
      <div className="recurepay-page">
        {walletNotice}
        <RecurepayCompose
          amount={amount}
          autopay={autopay}
          beneficiaryAuth={canAccessRecurring ? requestContext : null}
          canAutopay={canUseAutopay}
          compose={compose}
          error={composeError}
          label={beneficiaryLabel}
          narration={narration}
          onAmount={setAmount}
          onAutopay={setAutopay}
          onBack={() => {
            setComposeError(null);
            setView("home");
          }}
          onCompose={(next) => {
            setCompose(next);
            setComposeError(null);
          }}
          onLabel={setBeneficiaryLabel}
          onNarration={setNarration}
          onNext={handleComposeNext}
          onRecipient={setRecipientInput}
          onToken={setToken}
          recipient={recipientInput}
          resolution={recipientResolution}
          token={token}
        />
      </div>
    );
  }

  if (view === "review" && reviewPlan.ok) {
    const recipientLabel = resolvedRecipientUsername
      ? `@${resolvedRecipientUsername.replace(/^@/, "")}`
      : resolvedRecipientAddress
        ? `${resolvedRecipientAddress.slice(0, 6)}…${resolvedRecipientAddress.slice(-4)}`
        : recipientInput;
    return (
      <div className="recurepay-page">
        <RecurepayReview
          amount={amount}
          autopay={autopay && canUseAutopay}
          cadence={describeCadence({
            frequency: reviewPlan.frequency,
            intervalDays: reviewPlan.intervalDays,
            oneTime: reviewPlan.maxRuns === 1,
            startsAt: reviewPlan.startsAt,
          })}
          ends={
            reviewPlan.maxRuns === 1
              ? "After 1 payment"
              : reviewPlan.endsAt
                ? reviewPlan.endsAt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
                : reviewPlan.maxRuns
                  ? `After ${reviewPlan.maxRuns} payments`
                  : "When you stop it"
          }
          error={error}
          label={beneficiaryLabel}
          narration={narration}
          onBack={() => setView("compose")}
          onConfirm={() => void handleCreateSchedule()}
          recipientLabel={recipientLabel}
          runs={reviewRuns}
          saving={isSaving || isWritePending}
          status={isSaving ? success : null}
          token={token}
        />
      </div>
    );
  }

  return (
    <div className="recurepay-page">
      <RecurepayBar
        action={
          schedules.length > 0 ? (
            <button
              aria-label="Schedule a payment"
              className="recurepay-round is-primary"
              disabled={!canAccessRecurring}
              onClick={() => setView("compose")}
              type="button"
            >
              <Plus className="h-5 w-5" />
            </button>
          ) : null
        }
        backHref="/send"
        title="Scheduled payments"
      />
      {walletNotice}
      {messages}

      {isLoading && canAccessRecurring ? (
        <div className="recurepay-loading">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : schedules.length === 0 ? (
        <RecurepayEmpty disabled={!canAccessRecurring} onStart={() => setView("compose")} />
      ) : (
        <RecurepayDashboard
          dueExecutions={dueExecutions}
          executions={executions}
          historyExecutions={historyExecutions}
          onCompose={() => setView("compose")}
          onOpenSchedule={setOpenScheduleId}
          onPay={(execution) => void handlePayExecution(execution)}
          payingExecutionId={payingExecutionId}
          processingExecutions={processingExecutions}
          scheduleMap={scheduleMap}
          schedules={schedules}
        />
      )}

      <ScheduleSheet
        busy={detailBusy ?? (openSchedule && authorizingScheduleId === openSchedule.id ? "autopay" : deletingScheduleId === openSchedule?.id ? "delete" : null)}
        canAct={canAccessRecurring}
        executions={openSchedule ? executions.filter((execution) => execution.schedule_id === openSchedule.id) : []}
        onAutopay={() => openSchedule && void runScheduleAction("autopay", () => handleEnableAutopay(openSchedule))}
        onCancel={() => openSchedule && void runScheduleAction("cancel", () => handleScheduleStatus(openSchedule, "cancelled"))}
        onClose={() => setOpenScheduleId(null)}
        onDelete={() =>
          openSchedule &&
          void runScheduleAction("delete", async () => {
            await handleDeleteSchedule(openSchedule.id);
            setOpenScheduleId(null);
          })
        }
        onPause={() => openSchedule && void runScheduleAction("pause", () => handleScheduleStatus(openSchedule, "paused"))}
        onResume={() => openSchedule && void runScheduleAction("resume", () => handleScheduleStatus(openSchedule, "active"))}
        onRevoke={() => openSchedule && void runScheduleAction("revoke", () => handleDisableAutopay(openSchedule))}
        onRunNow={() =>
          openSchedule &&
          void runScheduleAction("run", async () => {
            await handleRunNow(openSchedule.id);
            setOpenScheduleId(null);
          })
        }
        schedule={openSchedule}
      />
    </div>
  );
}
