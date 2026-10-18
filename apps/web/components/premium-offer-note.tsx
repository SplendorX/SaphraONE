import { BadgePercent } from "lucide-react";

import { offerSummary, type PremiumOfferView } from "@/lib/premium-offers/rules";

import "./premium-offer-note.css";

/**
 * A live premium offer beside a price: its name, what it gives ("50% off ·
 * +7 bonus days") and when it ends. Shown on ALLIE Pro, automatic deposits
 * and automatic payroll (offers are set on Admin › Campaigns).
 */
export function PremiumOfferNote({ offer }: { offer: NonNullable<PremiumOfferView> }) {
  const summary = offerSummary({ bonus_days: offer.bonusDays, discount_percent: offer.discountPercent });
  return (
    <p className="pon">
      <BadgePercent aria-hidden className="pon-icon" />
      <span className="pon-text">
        <strong>{offer.headline || offer.title}</strong>
        <span>
          {summary} · ends {new Date(offer.endsAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
        </span>
      </span>
    </p>
  );
}
