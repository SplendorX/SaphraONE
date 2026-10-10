"use client";

import { Crown, Medal, Trophy } from "lucide-react";
import { useEffect, useState } from "react";

import { metricLabels, type CampaignMetric } from "@/lib/campaigns/rules";
import { cn } from "@/lib/utils";

import "./campaigns-board.css";

type PublicCampaign = {
  id: string;
  title: string;
  description: string;
  metric: CampaignMetric;
  minAmountUsd: number;
  minScore: number;
  startsAt: string;
  endsAt: string;
  phase: "upcoming" | "running" | "ended";
  status: "live" | "finalized" | "paid";
  prizePoolUsdc: number;
  payout: { type: "top"; splits: number[] } | { type: "threshold"; prizeUsdc: number };
  leaderboard: Array<{ rank: number; name: string; score: number; prizeUsdc: number }>;
  me: { rank: number; score: number; prizeUsdc: number | null; prizeStatus: string | null } | null;
};

function usdc(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
}

function score(metric: CampaignMetric, value: number) {
  if (metric === "volume" || metric === "fees") {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  return value.toLocaleString("en-US");
}

/** "3d 4h", "5h 12m", "8m". */
function remaining(until: string) {
  const ms = Math.max(0, Date.parse(until) - Date.now());
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function phaseChip(campaign: PublicCampaign) {
  if (campaign.status === "paid") return "Winners paid";
  if (campaign.status === "finalized") return "Winners announced";
  if (campaign.phase === "upcoming") return `Starts in ${remaining(campaign.startsAt)}`;
  if (campaign.phase === "running") return `Ends in ${remaining(campaign.endsAt)}`;
  return "Ended · results soon";
}

function payoutSummary(campaign: PublicCampaign) {
  if (campaign.payout.type === "threshold") {
    return `${usdc(campaign.payout.prizeUsdc)} each for ${score(campaign.metric, campaign.minScore)}+ ${metricLabels[campaign.metric].unit}`;
  }
  const ordinals = ["1st", "2nd", "3rd"];
  const places = campaign.payout.splits
    .slice(0, 3)
    .map((share, index) => `${ordinals[index]} ${usdc((campaign.prizePoolUsdc * share) / 100)}`);
  const rest = campaign.payout.splits.length - 3;
  return rest > 0 ? `${places.join(" · ")} · +${rest} more places` : places.join(" · ");
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown aria-label="1st" className="cb-rank-icon is-gold" />;
  if (rank === 2) return <Medal aria-label="2nd" className="cb-rank-icon is-silver" />;
  if (rank === 3) return <Medal aria-label="3rd" className="cb-rank-icon is-bronze" />;
  return <span className="cb-rank-number">{rank}</span>;
}

/**
 * USDC campaigns on the Rewards page: each live (or just-ended) campaign's
 * prize, rules, top ten and the viewer's own place. Renders nothing when no
 * campaign is running.
 */
export function CampaignsBoard({ wallet }: { wallet?: string | null }) {
  const [campaigns, setCampaigns] = useState<PublicCampaign[]>([]);

  useEffect(() => {
    let active = true;
    const query = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
    fetch(`/api/campaigns${query}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { campaigns: [] }))
      .then((payload: { campaigns?: PublicCampaign[] }) => {
        if (active) setCampaigns(payload.campaigns ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [wallet]);

  if (campaigns.length === 0) return null;

  return (
    <>
      {campaigns.map((campaign) => {
        const label = metricLabels[campaign.metric];
        const meInTop = campaign.me && campaign.leaderboard.some((row) => row.rank === campaign.me?.rank);
        return (
          <section className="cb-card" key={campaign.id}>
            <span aria-hidden className="cb-glow" />
            <div className="cb-head">
              <span className="cb-eyebrow">
                <Trophy className="h-3.5 w-3.5" /> USDC campaign
              </span>
              <span className={cn("cb-chip", campaign.phase === "running" && campaign.status === "live" && "is-live")}>
                {phaseChip(campaign)}
              </span>
            </div>

            <h2 className="cb-title">{campaign.title}</h2>
            <p className="cb-pool">
              {usdc(campaign.prizePoolUsdc)}
              <span>prize pool</span>
            </p>
            {campaign.description ? <p className="cb-description">{campaign.description}</p> : null}

            <ul className="cb-rules">
              <li>
                Ranked by <strong>{label.name.toLowerCase()}</strong>
                {campaign.minAmountUsd > 0 ? ` · payments of ${usdc(campaign.minAmountUsd)}+` : ""}
              </li>
              <li>{payoutSummary(campaign)}</li>
            </ul>

            {campaign.leaderboard.length === 0 ? (
              <p className="cb-empty">
                {campaign.phase === "upcoming" ? "The board opens when the campaign starts." : "No one on the board yet. Make the first payment."}
              </p>
            ) : (
              <ol className="cb-board">
                {campaign.leaderboard.map((row) => (
                  <li className={cn("cb-row", campaign.me?.rank === row.rank && "is-me")} key={row.rank}>
                    <RankBadge rank={row.rank} />
                    <span className="cb-name">
                      {row.name}
                      {campaign.me?.rank === row.rank ? <em>You</em> : null}
                    </span>
                    <span className="cb-score">
                      {score(campaign.metric, row.score)}
                      <small>{label.unit}</small>
                    </span>
                    {row.prizeUsdc > 0 ? <span className="cb-prize">{usdc(row.prizeUsdc)}</span> : null}
                  </li>
                ))}
              </ol>
            )}

            {campaign.me && !meInTop ? (
              <p className="cb-me">
                You're <strong>#{campaign.me.rank}</strong> with {score(campaign.metric, campaign.me.score)} {label.unit}
              </p>
            ) : null}
            {!campaign.me && wallet && campaign.phase === "running" ? (
              <p className="cb-me">You're not on the board yet. Eligible payments count automatically.</p>
            ) : null}
            {campaign.me?.prizeUsdc ? (
              <p className="cb-won">
                You won {usdc(campaign.me.prizeUsdc)}
                {campaign.me.prizeStatus === "PAID" ? " · sent to your wallet" : " · being reviewed for payout"}
              </p>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
