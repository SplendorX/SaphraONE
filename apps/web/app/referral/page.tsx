"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { readActivatedExternalProfile } from "@/lib/platform-access";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Award,
  Check,
  Coins,
  Copy,
  Gift,
  HandCoins,
  History,
  Info,
  Loader2,
  RefreshCw,
  Share2,
  ShoppingCart,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { Button } from "@/components/ui/button";
import { ShareModal } from "@/components/referral/share-modal";
import { RedeemModal } from "@/components/referral/redeem-modal";
import { BuyPointsModal } from "@/components/referral/buy-points-modal";
import { GiftPointsModal } from "@/components/referral/gift-points-modal";
import { ReferralIllustration } from "@/components/referral/referral-illustration";
import { TierBadge } from "@/components/referral/tier-badge";
import { TierProgressCard } from "@/components/referral/tier-progress-card";
import { ReferralBenefitsTable } from "@/components/referral/referral-benefits-table";
import { ReferralProgressList } from "@/components/referral/referral-progress-list";
import type { ReferralDashboardData, OnePointsLedgerEntry } from "@/lib/referral/types";

import { rewardsV2Enabled } from "@/lib/rewards/config";
import { InviteEarnV2 } from "@/components/referral/invite-earn-v2";
import "./referral.css";

type Tab = "referrals" | "ledger" | "ladder";

function cashbackFor(tier: ReferralDashboardData["currentTier"]) {
  return tier === "STARTER"
    ? "0.2 pts per transaction over 10 USDC"
    : tier === "BUILDER"
      ? "0.3 pts per transaction over 10 USDC"
      : tier === "ARCHITECT"
        ? "0.5 pts per transaction over 10 USDC"
        : "1.0 pt per transaction over 10 USDC";
}

/** Invite & Earn v2 (USDC); the points version only when NEXT_PUBLIC_REWARDS_V2=false. */
export default function ReferralRoute() {
  if (!rewardsV2Enabled()) return <ReferralPage />;
  return (
    <PlatformChrome
      actions={<PlatformProfileControls />}
      // The page draws its own bar with a back button.
      hideHeader
      subtitle="Earn USDC on your referrals' fees"
      title="Invite & Earn"
    >
      <PlatformAccessGate>
        <InviteEarnV2 />
      </PlatformAccessGate>
    </PlatformChrome>
  );
}

