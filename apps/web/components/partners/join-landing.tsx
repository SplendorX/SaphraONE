"use client";

import { ArrowRight, BadgePercent, Bot, Coins, Gift, Rocket, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { PlatformBrand } from "@/components/brand/platform-brand";
import { Button } from "@/components/ui/button";
import { PARTNER_OFFER_COOKIE } from "@/lib/partners/config";
import type { PublicOffer } from "@/lib/partners/offer-view";

const perkIcons: Record<string, LucideIcon> = {
  ALLIE_PRO_TRIAL: Bot,
  CASHBACK_BOOST: Rocket,
  FEE_REBATE: BadgePercent,
  PREMIUM_DISCOUNT: Sparkles,
  WELCOME_POINTS: Coins,
};

/** 30 days, like a /r/<username> referral. */
const cookieMaxAge = 2_592_000;

function remember(referralCode: string, offerCode: string) {
  try {
    // The sign-in screen's referral field reads this (components/landing/referral-code-field.tsx).
    window.localStorage.setItem("saphra_referral_token", referralCode);
  } catch {
    // Storage blocked (private mode): the cookies below still carry it.
  }
  document.cookie = `saphra_referral_token=${encodeURIComponent(referralCode)}; path=/; max-age=${cookieMaxAge}; SameSite=Lax`;
  document.cookie = `${PARTNER_OFFER_COOKIE}=${encodeURIComponent(offerCode)}; path=/; max-age=${cookieMaxAge}; SameSite=Lax`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The /join/<code> page: counts the visit, keeps the partner's referral and
 * the offer for sign-up, and shows the welcome package.
 */
export function JoinLanding({ offer }: { offer: PublicOffer }) {
  useEffect(() => {
    let active = true;
    fetch("/api/partners/click", {
      body: JSON.stringify({ code: offer.code }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { referralCode?: string } | null) => {
        if (active && payload?.referralCode) remember(payload.referralCode, offer.code);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [offer.code]);

  const { partner } = offer;
  const ends = offer.endsAt
    ? new Date(offer.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" })
    : null;

  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-b from-primary/5 via-background to-background p-4 sm:p-6">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between py-3">
        <Link aria-label="SaphraONE home" href="/">
          <PlatformBrand />
        </Link>
        <Link href="/dashboard">
          <Button className="text-xs font-semibold" size="sm" variant="ghost">
            Sign in
          </Button>
        </Link>
      </header>

      <div className="mx-auto my-auto w-full max-w-xl space-y-7 py-8 text-center">
        <div className="flex flex-col items-center gap-3">
          {partner.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="h-20 w-20 rounded-full border-4 border-background object-cover shadow-lg"
              height={80}
              src={partner.avatarUrl}
              width={80}
            />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-2xl font-black text-primary-foreground shadow-lg">
              {initials(partner.displayName)}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
            <Gift className="h-3.5 w-3.5" />
            {partner.handle ? `@${partner.handle}` : partner.displayName} partner offer
          </span>
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-black leading-tight tracking-tight text-foreground sm:text-4xl">
            {partner.displayName} invites you to SaphraONE
          </h1>
          <p className="mx-auto max-w-md text-base text-muted-foreground">
            {offer.headline || "One account for sending, receiving and growing your money in USDC."}
          </p>
        </div>

        {offer.unavailable ? (
          <div className="rounded-2xl border bg-card/70 p-5 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">{offer.unavailable}</p>
            <p className="mt-1">You can still create a free account and use everything SaphraONE offers.</p>
          </div>
        ) : (
          <section className="space-y-3 rounded-2xl border-2 border-primary/25 bg-card/80 p-5 text-left shadow-sm sm:p-6">
            <h2 className="text-sm font-bold uppercase tracking-widest text-primary">Your welcome package</h2>
            <ul className="space-y-3">
              {offer.perks.map((perk) => {
                const Icon = perkIcons[perk.kind] ?? Gift;
                return (
                  <li className="flex items-start gap-3" key={perk.kind}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-4.5 w-4.5" />
                    </span>
                    <span className="space-y-0.5">
                      <span className="block text-sm font-semibold text-foreground">{perk.name}</span>
                      <span className="block text-sm text-muted-foreground">{perk.summary}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              For new personal accounts{ends ? ` created by ${ends}` : ""}.{" "}
              <Link className="font-semibold text-primary underline-offset-4 hover:underline" href={`/join/${offer.code}/terms`}>
                Offer terms
              </Link>
            </p>
          </section>
        )}

        <div className="space-y-2">
          <Link href="/dashboard">
            <Button className="h-12 w-full gap-2 text-base font-bold shadow-md sm:w-auto sm:min-w-[280px]" size="lg">
              {offer.unavailable ? "Create your account" : "Claim your welcome package"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground">Free to open · ready in under a minute</p>
        </div>
      </div>

      <footer className="mx-auto w-full max-w-3xl border-t border-border/40 py-4 text-center text-xs text-muted-foreground">
        {partner.displayName} is a SaphraONE partner and may be paid for sharing this link.
      </footer>
    </main>
  );
}
