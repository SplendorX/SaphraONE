"use client";

import { ArrowLeft, ChevronRight, Flame, Gift, Loader2, Target } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";

import { OnePointsMark } from "@/components/brand/one-points-mark";
import { GiftPointsModal } from "@/components/referral/gift-points-modal";
import { CampaignsBoard } from "@/components/rewards/campaigns-board";
import { ClaimDiscountSheet } from "@/components/rewards/claim-discount-sheet";
import { WelcomePerksCard } from "@/components/rewards/welcome-perks-card";
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import { readActivatedExternalProfile } from "@/lib/platform-access";
import {
  DISCOUNT_OPTIONS,
  MIN_DISCOUNT_USDC,
  STREAK_DAILY_POINTS,
  STREAK_MILESTONES,
} from "@/lib/rewards/config";
import type { RewardsOverview } from "@/lib/rewards/types";
import { bottomSheetClassName, useSheetSide } from "@/lib/use-media-query";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

import "./rewards.css";

const dayLetters = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function points(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function usd(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function RewardsSheet({
  children,
  description,
  onOpenChange,
  open,
  title,
}: {
  children: ReactNode;
  description: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  const side = useSheetSide();
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className={cn("gap-0 p-0", side === "bottom" ? bottomSheetClassName : "w-full sm:max-w-md")}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        <div className="rw-sheet">
          <SheetTitle className="rw-sheet-title">{title}</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Claim unlocks this long after the follow link was opened. */
const SOCIAL_CLAIM_DELAY_MS = 5_000;

/**
 * "Follow us" quests: open the account, then claim. A follow can't be checked
 * from here, so claiming waits until the link has been opened.
 */
function SocialQuestActions({
  circleSocialUuid,
  onClaimed,
  questId,
  social,
  wallet,
}: {
  circleSocialUuid?: string | null;
  onClaimed: () => void;
  questId: string;
  social: NonNullable<RewardsOverview["quests"][number]["social"]>;
  wallet: string;
}) {
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!openedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [openedAt]);

  const ready = openedAt !== null && now - openedAt >= SOCIAL_CLAIM_DELAY_MS;

  async function claim() {
    setClaiming(true);
    setMessage(null);
    try {
      const response = await fetch("/api/rewards/quests/claim", {
        body: JSON.stringify({ circleSocialUuid, ownerWallet: wallet, questId }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const json = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(json?.message || "The quest couldn't be claimed.");
      onClaimed();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The quest couldn't be claimed.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="rw-quest-actions">
      <a
        className="rw-quest-btn"
        href={social.url}
        onClick={() => {
          setOpenedAt(Date.now());
          setNow(Date.now());
        }}
        rel="noopener noreferrer"
        target="_blank"
      >
        Follow on {social.platformLabel}
      </a>
      <button
        className="rw-quest-btn is-primary"
        disabled={!ready || claiming}
        onClick={() => void claim()}
        type="button"
      >
        {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {openedAt && !ready ? "Checking…" : "Claim"}
      </button>
      {message ? <p className="rw-quest-error">{message}</p> : null}
    </div>
  );
}

type Quest = RewardsOverview["quests"][number];

function questChip(quest: Quest) {
  if (quest.completed) return "Done";
  return quest.reward.kind === "percent" ? `up to ${points(quest.points)}` : `+${points(quest.points)}`;
}

function QuestProgressBar({ progress }: { progress: NonNullable<Quest["progress"]> }) {
  return (
    <span className="rw-quest-progress">
      <span style={{ width: `${Math.min(100, (progress.current / progress.target) * 100)}%` }} />
    </span>
  );
}

/** A quest in full, in its sheet: the ask, the reward, progress and how it completes. */
function QuestDetails({
  circleSocialUuid,
  onClaimed,
  quest,
  wallet,
}: {
  circleSocialUuid?: string | null;
  onClaimed: () => void;
  quest: Quest;
  wallet: string;
}) {
  return (
    <div className="rw-quest-detail">
      <span className="rw-quest-detail-icon">
        <Target className="h-6 w-6" />
      </span>
      {quest.description ? <p className="rw-quest-detail-body">{quest.description}</p> : null}

      <dl className="rw-quest-facts">
        <div>
          <dt>Reward</dt>
          <dd>
            {quest.reward.kind === "percent"
              ? `${quest.reward.percent}% back in points, up to ${points(quest.points)}`
              : `${points(quest.points)} ONE Points`}
          </dd>
        </div>
        {quest.progress ? (
          <div>
            <dt>Progress</dt>
            <dd>
              {points(Math.min(quest.progress.current, quest.progress.target))} of {points(quest.progress.target)}{" "}
              {quest.progress.unit}
            </dd>
          </div>
        ) : null}
        {quest.endsAt ? (
          <div>
            <dt>Ends</dt>
            <dd>{new Date(quest.endsAt).toLocaleDateString()}</dd>
          </div>
        ) : null}
        {quest.placesLeft !== null ? (
          <div>
            <dt>Places left</dt>
            <dd>{points(quest.placesLeft)}</dd>
          </div>
        ) : null}
        <div>
          <dt>For</dt>
          <dd>
            {quest.audience === "business" ? "Business accounts" : quest.audience === "personal" ? "Personal accounts" : "Everyone"}
          </dd>
        </div>
      </dl>

      {quest.progress ? <QuestProgressBar progress={quest.progress} /> : null}

      <p className="rw-quest-how">
        {quest.automatic
          ? "Completes automatically once you do it."
          : quest.social
            ? `Follow SaphraONE on ${quest.social.platformLabel}, then claim your points.`
            : "SaphraONE awards this one."}
      </p>

      {quest.social ? (
        <SocialQuestActions
          circleSocialUuid={circleSocialUuid}
          onClaimed={onClaimed}
          questId={quest.id}
          social={quest.social}
          wallet={wallet}
        />
      ) : null}
    </div>
  );
}

/** Rewards: OnePoints from your own transactions, streaks and quests. */
export function RewardsPage() {
  const { address: platformAddress, circleSocialUuid } = usePlatformWallet();
  const { address: wagmiAddress } = useAccount();
  const [externalProfile, setExternalProfile] = useState("");
  useEffect(() => setExternalProfile(readActivatedExternalProfile()), []);
  const wallet =
    platformAddress || wagmiAddress || (externalProfile && isAddress(externalProfile) ? externalProfile : undefined);

  const [data, setData] = useState<RewardsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<"earn" | "claim" | "streak" | "discount" | null>(null);
  const [openQuestId, setOpenQuestId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet) {
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({ ownerWallet: wallet });
      if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);
      const response = await fetch(`/api/rewards?${params}`, { cache: "no-store" });
      const json = (await response.json()) as RewardsOverview & { message?: string };
      if (!response.ok) throw new Error(json.message || "Could not load rewards.");
      setData(json);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load rewards.");
    } finally {
      setLoading(false);
    }
  }, [circleSocialUuid, wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="rw-page rw-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!wallet) {
    return <div className="rw-page rw-center rw-muted">Sign in to see your rewards.</div>;
  }
  if (!data) {
    return <div className="rw-page rw-center rw-muted">{error ?? "Could not load rewards."}</div>;
  }

  // The tier the next transaction earns in.
  const activeTier =
    data.month.tiers.find((tier) => tier.spentUsd < tier.limitUsd) ?? data.month.tiers[data.month.tiers.length - 1];
  const capReached = data.month.pointsEarned >= data.month.capPoints;
  // The open quest, while it is still live (it closes once claimed).
  const openQuest = data.quests.find((quest) => quest.id === openQuestId && !quest.completed) ?? null;

  return (
    <div className="rw-page">
      <header className="rw-head">
        <Link aria-label="Back" className="rw-round" href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="rw-title">Rewards</h1>
        <p className="rw-muted">Points from every payment</p>
      </header>

      {/* Two columns on a desktop (components/layout/windows-shell.css);
          on a phone the wrappers vanish and the cards keep this order. */}
      <div className="rw-col">
        {/* Balance */}
        <section className="rw-hero">
          <span aria-hidden className="rw-hero-glow" />
          <span aria-hidden className="rw-hero-sheen" />
          <p className="rw-hero-label">ONE Points</p>
          <p className="rw-balance">
            {points(data.balance)}
            <OnePointsMark className="rw-mark" />
          </p>
          <p className="rw-worth">
            Worth ~<strong>{usd(data.worthUsd)}</strong>
          </p>
          <div className="rw-pills">
            <button className="rw-pill is-light" onClick={() => setSheet("earn")} type="button">
              Earn points
            </button>
            <button className="rw-pill is-ghost" onClick={() => setSheet("claim")} type="button">
              How to claim
            </button>
          </div>
          <GiftPointsModal
            availablePoints={data.balance}
            circleSocialUuid={circleSocialUuid}
            onSuccess={() => void load()}
            trigger={
              <button className="rw-gift" type="button">
                <Gift className="h-4 w-4" /> Gift points
              </button>
            }
            userWallet={wallet}
          />
        </section>

        {/* A creator partner's welcome package, for accounts that joined through one */}
        <WelcomePerksCard circleSocialUuid={circleSocialUuid} wallet={wallet} />

        {/* USDC campaigns, when any are running */}
        <CampaignsBoard wallet={wallet} />

        {/* Earning rate */}
        <section className="rw-card">
          <div className="rw-card-row">
            <button className="rw-card-link" onClick={() => setSheet("earn")} type="button">
              Earn points <ChevronRight className="h-4 w-4" />
            </button>
            <span className="rw-chip">Tier {activeTier.index}</span>
          </div>
          <p className="rw-rate">
            {capReached ? (
              <>Monthly cap reached</>
            ) : (
              <>
                {points(activeTier.pointsPer10Usd)} <span>per $10 spent</span>
              </>
            )}
          </p>
          <p className="rw-muted rw-small">
            {points(data.month.pointsEarned)} of {points(data.month.capPoints)} cashback points this month
          </p>
          <div className="rw-claimed">
            <span>Total discounts claimed</span>
            <strong>{usd(data.discountsClaimedUsd)}</strong>
          </div>
        </section>
      </div>

      <div className="rw-col">
        {/* Activity */}
        <section className="rw-card">
          <h2 className="rw-card-title">Rewards activity</h2>
          {data.activity.length === 0 ? (
            <p className="rw-empty">Make a payment to earn your first points.</p>
          ) : (
            // Scrolls inside the card once it is longer than about six entries.
            <ul
              aria-label="Rewards activity"
              className={cn("rw-activity", data.activity.length > 6 && "is-long")}
              tabIndex={data.activity.length > 6 ? 0 : undefined}
            >
              {data.activity.map((entry) => (
                <li key={entry.id}>
                  <div className="min-w-0">
                    <p className="rw-activity-label">{entry.label}</p>
                    <p className="rw-activity-sub">{entry.description}</p>
                  </div>
                  <span className={cn("rw-activity-points", entry.points < 0 && "is-negative")}>
                    {entry.points > 0 ? "+" : ""}
                    {points(entry.points)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Streak */}
        <section className="rw-card">
          <div className="rw-week">
            {data.streak.week.map((day, index) => (
              <div className="rw-day" key={day.day}>
                <span className="rw-day-name">{dayLetters[index]}</span>
                <span className={cn("rw-day-dot", day.active && "is-active")}>
                  {day.active ? <Flame className="h-4 w-4" /> : null}
                </span>
                <span className={cn("rw-day-today", day.today && "is-today")} />
              </div>
            ))}
          </div>
          <div className="rw-stats">
            <div>
              <span>Total check-ins</span>
              <strong>{data.streak.totalDays || "—"}</strong>
            </div>
            <div>
              <span>Current streak</span>
              <strong>
                {data.streak.current ? `${data.streak.current} day${data.streak.current === 1 ? "" : "s"}` : "—"}
              </strong>
            </div>
          </div>
          <button className="rw-pill is-primary is-wide" onClick={() => setSheet("streak")} type="button">
            Learn more
          </button>
        </section>

        {/* Quests, when any are live */}
        {data.quests.length > 0 ? (
          <section className="rw-card">
            <div className="rw-card-row">
              <h2 className="rw-card-title">Quests</h2>
              <span className="rw-muted rw-small">
                {data.quests.filter((quest) => quest.completed).length} / {data.quests.length}
              </span>
            </div>
            <ul className="rw-quests">
              {data.quests.map((quest) => {
                const body = (
                  <>
                    <span className="rw-quest-icon">
                      <Target className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="rw-activity-label">{quest.title}</span>
                      {quest.description ? <span className="rw-activity-sub">{quest.description}</span> : null}
                      {quest.progress && !quest.completed ? <QuestProgressBar progress={quest.progress} /> : null}
                    </span>
                    <span className="rw-chip">{questChip(quest)}</span>
                  </>
                );
                // An active quest opens its details; a finished one is just a row.
                return (
                  <li className={cn(quest.completed && "is-done")} key={quest.id}>
                    {quest.completed ? (
                      <div className="rw-quest-row">{body}</div>
                    ) : (
                      <button
                        aria-label={`${quest.title}: details`}
                        className="rw-quest-row is-open"
                        onClick={() => setOpenQuestId(quest.id)}
                        type="button"
                      >
                        {body}
                        <ChevronRight aria-hidden className="rw-quest-chevron h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>

      {/* One quest, in full */}
      <RewardsSheet
        description="What the quest asks, its reward and how it completes"
        onOpenChange={(open) => {
          if (!open) setOpenQuestId(null);
        }}
        open={Boolean(openQuest)}
        title={openQuest?.title ?? "Quest"}
      >
        {openQuest ? (
          <QuestDetails
            circleSocialUuid={circleSocialUuid}
            onClaimed={() => {
              setOpenQuestId(null);
              void load();
            }}
            quest={openQuest}
            wallet={wallet}
          />
        ) : null}
      </RewardsSheet>

      {/* Earn points */}
      <RewardsSheet
        description="How transactions earn OnePoints each month"
        onOpenChange={(open) => setSheet(open ? "earn" : null)}
        open={sheet === "earn"}
        title="Earn points"
      >
        <div className="rw-tiers">
          <div className="rw-tiers-head">
            <span>Tiers</span>
            <span className="rw-chip is-light">This month</span>
          </div>
          <ol>
            {data.month.tiers.map((tier) => {
              const done = tier.spentUsd >= tier.limitUsd;
              const current = tier.index === activeTier.index && !capReached;
              return (
                <li className={cn(current && "is-current", done && "is-done")} key={tier.index}>
                  <span className="rw-tier-num">{tier.index}</span>
                  <div>
                    <p className="rw-tier-rate">
                      {points(tier.pointsPer10Usd)} {tier.pointsPer10Usd === 1 ? "point" : "points"} per $10 spent
                    </p>
                    <p className="rw-muted rw-small">
                      {usd(tier.spentUsd)} spent of the {usd(tier.limitUsd)} limit.
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="rw-note">
          Spending limits reset at the start of each month. Cashback is capped at {points(data.month.capPoints)} points
          ($5) a month; streak and quest points come on top.
        </p>
      </RewardsSheet>

      {/* How to claim */}
      <RewardsSheet
        description="Spend points on a discount for a premium purchase"
        onOpenChange={(open) => setSheet(open ? "claim" : null)}
        open={sheet === "claim"}
        title="How to claim"
      >
        <p className="rw-note is-lead">
          Points come back as a USDC refund on a premium purchase you&apos;ve already made (Allie Pro, automatic
          deposits, automatic payroll). Pick the purchase, choose how much of it to refund, and the USDC arrives in your
          wallet.
        </p>
        <table className="rw-table">
          <thead>
            <tr>
              <th>You refund</th>
              <th>Points per $1</th>
            </tr>
          </thead>
          <tbody>
            {DISCOUNT_OPTIONS.map((option) => (
              <tr key={option.percent}>
                <td>{option.percent}% of the purchase</td>
                <td>{option.pointsPerUsd}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="rw-rules">
          <li>The purchase is a premium purchase paid in USDC on SaphraONE.</li>
          <li>The refund is at least {usd(MIN_DISCOUNT_USDC)}.</li>
          <li>It hasn&apos;t been refunded or claimed before.</li>
        </ul>
        <button className="rw-pill is-primary is-wide" onClick={() => setSheet("discount")} type="button">
          Claim a discount
        </button>
      </RewardsSheet>

      <ClaimDiscountSheet
        balance={data.balance}
        circleSocialUuid={circleSocialUuid}
        onClaimed={() => void load()}
        onOpenChange={(open) => setSheet(open ? "discount" : null)}
        open={sheet === "discount"}
        wallet={wallet}
      />

      {/* Streak rules */}
      <RewardsSheet
        description="How streaks earn points"
        onOpenChange={(open) => setSheet(open ? "streak" : null)}
        open={sheet === "streak"}
        title="Streaks"
      >
        <p className="rw-note is-lead">
          Make at least one payment a day to keep your streak. Each streak day earns {points(STREAK_DAILY_POINTS)}{" "}
          points, with bonuses along the way:
        </p>
        <ul className="rw-milestones">
          {STREAK_MILESTONES.map((milestone) => (
            <li key={milestone.days}>
              <Flame className="h-4 w-4" />
              <span>{milestone.days}-day streak</span>
              <strong>+{points(milestone.points)} points</strong>
            </li>
          ))}
        </ul>
        <p className="rw-note">
          After 30 days the bonuses start again. Missing a day resets your streak. Days follow UTC.
        </p>
      </RewardsSheet>
    </div>
  );
}