function ReferralPage() {
  const {
    address: platformAddress,
    circleSocialUuid,
  } = usePlatformWallet();
  const { address: wagmiAddress } = useAccount();
  const [activatedExternalAddress, setActivatedExternalAddress] = useState("");

  useEffect(() => {
    setActivatedExternalAddress(readActivatedExternalProfile());
  }, []);

  const activeWallet =
    platformAddress ||
    wagmiAddress ||
    (activatedExternalAddress && isAddress(activatedExternalAddress)
      ? activatedExternalAddress
      : undefined);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<ReferralDashboardData | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<OnePointsLedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("referrals");
  const [linkCopied, setLinkCopied] = useState(false);
  // The intro shows until the first referral, like RecurePay's; "How it works" reopens it.
  const [showIntro, setShowIntro] = useState<boolean | null>(null);

  const fetchDashboard = useCallback(
    async (quiet = false) => {
      if (!activeWallet) {
        setLoading(false);
        return;
      }

      if (!quiet) setLoading(true);
      else setRefreshing(true);

      try {
        const params = new URLSearchParams({ ownerWallet: activeWallet });
        if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);

        const res = await fetch(`/api/referrals/dashboard?${params.toString()}`);
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.message || json.error || "Failed to load referral data.");
        }

        const dashboardData = (json.data ?? json) as ReferralDashboardData;
        setData(dashboardData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error loading referrals.";
        if (!quiet) toast.error(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeWallet, circleSocialUuid],
  );

  const fetchLedger = useCallback(async () => {
    if (!activeWallet) return;
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams({
        ownerWallet: activeWallet,
        pageSize: "50",
      });
      if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);

      const res = await fetch(`/api/one-points/ledger?${params.toString()}`);
      const json = await res.json();
      if (res.ok) {
        setLedgerEntries(json.entries || []);
      }
    } catch {
      // quiet fallback
    } finally {
      setLedgerLoading(false);
    }
  }, [activeWallet, circleSocialUuid]);

  useEffect(() => {
    if (activeWallet) {
      void fetchDashboard();
      void fetchLedger();
    } else {
      setLoading(false);
      setData(null);
    }
  }, [activeWallet, fetchDashboard, fetchLedger]);

  // Decide once, when the first data arrives.
  useEffect(() => {
    if (data && showIntro === null) {
      setShowIntro(data.activity.length === 0 && data.totalSuccessfulReferrals === 0);
    }
  }, [data, showIntro]);

  const handleCopyLink = async () => {
    if (!data?.referralLink) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setLinkCopied(true);
      toast.success("Referral link copied!");
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  };

  const refreshAll = () => {
    void fetchDashboard(true);
    void fetchLedger();
  };

  const bar = (
    <header className="ref-bar">
      {showIntro && data && (data.activity.length > 0 || data.totalSuccessfulReferrals > 0) ? (
        <button aria-label="Back" className="ref-round" onClick={() => setShowIntro(false)} type="button">
          <ArrowLeft className="h-5 w-5" />
        </button>
      ) : (
        <Link aria-label="Back to the dashboard" className="ref-round" href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <h1 className="ref-title">Invite &amp; Earn</h1>
      {data && !showIntro ? (
        <button
          aria-label="Refresh"
          className="ref-round"
          disabled={refreshing}
          onClick={refreshAll}
          title="Refresh"
          type="button"
        >
          <RefreshCw className={refreshing ? "h-5 w-5 animate-spin" : "h-5 w-5"} />
        </button>
      ) : (
        <span />
      )}
    </header>
  );

  return (
    <PlatformChrome
      title="Invite & Earn"
      subtitle="Invite friends & businesses to earn OnePoints and ongoing cashback"
      actions={<PlatformProfileControls />}
      // The page draws its own bar with a back button.
      hideHeader
    >
      <PlatformAccessGate>
        <div className="ref-page">
          {bar}

          {loading ? (
            <div className="ref-loading">
              <Loader2 className="h-6 w-6 animate-spin" />
              Loading Invite &amp; Earn…
            </div>
          ) : !activeWallet ? (
            <div className="ref-empty">
              <Gift className="h-9 w-9" />
              <p className="ref-empty-title">Connect your wallet</p>
              <p>Connect your account to get your invite link, tier progress and OnePoints balance.</p>
            </div>
          ) : !data ? (
            <div className="ref-empty">
              <Gift className="h-9 w-9" />
              <p className="ref-empty-title">Couldn&apos;t load Invite &amp; Earn</p>
              <p>Check your connection and try again.</p>
              <Button className="mt-2 h-11" onClick={() => void fetchDashboard()} variant="outline">
                <RefreshCw className="h-4 w-4" /> Retry
              </Button>
            </div>
          ) : showIntro ? (
            // ── Intro: what it is and the way in ──────────────────────────
            <div className="ref-intro">
              <ReferralIllustration className="ref-illustration" />
              <h2 className="ref-intro-title">Invite friends. Earn together.</h2>
              <p className="ref-intro-body">
                Share your link. When a friend or business joins SaphraONE and qualifies, you both earn OnePoints
                you can redeem for USDC, and you keep earning cashback on their activity.
              </p>
              <ul className="ref-intro-points">
                <li>
                  <Gift className="h-4 w-4" /> Up to 100 OnePoints per personal referral, 200 per business
                </li>
                <li>
                  <Users className="h-4 w-4" /> Your friend gets 20 OnePoints when they qualify
                </li>
                <li>
                  <Zap className="h-4 w-4" /> Ongoing cashback on their transactions over 10 USDC
                </li>
              </ul>
              <ShareModal
                referralLink={data.referralLink}
                referralToken={data.referralToken}
                trigger={
                  <Button className="ref-cta">
                    <Share2 className="h-4 w-4" />
                    Share your invite link
                  </Button>
                }
              />
              <button className="ref-text-link" onClick={() => setShowIntro(false)} type="button">
                See my OnePoints
              </button>
            </div>
          ) : (
            // ── Dashboard ─────────────────────────────────────────────────
            <>
              <section className="ref-hero">
                <span aria-hidden className="ref-hero-glow" />
                <div className="ref-hero-top">
                  <span className="ref-hero-eyebrow">
                    <Coins className="h-4 w-4" />
                    Available OnePoints
                  </span>
                  <TierBadge className="ref-hero-tier" tier={data.currentTier} />
                </div>
                <p className="ref-hero-amount">{data.onePoints.available.toLocaleString()}</p>
                <p className="ref-hero-sub">
                  ≈ {data.onePoints.usdcEquivalent.toFixed(2)} USDC · 1 point = 0.01 USDC
                </p>
                <div className="ref-hero-actions">
                  {/* Rewards v2: no redeeming or buying; the Rewards page takes over points. */}
                  {rewardsV2Enabled() ? null : (
                  <>
                  <RedeemModal
                    availablePoints={data.onePoints.available}
                    onSuccess={refreshAll}
                    trigger={
                      <button className="ref-hero-action" type="button">
                        <span>
                          <HandCoins className="h-5 w-5" />
                        </span>
                        Redeem
                      </button>
                    }
                    userWallet={activeWallet || ""}
                  />
                  <BuyPointsModal
                    circleSocialUuid={circleSocialUuid}
                    onSuccess={refreshAll}
                    trigger={
                      <button className="ref-hero-action" type="button">
                        <span>
                          <ShoppingCart className="h-5 w-5" />
                        </span>
                        Buy
                      </button>
                    }
                    userWallet={activeWallet || ""}
                  />
                  </>
                  )}
                  <GiftPointsModal
                    availablePoints={data.onePoints.available}
                    circleSocialUuid={circleSocialUuid}
                    onSuccess={refreshAll}
                    trigger={
                      <button className="ref-hero-action" type="button">
                        <span>
                          <Gift className="h-5 w-5" />
                        </span>
                        Gift
                      </button>
                    }
                    userWallet={activeWallet || ""}
                  />
                </div>
              </section>

              <section className="ref-card ref-invite">
                <div className="ref-card-head">
                  <h2>Your invite link</h2>
                  <button className="ref-text-link" onClick={() => setShowIntro(true)} type="button">
                    <Info className="h-3.5 w-3.5" /> How it works
                  </button>
                </div>
                <div className="ref-link">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{data.referralLink}</span>
                  <button className="ref-copy" onClick={() => void handleCopyLink()} type="button">
                    {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {linkCopied ? "Copied" : "Copy"}
                  </button>
                </div>
                <ShareModal
                  referralLink={data.referralLink}
                  referralToken={data.referralToken}
                  trigger={
                    <Button className="ref-cta is-full">
                      <Share2 className="h-4 w-4" />
                      Share invitation
                    </Button>
                  }
                />
              </section>

              <div className="ref-stats">
                <div className="ref-stat">
                  <span className="ref-stat-top">
                    Lifetime earned <TrendingUp className="h-4 w-4" />
                  </span>
                  <span className="ref-stat-value">{data.onePoints.lifetimeEarned.toLocaleString()}</span>
                  <span className="ref-stat-foot">
                    {data.onePoints.redeemed.toLocaleString()} redeemed · {data.onePoints.pending} pending
                  </span>
                </div>
                <div className="ref-stat">
                  <span className="ref-stat-top">
                    Qualified referrals <Users className="h-4 w-4" />
                  </span>
                  <span className="ref-stat-value">{data.totalSuccessfulReferrals}</span>
                  <span className="ref-stat-foot">
                    {data.successfulPersonalReferrals} personal · {data.successfulBusinessReferrals} business ·{" "}
                    {data.metrics.invited} invited
                  </span>
                </div>
                <div className="ref-stat is-wide">
                  <span className="ref-stat-top">
                    Your cashback <Award className="h-4 w-4" />
                  </span>
                  <span className="ref-stat-value is-small">{cashbackFor(data.currentTier)}</span>
                  <span className="ref-stat-foot">On your referrals&apos; activity, at your current tier</span>
                </div>
              </div>

              <TierProgressCard
                currentTier={data.currentTier}
                tierProgress={data.tierProgress}
                totalSuccessfulReferrals={data.totalSuccessfulReferrals}
              />

              <div aria-label="Section" className="ref-segment" role="tablist">
                {(
                  [
                    ["referrals", `Referrals (${data.activity.length})`],
                    ["ledger", "Points history"],
                    ["ladder", "Tiers"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    aria-selected={activeTab === value}
                    key={value}
                    onClick={() => setActiveTab(value)}
                    role="tab"
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === "referrals" ? (
                <section className="ref-card ref-flush">
                  {data.activity.length === 0 ? (
                    <div className="ref-empty is-inline">
                      <Users className="h-8 w-8" />
                      <p className="ref-empty-title">No referrals yet</p>
                      <p>Share your link with friends or business owners to start earning.</p>
                    </div>
                  ) : (
                    <ReferralProgressList referrals={data.activity} tier={data.currentTier} />
                  )}
                </section>
              ) : null}

              {activeTab === "ledger" ? (
                <section className="ref-card">
                  {ledgerLoading ? (
                    <p className="ref-loading is-inline">
                      <Loader2 className="h-5 w-5 animate-spin" /> Loading points history…
                    </p>
                  ) : ledgerEntries.length === 0 ? (
                    <div className="ref-empty is-inline">
                      <History className="h-8 w-8" />
                      <p className="ref-empty-title">No points yet</p>
                      <p>Points you earn, buy, gift and redeem are listed here.</p>
                    </div>
                  ) : (
                    <ul className="ref-ledger">
                      {ledgerEntries.map((entry) => {
                        const isCredit = entry.display_amount > 0;
                        return (
                          <li key={entry.id}>
                            <span className={isCredit ? "ref-ledger-icon is-in" : "ref-ledger-icon"}>
                              {isCredit ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                {entry.description || entry.entry_type.replace(/_/g, " ").toLowerCase()}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {new Date(entry.created_at).toLocaleString(undefined, {
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                  month: "short",
                                })}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className={isCredit ? "ref-ledger-amount is-in" : "ref-ledger-amount"}>
                                {isCredit ? `+${entry.display_amount}` : entry.display_amount} pts
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {Math.abs(entry.usdc_equivalent).toFixed(2)} USDC
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ) : null}

              {activeTab === "ladder" ? <ReferralBenefitsTable currentTier={data.currentTier} /> : null}
            </>
          )}
        </div>
      </PlatformAccessGate>
    </PlatformChrome>
  );
}
