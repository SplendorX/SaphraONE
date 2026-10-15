"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ClipboardPaste,
  Loader2,
  ScanQrCode,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Chain,
  type EIP1193Provider,
} from "viem";

import { NetworkLogo, NetworkPicker } from "@/components/send/network-picker";
import { TransferProgress } from "@/components/send/transfer-progress";
import { QrScanSheet } from "@/components/send/qr-scan-sheet";
import { arcChain, arcTransport } from "@/lib/chains";
import { isCircleChallengeError } from "@/lib/circle-eip1193";
import { userFacingErrorMessage } from "@/lib/circle-session";
import { isRejection } from "@/lib/deposit-to-arc";
import {
  fetchCrossChainSend,
  fetchNetworkFees,
  fetchSendQuote,
  reportCrossChainSend,
  startCrossChainSend,
  type FeeMode,
  type NetworkFeeView,
  type OutboundTransferView,
  type SendQuote,
} from "@/lib/multichain/client";
import type { MultichainChain } from "@/lib/multichain/chains";
import { enabledMultichainChains } from "@/lib/multichain/flag";
import { CROSS_CHAIN_SERVICE_FEE_USDC, MIN_OUTBOUND_USDC } from "@/lib/multichain/rules";
import { arcTokens } from "@/lib/tokens";
import {
  plainResult,
  SEND_OUT_STEPS,
  sendOutStepLabel,
  SendOutRejectedError,
  sendUsdcFromArc,
  type SendOutStep,
} from "@/lib/multichain/send-out";
import { confirmFlow, TxApprovalCancelled } from "@/lib/tx-approval/client";
import { useSigningWallet } from "@/lib/use-signing-wallet";
import { cn } from "@/lib/utils";

import "./cross-chain-send.css";

/**
 * Pay SaphraONE's service fee: a plain USDC transfer on Arc to the fee wallet,
 * waited on so the burn that follows sees the right balance.
 */
async function payServiceFee(input: { account: string; fee: string; provider: unknown; recipient: string }) {
  const chain = arcChain as Chain;
  const walletClient = createWalletClient({
    account: getAddress(input.account),
    chain,
    transport: custom(input.provider as EIP1193Provider),
  });
  let hash: `0x${string}`;
  try {
    hash = await walletClient.writeContract({
      abi: erc20Abi,
      address: arcTokens.USDC.address,
      args: [getAddress(input.recipient) as Address, parseUnits(input.fee, arcTokens.USDC.decimals)],
      functionName: "transfer",
    });
  } catch (cause) {
    if (isRejection(cause)) throw new SendOutRejectedError();
    throw cause;
  }
  const receipt = await createPublicClient({ chain, transport: arcTransport() }).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The service fee payment failed. Nothing was sent.");
  return hash;
}

type Stage = "to" | "amount" | "sending" | "done";

function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function money(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 2 })
    : String(value);
}

/**
 * Pay a 0x address on another network from the Arc balance. Usernames always
 * settle on Arc, so this takes raw addresses only.
 */
