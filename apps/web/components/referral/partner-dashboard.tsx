"use client";

import { Check, Copy, Download, Handshake } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import "./partner-dashboard.css";

type PartnerOffer = {
  activated: number;
  clicks: number;
  code: string;
  earnedUsdc: number;
  endsAt: string | null;
  link: string;
  signups: number;
  status: "LIVE" | "PAUSED" | "ENDED";
  title: string;
  volumeUsd: number;
};

type PartnerView = {
  offers: PartnerOffer[];
  partner: {
    bountyUsdc: number;
    commissionBps: number | null;
    commissionMode: "FIXED" | "AT_LEAST_TIER";
    contractEndsAt: string | null;
    displayName: string;
    status: string;
  } | null;
};

function usd(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

const statusLabels: Record<PartnerOffer["status"], string> = { ENDED: "Ended", LIVE: "Live", PAUSED: "Paused" };

/**
 * For a creator partner, on Invite & Earn: each offer's link and what it
 * brought in, their contract rate, and their earnings statement. Renders
 * nothing for everyone else.
 */
export function PartnerDashboard({ circleSocialUuid, wallet }: { circleSocialUuid?: string | null; wallet?: string | null }) {
  const [view, setView] = useState<PartnerView | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (wallet) params.set("ownerWallet", wallet);
  if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);
  const query = params.toString();

  useEffect(() => {
    if (!wallet) return;
    let active = true;
    fetch(`/api/partners/dashboard?${query}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: PartnerView | null) => {
        if (active) setView(payload?.partner ? payload : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [query, wallet]);

  if (!view?.partner) return null;
  const { partner } = view;

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard blocked: the link is on screen to copy by hand.
    }
  }

  return (
    <section className="pd-card">
      <div className="pd-head">
        <span className="pd-eyebrow">
          <Handshake className="h-3.5 w-3.5" /> Creator partner
        </span>
        <a className="pd-download" href={`/api/partners/dashboard?${query}&format=csv`}>
          <Download className="h-3.5 w-3.5" /> Statement
        </a>
      </div>
      <p className="pd-terms">
        {partner.commissionBps !== null
          ? `You earn ${partner.commissionBps / 100}% of your referrals' fees${partner.commissionMode === "AT_LEAST_TIER" ? " (or your tier's rate, if higher)" : ""}`
          : "You earn your tier's share of your referrals' fees"}
        {partner.contractEndsAt ? ` until ${new Date(partner.contractEndsAt).toLocaleDateString()}` : ""}
        {partner.bountyUsdc > 0 ? `, plus ${usd(partner.bountyUsdc)} for each member who becomes active` : ""}.
      </p>

      {view.offers.length === 0 ? <p className="pd-empty">Your offer links will appear here once they&apos;re live.</p> : null}
      {view.offers.map((offer) => (
        <article className="pd-offer" key={offer.code}>
          <div className="pd-offer-head">
            <strong>{offer.title}</strong>
            <span className={cn("pd-chip", offer.status === "LIVE" && "is-live")}>{statusLabels[offer.status]}</span>
          </div>
          <button className="pd-link" onClick={() => void copy(offer.link)} type="button">
            <span>{offer.link.replace(/^https?:\/\//, "")}</span>
            {copied === offer.link ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
          <dl className="pd-stats">
            <div>
              <dt>Visits</dt>
              <dd>{offer.clicks.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Signups</dt>
              <dd>{offer.signups.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd>{offer.activated.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Volume</dt>
              <dd>{usd(offer.volumeUsd)}</dd>
            </div>
            <div>
              <dt>You earned</dt>
              <dd>{usd(offer.earnedUsdc)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </section>
  );
}
