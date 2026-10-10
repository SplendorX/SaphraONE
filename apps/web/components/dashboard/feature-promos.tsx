"use client";

import { PiggyBank, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PromoGiftArt } from "@/components/dashboard/promo-gift-art";
import { REFERRED_QUALIFICATION_REWARD_POINTS } from "@/lib/referral/types";
import { rewardsV2Enabled } from "@/lib/rewards/config";

import "./feature-promos.css";

type EarnMode = "live" | "simulation" | "unavailable";
type EarnApy = { display: string | null; estimate: boolean; mode: EarnMode | null };

/**
 * Earn's net APY for the promo. Only live mode has one: simulation (testnet
 * mock pool) has no interest rate at all, so the card says so rather than
 * showing a number.
 */
function useEarnApy() {
  const [apy, setApy] = useState<EarnApy>({ display: null, estimate: false, mode: null });

  useEffect(() => {
    let active = true;
    fetch("/api/earn/apy")
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (payload: {
          current?: { isEstimate?: boolean; isSimulation?: boolean; netApyDisplay?: string | null };
          mode?: EarnMode;
        } | null) => {
          if (!active || !payload) return;
          const display = payload.current?.netApyDisplay ?? null;
          setApy({
            display: display && display !== "0%" && display !== "0.00%" ? display : null,
            estimate: Boolean(payload.current?.isEstimate),
            mode: payload.mode ?? null,
          });
        },
      )
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return apy;
}

type Promo = {
  body: string;
  /** The pill at the bottom of the card: the one number that sells it. */
  figure: string;
  figureNote: string;
  href: string;
  /** Art in the lower right; the invite card draws a gift box instead. */
  icon: LucideIcon | null;
  id: "earn" | "save" | "invite";
  title: [string, string];
};

/** Tall cards that point people at Invest, Save and Invite & Earn. */
export function FeaturePromos() {
  const apy = useEarnApy();

  const promos: Promo[] = [
    rewardsV2Enabled()
      ? {
          // Rewards v2: USDC commission on direct referrals' fees, 10% rising
          // to 25% by tier (lib/referral/usdc-commission.ts).
          body: "Earn a share of the fees on every payment your friends make, paid in USDC.",
          figure: "10–25%",
          figureNote: "of their fees",
          href: "/referral",
          icon: null,
          id: "invite",
          title: ["Invite friends", "& earn USDC"],
        }
      : {
          // Referral activity cashback: points per qualifying payment the friend
          // makes, rising with the referrer's tier (see lib/referral/policy-service).
          body: "You both get ONE Points once they start, then cashback on every payment they make.",
          figure: `+${REFERRED_QUALIFICATION_REWARD_POINTS}`,
          figureNote: "ONE Points each",
          href: "/referral",
          icon: null,
          id: "invite",
          title: ["Invite friends", "& earn rewards"],
        },
    {
      body: "Put idle USDC to work and move it back whenever you need it.",
      ...(apy.display
        ? { figure: apy.display, figureNote: apy.estimate ? "est. net APY" : "net APY" }
        : apy.mode === "simulation"
          ? { figure: "Demo", figureNote: "testnet" }
          : { figure: "USDC", figureNote: "yield when live" }),
      href: "/earn",
      icon: TrendingUp,
      id: "earn",
      title: ["Invest.", "Grow idle USDC."],
    },
    {
      body: "Set money aside in pockets, or save a little each time you spend.",
      figure: "Pockets",
      figureNote: "+ Spend&Save",
      href: "/save",
      icon: PiggyBank,
      id: "save",
      title: ["Save.", "A little every day."],
    },
  ];

  return (
    <div aria-label="Explore SaphraONE" className="promo-tiles" role="list">
      {promos.map(({ body, figure, figureNote, href, icon: Icon, id, title }) => (
        <Link
          className="promo-tile"
          data-promo={id}
          href={href}
          key={id}
          role="listitem"
        >
          <span className="promo-tile-title">
            {title[0]}
            <br />
            {title[1]}
          </span>
          <span className="promo-tile-body">{body}</span>

          <span aria-hidden className="promo-tile-art">
            {Icon ? (
              <span className="promo-tile-art-tile">
                <Icon className="promo-tile-art-icon" strokeWidth={1.6} />
              </span>
            ) : (
              <PromoGiftArt className="promo-tile-art-gift" />
            )}
          </span>

          <span className="promo-tile-pill">
            <strong>{figure}</strong> {figureNote}
          </span>
        </Link>
      ))}
    </div>
  );
}
