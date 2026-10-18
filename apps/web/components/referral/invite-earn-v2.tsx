"use client";

import { ArrowLeft, Check, Copy, Gift, Loader2, Percent, Share2, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";

import { PartnerDashboard } from "@/components/referral/partner-dashboard";
import { ShareModal } from "@/components/referral/share-modal";
import { showSuccess } from "@/components/success-popup";
import { arcChain } from "@/lib/chains";
import { readActivatedExternalProfile } from "@/lib/platform-access";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

import "./invite-earn.css";

type TierRow = {
  activeMinTransactions: number;
  commissionBps: number;
  minActiveReferrals: number;
  minMonthlyVolumeUsd: number;
  sort: number;
  tier: string;
};

type EarningsData = {
  accruedUsdc: number;
  activeReferrals: number;
  claimedUsdc: number;
  heldUsdc: number;
  minClaimUsdc: number;
  monthlyVolumeUsd: number;
  nextTier: TierRow | null;
  policy: TierRow[];
  recent: Array<{ amountUsdc: number; createdAt: string; referredWallet: string; source: string; status: string }>;
  referralCode: string;
  referralLink: string;
  tier: TierRow;
  totalReferrals: number;
};

const tierNames: Record<string, string> = {
  AMBASSADOR: "Ambassador",
  ARCHITECT: "Architect",
  BUILDER: "Builder",
  STARTER: "Starter",
};

function usd(value: number, digits = 2) {
  // The minimum can't exceed the maximum: usd(500, 0) threw a RangeError.
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) })}`;
}

function percent(bps: number) {
  return `${bps / 100}%`;
}

function short(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

/** Invite & Earn v2: a share of your referrals' fees, in USDC. */
export function InviteEarnV2() {
  const { address: platformAddress, circleSocialUuid } = usePlatformWallet();
  const { address: wagmiAddress } = useAccount();
  const [externalProfile, setExternalProfile] = useState("");
  useEffect(() => setExternalProfile(readActivatedExternalProfile()), []);
  const wallet =
    platformAddress || wagmiAddress || (externalProfile && isAddress(externalProfile) ? externalProfile : undefined);

  const [data, setData] = useState<EarningsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!wallet) {
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({ ownerWallet: wallet });
      if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);
      const response = await fetch(`/api/referrals/earnings?${params}`, { cache: "no-store" });
      const json = (await response.json()) as EarningsData & { message?: string };
      if (!response.ok) throw new Error(json.message || "Could not load your earnings.");
      setData(json);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your earnings.");
    } finally {
      setLoading(false);
    }
  }, [circleSocialUuid, wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim() {
    if (!wallet || !data) return;
    setClaiming(true);
    setError(null);
    try {
      const response = await fetch("/api/referrals/earnings", {
        body: JSON.stringify({ circleSocialUuid, ownerWallet: wallet }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await response.json()) as {
        amountUsdc?: number;
        message?: string;
        review?: boolean;
        txHash?: string | null;
      };
      if (!response.ok) throw new Error(json.message || "The claim could not be paid.");
      await load();
      showSuccess({
        amount: `${(json.amountUsdc ?? data.accruedUsdc).toFixed(2)} USDC`,
        eyebrow: "Invite & Earn",
        explorerUrl: json.txHash ? `${arcChain.blockExplorers.default.url}/tx/${json.txHash}` : undefined,
        subtitle: json.review
          ? "It's a large payout, so our team checks it first. It arrives once approved."
          : "Your referral earnings are in your wallet.",
        title: json.review ? "Claim received" : "Earnings claimed",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The claim could not be paid.");
    } finally {
      setClaiming(false);
    }
  }

  async function copyCode() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.referralCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the code is on screen to copy by hand.
    }
  }

  if (loading) {
    return (
      <div className="ie-page ie-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!wallet) return <div className="ie-page ie-center ie-muted">Sign in to invite friends.</div>;
  if (!data) return <div className="ie-page ie-center ie-muted">{error ?? "Could not load your earnings."}</div>;

  const topRate = Math.max(...data.policy.map((row) => row.commissionBps));
  const canClaim = data.accruedUsdc >= data.minClaimUsdc;

  return (
    <div className="ie-page">
      <header className="ie-bar">
        <Link aria-label="Back to the dashboard" className="ie-round" href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </header>

      {/* Two columns on a desktop (components/layout/windows-shell.css);
          on a phone the wrappers vanish and the cards keep this order. */}
      <div className="ie-col ie-col-main">
        <h1 className="ie-title">Invite friends &amp; earn up to {percent(topRate)} of their fees</h1>

        {/* Code */}
        <section className="ie-code-card">
          <span className="ie-code-label">Your referral code</span>
          <span className="ie-code">{data.referralCode}</span>
        </section>
        <button className="ie-copy" onClick={() => void copyCode()} type="button">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy code"}
        </button>

        {/* Rewards and referrals */}
        <section className="ie-stats">
          <div>
            <span>Rewards</span>
            <strong>{usd(data.accruedUsdc)} USDC</strong>
            <button className="ie-claim" disabled={!canClaim || claiming} onClick={() => void claim()} type="button">
              {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Claim"}
            </button>
            {!canClaim ? <em>Claim from {usd(data.minClaimUsdc)}</em> : null}
          </div>
          <div>
            <span>Referrals</span>
            <strong>
              {data.activeReferrals}/{data.totalReferrals}
            </strong>
            <em>active · total</em>
          </div>
        </section>
        {data.heldUsdc > 0 ? (
          <p className="ie-note">{usd(data.heldUsdc)} is held while we review some referral activity.</p>
        ) : null}
        {error ? <p className="ie-error">{error}</p> : null}
      </div>

      <div className="ie-col ie-col-side">
        {/* Creator partners: their offer links and what they brought in */}
        <PartnerDashboard circleSocialUuid={circleSocialUuid} wallet={wallet} />

        {/* How it works */}
        <section className="ie-card">
          <ul className="ie-steps">
            <li>
              <span>
                <Users className="h-4 w-4" />
              </span>
              <p>
                <strong>Refer friends to SaphraONE</strong> and earn on the service fees they pay.
              </p>
            </li>
            <li>
              <span>
                <Percent className="h-4 w-4" />
              </span>
              <p>
                <strong>Earn {percent(data.tier.commissionBps)} in USDC</strong> as a {tierNames[data.tier.tier] ?? data.tier.tier},
                rising to {percent(topRate)} as your referrals grow.
              </p>
            </li>
            <li>
              <span>
                <Gift className="h-4 w-4" />
              </span>
              <p>
                <strong>Claim to your wallet</strong> once you&apos;ve earned {usd(data.minClaimUsdc)}. Earnings land after
                each transaction confirms.
              </p>
            </li>
            <li>
              <span>
                <ShieldCheck className="h-4 w-4" />
              </span>
              <p>
                <strong>Direct referrals only.</strong> A referral is active after{" "}
                {data.tier.activeMinTransactions} payments in 30 days.
              </p>
            </li>
          </ul>
        </section>

        {/* Tiers */}
        <section className="ie-card">
          <h2 className="ie-card-title">Your tier</h2>
          <div className="ie-tiers" role="table">
            {[...data.policy]
              .sort((a, b) => a.sort - b.sort)
              .map((row) => (
                <div className={cn("ie-tier", row.tier === data.tier.tier && "is-current")} key={row.tier} role="row">
                  <strong>{tierNames[row.tier] ?? row.tier}</strong>
                  <span>{row.minActiveReferrals ? `${row.minActiveReferrals}+ active` : "Any"}</span>
                  <span>{row.minMonthlyVolumeUsd ? `${usd(row.minMonthlyVolumeUsd, 0)}/mo` : "No minimum"}</span>
                  <em>{percent(row.commissionBps)}</em>
                </div>
              ))}
          </div>
          {data.nextTier ? (
            <p className="ie-note">
              Next: {tierNames[data.nextTier.tier] ?? data.nextTier.tier} at {data.nextTier.minActiveReferrals} active
              referrals and {usd(data.nextTier.minMonthlyVolumeUsd, 0)} monthly volume. You have {data.activeReferrals}{" "}
              and {usd(data.monthlyVolumeUsd, 0)}.
            </p>
          ) : null}
        </section>

        {/* Recent earnings */}
        {data.recent.length > 0 ? (
          <section className="ie-card">
            <h2 className="ie-card-title">Recent earnings</h2>
            <ul className="ie-recent">
              {data.recent.map((row, index) => (
                <li key={`${row.createdAt}-${index}`}>
                  <div>
                    <strong>{short(row.referredWallet)}</strong>
                    <span>
                      {new Date(row.createdAt).toLocaleDateString()} · {row.status.toLowerCase()}
                    </span>
                  </div>
                  <em>+{usd(row.amountUsdc, 6)}</em>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="ie-sticky">
        <ShareModal
          referralLink={data.referralLink}
          referralToken={data.referralCode}
          trigger={
            <button className="ie-invite" type="button">
              <Share2 className="h-4 w-4" />
              Invite friends
            </button>
          }
        />
      </div>
    </div>
  );
}
