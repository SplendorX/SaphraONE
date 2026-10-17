"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  Delete,
  Download,
  Globe,
  Loader2,
  Plus,
  QrCode,
  Receipt,
  Share2,
  Store,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAccountContext } from "@/components/account/account-provider";
import { pressAmountKey } from "@/components/checkout/amount-keypad";
import { OnlinePaymentsPanel } from "@/components/checkout/online-payments-panel";
import { LazyQRCodeSVG } from "@/components/lazy-qr-code";
import { showSuccess } from "@/components/success-popup";
import { Button } from "@/components/ui/button";
import { formatMoney, moneyNumber } from "@/lib/account/money";
import {
  cancelChargeClient,
  createChargeClient,
  fetchCharge,
  fetchCharges,
  reconcileChargeClient,
  type MerchantAuth,
} from "@/lib/checkout/client";
import { CHARGE_MAX_AMOUNT, CHARGE_MIN_AMOUNT } from "@/lib/checkout/money-rules";
import type { ChargeSummary, ChargeWithPayments } from "@/lib/checkout/types";
import { downloadStorefrontPoster } from "@/lib/checkout/poster";
import { explorerTxUrl } from "@/lib/onchain-facts";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

import "./checkout.css";

const POLL_MS = 2_500;

type Tab = "charge" | "storefront" | "online";

function newIdempotencyKey() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" });
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy. Select and copy it instead.");
  }
}

async function shareLink(url: string, title: string) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return;
    } catch {
      // Dismissed: fall back to copying.
    }
  }
  await copyText(url, "Link");
}

