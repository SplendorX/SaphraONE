"use client";

import {
  ArrowUp,
  ArrowUpRight,
  Maximize2,
  Mic,
  Minimize2,
  Square,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ActionCard,
  allieMoney,
  type ActionCardState,
} from "@/components/allie/ActionCard";
import { AllieMark } from "@/components/allie/AllieMark";
import { OutcomeCard } from "@/components/allie/OutcomeCard";
import { OneWatermark } from "@/components/brand/one-watermark";
import { isProTier, ProTierBadge } from "@/components/allie/ProTierBadge";
import { ConfirmationModal } from "@/components/allie/ConfirmationModal";
import {
  AllieThinking,
  MessageBubble,
} from "@/components/allie/MessageBubble";
import type { AllieStatus } from "@/components/allie/StatusIndicator";
import { Button } from "@/components/ui/button";
import {
  cancelAlliePayment,
  confirmAlliePayment,
  fetchAgentWallet,
  fetchAlliePolicy,
  revokeAgentWallet,
  sendAllieMessage,
  setAgentWalletStatus,
  shortenAddress,
  unitsToDisplay,
  type AllieChatResponse,
  type AllieExecutionResponse,
} from "@/lib/allie/client";
import { useVoiceDictation } from "@/lib/allie/use-voice-dictation";
import { emitOnePointsUpdated } from "@/lib/referral/use-one-points";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { markAgentWalletActive } from "@/lib/wallet-mode";
import { cn } from "@/lib/utils";

const maxMessageLength = 1_000;

/** Shown as cards in the empty state and as chips once a thread is running. */
/**
 * Shown as cards in the empty state and as chips once a thread is running.
 *
 * `send` runs immediately; `fill` drops a template into the composer instead.
 * Anything naming a recipient uses `fill` — inventing a payee and firing it at
 * the engine is how you end up confirming a payment to someone who isn't real.
 */
const suggestions = [
  { label: "Check my balance", send: "what's my balance" },
  { label: "Recent payments", send: "recent payments" },
  { label: "My savings balance", send: "my savings balance" },
  { label: "Send a payment", fill: "send $10 to " },
  { label: "Split a bill", fill: "split $30 between " },
] as const;

const statusCopy: Record<AllieStatus, string> = {
  active: "Active — ready to pay",
  paused: "Paused — nothing will move",
  revoked: "Revoked",
  not_created: "Agent wallet not set up",
};

/** Set when ALLIE Pro's language model answered, not Tier 1 rules. */
type ProMark = { overagePoints?: number };

type ChatEntry =
  | { id: string; kind: "user"; text: string; at: string }
  | {
      id: string;
      kind: "allie";
      text: string;
      at: string;
      pro?: ProMark;
      /** Labels the bubble "Allie:" — used for the note after a payment lands. */
      speaker?: boolean;
    }
  | {
      id: string;
      kind: "action";
      at: string;
      response: AllieChatResponse;
      state: ActionCardState;
      execution?: AllieExecutionResponse | null;
      executionError?: string | null;
    }
  | { id: string; kind: "upgrade"; at: string; text: string }
  | {
      id: string;
      kind: "outcome";
      at: string;
      outcome: NonNullable<AllieChatResponse["outcome"]>;
      pro?: ProMark;
    };

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** ALLIE's one-line wrap-up once a confirmed payment reaches Arc. */
function doneMessage(
  response: AllieChatResponse,
  execution: AllieExecutionResponse,
): string {
  const asset =
    response.action.type === "BatchPay" || response.action.type === "PaymentIntent"
      ? response.action.asset
      : "USDC";
  const total = response.amountUnits ? allieMoney(response.amountUnits, asset) : asset;
  const legs = response.legs ?? [];

  if (response.action.type === "BatchPay") {
    const paymentLegs =
      execution.batch?.legs.filter((leg) => leg.kind === "payment").length ??
      legs.length;
    const submitted = execution.batch?.submitted ?? paymentLegs;

    if (submitted < paymentLegs) {
      return `Partly done. ${submitted} of ${paymentLegs} payments went through — the card above shows which.`;
    }

    return legs.length > 0 && legs.length <= 3
      ? `Done. ${total} sent to ${joinNames(legs.map((leg) => leg.label))}.`
      : `Done. ${total} sent to ${legs.length || paymentLegs} recipients.`;
  }

  const recipient =
    response.recipientLabel ??
    (response.resolvedRecipient
      ? shortenAddress(response.resolvedRecipient)
      : response.action.type === "PaymentIntent"
        ? response.action.recipient
        : "");

  return recipient ? `Done. ${total} sent to ${recipient}.` : `Done. ${total} sent.`;
}