export function CrossChainSend({
  hideBalance = false,
  onBack,
  ownerWallet: accountWallet,
  usdcBalance: accountUsdcBalance,
}: {
  hideBalance?: boolean;
  onBack: () => void;
  ownerWallet: string;
  /** Spendable USDC on Arc, when known. */
  usdcBalance?: string;
}) {
  const chains = useMemo(() => enabledMultichainChains(), []);
  const wallet = useSigningWallet();
  // The burn comes out of the wallet that signs, so that is whose send it is,
  // and the page's balance only applies when it is the same wallet.
  const ownerWallet = (wallet.address ?? accountWallet).toLowerCase();
  const usdcBalance = ownerWallet === accountWallet.toLowerCase() ? accountUsdcBalance : undefined;
  const [stage, setStage] = useState<Stage>("to");
  const [network, setNetwork] = useState<MultichainChain | null>(chains[0] ?? null);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SendQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [step, setStep] = useState<SendOutStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<OutboundTransferView | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [fees, setFees] = useState<Record<string, NetworkFeeView> | null>(null);
  const [feeMode, setFeeMode] = useState<FeeMode>("deduct");
  // A send that stopped before its burn, kept so "Try again" resumes it (and
  // never charges the service fee twice).
  const resumeRef = useRef<{
    burnAmount: string;
    feePaid: boolean;
    id: string;
    result: unknown;
    serviceFee: string;
    serviceFeeRecipient: string | null;
    total: string;
  } | null>(null);

  const trimmed = destination.trim();
  const validAddress = isAddress(trimmed) && !/^0x0{40}$/i.test(trimmed);
  const isOwnArcAddress = validAddress && trimmed.toLowerCase() === ownerWallet.toLowerCase();

  // Each network's fee, for the picker. Without it the picker just leaves fees out.
  useEffect(() => {
    const controller = new AbortController();
    fetchNetworkFees(ownerWallet, controller.signal)
      .then(({ fees: rows }) => setFees(Object.fromEntries(rows.map((row) => [row.network, row]))))
      .catch(() => {
        if (!controller.signal.aborted) setFees({});
      });
    return () => controller.abort();
  }, [ownerWallet]);

  // Live quote, debounced, while the amount is typed.
  // Left alone while sending, so the fee stays on screen.
  useEffect(() => {
    if (stage !== "amount") return;
    setQuote(null);
    setQuoteError(null);
    if (!network || !/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setQuoting(true);
      fetchSendQuote(ownerWallet, network.key, amount, feeMode, controller.signal)
        .then((next) => {
          setQuote(next);
          setQuoteError(next.message);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setQuoteError(cause instanceof Error ? cause.message : "No quote right now.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setQuoting(false);
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [amount, feeMode, network, ownerWallet, stage]);

  // After the burn, follow the delivery until the destination has it.
  useEffect(() => {
    if (stage !== "done" || !transfer || transfer.status !== "sending") return;
    const timer = window.setInterval(() => {
      void fetchCrossChainSend(ownerWallet, transfer.id)
        .then((payload) => {
          if (payload.transfer) setTransfer(payload.transfer);
        })
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [ownerWallet, stage, transfer]);

  // What leaves the balance: the burn plus SaphraONE's fee (the quoted total).
  const debitAmount = quote?.total ?? amount;
  const overBalance = usdcBalance !== undefined && Number(debitAmount) > Number(usdcBalance);
  const hasServiceFee = Boolean(quote && Number(quote.serviceFee) > 0);
  // Taken from the amount, the service fee raises the smallest send.
  const minimumSend = feeMode === "deduct" ? MIN_OUTBOUND_USDC + Number(CROSS_CHAIN_SERVICE_FEE_USDC) : MIN_OUTBOUND_USDC;
  const canSend =
    Boolean(quote) && !quoteError && !quoting && !overBalance && wallet.canSign && Number(amount) >= MIN_OUTBOUND_USDC;

  async function send() {
    if (!network || !wallet.resolveProvider) return;
    setError(null);
    setStage("sending");
    setStep(null);

    let id = resumeRef.current?.id ?? null;
    let toBurn = resumeRef.current?.burnAmount ?? null;
    let feePaid = resumeRef.current?.feePaid ?? false;
    let serviceFee = resumeRef.current?.serviceFee ?? "0";
    let serviceFeeRecipient = resumeRef.current?.serviceFeeRecipient ?? null;
    let total = resumeRef.current?.total ?? null;
    // Set once the burn is reported; after that nothing here may undo the done screen.
    let settled = false;

    const finish = async (burnTxHash: string, outcome?: { deliveredTxHash: string | null; result: unknown }) => {
      if (settled || !id) return;
      settled = true;
      resumeRef.current = null;
      const reported = await reportCrossChainSend(id, {
        bridgeResult: outcome ? plainResult(outcome.result) : undefined,
        burnTxHash,
        ownerWallet,
      }).catch(() => null);
      setTransfer(
        reported?.transfer ?? {
          amount: toBurn ?? amount,
          burnTxHash,
          createdAt: new Date().toISOString(),
          destination: trimmed,
          destinationTxUrl: outcome?.deliveredTxHash ? network.explorerTx(outcome.deliveredTxHash) : null,
          error: null,
          fee: quote?.fee ?? null,
          id,
          serviceFee: Number(serviceFee) > 0 ? serviceFee : null,
          network: network.key,
          networkName: network.name,
          received: null,
          status: "sending",
        },
      );
      setStage("done");
    };

    try {
      if (!id) {
        const started = await startCrossChainSend({
          amount,
          destination: trimmed,
          feeMode,
          network: network.key,
          ownerWallet,
        });
        id = started.transfer?.id ?? null;
        toBurn = started.quote.amount;
        serviceFee = started.quote.serviceFee;
        serviceFeeRecipient = started.quote.serviceFeeRecipient;
        total = started.quote.total;
        if (!id) throw new Error("The send could not be started.");
      }

      const resolveProvider = wallet.resolveProvider;
      const chargeFee = Number(serviceFee) > 0 && serviceFeeRecipient !== null;
      // One confirmation for the whole send (service fee + approve + burn):
      // the server checks it pays only this recipient and the fee wallet, and
      // no more than the total.
      const outcome = await confirmFlow(
        wallet.circleWalletId,
        {
          amount: total ?? toBurn ?? amount,
          maxUses: 5,
          recipients: chargeFee && serviceFeeRecipient ? [trimmed, serviceFeeRecipient] : [trimmed],
          title: `Send USDC to ${network.name}`,
          token: "USDC",
        },
        async () => {
          const provider = await resolveProvider();
          if (chargeFee && serviceFeeRecipient && !feePaid) {
            const feeTxHash = await payServiceFee({
              account: ownerWallet,
              fee: serviceFee,
              provider,
              recipient: serviceFeeRecipient,
            });
            feePaid = true;
            await reportCrossChainSend(id!, { ownerWallet, serviceFeeTxHash: feeTxHash }).catch(() => null);
          }
          return sendUsdcFromArc({
            amount: toBurn ?? amount,
            destination: network,
            // Circle delivers the rest by itself and the server follows it from
            // here. Waiting on App Kit past the burn is how this screen got stuck.
            onBurn: (hash) => void finish(hash),
            onStep: setStep,
            provider,
            recipient: trimmed,
            resumeFrom: resumeRef.current?.result,
          });
        },
      );
      if (settled) return;

      if (outcome.burnTxHash) {
        await finish(outcome.burnTxHash, outcome);
        return;
      }

      // Stopped before anything left the balance.
      // A paid fee keeps the send resumable, so a retry doesn't charge it again.
      resumeRef.current =
        outcome.resumable || feePaid
          ? {
              burnAmount: toBurn ?? amount,
              feePaid,
              id,
              result: outcome.resumable ? outcome.result : undefined,
              serviceFee,
              serviceFeeRecipient,
              total: total ?? toBurn ?? amount,
            }
          : null;
      await reportCrossChainSend(id, {
        bridgeResult: plainResult(outcome.result),
        error: outcome.error ?? "Stopped before sending.",
        ownerWallet,
      }).catch(() => null);
      if (!outcome.resumable && !feePaid) resumeRef.current = null;
      setError(outcome.error ?? "The send stopped before any money left your balance. Try again.");
      setStage("amount");
    } catch (cause) {
      if (settled) return;
      // Circle's PIN screen failed after the person confirmed: like a cancel,
      // nothing left the balance, but say what went wrong.
      const challengeFailed = isCircleChallengeError(cause);
      if (cause instanceof SendOutRejectedError || cause instanceof TxApprovalCancelled || challengeFailed) {
        const reason = challengeFailed
          ? userFacingErrorMessage(cause, "Circle couldn't complete this payment.")
          : null;
        if (id) {
          await reportCrossChainSend(id, { error: reason ?? "Cancelled in the wallet.", ownerWallet }).catch(() => null);
        }
        if (feePaid && id) {
          // Keep it: "Try again" finishes this send without a second fee.
          resumeRef.current = {
            burnAmount: toBurn ?? amount,
            feePaid,
            id,
            result: undefined,
            serviceFee,
            serviceFeeRecipient,
            total: total ?? toBurn ?? amount,
          };
          setError(
            reason
              ? `${reason} The service fee is already paid, so Try again won't charge it twice.`
              : "Cancelled before sending. The service fee is already paid, so Try again won't charge it twice.",
          );
        } else {
          resumeRef.current = null;
          setError(
            !reason
              ? "Cancelled. Nothing was sent."
              : /nothing was sent/i.test(reason)
                ? reason
                : `${reason} Nothing was sent.`,
          );
        }
        setStage("amount");
        return;
      }
      // We cannot tell whether the burn happened; never invite a blind retry.
      resumeRef.current = null;
      const reason = userFacingErrorMessage(cause, "The wallet didn't confirm the send.");
      // Saved with the send (left open, not failed), so it can be traced.
      if (id) {
        await reportCrossChainSend(id, { error: reason, ownerWallet, unconfirmed: true }).catch(() => null);
      }
      setError(
        cause instanceof Error && !id
          ? cause.message
          : `We could not confirm this send (${reason.replace(/\.$/, "")}). Check Activity before trying again so it is not sent twice.`,
      );
      setStage("amount");
    }
  }

  // ── Address and network ───────────────────────────────────────────────────
  if (stage === "to") {
    return (
      <div className="sx-page">
        <header className="sx-bar">
          <button aria-label="Back" className="sx-round" onClick={onBack} type="button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="sx-title">Pay to another network</h1>
          <button
            className="sx-next"
            disabled={!validAddress || !network}
            onClick={() => setStage("amount")}
            type="button"
          >
            Next
          </button>
        </header>

        <section className="sx-section">
          <span className="sx-label" id="xc-network-label">
            Network
          </span>
          <NetworkPicker
            chains={chains}
            fees={fees}
            onChange={setNetwork}
            value={network}
          />
        </section>

        <section className="sx-section">
          <label className="sx-label" htmlFor="xc-to">
            {network ? `${network.name} address` : "Address"}
          </label>
          <div className="sx-to">
            <div className="sx-to-field">
              <input
                autoCapitalize="off"
                autoComplete="off"
                autoFocus
                id="xc-to"
                onChange={(event) => setDestination(event.target.value.replace(/\s/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && validAddress) setStage("amount");
                }}
                placeholder="0x…"
                spellCheck={false}
                value={destination}
              />
              <button
                className="sx-paste"
                onClick={() => {
                  void navigator.clipboard
                    ?.readText()
                    .then((text) => setDestination(text.trim()))
                    .catch(() => undefined);
                }}
                type="button"
              >
                Paste
                <ClipboardPaste className="h-4 w-4" />
              </button>
            </div>
            <button aria-label="Scan a QR code" className="sx-scan-button" onClick={() => setScanOpen(true)} type="button">
              <ScanQrCode className="h-6 w-6" />
            </button>
          </div>
          {trimmed && !validAddress ? (
            <p className="xc-hint is-error">
              {trimmed.startsWith("@") || /\.one$/i.test(trimmed)
                ? "ONE IDs are paid on Arc. Go back and use Pay to a ONE ID."
                : "Enter a 0x address."}
            </p>
          ) : isOwnArcAddress ? (
            <p className="xc-hint">
              This is your own SaphraONE address. Make sure you control it on {network?.name}.
            </p>
          ) : null}
        </section>

        {network ? (
          <div className="xc-warn">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p>
              Send only to an address that accepts <strong>USDC on {network.name}</strong>. A send to the wrong
              network or address cannot be reversed.
            </p>
          </div>
        ) : null}

        <QrScanSheet
          onClose={() => setScanOpen(false)}
          onResult={(text) => {
            setScanOpen(false);
            const found = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
            if (found) setDestination(found);
          }}
          open={scanOpen}
        />
      </div>
    );
  }

  // The two ends of the animation: Arc, and the network it goes to.
  const fromLogo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={arcChain.name} height={32} src={arcChain.iconUrl} width={32} />
  );
  const toLogo = network ? <NetworkLogo chain={network} /> : null;
  const stepLabels = SEND_OUT_STEPS.map((entry) => sendOutStepLabel(entry, network?.name ?? ""));

  // ── Done ──────────────────────────────────────────────────────────────────
  if (stage === "done" && transfer && network) {
    const delivered = transfer.status === "delivered";
    const onHold = transfer.status === "on-hold";
    const summary = `${money(transfer.received ?? quote?.receive ?? transfer.amount)} USDC to ${short(transfer.destination)} on ${network.name}`;
    return (
      <div className="sx-page">
        <div className="xc-done">
          {/* Picks up where the sending screen left off: Circle is delivering. */}
          <TransferProgress
            current={SEND_OUT_STEPS.indexOf("deliver")}
            details={{
              amount: `${money(transfer.received ?? quote?.receive ?? transfer.amount)} USDC`,
              eyebrow: "Sent to another network",
              explorerLabel: `View on ${network.name}`,
              explorerUrl: transfer.destinationTxUrl ?? undefined,
              rows: [
                { label: "To", value: short(transfer.destination) },
                { label: "Network", value: network.name },
                { label: "You sent", value: `${money(transfer.amount)} USDC` },
                ...(transfer.fee ? [{ label: "Network fee (Circle)", value: `${money(transfer.fee)} USDC` }] : []),
                ...(transfer.serviceFee && Number(transfer.serviceFee) > 0
                  ? [{ label: "Service fee", value: `${money(transfer.serviceFee)} USDC` }]
                  : []),
              ],
            }}
            doneSubtitle={`To ${short(transfer.destination)} on ${network.name}.`}
            doneTitle="Delivered"
            from={fromLogo}
            onClose={onBack}
            holdSubtitle={`${summary}. We couldn't confirm it automatically, so our team is checking it. Don't send it again; it shows in Activity once it's cleared.`}
            skipIntro
            state={delivered ? "done" : onHold ? "hold" : "running"}
            steps={stepLabels}
            to={toLogo}
          />
          {/* While Circle delivers, the receipt isn't up yet: it's fine to leave. */}
          {!delivered && !onHold ? (
            <>
              <p className="xc-done-sub">{summary}. This usually takes under a minute; you can leave this page.</p>
              <button className="sx-send xc-cta" onClick={onBack} type="button">
                Done
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Sending: the coin travels Arc → network, one step at a time ───────────
  if (stage === "sending" && network) {
    return (
      <div className="sx-page">
        <TransferProgress
          current={step ? SEND_OUT_STEPS.indexOf(step) : -1}
          doneTitle="Delivered"
          from={fromLogo}
          state="running"
          steps={stepLabels}
          to={toLogo}
        />
        {wallet.kind === "circle" ? <p className="sx-muted xc-progress-note">Confirm when asked.</p> : null}
      </div>
    );
  }

  // ── Amount, quote ─────────────────────────────────────────────────────────
  const sending = stage === "sending";
  return (
    <div className="sx-page">
      <header className="sx-bar">
        <button
          aria-label="Back"
          className="sx-round"
          disabled={sending}
          onClick={() => {
            setError(null);
            setStage("to");
          }}
          type="button"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="sx-title">Amount</h1>
        <span />
      </header>

      <div className="xc-recipient">
        <span className="xc-recipient-label">To</span>
        <span className="xc-recipient-value">
          {short(trimmed)} <em>on {network?.name}</em>
        </span>
      </div>

      <section className="sx-section">
        <label className="sx-label" htmlFor="xc-amount">
          {feeMode === "add" ? "They receive (USDC)" : "You send (USDC)"}
        </label>
        <div className="xc-amount">
          <input
            disabled={sending}
            id="xc-amount"
            inputMode="decimal"
            onChange={(event) => {
              const next = event.target.value.replace(/,/g, ".");
              if (/^\d*(\.\d{0,6})?$/.test(next)) setAmount(next);
            }}
            placeholder="0.00"
            value={amount}
          />
          {usdcBalance !== undefined ? (
            <button
              className="xc-max"
              disabled={sending}
              onClick={() => setAmount(String(Math.floor(Number(usdcBalance) * 1e6) / 1e6))}
              type="button"
            >
              Max
            </button>
          ) : null}
        </div>
        <p className="sx-muted">
          {usdcBalance !== undefined
            ? `Available on ${arcChain.name}: ${hideBalance ? "••••" : `${money(usdcBalance)} USDC`}`
            : `From your ${arcChain.name} balance`}
        </p>
      </section>

      <div aria-label="Network fee" className="xc-feemode" role="radiogroup">
        {(
          [
            ["deduct", "Take fee from amount"],
            ["add", "Add fee on top"],
          ] as const
        ).map(([mode, label]) => (
          <button
            aria-checked={feeMode === mode}
            className={cn("xc-feemode-option", feeMode === mode && "is-active")}
            disabled={sending}
            key={mode}
            onClick={() => setFeeMode(mode)}
            role="radio"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <section className="xc-quote" aria-live="polite">
        {quoting ? (
          <p className="sx-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Getting the network fee…
          </p>
        ) : quote ? (
          <>
            <div className="xc-quote-row">
              <span>You send</span>
              <span>{money(quote.amount)} USDC</span>
            </div>
            <div className="xc-quote-row">
              <span>Network fee (Circle)</span>
              <span>{money(quote.fee)} USDC</span>
            </div>
            {hasServiceFee ? (
              <div className="xc-quote-row">
                <span>Service fee</span>
                <span>{money(quote.serviceFee)} USDC</span>
              </div>
            ) : null}
            <div className="xc-quote-row">
              <span>They receive at least</span>
              <strong>{money(quote.receive)} USDC</strong>
            </div>
            {hasServiceFee ? (
              <div className="xc-quote-row">
                <span>Total from your balance</span>
                <strong>{money(quote.total)} USDC</strong>
              </div>
            ) : null}
            <div className="xc-quote-row">
              <span>Arrives</span>
              <span>in about 30 seconds, on {network?.name}</span>
            </div>
          </>
        ) : (
          <p className="sx-muted">
            Enter at least {minimumSend} USDC to see the fees.
            {network?.key === "ethereum" ? " Ethereum costs more than the other networks (about $1.20)." : ""}
          </p>
        )}
        {quoteError ? <p className="xc-hint is-error">{quoteError}</p> : null}
        {overBalance ? <p className="xc-hint is-error">That is more than your USDC balance.</p> : null}
      </section>

      {error ? <p className="xc-hint is-error">{error}</p> : null}
      {!wallet.canSign && wallet.reason ? <p className="xc-hint is-error">{wallet.reason}</p> : null}

      <button className="sx-send xc-cta" disabled={!canSend || sending} onClick={() => void send()} type="button">
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Sending…
          </>
        ) : resumeRef.current ? (
          "Try again"
        ) : (
          `Send${debitAmount ? ` ${money(debitAmount)} USDC` : ""}`
        )}
      </button>
    </div>
  );
}
