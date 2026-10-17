"use client";

import { CreditCard, Link2, Loader2, Lock, Store, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PlatformBrand } from "@/components/brand/platform-brand";
import { PayerBackButton } from "@/components/checkout/payer-back-button";
import { ChargeReceiptCard } from "@/components/checkout/charge-receipt-card";
import {
  OnlineCancelLink,
  OnlineOrderSummary,
  OnlineReturnToStore,
  storeHomeUrl,
} from "@/components/checkout/online-checkout-parts";
import { PayWithBridge } from "@/components/checkout/pay-with-bridge";
import { PayWithOnramp } from "@/components/checkout/pay-with-onramp";
import { PayWithSaphra } from "@/components/checkout/pay-with-saphra";
import { PayWithWallet } from "@/components/checkout/pay-with-wallet";
import { TipPicker } from "@/components/checkout/tip-picker";
import { Button } from "@/components/ui/button";
import { formatMoney, moneyNumber, roundMoney } from "@/lib/account/money";
import { fetchOnrampEnabled, fetchPublicCharge, updateChargeTip } from "@/lib/checkout/client";
import type { PublicChargePayload } from "@/lib/checkout/types";
import { trackTractionEvent } from "@/lib/traction/client";
import { cn } from "@/lib/utils";

type Method = "card" | "chain" | "saphra" | "wallet";

const POLL_MS = 2_500;

