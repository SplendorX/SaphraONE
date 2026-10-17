"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Coins, Gift, Loader2, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { PlatformBrand } from "@/components/brand/platform-brand";
import { Button } from "@/components/ui/button";
import { rewardsV2Enabled } from "@/lib/rewards/config";

export default function ReferralLandingPage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const rawIdentifier = decodeURIComponent(params.username ?? "").replace(/^@/, "").replace(/\.one$/i, "");

  const [loading, setLoading] = useState(true);
  const [resolvedUsername, setResolvedUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!rawIdentifier) {
      setLoading(false);
      return;
    }

    // Track visitor click & resolve referrer
    async function trackClick() {
      try {
        const res = await fetch("/api/referrals/track-click", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identifier: rawIdentifier,
            referralToken: rawIdentifier,
            metadata: {
              source: "landing_page",
              path: `/r/${rawIdentifier}`,
              timestamp: new Date().toISOString(),
            },
          }),
        });

        const json = await res.json();
        if (res.ok) {
          const token = json.referralToken || rawIdentifier;
          const wallet = json.referrerWallet;
          const username = json.referrerUsername || json.resolvedUsername || rawIdentifier;

          setResolvedUsername(username);

          // Store in localStorage & cookies for signup attribution
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem("saphra_referral_token", token);
              if (wallet) {
                window.localStorage.setItem("saphra_referrer_wallet", wallet);
              }
              // Set cookie valid for 30 days
              document.cookie = `saphra_referral_token=${encodeURIComponent(
                token,
              )}; path=/; max-age=2592000; SameSite=Lax`;
            } catch {
              // Ignore storage errors in incognito
            }
          }
        } else {
          setResolvedUsername(rawIdentifier);
        }
      } catch {
        setResolvedUsername(rawIdentifier);
      } finally {
        setLoading(false);
      }
    }

    void trackClick();
  }, [rawIdentifier]);

  const handleGetStarted = () => {
    router.push("/dashboard");
  };

  const displayName = resolvedUsername || rawIdentifier;

  return (
    <main className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Brand Header */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-4">
        <Link href="/" aria-label="SaphraONE home" className="flex items-center">
          <PlatformBrand />
        </Link>

        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="text-xs font-semibold">
            Already have an account? Sign In
          </Button>
        </Link>
      </header>

      {/* Hero Invitation Card */}
      <div className="max-w-2xl w-full mx-auto my-auto py-10 text-center space-y-8">
        {loading ? (
          <div className="py-24 space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-xs text-muted-foreground">Preparing your exclusive invitation…</p>
          </div>
        ) : (
          <>
            {/* Invite Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary shadow-sm">
              <Gift className="h-4 w-4" />
              Exclusive Referral Invitation
            </div>

            {/* Main Headline */}
            <div className="space-y-3">
              <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-foreground leading-tight">
                You’re invited to SaphraONE by{" "}
                <span className="text-primary underline decoration-primary/40 underline-offset-8">
                  @{displayName}
                </span>
              </h1>
              <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto">
                Join the future of frictionless money. Experience instant, zero-fee USDC payments, automated yield strategies, and global business tools.
              </p>
            </div>

            {rewardsV2Enabled() ? (
              // Rewards v2 has no welcome bonus: new members earn ONE Points
              // on their own payments and streaks (REWARDS-PLAN.md).
              <div className="rounded-2xl border-2 border-primary/25 bg-primary/5 p-6 sm:p-7 shadow-sm text-left">
                <div className="flex items-center gap-2 font-bold text-base sm:text-lg text-foreground">
                  <Coins className="h-5 w-5 text-primary" />
                  Earn ONE Points as you pay
                </div>
                <p className="mt-1 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Every eligible payment earns ONE Points, plus bonuses for daily streaks. Use
                  them for discounts on premium features like ALLIE Pro and automations.
                </p>
              </div>
            ) : (
              <>
              {/* Welcome Reward Highlight Box */}
              <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/10 p-6 sm:p-7 shadow-sm text-left relative overflow-hidden">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-base sm:text-lg">
                      <Coins className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      20 ONE Points Welcome Reward
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      Automatically credited once your payments add up to 250+ USDC.
                    </p>
                  </div>
                  <div className="shrink-0 rounded-xl bg-background/90 px-4 py-2 text-center border shadow-xs">
                    <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono">
                      +0.20 USDC
                    </div>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase">
                      Free Bonus
                    </div>
                  </div>
                </div>
              </div>

              {/* General Cashback Notice for New Users */}
              <div className="rounded-xl border border-primary/25 bg-card/70 p-4 text-left shadow-xs flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                  <Coins className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-bold text-foreground">
                    Everyday Transaction Cashback on All Sends
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Earn automatic ONE Points cashback on every platform send or payment from 20 USDC/EURC up:{" "}
                    <strong className="text-foreground">1 pt (20+)</strong>,{" "}
                    <strong className="text-foreground">5 pts (100+)</strong>,{" "}
                    <strong className="text-foreground">20 pts (500+)</strong>, and{" "}
                    <strong className="text-foreground">50 pts (1,000+ USDC/EURC)</strong>.
                  </p>
                </div>
              </div>
              </>
            )}

            {/* Features Checklist */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
              <div className="rounded-xl border bg-card/60 p-4 space-y-1.5 shadow-xs">
                <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Zero Gas Fees
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Send USDC instantly worldwide with zero network gas fees.
                </p>
              </div>

              <div className="rounded-xl border bg-card/60 p-4 space-y-1.5 shadow-xs">
                <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                  Automated Yield
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Earn competitive yield on your balance with Circle Smart vaults.
                </p>
              </div>

              <div className="rounded-xl border bg-card/60 p-4 space-y-1.5 shadow-xs">
                <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                  <ShieldCheck className="h-4 w-4 text-blue-500" />
                  Self-Custody & Safe
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Secured by biometric passkeys and multi-party computation.
                </p>
              </div>
            </div>

            {/* CTA Button */}
            <div className="pt-4 space-y-3">
              <Button
                size="lg"
                onClick={handleGetStarted}
                className="w-full sm:w-auto min-w-[280px] h-12 text-base font-bold gap-2 shadow-md hover:shadow-lg transition-all"
              >
                {rewardsV2Enabled() ? "Get started" : "Claim 20 ONE Points & Get Started"}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <p className="text-xs text-muted-foreground">
                No credit card required • Instant setup in 30 seconds
              </p>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="max-w-5xl w-full mx-auto py-4 text-center text-xs text-muted-foreground border-t border-border/40">
        © {new Date().getFullYear()} SaphraONE. All rights reserved. Universal Referral Network.
      </footer>
    </main>
  );
}
