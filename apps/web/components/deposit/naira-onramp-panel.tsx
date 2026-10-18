"use client";

import { AlertTriangle, ArrowUpRight, Check, CheckCircle2, Clock, Copy, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { KycSheet } from "@/components/kyc/kyc-sheet";
import { Button } from "@/components/ui/button";
import { WalletConnectButton } from "@/components/wallet-connect-button";
import { explorerTxUrl } from "@/lib/onchain-facts";
import { createOrder, fetchRampStatus, getOrder, RampApiError, readOpenOrderId, rememberOpenOrderId, requestQuote } from "@/lib/ramp/client";
import { parseNgnAmount } from "@/lib/ramp/rules";
import type { RampKycInfo, RampOrderView, RampQuote } from "@/lib/ramp/types";
import { formatCountdown, isFinished, useDebounced, useRampOrder, useSecondsLeft } from "@/lib/ramp/use-ramp-order";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

import "./ramp.css";

const quickPicks = [10_000, 50_000, 100_000];

export function formatNaira(value: string | number | null | undefined) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "₦—";
  return `₦${amount.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

export function formatUsdc(value: string | number | null | undefined) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "— USDC";
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 2 })} USDC`;
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Pay Naira by bank transfer and receive USDC on Arc, through Centiiv. The
 * user transfers to a one-time virtual account; Centiiv converts and sends
 * USDC straight to the signed-in wallet.
 */
export function NairaOnrampPanel() {
  const { address, isConnected } = usePlatformWallet();
  const wallet = address?.toLowerCase() ?? null;
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [started, setStarted] = useState<RampOrderView | null>(null);
  const [order, setOrder] = useRampOrder(wallet, started);
  const [kyc, setKyc] = useState<RampKycInfo | null>(null);
  const [kycOpen, setKycOpen] = useState(false);
  const [kycMode, setKycMode] = useState<"tier1" | "selfie">("tier1");

  const parsed = useMemo(() => (amount ? parseNgnAmount(amount) : null), [amount]);
  const quoteAmount = useDebounced(parsed?.ok ? parsed.value : null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    void fetchRampStatus(wallet).then((status) => {
      if (!cancelled) setKyc(status?.kyc ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  // Resume an order left open on this device.
  useEffect(() => {
    if (!wallet) return;
    const id = readOpenOrderId("ONRAMP", wallet);
    if (!id) return;
    let cancelled = false;
    getOrder(wallet, id)
      .then((found) => {
        if (!cancelled && !isFinished(found.status)) setStarted(found);
        else if (!cancelled) rememberOpenOrderId("ONRAMP", wallet, null);
      })
      .catch(() => rememberOpenOrderId("ONRAMP", wallet, null));
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  useEffect(() => {
    if (!wallet || !quoteAmount) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setError(null);
    requestQuote(wallet, "ONRAMP", quoteAmount)
      .then((next) => {
        if (!cancelled) setQuote(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setQuote(null);
          setError(cause instanceof Error ? cause.message : "Couldn't get a rate.");
        }
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, quoteAmount]);

  useEffect(() => {
    if (wallet && order && isFinished(order.status)) rememberOpenOrderId("ONRAMP", wallet, null);
  }, [wallet, order]);

  function changeAmount(value: string) {
    setAmount(value.replace(/[^\d.,]/g, ""));
    // A different amount is a different order.
    setIdempotencyKey(newKey());
  }

  async function start() {
    if (!wallet || !parsed?.ok) return;
    if (kyc?.required && kyc.tier < 1) {
      setKycMode("tier1");
      setKycOpen(true);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createOrder({
        amount: parsed.value,
        direction: "ONRAMP",
        idempotencyKey,
        wallet,
      });
      rememberOpenOrderId("ONRAMP", wallet, created.id);
      setStarted(created);
    } catch (cause) {
      if (cause instanceof RampApiError && cause.code === "KYC_REQUIRED") {
        setKycMode("tier1");
        setKycOpen(true);
      } else if (cause instanceof RampApiError && cause.code === "KYC_LIMIT") {
        setKycMode("selfie");
        setKycOpen(true);
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : "Couldn't start the deposit.");
      }
    } finally {
      setCreating(false);
    }
  }

  function startAgain() {
    if (wallet) rememberOpenOrderId("ONRAMP", wallet, null);
    setStarted(null);
    setOrder(null);
    setAmount("");
    setQuote(null);
    setError(null);
    setIdempotencyKey(newKey());
  }

  if (!isConnected || !wallet) {
    return (
      <section className="section-panel">
        <h2 className="section-title">Pay with Naira</h2>
        <p className="section-copy">Connect your account to get bank details for your deposit.</p>
        <div className="mt-5">
          <WalletConnectButton />
        </div>
      </section>
    );
  }

  if (order) return <OnrampOrder onStartAgain={startAgain} order={order} />;

  return (
    <div className="ramp">
      <div className="ramp-card">
        <label className="ramp-label" htmlFor="naira-amount">
          You pay
        </label>
        <div className="ramp-amount">
          <span>₦</span>
          <input
            autoComplete="off"
            id="naira-amount"
            inputMode="decimal"
            onChange={(event) => changeAmount(event.target.value)}
            placeholder="0"
            value={amount}
          />
        </div>
        <div className="ramp-chips">
          {quickPicks.map((pick) => (
            <button
              className={cn("ramp-chip", parsed?.ok && Number(parsed.value) === pick && "is-active")}
              key={pick}
              onClick={() => changeAmount(String(pick))}
              type="button"
            >
              {formatNaira(pick)}
            </button>
          ))}
        </div>
        {kyc?.tier ? (
          <p className="ramp-note">Verified · {formatNaira(kyc.remainingToday.onrampNgn)} left today</p>
        ) : null}

        {parsed && !parsed.ok ? <p className="ramp-error">{parsed.message}</p> : null}

        {quote && parsed?.ok ? (
          <div className="ramp-quote">
            <div className="ramp-quote-row is-main">
              <span>You get about</span>
              <b>{formatUsdc(quote.receive)}</b>
            </div>
            <div className="ramp-quote-row">
              <span>Rate</span>
              <b>{formatNaira(quote.rate)} / USDC</b>
            </div>
            <div className="ramp-quote-row">
              <span>Fee</span>
              <b>{formatNaira(quote.fees)}</b>
            </div>
            <p className="ramp-powered">Powered by Centiiv. The final rate can move slightly.</p>
          </div>
        ) : quoting ? (
          <p className="ramp-note">
            <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
            Getting a rate…
          </p>
        ) : null}

        {error ? <p className="ramp-error">{error}</p> : null}

        <Button className="h-12 w-full" disabled={!parsed?.ok || !quote || quoting || creating} onClick={start} type="button">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Get bank details
        </Button>
      </div>
      <p className="ramp-note">
        You&apos;ll get a one-time account to pay into from any Nigerian bank. USDC arrives in your SaphraONE wallet
        on Arc once the transfer lands.
      </p>
      {wallet ? (
        <KycSheet
          mode={kycMode}
          onOpenChange={setKycOpen}
          onVerified={(next) => {
            setKyc({
              available: next.available,
              limits: next.limits,
              nextTier: next.nextTier,
              remainingToday: next.remainingToday,
              required: next.required,
              status: next.status,
              tier: next.tier,
            });
            setKycOpen(false);
            void start();
          }}
          open={kycOpen}
          wallet={wallet}
        />
      ) : null}
    </div>
  );
}

function CopyRow({ label, value, display }: { label: string; value: string; display?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="ramp-detail">
      <span className="ramp-detail-main">
        <small>{label}</small>
        <strong>{display ?? value}</strong>
      </span>
      <button className="ramp-copy" onClick={() => void copy()} type="button">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function OnrampOrder({ order, onStartAgain }: { order: RampOrderView; onStartAgain: () => void }) {
  const secondsLeft = useSecondsLeft(order.status === "PENDING" ? order.expiresAt : null);

  if (order.status === "FULFILLED") {
    return (
      <div className="ramp-card ramp-status">
        <span className="ramp-status-icon">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <h3>{formatUsdc(order.usdcAmount)} received</h3>
        <p>Your Naira payment is now USDC in your wallet.</p>
        {order.deliveryTxHash ? (
          <a className="ramp-link" href={explorerTxUrl(order.deliveryTxHash)} rel="noreferrer" target="_blank">
            View on ArcScan <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        ) : null}
        <Button className="mt-2" onClick={onStartAgain} type="button" variant="outline">
          Make another deposit
        </Button>
      </div>
    );
  }

  if (isFinished(order.status)) {
    const title =
      order.status === "EXPIRED" ? "This deposit expired" : order.status === "REFUNDED" ? "Payment refunded" : "Deposit didn't complete";
    return (
      <div className="ramp-card ramp-status">
        <span className="ramp-status-icon is-bad">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h3>{title}</h3>
        <p>
          {order.failureReason ??
            "If you already sent money to this account, it will be returned to you. Contact support if it hasn't arrived."}
        </p>
        <Button className="mt-2" onClick={onStartAgain} type="button">
          Start again
        </Button>
      </div>
    );
  }

  if (order.status === "PROCESSING") {
    return (
      <div className="ramp-card ramp-status">
        <span className="ramp-status-icon">
          <Loader2 className="h-6 w-6 animate-spin" />
        </span>
        <h3>Payment received</h3>
        <p>Sending {formatUsdc(order.usdcAmount)} to your wallet. This usually takes a minute or two.</p>
      </div>
    );
  }

  const payin = order.payin;
  return (
    <div className="ramp">
      <div className="ramp-card">
        <div className="flex items-center justify-between gap-3">
          <span className="ramp-label">Transfer exactly</span>
          {secondsLeft !== null ? (
            <span className="ramp-timer">
              <Clock className="h-3.5 w-3.5" />
              {secondsLeft > 0 ? formatCountdown(secondsLeft) : "Expiring"}
            </span>
          ) : null}
        </div>
        {order.totalToPay ? (
          <CopyRow display={formatNaira(order.totalToPay)} label="Amount" value={order.totalToPay} />
        ) : null}
        {payin ? (
          <>
            <CopyRow label="Account number" value={payin.accountNumber} />
            {payin.bankName ? <CopyRow label="Bank" value={payin.bankName} /> : null}
            {payin.accountName ? <CopyRow label="Account name" value={payin.accountName} /> : null}
          </>
        ) : (
          <p className="ramp-error">Bank details aren&apos;t available for this deposit. Start again.</p>
        )}
        <p className="ramp-note">
          Transfer exactly this amount from an account in your name. USDC arrives in your SaphraONE wallet
          automatically, about {formatUsdc(order.receive)}.
        </p>
        <p className="ramp-note flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for your transfer…
        </p>
      </div>
      <button className="ramp-note underline" onClick={onStartAgain} type="button">
        Start a different deposit
      </button>
    </div>
  );
}
