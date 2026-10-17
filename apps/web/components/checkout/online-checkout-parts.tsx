"use client";

import { ArrowLeft, ArrowRight, Clock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatMoney, moneyNumber } from "@/lib/account/money";
import type { ChargeCurrency, PublicOnlineSession } from "@/lib/checkout/types";

const REDIRECT_DELAY_MS = 3_000;

/** Where "back to the store" goes when the site gave no cancel URL. */
export function storeHomeUrl(online: PublicOnlineSession) {
  if (online.cancelUrl) return online.cancelUrl;
  try {
    return new URL(online.successUrl).origin;
  } catch {
    return null;
  }
}

function minutesLeft(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 60_000)) : null;
}

/** What the buyer is paying for, and how long the checkout stays open. */
export function OnlineOrderSummary({
  currency,
  expiresAt,
  online,
}: {
  currency: ChargeCurrency;
  expiresAt: string;
  online: PublicOnlineSession;
}) {
  const [left, setLeft] = useState(() => minutesLeft(expiresAt));

  useEffect(() => {
    const timer = window.setInterval(() => setLeft(minutesLeft(expiresAt)), 30_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return (
    <div className="space-y-3">
      {online.lineItems.length > 0 ? (
        <ul className="divide-y divide-border/70 rounded-xl border border-border/70 text-sm">
          {online.lineItems.map((item, index) => (
            <li className="flex items-baseline justify-between gap-3 px-3 py-2" key={`${item.name}-${index}`}>
              <span className="min-w-0 truncate">
                {item.quantity > 1 ? <span className="text-muted-foreground">{item.quantity} × </span> : null}
                {item.name}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatMoney(moneyNumber(item.unit_amount) * item.quantity, currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {left !== null && left <= 24 * 60 ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          {left <= 1 ? "Expires in under a minute" : `Expires in ${left} min`}
        </p>
      ) : null}
    </div>
  );
}

/** "Cancel and return to shop.example", shown while the checkout is open. */
export function OnlineCancelLink({ online }: { online: PublicOnlineSession }) {
  const href = storeHomeUrl(online);
  if (!href) return null;
  return (
    <a
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      href={href}
    >
      <ArrowLeft className="h-4 w-4" />
      Cancel and return to {online.siteHost || "the store"}
    </a>
  );
}

/** Once paid: back to the store's success page, automatically after a moment. */
export function OnlineReturnToStore({ online }: { online: PublicOnlineSession }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.location.assign(online.successUrl), REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [online.successUrl]);

  return (
    <div className="space-y-2 text-center">
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Taking you back to {online.siteHost || "the store"}…
      </p>
      <Button asChild className="h-12 w-full text-base">
        <a href={online.successUrl}>
          Return to {online.siteHost || "the store"}
          <ArrowRight className="h-4 w-4" />
        </a>
      </Button>
    </div>
  );
}