export function PayChargePage({ code }: { code: string }) {
  const [payload, setPayload] = useState<PublicChargePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tip, setTip] = useState("0");
  const [tipError, setTipError] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("wallet");
  const [onrampEnabled, setOnrampEnabled] = useState(false);
  const tipTouched = useRef(false);
  const tracked = useRef(false);

  const applyPayload = useCallback((next: PublicChargePayload) => {
    setPayload(next);
    if (!tipTouched.current) setTip(next.charge.tipAmount || "0");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicCharge(code)
      .then((next) => {
        if (!cancelled) applyPayload(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "That charge was not found.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyPayload, code]);

  const status = payload?.charge.status;

  useEffect(() => {
    void fetchOnrampEnabled().then(setOnrampEnabled);
  }, []);

  // Live status while the charge is open: a SaphraONE payment made in another
  // tab, or by someone else at the counter, flips this page too.
  useEffect(() => {
    if (status !== "OPEN") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchPublicCharge(code)
        .then(applyPayload)
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [applyPayload, code, status]);

  // The picked tip is saved (debounced) as a hint for the merchant screen.
  useEffect(() => {
    if (!tipTouched.current || status !== "OPEN") return;
    const timer = window.setTimeout(() => {
      void updateChargeTip(code, tip || "0")
        .then(() => setTipError(null))
        .catch((error: unknown) =>
          setTipError(error instanceof Error ? error.message : "Could not save the tip."),
        );
    }, 600);
    return () => window.clearTimeout(timer);
  }, [code, status, tip]);

  const onSettled = useCallback(
    (next: PublicChargePayload, txHash: string) => {
      applyPayload(next);
      if (!tracked.current) {
        tracked.current = true;
        trackTractionEvent({
          amount: next.charge.amountReceived,
          currency: next.charge.currency,
          eventType: "payment_submitted",
          metadata: { kind: next.charge.kind, method: "wallet" },
          source: "checkout",
          txHash,
        });
      }
    },
    [applyPayload],
  );

  if (loadError) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <div className="flex items-center gap-3">
          <PayerBackButton />
          <PlatformBrand />
        </div>
        <h1 className="mt-6 font-heading text-3xl">
          {code.startsWith("cs_") ? "Checkout not found" : "Charge not found"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading payment…
      </main>
    );
  }

  const { business, charge } = payload;
  // A checkout a website started (kind ONLINE): no tip, back to the store after.
  const online = charge.online;
  const received = moneyNumber(charge.amountReceived);
  const remainingBase = Math.max(0, moneyNumber(charge.amount) - received);
  // A partly-paid charge asks only for the rest; the tip rides on top.
  const total = roundMoney(remainingBase + moneyNumber(tip || "0"));
  // Circle Onramp delivers USDC only.
  const methods: Array<{ icon: typeof Wallet; id: Method; label: string }> = [
    { icon: Wallet, id: "wallet", label: "Any wallet" },
    { icon: Store, id: "saphra", label: "SaphraONE" },
    ...(onrampEnabled && charge.currency === "USDC"
      ? [{ icon: CreditCard, id: "card" as const, label: "Card or bank" }]
      : []),
    // Circle's cross-chain transfer moves USDC only.
    ...(charge.currency === "USDC"
      ? [{ icon: Link2, id: "chain" as const, label: "Other chain" }]
      : []),
  ];
  const slowPaymentPending =
    charge.pendingMethod === "ONRAMP" || charge.pendingMethod === "BRIDGE";

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-4 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <PayerBackButton />
            <PlatformBrand />
          </div>
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Secure payment
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-6 sm:py-10">
        <section className="section-panel space-y-5 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            {business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="h-12 w-12 rounded-xl border border-border object-cover"
                src={business.logoUrl}
              />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <Store className="h-6 w-6" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold">{business.name}</p>
              {business.username ? (
                <p className="truncate text-sm text-muted-foreground">
                  {business.username}.one
                  {online?.siteHost ? ` · ${online.siteHost}` : ""}
                </p>
              ) : online?.siteHost ? (
                <p className="truncate text-sm text-muted-foreground">{online.siteHost}</p>
              ) : null}
            </div>
          </div>

          {charge.status === "PAID" ? (
            <>
              <ChargeReceiptCard payload={payload} />
              {online ? <OnlineReturnToStore online={online} /> : null}
            </>
          ) : charge.status === "CANCELLED" || charge.status === "EXPIRED" ? (
            <div className="space-y-2">
              <p className="font-heading text-2xl">
                {charge.status === "CANCELLED" ? "Cancelled" : "Expired"}
              </p>
              <p className="text-sm text-muted-foreground">
                {online
                  ? `This checkout can\u2019t be paid any more. Go back to ${online.siteHost || business.name} to start again.`
                  : `This charge can\u2019t be paid any more. Ask ${business.name} for a new one.`}
              </p>
              {online && storeHomeUrl(online) ? (
                <Button asChild className="mt-2 w-full" variant="outline">
                  <a href={storeHomeUrl(online) ?? undefined}>Back to {online.siteHost || business.name}</a>
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {received > 0 ? "Left to pay" : "Amount due"}
                </p>
                <p className="mt-1 font-heading text-5xl tabular-nums">
                  {formatMoney(total, charge.currency)}
                </p>
                {received > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Received {formatMoney(received, charge.currency)} of{" "}
                    {formatMoney(charge.amount, charge.currency)}
                  </p>
                ) : moneyNumber(tip || "0") > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatMoney(charge.amount, charge.currency)} +{" "}
                    {formatMoney(tip, charge.currency)} tip
                  </p>
                ) : null}
                {charge.note ? <p className="mt-2 text-sm">{charge.note}</p> : null}
              </div>

              {online ? (
                <OnlineOrderSummary currency={charge.currency} expiresAt={charge.expiresAt} online={online} />
              ) : (
                <>
                  <TipPicker
                    amount={charge.amount}
                    currency={charge.currency}
                    onChange={(next) => {
                      tipTouched.current = true;
                      setTip(next);
                    }}
                    value={tip}
                  />
                  {tipError ? <p className="text-sm text-destructive">{tipError}</p> : null}
                </>
              )}

              {slowPaymentPending && method !== "card" ? (
                <p className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  A {charge.pendingMethod === "ONRAMP" ? "card or bank" : "cross-chain"} payment for
                  this charge may be on its way. If you already paid, wait for this page to update
                  instead of paying again.
                </p>
              ) : null}

              <div
                className={cn(
                  "grid gap-1 rounded-xl bg-muted/60 p-1 text-sm font-medium",
                  methods.length === 3 ? "grid-cols-3" : "grid-cols-2",
                )}
              >
                {methods.map((option) => (
                  <button
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition-colors",
                      method === option.id
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    key={option.id}
                    onClick={() => setMethod(option.id)}
                    type="button"
                  >
                    <option.icon className="h-4 w-4" />
                    {option.label}
                  </button>
                ))}
              </div>

              {method === "wallet" ? (
                <PayWithWallet onSettled={onSettled} payload={payload} total={total} />
              ) : method === "card" ? (
                <PayWithOnramp onUpdate={applyPayload} payload={payload} total={total} />
              ) : method === "chain" ? (
                <PayWithBridge onUpdate={applyPayload} payload={payload} total={total} />
              ) : (
                <PayWithSaphra payload={payload} total={total} />
              )}

              {online ? (
                <div className="text-center">
                  <OnlineCancelLink online={online} />
                </div>
              ) : null}
            </>
          )}
        </section>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Payments settle on Arc in seconds.{" "}
          <a className="font-medium text-primary hover:underline" href="/">
            Get SaphraONE
          </a>
        </p>
      </div>
    </main>
  );
}