function now() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Fallback prose for anything the server did not resolve into an outcome. */
function describeAction(response: AllieChatResponse): string {
  if (response.action.type === "Clarify") {
    return response.action.question;
  }

  return "I'm not sure how to help with that yet.";
}

/** Percent of the daily limit already spent, clamped to the meter's range. */
function spendPercent(spent: string, limit: string) {
  try {
    const cap = BigInt(limit);

    if (cap <= 0n) {
      return 0;
    }

    const used = (BigInt(spent) * 100n) / cap;
    return Math.min(100, Math.max(0, Number(used)));
  } catch {
    return 0;
  }
}

/**
 * Balances are held to 6 decimals; a card that prints all of them reads as a
 * debug dump. Two is what a balance is actually scanned for — the exact figure
 * stays on the title for anyone who needs it.
 */
function compactAmount(units: string | null) {
  if (units === null) {
    return { short: "—", exact: "" };
  }

  const exact = unitsToDisplay(units);
  const [whole, fraction = ""] = exact.split(".");
  const short = fraction
    ? `${whole}.${fraction.slice(0, 2).padEnd(2, "0")}`
    : `${whole}.00`;

  return { short, exact };
}

function BalanceCard({ asset, units }: { asset: string; units: string | null }) {
  const { short, exact } = compactAmount(units);

  return (
    <div className={cn("allie-balance-card", `is-${asset.toLowerCase()}`)}>
      <span className="allie-balance-asset">{asset}</span>
      <span className="allie-balance-value" title={exact || undefined}>
        {short}
      </span>
    </div>
  );
}

