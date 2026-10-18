"use client";

import { ArrowRight, Loader2, Lock, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { PlatformBrand } from "@/components/brand/platform-brand";
import { PayerBackButton } from "@/components/checkout/payer-back-button";
import { AmountKeypad } from "@/components/checkout/amount-keypad";
import { TipPicker } from "@/components/checkout/tip-picker";
import { Button } from "@/components/ui/button";
import { moneyNumber } from "@/lib/account/money";
import { createStorefrontChargeClient, fetchPublicStorefront } from "@/lib/checkout/client";
import { CHARGE_MAX_AMOUNT, CHARGE_MIN_AMOUNT } from "@/lib/checkout/money-rules";
import type { PublicStorefrontPayload } from "@/lib/checkout/types";
import "@/components/layout/windows-surfaces.css";

/** A business's permanent pay page: the customer types the amount. */
export function StorefrontPage({ username }: { username: string }) {
  const router = useRouter();
  const [storefront, setStorefront] = useState<PublicStorefrontPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [tip, setTip] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicStorefront(username)
      .then((next) => {
        if (!cancelled) setStorefront(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Business not found.");
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loadError) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <div className="flex items-center gap-3">
          <PayerBackButton />
          <PlatformBrand />
        </div>
        <h1 className="mt-6 font-heading text-3xl">Business not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
      </main>
    );
  }

  if (!storefront) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </main>
    );
  }

  const { business, currency } = storefront;
  const value = moneyNumber(amount || "0");
  const tooSmall = value > 0 && value < CHARGE_MIN_AMOUNT;
  const tooLarge = value > CHARGE_MAX_AMOUNT.STOREFRONT;

  async function proceed() {
    setError(null);
    setSubmitting(true);
    try {
      const { code } = await createStorefrontChargeClient(username, {
        amount,
        currency,
        tip: tip || "0",
      });
      router.push(`/c/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the payment.");
      setSubmitting(false);
    }
  }

  return (
    <main className="win-surface win-pay min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="win-pay-bar mx-auto flex max-w-lg items-center justify-between gap-4 px-4 py-4">
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

      <div className="win-pay-body mx-auto max-w-lg px-4 py-6 sm:py-10">
        <section className="win-pay-panel section-panel space-y-5 p-5 sm:p-6">
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
              <p className="truncate font-semibold">Pay {business.name}</p>
              <p className="text-sm text-muted-foreground">Enter the amount you were asked for</p>
            </div>
          </div>

          <AmountKeypad currency={currency} disabled={submitting} onChange={setAmount} value={amount} />

          {value >= CHARGE_MIN_AMOUNT && !tooLarge ? (
            <TipPicker amount={amount} currency={currency} disabled={submitting} onChange={setTip} value={tip} />
          ) : null}

          {tooSmall ? (
            <p className="text-sm text-destructive">The smallest payment is {CHARGE_MIN_AMOUNT.toFixed(2)}.</p>
          ) : tooLarge ? (
            <p className="text-sm text-destructive">
              The largest payment here is {CHARGE_MAX_AMOUNT.STOREFRONT.toLocaleString("en-US")}.
            </p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Button
            className="h-12 w-full text-base"
            disabled={submitting || value < CHARGE_MIN_AMOUNT || tooLarge}
            onClick={() => void proceed()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continue
            {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
          </Button>
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
