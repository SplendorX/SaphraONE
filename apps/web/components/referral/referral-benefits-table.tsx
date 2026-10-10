"use client";

import { Check, Coins, Layers, Zap } from "lucide-react";
import { TierBadge } from "@/components/referral/tier-badge";
import type { ReferralTier } from "@/lib/referral/types";

interface BenefitsTableProps {
  currentTier?: ReferralTier;
}

const tiersData = [
  {
    tier: "STARTER" as ReferralTier,
    range: "1 – 50",
    personalReward: "20 pts (0.20 USDC)",
    friendReward: "20 pts (0.20 USDC)",
    qualificationCriteria: "250+ USDC in total payments",
    cashback: "0.2 pts / tx > 10 USDC",
    perks: "Standard access",
  },
  {
    tier: "BUILDER" as ReferralTier,
    range: "51 – 200",
    personalReward: "30 pts (0.30 USDC)",
    friendReward: "20 pts (0.20 USDC)",
    qualificationCriteria: "500+ USDC in total payments",
    cashback: "0.3 pts / tx > 10 USDC",
    perks: "Special Profile Badge",
  },
  {
    tier: "ARCHITECT" as ReferralTier,
    range: "201 – 500",
    personalReward: "50 pts (0.50 USDC)",
    friendReward: "20 pts (0.20 USDC)",
    qualificationCriteria: "750+ USDC in total payments",
    cashback: "0.5 pts / tx > 10 USDC",
    perks: "Special Profile Badge + Exclusive Campaigns",
  },
  {
    tier: "AMBASSADOR" as ReferralTier,
    range: "501+",
    personalReward: "100 pts (1.00 USDC)",
    friendReward: "20 pts (0.20 USDC)",
    qualificationCriteria: "1,250+ USDC in total payments",
    cashback: "1.0 pt / tx > 10 USDC",
    perks: "Verified Golden Ambassador Badge + Exclusive Campaigns",
  },
];

export function ReferralBenefitsTable({ currentTier }: BenefitsTableProps) {
  return (
    <div className="rounded-2xl border bg-card/70 p-5 shadow-sm space-y-5">
      <div>
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          Universal Tier Ladder, Qualification & Activity Cashback
        </h3>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          Understand the difference between <strong>Qualified Activation</strong> (the one-time milestone that unlocks referral bonuses) and <strong>Referral Activity Cashback</strong> (ongoing points per transaction &gt; 10 USDC from your referrals).
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground font-semibold">
              <th className="py-3 px-3">Tier</th>
              <th className="py-3 px-3">Referral Ladder</th>
              <th className="py-3 px-3">Referrer Direct Reward</th>
              <th className="py-3 px-3">Friend Welcome Bonus</th>
              <th className="py-3 px-3 min-w-[220px]">Qualified Activation Criteria</th>
              <th className="py-3 px-3 min-w-[160px]">Ongoing Activity Cashback</th>
              <th className="py-3 px-3">Tier Perks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {tiersData.map((item) => {
              const isCurrent = currentTier === item.tier;
              return (
                <tr
                  key={item.tier}
                  className={`transition-colors ${
                    isCurrent
                      ? "bg-primary/5 font-semibold text-foreground"
                      : "hover:bg-muted/30 text-muted-foreground"
                  }`}
                >
                  <td className="py-3.5 px-3">
                    <div className="flex items-center gap-2">
                      <TierBadge tier={item.tier} showIcon={false} />
                      {isCurrent && (
                        <span className="rounded bg-primary px-1.5 py-0.2 text-[9px] font-bold text-primary-foreground">
                          YOU
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3.5 px-3 font-mono">{item.range}</td>
                  <td className="py-3.5 px-3 font-bold text-foreground">{item.personalReward}</td>
                  <td className="py-3.5 px-3 font-semibold text-emerald-600 dark:text-emerald-400">
                    {item.friendReward}
                  </td>
                  <td className="py-3.5 px-3 text-foreground leading-snug">
                    {item.qualificationCriteria}
                  </td>
                  <td className="py-3.5 px-3 font-bold text-primary">
                    {item.cashback}
                  </td>
                  <td className="py-3.5 px-3 text-[11px] text-muted-foreground">
                    {item.perks}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Three Column Comparison: Qualification vs Referral Cashback vs General Cashback */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3.5 space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-foreground">
            <Check className="h-4 w-4 text-primary" />
            1. Qualified Activation
          </div>
          <p className="text-muted-foreground leading-relaxed text-[11px]">
            Triggered <strong>only once</strong> when your invitee signs up and their payments add up to the qualifying volume for your tier (e.g. <strong>250+ USDC</strong> for Starter). Referrer earns tier reward (20 to 100 pts) and referred friend receives <strong>20 OnePoints</strong> across all tiers.
          </p>
        </div>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-foreground">
            <Zap className="h-4 w-4 text-amber-500" />
            2. Referral Activity Cashback
          </div>
          <p className="text-muted-foreground leading-relaxed text-[11px]">
            Awarded to you on <strong>every subsequent transaction &gt; 10 USDC</strong> made by your qualified referrals. You earn <strong>0.2 to 1.0 ONE Point</strong> per transaction depending on your current tier.
          </p>
        </div>

        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5 space-y-1 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-foreground">
            <Coins className="h-4 w-4 text-emerald-500" />
            3. General Platform Cashback
          </div>
          <p className="text-muted-foreground leading-relaxed text-[11px]">
            Awarded directly to <strong>all SaphraONE accounts</strong> on your own platform transactions: <strong>1 pt (&gt; 20)</strong>, <strong>5 pts (&gt; 100)</strong>, <strong>20 pts (&gt; 500)</strong>, and <strong>50 pts (&gt; 1,000 USDC/EURC)</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
