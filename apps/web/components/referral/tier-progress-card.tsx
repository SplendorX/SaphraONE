"use client";

import { ShieldCheck, Zap } from "lucide-react";
import type { ReferralTier, TierProgress } from "@/lib/referral/types";
import { TierBadge } from "@/components/referral/tier-badge";
import { Progress } from "@/components/ui/progress";

interface TierProgressCardProps {
  currentTier: ReferralTier;
  totalSuccessfulReferrals: number;
  tierProgress: TierProgress;
}

const tierCashbackDescriptions: Record<ReferralTier, string> = {
  STARTER: "0.2 OnePoints / tx > 10 USDC",
  BUILDER: "0.3 OnePoints / tx > 10 USDC",
  ARCHITECT: "0.5 OnePoints / tx > 10 USDC",
  AMBASSADOR: "1.0 ONE Point / tx > 10 USDC",
};

const tierDirectPersonal: Record<ReferralTier, number> = {
  STARTER: 20,
  BUILDER: 30,
  ARCHITECT: 50,
  AMBASSADOR: 100,
};

const tierDirectBusiness: Record<ReferralTier, number> = {
  STARTER: 50,
  BUILDER: 100,
  ARCHITECT: 150,
  AMBASSADOR: 200,
};

const tierQualificationCriteria: Record<ReferralTier, string> = {
  STARTER: "Invitee sends 250+ USDC in total payments",
  BUILDER: "Invitee sends 500+ USDC in total payments",
  ARCHITECT: "Invitee sends 750+ USDC in total payments",
  AMBASSADOR: "Invitee sends 1,250+ USDC in total payments",
};

export function TierProgressCard({
  currentTier,
  totalSuccessfulReferrals,
  tierProgress,
}: TierProgressCardProps) {
  const currentCashback = tierCashbackDescriptions[currentTier];
  const isMaxTier = currentTier === "AMBASSADOR";
  const progressPercent = Math.min(100, Math.max(0, tierProgress.progressPercentage));
  const qualificationCriteria = tierQualificationCriteria[currentTier];

  return (
    <div className="rounded-2xl border bg-card/80 p-5 shadow-sm backdrop-blur-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Universal Referral Tier
          </div>
          <div className="mt-1 flex items-center gap-2.5">
            <TierBadge tier={currentTier} className="text-sm px-3 py-1" />
            <span className="text-xs text-muted-foreground">
              {totalSuccessfulReferrals} qualified referrals
            </span>
          </div>
        </div>

        {/* Current Tier Activity Cashback pill */}
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-xs text-foreground">
          <Zap className="h-4 w-4 text-amber-500 shrink-0" />
          <span>
            Activity Cashback: <strong>{currentCashback}</strong> from referrals
          </span>
        </div>
      </div>

      {/* Progress Bar & Range */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {isMaxTier
              ? "Highest tier achieved!"
              : `${Math.max(0, tierProgress.targetCount - tierProgress.currentCount)} more referrals to ${tierProgress.nextTier}`}
          </span>
          <span className="font-mono font-medium">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="h-2" />
        <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
          <span>Current: {totalSuccessfulReferrals}</span>
          {!isMaxTier && tierProgress.targetCount > 0 && (
            <span>Target: {tierProgress.targetCount}</span>
          )}
        </div>
      </div>

      {/* Perks summary grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">
            Personal Reward
          </div>
          <div className="text-sm font-bold text-foreground mt-0.5">
            {tierDirectPersonal[currentTier]} pts
          </div>
          <div className="text-[10px] text-muted-foreground">per qualified user</div>
        </div>

        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">
            Business Reward
          </div>
          <div className="text-sm font-bold text-foreground mt-0.5">
            {tierDirectBusiness[currentTier]} pts
          </div>
          <div className="text-[10px] text-muted-foreground">per qualified business</div>
        </div>

        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">
            Friend Welcome Bonus
          </div>
          <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
            20 pts
          </div>
          <div className="text-[10px] text-muted-foreground">across all tiers</div>
        </div>

        <div className="rounded-lg bg-muted/40 p-2.5 text-center">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">
            Activity Cashback
          </div>
          <div className="text-sm font-bold text-amber-600 dark:text-amber-400 mt-0.5">
            {currentTier === "STARTER" ? "0.2 pts" : currentTier === "BUILDER" ? "0.3 pts" : currentTier === "ARCHITECT" ? "0.5 pts" : "1.0 pt"}
          </div>
          <div className="text-[10px] text-muted-foreground">per tx &gt; 10 USDC</div>
        </div>
      </div>

      {/* Qualification Criteria Notice */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
        <span>
          <strong className="text-foreground">Qualification:</strong> {qualificationCriteria}.
        </span>
      </div>
    </div>
  );
}