export function ChatWindow({
  className,
  expanded,
  onClose,
  onToggleExpand,
}: {
  /** Overrides the default standalone framing (used by the floating panel). */
  className?: string;
  /** Whether the floating panel is currently in its larger size. */
  expanded?: boolean;
  /** When provided, the header shows a close control. */
  onClose?: () => void;
  /** When provided, the header shows a control to grow/shrink the panel. */
  onToggleExpand?: () => void;
} = {}) {
  const { address, circleSocialUuid } = usePlatformWallet();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<AllieStatus>("not_created");
  const [error, setError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [sessionId] = useState(newId);
  const [balances, setBalances] = useState<{
    USDC: string;
    EURC: string;
  } | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [spend, setSpend] = useState<{ spent: string; limit: string } | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // What was already typed when a voice note began; speech is added after it.
  const voiceBaseRef = useRef("");
  const voice = useVoiceDictation({
    onTranscript: (spoken) => {
      const base = voiceBaseRef.current;
      setDraft(`${base}${base && spoken ? " " : ""}${spoken}`.slice(0, maxMessageLength));
    },
  });
  const wasListening = useRef(false);
  const walletRef = useRef<HTMLDivElement | null>(null);
  const scrolledOnce = useRef(false);

  const showIntro = entries.length === 0 && !pending;

  // A finished voice note goes back to the text box for review, not straight
  // to ALLIE.
  useEffect(() => {
    if (wasListening.current && !voice.listening) {
      inputRef.current?.focus();
    }
    wasListening.current = voice.listening;
  }, [voice.listening]);

  const toggleVoice = useCallback(() => {
    if (!voice.listening) {
      voiceBaseRef.current = draft.trim();
    }
    voice.toggle();
  }, [draft, voice]);

  /** A template goes into the composer; a complete question just runs. */
  const runSuggestion = useCallback(
    (item: (typeof suggestions)[number]) => {
      if ("fill" in item) {
        setDraft(item.fill);
        inputRef.current?.focus();
        return;
      }

      void submitRef.current?.(item.send);
    },
    [],
  );

  const context = useMemo(
    () =>
      address
        ? { ownerWallet: address, circleSocialUuid }
        : null,
    [address, circleSocialUuid],
  );

  const refreshStatus = useCallback(async () => {
    if (!context) {
      return;
    }

    try {
      const payload = await fetchAgentWallet(context);
      const next = payload.agentWallet?.status ?? "not_created";
      setStatus(next);
      setBalances(payload.balances);
      markAgentWalletActive(next === "active");
    } catch {
      setStatus("not_created");
      setBalances(null);
    }
  }, [context]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    // Opening the panel is not a catch-up: the thread starts empty and the
    // intro is meant to be read from the top. Scrolling on that first pass is
    // what drags the view down to the end of the chat the moment it opens.
    if (!scrolledOnce.current) {
      scrolledOnce.current = true;
      return;
    }

    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [entries, pending]);

  // Today's spend is only worth a request once someone asks to see it.
  useEffect(() => {
    if (!walletOpen || !context) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const payload = await fetchAlliePolicy(context);

        if (!cancelled) {
          setSpend({
            spent: payload.dailySpentUnits,
            limit: payload.policy.dailyLimitUnits,
          });
        }
      } catch {
        // The card falls back to placeholders rather than failing the chat.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context, walletOpen]);

  useEffect(() => {
    if (!walletOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!walletRef.current?.contains(event.target as Node)) {
        setWalletOpen(false);
      }
    }

    // Captured, so Escape closes this popover without also closing the panel
    // underneath it.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setWalletOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [walletOpen]);

  const submitRef = useRef<((message: string) => Promise<void>) | null>(null);

  const appendEntry = useCallback((entry: ChatEntry) => {
    setEntries((current) => [...current, entry]);
  }, []);

  const updateAction = useCallback(
    (id: string, patch: Partial<Extract<ChatEntry, { kind: "action" }>>) => {
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id && entry.kind === "action"
            ? { ...entry, ...patch }
            : entry,
        ),
      );
    },
    [],
  );

  const handleAgentControl = useCallback(
    async (action: "pause" | "resume" | "revoke") => {
      if (!context) {
        return "Connect a wallet first.";
      }

      if (action === "revoke") {
        setRevokeOpen(true);
        return "Revoking is permanent — confirm it in the dialog and I'll stop immediately.";
      }

      try {
        await setAgentWalletStatus({
          ...context,
          status: action === "pause" ? "paused" : "active",
        });
        await refreshStatus();

        return action === "pause"
          ? "Paused. I won't move any funds until you resume me."
          : "Resumed. I'm active again within your policy limits.";
      } catch (controlError) {
        return controlError instanceof Error
          ? controlError.message
          : "I couldn't change my status.";
      }
    },
    [context, refreshStatus],
  );

  const submit = useCallback(
    async (rawMessage: string) => {
      const message = rawMessage.trim();

      if (!message || pending) {
        return;
      }

      if (!context) {
        setError("Connect a wallet to chat with ALLIE.");
        return;
      }

      setError(null);
      setDraft("");
      appendEntry({ id: newId(), kind: "user", text: message, at: now() });
      setPending(true);

      try {
        const response = await sendAllieMessage({
          ...context,
          message,
          sessionId,
        });
        // A paid extra request lowered the OnePoints balance shown elsewhere.
        if (response.overagePoints) emitOnePointsUpdated();
        const pro: ProMark | undefined = isProTier(response.tier)
          ? { overagePoints: response.overagePoints }
          : undefined;

        if (
          response.action.type === "PaymentIntent" ||
          response.action.type === "BatchPay"
        ) {
          appendEntry({
            id: newId(),
            kind: "action",
            at: now(),
            response,
            state: "idle",
          });
          return;
        }

        if (response.action.type === "AgentControl") {
          const reply = await handleAgentControl(response.action.action);
          appendEntry({ id: newId(), kind: "allie", text: reply, at: now(), pro });
          return;
        }

        if (response.upgradeRequired) {
          appendEntry({
            id: newId(),
            kind: "upgrade",
            at: now(),
            text:
              response.action.type === "Clarify"
                ? response.action.question
                : "That needs ALLIE Pro.",
          });
          return;
        }

        if (response.outcome && response.outcome.kind !== "message") {
          appendEntry({
            id: newId(),
            kind: "outcome",
            at: now(),
            outcome: response.outcome,
            pro,
          });
          return;
        }

        appendEntry({
          id: newId(),
          kind: "allie",
          at: now(),
          text:
            response.outcome?.kind === "message"
              ? response.outcome.text
              : describeAction(response),
          pro,
        });
      } catch (sendError) {
        appendEntry({
          id: newId(),
          kind: "allie",
          at: now(),
          text:
            sendError instanceof Error
              ? sendError.message
              : "Something went wrong on my side. Try again?",
        });
      } finally {
        setPending(false);
      }
    },
    [appendEntry, context, handleAgentControl, pending, sessionId],
  );

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  const confirmEntry = useMemo(
    () =>
      entries.find(
        (entry): entry is Extract<ChatEntry, { kind: "action" }> =>
          entry.kind === "action" && entry.id === confirmTarget,
      ) ?? null,
    [confirmTarget, entries],
  );

  /**
   * Calls the payment off in the ledger, then withdraws the card.
   *
   * The card is only dismissed once the server has recorded the cancellation,
   * so the UI never claims a payment is dead while the intent is still
   * executable. A server that refuses (already executing, say) leaves the card
   * live and says why.
   */
  const cancelAction = useCallback(
    async (entryId: string) => {
      const entry = entries.find(
        (candidate): candidate is Extract<ChatEntry, { kind: "action" }> =>
          candidate.kind === "action" && candidate.id === entryId,
      );

      if (!entry) {
        return;
      }

      const intentId = entry.response.intentId;

      if (!intentId || !context) {
        updateAction(entryId, { state: "cancelled", executionError: null });
        return;
      }

      try {
        await cancelAlliePayment({ ...context, intentId });
        updateAction(entryId, { state: "cancelled", executionError: null });
      } catch (cancelError) {
        updateAction(entryId, {
          state: "error",
          executionError:
            cancelError instanceof Error
              ? cancelError.message
              : "This payment could not be cancelled.",
        });
      }
    },
    [context, entries, updateAction],
  );

  /**
   * Runs one action card. Takes the id rather than reading the modal's target,
   * because a payment under the approval threshold never opens the modal.
   */
  const executePayment = useCallback(
    async (entryId: string) => {
      const entry = entries.find(
        (candidate): candidate is Extract<ChatEntry, { kind: "action" }> =>
          candidate.kind === "action" && candidate.id === entryId,
      );

      if (!entry || !context || entry.state === "cancelled") {
        return;
      }

      const intentId = entry.response.intentId;

      if (!intentId) {
        updateAction(entry.id, {
          state: "error",
          executionError: "This payment is missing its intent reference.",
        });
        setConfirmTarget(null);
        return;
      }

      updateAction(entry.id, { state: "executing", executionError: null });
      // Close the go-ahead modal now: the card shows ALLIE processing.
      setConfirmTarget(null);

      try {
        const execution = await confirmAlliePayment({ ...context, intentId });
        const failed = execution.result.status === "failed";

        updateAction(entry.id, {
          state: failed ? "error" : "settled",
          execution,
          executionError: execution.result.error ?? null,
        });

        if (!failed) {
          appendEntry({
            id: newId(),
            kind: "allie",
            at: now(),
            speaker: true,
            text: doneMessage(entry.response, execution),
          });
        }
      } catch (executeError) {
        updateAction(entry.id, {
          state: "error",
          executionError:
            executeError instanceof Error
              ? executeError.message
              : "The payment could not be submitted.",
        });
      } finally {
        setConfirmTarget(null);
      }
    },
    [appendEntry, context, entries, updateAction],
  );

  /**
   * "Edit" on a card: call the payment off, then put the request that made it
   * back in the composer so the user can fix the amount or payee and resend.
   */
  const editAction = useCallback(
    async (entryId: string) => {
      const index = entries.findIndex((entry) => entry.id === entryId);
      const request = entries
        .slice(0, Math.max(index, 0))
        .reverse()
        .find(
          (entry): entry is Extract<ChatEntry, { kind: "user" }> =>
            entry.kind === "user",
        );

      await cancelAction(entryId);
      if (request) setDraft(request.text);
      inputRef.current?.focus();
    },
    [cancelAction, entries],
  );

  const confirmRevoke = useCallback(async () => {
    if (!context) {
      return;
    }

    try {
      await revokeAgentWallet(context);
      await refreshStatus();
      appendEntry({
        id: newId(),
        kind: "allie",
        at: now(),
        text: "Revoked. I no longer have access to that wallet.",
      });
    } catch (revokeError) {
      appendEntry({
        id: newId(),
        kind: "allie",
        at: now(),
        text:
          revokeError instanceof Error
            ? revokeError.message
            : "I couldn't revoke the wallet.",
      });
    } finally {
      setRevokeOpen(false);
    }
  }, [appendEntry, context, refreshStatus]);

  const confirmAction =
    confirmEntry?.response.action.type === "PaymentIntent"
      ? confirmEntry.response.action
      : null;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden bg-card",
        className ?? "min-h-[32rem] rounded-2xl border border-border",
      )}
    >
      <header className="allie-header relative z-20 flex shrink-0 items-center gap-2.5 px-4 py-3">
        <AllieMark size={34} />

        <div className="min-w-0 flex-1">
          <p className="allie-wordmark flex items-center gap-1.5">
            ALLIE
            <span
              aria-label={statusCopy[status]}
              className={cn("allie-status-dot", `is-${status}`)}
              title={statusCopy[status]}
            />
          </p>
          <p className="truncate text-[0.72rem] text-muted-foreground">
            {pending ? "Thinking…" : statusCopy[status]}
          </p>
        </div>

        <div className="relative" ref={walletRef}>
          <Button
            aria-expanded={walletOpen}
            aria-haspopup="dialog"
            aria-label="Agent Wallet balances"
            className="h-8 w-8 rounded-full"
            onClick={() => setWalletOpen((value) => !value)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Wallet className="h-4 w-4" />
          </Button>

          {walletOpen ? (
            <div
              aria-label="Agent Wallet"
              className="allie-wallet-pop absolute top-[calc(100%+0.6rem)] right-0 z-30 w-[min(19rem,calc(100vw-3rem))]"
              role="dialog"
            >
              <p className="allie-wallet-eyebrow">Agent Wallet</p>

              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <BalanceCard asset="USDC" units={balances?.USDC ?? null} />
                <BalanceCard asset="EURC" units={balances?.EURC ?? null} />
              </div>

              <div className="allie-spend-card mt-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="allie-spend-label">Spent today</span>
                  <span className="allie-spend-value">
                    {spend ? compactAmount(spend.spent).short : "—"}
                    <span className="allie-spend-limit">
                      {spend ? ` / ${compactAmount(spend.limit).short}` : ""}
                    </span>
                  </span>
                </div>

                <div className="allie-meter">
                  <span
                    style={{
                      width: `${spend ? spendPercent(spend.spent, spend.limit) : 0}%`,
                    }}
                  />
                </div>

                <p className="allie-spend-foot">
                  {spend
                    ? `${100 - spendPercent(spend.spent, spend.limit)}% of today's limit still available`
                    : "Loading your daily limit…"}
                </p>
              </div>

              <Link
                className="allie-wallet-link"
                href="/settings#agent-wallet"
                onClick={() => setWalletOpen(false)}
              >
                Agent Wallet settings
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : null}
        </div>

        {onToggleExpand ? (
          <Button
            aria-label={expanded ? "Shrink ALLIE" : "Expand ALLIE"}
            className="h-8 w-8 rounded-full"
            onClick={onToggleExpand}
            size="icon"
            type="button"
            variant="ghost"
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        ) : null}

        {onClose ? (
          <Button
            aria-label="Close ALLIE"
            className="h-8 w-8 rounded-full"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </header>

      <div className="one-watermark-host flex min-h-0 flex-1 flex-col">
      <OneWatermark className="one-watermark-center" />
      <div
        className="allie-scroll relative z-[1] min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
        ref={scrollRef}
      >
        {showIntro ? (
          <div className="flex flex-col items-center gap-4 px-2 py-6 text-center">
            <AllieMark size={72} />
            <div className="space-y-1.5">
              <p className="text-base font-semibold">Hi, I&apos;m ALLIE.</p>
              <p className="mx-auto max-w-[17rem] text-[0.83rem] leading-relaxed text-muted-foreground">
                Tell me who to pay and how much. I&apos;ll prepare it — and
                nothing moves until you press Confirm.
              </p>
            </div>

            <div className="grid w-full gap-1.5 pt-1">
              {suggestions.map((item) => (
                <button
                  className="allie-suggestion"
                  disabled={pending}
                  key={item.label}
                  onClick={() => runSuggestion(item)}
                  type="button"
                >
                  <span className="truncate">{item.label}</span>
                  <ArrowUp className="h-3.5 w-3.5 rotate-45 opacity-50" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {entries.map((entry, index) => {
          if (entry.kind === "action") {
            return (
              <div className="flex w-full justify-start pl-9" key={entry.id}>
                <ActionCard
                  busy={entry.state === "executing"}
                  execution={entry.execution}
                  executionError={entry.executionError}
                  onCancel={() => void cancelAction(entry.id)}
                  onEdit={() => void editAction(entry.id)}
                  onConfirm={() => {
                    // Above the auto-approve threshold the card is only the
                    // first gate — the modal is the explicit go-ahead. Below
                    // it, this click is the approval and nothing else should
                    // stand between it and the engine.
                    if (entry.response.requiresApproval) {
                      setConfirmTarget(entry.id);
                      return;
                    }

                    void executePayment(entry.id);
                  }}
                  response={entry.response}
                  state={entry.state}
                />
              </div>
            );
          }

          if (entry.kind === "outcome") {
            return (
              <div
                className="flex w-full flex-col items-start gap-1 pl-9"
                key={entry.id}
              >
                <OutcomeCard outcome={entry.outcome} />
                {entry.pro ? (
                  <ProTierBadge
                    className="ml-1"
                    overagePoints={entry.pro.overagePoints}
                  />
                ) : null}
              </div>
            );
          }

          if (entry.kind === "upgrade") {
            return (
              <div className="flex w-full justify-start pl-9" key={entry.id}>
                <div className="w-full rounded-[1.1rem] border border-primary/30 bg-primary/5 p-3.5">
                  <p className="text-[0.8rem] font-semibold text-primary">
                    ALLIE Pro
                  </p>
                  <p className="mt-1 text-[0.83rem] leading-relaxed text-muted-foreground">
                    {entry.text}
                  </p>
                  <Button asChild className="mt-3 w-full" size="sm">
                    <Link href="/settings?focus=allie-pro#agent-wallet">
                      Upgrade to Pro
                    </Link>
                  </Button>
                </div>
              </div>
            );
          }

          const previous = entries[index - 1];

          return (
            <MessageBubble
              key={entry.id}
              role={entry.kind === "user" ? "user" : "allie"}
              showAvatar={!previous || previous.kind !== entry.kind}
              timestamp={entry.at || undefined}
              badge={
                entry.kind === "allie" && entry.pro ? (
                  <ProTierBadge overagePoints={entry.pro.overagePoints} />
                ) : undefined
              }
            >
              {entry.kind === "allie" && entry.speaker ? (
                <span className="allie-done-speaker">Allie:</span>
              ) : null}
              <span className="whitespace-pre-line">{entry.text}</span>
            </MessageBubble>
          );
        })}

        {pending ? <AllieThinking /> : null}
      </div>
      </div>

      <div className="shrink-0 border-t border-border/70 px-3 pt-3 pb-3">
        {error ? (
          <p className="mb-2 px-1 text-[0.75rem] font-medium text-destructive">
            {error}
          </p>
        ) : null}

        {voice.error ? (
          <p className="mb-2 px-1 text-[0.75rem] font-medium text-destructive" role="alert">
            {voice.error}
          </p>
        ) : null}

        {showIntro ? null : (
          <div className="allie-chiprow mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {suggestions.map((item) => (
              <button
                className="allie-chip"
                disabled={pending}
                key={item.label}
                onClick={() => runSuggestion(item)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        <form
          className={cn("allie-composer", voice.listening && "is-listening")}
          onSubmit={(event) => {
            event.preventDefault();
            voice.stop();
            void submit(draft);
          }}
        >
          <input
            aria-label="Ask ALLIE to send a payment"
            className="allie-composer-input"
            disabled={pending}
            maxLength={maxMessageLength}
            onChange={(event) => {
              setDraft(event.target.value);
              voice.clearError();
            }}
            placeholder={
              voice.listening ? "Listening… say what to pay" : "Ask ALLIE to send a payment…"
            }
            ref={inputRef}
            value={draft}
          />
          {voice.supported ? (
            <button
              aria-label={voice.listening ? "Stop voice note" : "Speak to ALLIE"}
              aria-pressed={voice.listening}
              className="allie-mic"
              disabled={pending}
              onClick={toggleVoice}
              title={voice.listening ? "Stop" : "Speak to ALLIE"}
              type="button"
            >
              {voice.listening ? (
                <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} />
              ) : (
                <Mic className="h-4 w-4" strokeWidth={2.25} />
              )}
            </button>
          ) : null}
          <button
            aria-label="Send message"
            className="allie-send"
            disabled={pending || !draft.trim()}
            type="submit"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </form>

        {draft.length > maxMessageLength - 100 ? (
          <p className="mt-1.5 px-1 text-right text-[0.7rem] text-muted-foreground">
            {draft.length}/{maxMessageLength}
          </p>
        ) : null}
      </div>

      <ConfirmationModal
        amountLabel={
          confirmAction
            ? `${
                confirmEntry?.response.amountUnits
                  ? unitsToDisplay(confirmEntry.response.amountUnits)
                  : confirmAction.amountUsdc
              } ${confirmAction.asset}`
            : undefined
        }
        busy={confirmEntry?.state === "executing"}
        description="SaphraONE will submit this from your ALLIE Agent Wallet. This cannot be undone once it settles on Arc."
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          if (confirmTarget) {
            void executePayment(confirmTarget);
          }
        }}
        open={Boolean(confirmEntry)}
        recipientLabel={
          confirmEntry?.response.recipientLabel ??
          (confirmEntry?.response.resolvedRecipient
            ? shortenAddress(confirmEntry.response.resolvedRecipient)
            : confirmAction?.recipient)
        }
        requiresApproval={confirmEntry?.response.requiresApproval}
      />

      <ConfirmationModal
        confirmLabel="Revoke ALLIE"
        description="Revoking stops ALLIE permanently and marks the agent wallet and its policy revoked. Funds already in the wallet stay there."
        onCancel={() => setRevokeOpen(false)}
        onConfirm={() => void confirmRevoke()}
        open={revokeOpen}
        title="Revoke your Agent Wallet?"
        tone="destructive"
      />
    </div>
  );
}
