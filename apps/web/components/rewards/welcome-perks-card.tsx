"use client";

import { Gift, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { WelcomePerks } from "@/lib/partners/types";
import { cn } from "@/lib/utils";

import "./welcome-perks-card.css";

function money(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function day(value: string) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * "Welcome from @creator" on the Rewards page: for accounts that signed up
 * through a creator partner's link, the days left, each perk and how much of
 * it is used, and the USDC rebates to claim. Renders nothing for everyone else.
 */
export function WelcomePerksCard({ circleSocialUuid, wallet }: { circleSocialUuid?: string | null; wallet?: string | null }) {
  const [perks, setPerks] = useState<WelcomePerks | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);

  const load = useCallback(async () => {
    if (!wallet) return;
    const params = new URLSearchParams({ ownerWallet: wallet });
    if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);
    const response = await fetch(`/api/partners/me?${params}`, { cache: "no-store" }).catch(() => null);
    const json = response?.ok ? ((await response.json()) as { perks: WelcomePerks | null }) : null;
    setPerks(json?.perks ?? null);
  }, [circleSocialUuid, wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim() {
    setClaiming(true);
    setMessage(null);
    try {
      const response = await fetch("/api/partners/me", {
        body: JSON.stringify({ circleSocialUuid, ownerWallet: wallet }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await response.json().catch(() => null)) as { amountUsdc?: number; message?: string; review?: boolean } | null;
      if (!response.ok) throw new Error(json?.message || "The claim couldn't be paid.");
      setMessage({
        text: json?.review
          ? `${money(json.amountUsdc ?? 0)} is being reviewed and will be sent soon.`
          : `${money(json?.amountUsdc ?? 0)} sent to your wallet.`,
        tone: "ok",
      });
      await load();
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "The claim couldn't be paid.", tone: "error" });
    } finally {
      setClaiming(false);
    }
  }

  if (!perks) return null;
  const { rebates } = perks;
  const live = perks.status === "ACTIVE" || perks.status === "HELD";
  const who = perks.partner.handle ? `@${perks.partner.handle}` : perks.partner.displayName;

  return (
    <section className="wp-card">
      <div className="wp-head">
        <span className="wp-eyebrow">
          <Gift className="h-3.5 w-3.5" /> Welcome from {who}
        </span>
        {live ? (
          <span className={cn("wp-chip", perks.daysLeft <= 3 && "is-ending")}>
            {perks.daysLeft} day{perks.daysLeft === 1 ? "" : "s"} left
          </span>
        ) : null}
      </div>
      <p className="wp-sub">
        {live ? `Your welcome perks run until ${day(perks.endsAt)}.` : `${perks.offer.title}`}
      </p>
      {perks.note ? <p className="wp-note">{perks.note}</p> : null}

      {perks.perks.length ? (
        <ul className="wp-perks">
          {perks.perks.map((perk) => (
            <li key={perk.kind}>
              <span className="wp-perk-name">{perk.name}</span>
              <span className="wp-perk-summary">{perk.summary}</span>
              {perk.usage ? <span className="wp-perk-usage">{perk.usage}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {rebates.claimableUsdc > 0 || rebates.pendingUsdc > 0 || rebates.claimedUsdc > 0 ? (
        <div className="wp-rebates">
          <div>
            <p className="wp-amount">{money(rebates.claimableUsdc)}</p>
            <p className="wp-sub">
              USDC back, ready to claim
              {rebates.pendingUsdc > 0
                ? ` · ${money(rebates.pendingUsdc)} more from ${rebates.nextClaimableAt ? day(rebates.nextClaimableAt) : "soon"}`
                : ""}
            </p>
          </div>
          <button
            className="wp-claim"
            disabled={claiming || rebates.claimableUsdc < rebates.minClaimUsdc || perks.status === "HELD"}
            onClick={() => void claim()}
            type="button"
          >
            {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Claim
          </button>
        </div>
      ) : null}
      {perks.pendingPoints > 0 ? (
        <p className="wp-sub">{perks.pendingPoints.toLocaleString("en-US")} bonus points arrive 7 days after you earn them.</p>
      ) : null}
      {message ? <p className={cn("wp-message", message.tone === "error" && "is-error")}>{message.text}</p> : null}

      <Link className="wp-terms" href={`/join/${perks.offer.code}/terms`}>
        Offer terms
      </Link>
    </section>
  );
}