export function MerchantCheckoutHub() {
  const {
    account,
    circleSocialUuid: accountSocialUuid,
    isBusiness,
    loading: accountLoading,
    ownerWallet,
    profile,
  } = useAccountContext();
  const { address, circleSocialUuid: walletSocialUuid } = usePlatformWallet();
  const activeWallet = (ownerWallet || address)?.toLowerCase() ?? null;
  const isBusinessAccount = Boolean(isBusiness || account?.account_type === "BUSINESS");
  const auth = useMemo<MerchantAuth | null>(
    () =>
      activeWallet
        ? { circleSocialUuid: accountSocialUuid || walletSocialUuid || undefined, ownerWallet: activeWallet }
        : null,
    [accountSocialUuid, activeWallet, walletSocialUuid],
  );
  const currency = profile?.currency ?? "USDC";

  const [tab, setTab] = useState<Tab>("charge");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ChargeWithPayments | null>(null);
  const [charges, setCharges] = useState<ChargeWithPayments[]>([]);
  const [summary, setSummary] = useState<ChargeSummary | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileHash, setReconcileHash] = useState("");
  const [reconciling, setReconciling] = useState(false);
  const [origin, setOrigin] = useState("");
  const idempotencyKey = useRef(newIdempotencyKey());
  const celebrated = useRef<Set<string>>(new Set());
  const storefrontQrRef = useRef<HTMLDivElement>(null);
  const [posterBusy, setPosterBusy] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    // The Developers page links here with ?tab=online.
    if (new URLSearchParams(window.location.search).get("tab") === "online") setTab("online");
  }, []);

  const loadCharges = useCallback(async () => {
    if (!auth) return;
    try {
      const result = await fetchCharges(auth, { kind: "IN_PERSON" });
      setCharges(result.charges);
      setSummary(result.summary);
    } catch {
      // The list is secondary; the charge screen still works.
    }
  }, [auth]);

  useEffect(() => {
    if (isBusinessAccount) void loadCharges();
  }, [isBusinessAccount, loadCharges]);

  const activeId = active?.id;
  const activeStatus = active?.status;

  // Watch the charge on screen until it is paid, so the counter sees it live.
  useEffect(() => {
    if (!auth || !activeId || activeStatus !== "OPEN") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchCharge(auth, activeId)
        .then(({ charge }) => setActive((current) => (current?.id === charge.id ? charge : current)))
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeId, activeStatus, auth]);

  useEffect(() => {
    if (!active || active.status !== "PAID" || celebrated.current.has(active.id)) return;
    celebrated.current.add(active.id);
    const tip = moneyNumber(active.tip_amount);
    showSuccess({
      amount: formatMoney(active.amount_received, active.currency),
      eyebrow: "Checkout",
      explorerUrl: active.payments[0] ? explorerTxUrl(active.payments[0].tx_hash) : undefined,
      subtitle: tip > 0 ? `Including a ${formatMoney(tip, active.currency)} tip` : undefined,
      title: "Payment received",
    });
    void loadCharges();
  }, [active, loadCharges]);

  if (accountLoading && !account) {
    return (
      <div className="ck-page">
        <CheckoutBar />
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!accountLoading && !isBusinessAccount) {
    return (
      <div className="ck-page">
        <CheckoutBar />
        <section className="ck-card ck-intro">
          <span className="ck-intro-icon">
            <Store className="h-7 w-7" />
          </span>
          <h2 className="ck-intro-title">Take payments at your counter</h2>
          <p className="ck-muted">
            Only Business accounts can take in-person payments. Upgrade your account to Business to
            start charging customers.
          </p>
          <Button asChild className="ck-primary">
            <Link href="/settings#account-type">Upgrade to Business</Link>
          </Button>
        </section>
      </div>
    );
  }

  const value = moneyNumber(amount || "0");
  const valid = value >= CHARGE_MIN_AMOUNT && value <= CHARGE_MAX_AMOUNT.MERCHANT;
  const chargeUrl = active && origin ? `${origin}/c/${active.public_id}` : "";
  const storefrontUrl = account?.username && origin ? `${origin}/p/${account.username}` : "";

  async function createActiveCharge() {
    if (!auth || !valid) return;
    setCreating(true);
    setError(null);
    try {
      const { charge } = await createChargeClient(
        auth,
        { amount, currency, note: note.trim() || undefined },
        idempotencyKey.current,
      );
      setActive(charge);
      idempotencyKey.current = newIdempotencyKey();
      void loadCharges();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the charge.");
    } finally {
      setCreating(false);
    }
  }

  async function reconcile(charge: ChargeWithPayments) {
    if (!auth) return;
    const hash = reconcileHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      toast.error("Paste the full transaction hash (0x followed by 64 characters).");
      return;
    }
    setReconciling(true);
    try {
      const { charge: next } = await reconcileChargeClient(auth, charge.id, hash);
      setActive(next);
      setReconcileHash("");
      setReconcileOpen(false);
      toast.success(next.status === "PAID" ? "Payment attached. Charge paid." : "Payment attached.");
      void loadCharges();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not attach that payment.");
    } finally {
      setReconciling(false);
    }
  }

  function resetCharge() {
    setReconcileOpen(false);
    setReconcileHash("");
    setActive(null);
    setAmount("");
    setNote("");
    setError(null);
  }

  async function cancel(charge: ChargeWithPayments) {
    if (!auth) return;
    setCancellingId(charge.id);
    try {
      const { charge: next } = await cancelChargeClient(auth, charge.id);
      setActive((current) => (current?.id === next.id ? next : current));
      void loadCharges();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the charge.");
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="ck-page">
      <CheckoutBar />

      <div aria-label="Checkout mode" className="ck-tabs" role="tablist">
        {(
          [
            { icon: QrCode, id: "charge", label: "New charge" },
            { icon: Store, id: "storefront", label: "Storefront" },
            { icon: Globe, id: "online", label: "Online" },
          ] as const
        ).map((option) => (
          <button
            aria-selected={tab === option.id}
            className="ck-tab"
            key={option.id}
            onClick={() => setTab(option.id)}
            role="tab"
            type="button"
          >
            <option.icon className="h-4 w-4" />
            {option.label}
          </button>
        ))}
      </div>

      {tab === "online" ? (
        <OnlinePaymentsPanel auth={auth} />
      ) : tab === "storefront" ? (
        storefrontUrl ? (
          <section className="ck-card ck-center">
            <div className="ck-shop">
              {profile?.logo_url ? (
                <img alt="" className="ck-shop-logo" src={profile.logo_url} />
              ) : (
                <span className="ck-shop-logo">
                  <Store className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0 text-left">
                <span className="ck-shop-name">
                  {profile?.business_name ?? account?.display_name ?? `${account?.username}.one`}
                </span>
                <span className="ck-muted block text-xs">Your permanent storefront QR</span>
              </span>
            </div>
            <div className="ck-qr" ref={storefrontQrRef}>
              <LazyQRCodeSVG level="M" size={220} value={storefrontUrl} />
            </div>
            <p className="ck-muted">
              Put this QR on your counter or window. Customers scan it, type the amount, and pay.
            </p>
            <p className="ck-link">{storefrontUrl}</p>
            <div className="ck-pills">
              <button className="ck-pill" onClick={() => void copyText(storefrontUrl, "Link")} type="button">
                <Copy className="h-4 w-4" />
                Copy link
              </button>
              <button
                className="ck-pill"
                onClick={() => void shareLink(storefrontUrl, `Pay ${profile?.business_name ?? "us"}`)}
                type="button"
              >
                <Share2 className="h-4 w-4" />
                Share
              </button>
            </div>
            <Button
              className="ck-primary"
              disabled={posterBusy}
              onClick={() => {
                const svg = storefrontQrRef.current?.querySelector("svg");
                if (!svg) return;
                setPosterBusy(true);
                void downloadStorefrontPoster({
                  businessName: profile?.business_name ?? account?.display_name ?? account?.username ?? "SaphraONE",
                  logoUrl: profile?.logo_url,
                  qrSvg: svg,
                  url: storefrontUrl,
                })
                  .catch(() => toast.error("Could not create the poster."))
                  .finally(() => setPosterBusy(false));
              }}
            >
              {posterBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download printable poster
            </Button>
          </section>
        ) : (
          <section className="ck-card ck-center">
            <span className="ck-intro-icon">
              <Store className="h-7 w-7" />
            </span>
            <p className="ck-muted">
              Set a username in{" "}
              <Link className="font-semibold text-primary hover:underline" href="/settings">
                Settings
              </Link>{" "}
              to get a permanent storefront QR.
            </p>
          </section>
        )
      ) : active ? (
        <section className="ck-card ck-center">
          {active.status === "PAID" ? (
            <div className="ck-paid">
              <span className="ck-paid-icon">
                <Check className="h-7 w-7" />
              </span>
              <p className="ck-paid-label">Payment received</p>
              <p className="ck-paid-amount">{formatMoney(active.amount_received, active.currency)}</p>
              {moneyNumber(active.tip_amount) > 0 ? (
                <p className="ck-paid-tip">+{formatMoney(active.tip_amount, active.currency)} tip</p>
              ) : null}
            </div>
          ) : active.status === "OPEN" ? (
            <>
              <p className="ck-muted text-sm">Ask the customer to scan</p>
              <p className="ck-charge-amount">{formatMoney(active.amount, active.currency)}</p>
              {active.note ? <p className="ck-muted">{active.note}</p> : null}
              <div className="ck-qr">{chargeUrl ? <LazyQRCodeSVG size={232} value={chargeUrl} /> : null}</div>
              <p className="ck-waiting">
                <span aria-hidden className="ck-pulse" />
                {moneyNumber(active.amount_received) > 0
                  ? `Received ${formatMoney(active.amount_received, active.currency)} of ${formatMoney(active.amount, active.currency)}`
                  : active.pending_method
                    ? "Customer is paying…"
                    : "Waiting for the customer to scan"}
              </p>
              <p className="ck-code">{active.public_id}</p>
              <div className="ck-pills">
                <button className="ck-pill" onClick={() => void copyText(chargeUrl, "Link")} type="button">
                  <Copy className="h-4 w-4" />
                  Copy link
                </button>
                <button className="ck-pill" onClick={() => void shareLink(chargeUrl, "Pay with SaphraONE")} type="button">
                  <Share2 className="h-4 w-4" />
                  Share
                </button>
              </div>
            </>
          ) : (
            <p className="ck-muted py-6">This charge was {active.status.toLowerCase()}.</p>
          )}
          {active.status === "OPEN" || active.status === "EXPIRED" ? (
            reconcileOpen ? (
              <div className="ck-reconcile">
                <p className="text-sm">
                  Paste the transaction hash of a payment the customer made to your wallet. It will be
                  credited to this charge.
                </p>
                <label className="ck-field">
                  <input
                    className="font-mono text-xs"
                    disabled={reconciling}
                    onChange={(event) => setReconcileHash(event.target.value)}
                    placeholder="0x…"
                    spellCheck={false}
                    value={reconcileHash}
                  />
                </label>
                <div className="ck-row">
                  <Button className="flex-1" disabled={reconciling} onClick={() => setReconcileOpen(false)} variant="ghost">
                    Close
                  </Button>
                  <Button className="flex-1" disabled={reconciling} onClick={() => void reconcile(active)}>
                    {reconciling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Attach payment
                  </Button>
                </div>
              </div>
            ) : (
              <button className="ck-quiet-link" onClick={() => setReconcileOpen(true)} type="button">
                Customer paid but it isn&rsquo;t showing?
              </button>
            )
          ) : null}
          <div className="ck-row">
            {active.status === "OPEN" && active.payments.length === 0 ? (
              <Button
                className="flex-1"
                disabled={cancellingId === active.id}
                onClick={() => void cancel(active)}
                variant="outline"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            ) : null}
            <Button className="ck-primary flex-1" onClick={resetCharge}>
              <Plus className="h-4 w-4" />
              New charge
            </Button>
          </div>
        </section>
      ) : (
        <>
          <section className="ck-hero">
            <span aria-hidden className="ck-hero-glow" />
            <span className="ck-hero-label">Charge a customer · {currency}</span>
            <p aria-live="polite" className={cn("ck-hero-amount", !amount && "is-empty")}>
              {formatMoney(amount || "0", currency)}
            </p>
            <p className="ck-hero-sub">Customers pay with SaphraONE or any wallet on Arc. No fee on what they send you.</p>
          </section>

          <section className="ck-card">
            <div className="ck-keypad">
              {keypadKeys.map((key) => (
                <button
                  aria-label={key === "back" ? "Delete" : key}
                  className="ck-key"
                  disabled={creating}
                  key={key}
                  onClick={() => setAmount((current) => pressAmountKey(current, key))}
                  type="button"
                >
                  {key === "back" ? <Delete className="h-5 w-5" /> : key}
                </button>
              ))}
            </div>
            <label className="ck-field">
              <input
                disabled={creating}
                maxLength={140}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Note for the customer (optional)"
                value={note}
              />
            </label>
            {value > CHARGE_MAX_AMOUNT.MERCHANT ? (
              <p className="text-sm text-destructive">
                The largest charge is {CHARGE_MAX_AMOUNT.MERCHANT.toLocaleString("en-US")}.
              </p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button
              className="ck-primary"
              disabled={!valid || creating || !auth}
              onClick={() => void createActiveCharge()}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
              Charge {value > 0 ? formatMoney(amount, currency) : ""}
            </Button>
          </section>
        </>
      )}

      {summary && tab !== "online" ? (
        <section aria-label="Today" className="ck-today">
          {[
            { label: "Paid today", value: String(summary.todayCount) },
            { label: "Volume", value: formatMoney(summary.todayVolume, currency) },
            { label: "Tips", value: formatMoney(summary.todayTips, currency) },
          ].map((stat) => (
            <div className="ck-stat" key={stat.label}>
              <span className="ck-stat-value">{stat.value}</span>
              <span className="ck-stat-label">{stat.label}</span>
            </div>
          ))}
        </section>
      ) : null}

      {tab === "online" ? null : (
      <section className="ck-card">
        <h2 className="ck-card-title">
          <Receipt className="h-4 w-4 text-primary" />
          Recent charges
        </h2>
        {charges.length === 0 ? (
          <p className="ck-muted">Charges you create show up here.</p>
        ) : (
          <ul className="ck-list">
            {charges.map((charge) => (
              <li className="ck-item" key={charge.id}>
                <button
                  className="ck-item-main"
                  onClick={() => {
                    setTab("charge");
                    setActive(charge);
                    window.scrollTo({ behavior: "smooth", top: 0 });
                  }}
                  type="button"
                >
                  <span className="ck-item-icon" data-status={charge.status}>
                    {charge.kind === "STOREFRONT" ? <Store className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="ck-item-amount">
                      {formatMoney(
                        charge.status === "PAID" ? charge.amount_received : charge.amount,
                        charge.currency,
                      )}
                      {charge.status === "PAID" && moneyNumber(charge.tip_amount) > 0 ? (
                        <span className="ck-item-tip">incl. {formatMoney(charge.tip_amount, charge.currency)} tip</span>
                      ) : null}
                    </span>
                    <span className="ck-item-meta">
                      {timeLabel(charge.created_at)} · {charge.public_id}
                      {charge.kind === "STOREFRONT" ? " · storefront" : ""}
                      {charge.note ? ` · ${charge.note}` : ""}
                    </span>
                  </span>
                </button>
                <span className="ck-status" data-status={charge.status}>
                  {charge.status.toLowerCase()}
                </span>
                {charge.payments[0] ? (
                  <a
                    aria-label="View transaction"
                    className="ck-item-action"
                    href={explorerTxUrl(charge.payments[0].tx_hash)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                ) : charge.status === "OPEN" ? (
                  <button
                    aria-label="Cancel charge"
                    className="ck-item-action is-danger"
                    disabled={cancellingId === charge.id}
                    onClick={() => void cancel(charge)}
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </div>
  );
}

const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

function CheckoutBar() {
  return (
    <header className="ck-bar">
      <Link aria-label="Back to Overview" className="ck-round" href="/business">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <h1 className="ck-title">Checkout</h1>
      <span aria-hidden />
    </header>
  );
}
