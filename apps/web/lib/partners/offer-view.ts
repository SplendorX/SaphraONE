// Server-only. What the public /join/<code> pages show about an offer.
import { cache } from "react";

import { creatorPartnersEnabled, perkKinds, perkLabels, PERK_HOLD_DAYS } from "@/lib/partners/config";
import { loadOfferByCode } from "@/lib/partners/db";
import { normalizeOfferCode, offerAvailability, perkSummary, unavailableLabels } from "@/lib/partners/rules";

export type PublicOffer = {
  code: string;
  title: string;
  headline: string;
  termsMd: string;
  endsAt: string | null;
  perkDays: number;
  partner: { avatarUrl: string | null; displayName: string; handle: string | null };
  perks: Array<{ kind: string; name: string; summary: string }>;
  /** Null while new signups get the package; otherwise why not, in plain words. */
  unavailable: string | null;
};

/** A live (or ended) offer by its code; null for unknown codes and drafts. Cached per request. */
export const loadPublicOffer = cache(async (rawCode: string): Promise<PublicOffer | null> => {
  if (!creatorPartnersEnabled()) return null;
  const code = normalizeOfferCode(decodeURIComponent(rawCode));
  if (!code) return null;
  const loaded = await loadOfferByCode(code);
  if (!loaded || loaded.offer.status === "DRAFT") return null;
  const { offer, partner, perks } = loaded;
  const availability = offerAvailability(offer, partner);
  return {
    code,
    endsAt: offer.ends_at,
    headline: offer.headline,
    partner: { avatarUrl: partner.avatar_url, displayName: partner.display_name, handle: partner.handle },
    perkDays: offer.perk_days,
    perks: perkKinds
      .filter((kind) => perks[kind])
      .map((kind) => ({ kind, name: perkLabels[kind].name, summary: perkSummary(kind, perks[kind], offer.perk_days) })),
    termsMd: offer.terms_md,
    title: offer.title,
    unavailable: availability.available ? null : unavailableLabels[availability.reason],
  };
});

/** The rules every offer shares, shown on its terms page. */
export function standardTerms(offer: PublicOffer) {
  return [
    "For new SaphraONE accounts created through this link. Accounts that already exist can't join.",
    "One welcome package per person. Accounts that look like duplicates wait for review and may lose their perks.",
    "Personal accounts only. A business account can sign up but gets no welcome perks.",
    `The welcome period starts when your account is created and lasts ${offer.perkDays} days. Each perk has its own limit.`,
    "Fee rebates only cover fees you really paid on payments to other people. Moving money between your own accounts doesn't count.",
    `Rebates and bonus points can be claimed ${PERK_HOLD_DAYS} days after they're earned. A USDC rebate balance under $1 is paid automatically at the end of the period if it's at least $0.10.`,
    "Perks are personal and can't be transferred. They have no cash value, except a rebate of a fee you paid.",
    "SaphraONE may change or end this offer at any time. Perks already earned stay yours unless they were gained by abuse.",
  ];
}
