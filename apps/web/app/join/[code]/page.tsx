import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JoinLanding } from "@/components/partners/join-landing";
import { loadPublicOffer } from "@/lib/partners/offer-view";

type JoinPageProps = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: JoinPageProps): Promise<Metadata> {
  const offer = await loadPublicOffer((await params).code);
  if (!offer) return { robots: { follow: false, index: false }, title: "SaphraONE" };
  const title = `${offer.partner.displayName} invites you to SaphraONE`;
  const description = offer.headline || offer.perks.map((perk) => perk.summary).join(" · ") || offer.title;
  return {
    description,
    openGraph: { description, title },
    robots: { follow: false, index: false },
    title,
    twitter: { card: "summary_large_image", description, title },
  };
}

/**
 * A creator partner's link (CREATOR-PARTNERS-PLAN.md): who invited you, the
 * welcome package in plain words, and the way in. Sign-up then carries the
 * partner's referral and this offer's code.
 */
export default async function JoinPage({ params }: JoinPageProps) {
  const offer = await loadPublicOffer((await params).code);
  if (!offer) notFound();
  return <JoinLanding offer={offer} />;
}
