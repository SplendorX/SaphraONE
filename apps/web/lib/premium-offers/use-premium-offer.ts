"use client";

import { useEffect, useState } from "react";

import type { PremiumOfferView } from "@/lib/premium-offers/rules";

/**
 * The member's live premium offer on a feature unlock (automatic deposits or
 * payroll), from the entitlements route: the price to pay and any bonus days.
 * Null when there is none, or until it loads.
 */
export function usePremiumOffer(input: {
  circleSocialUuid?: string | null;
  feature: "EARN_AUTO_DEPOSIT" | "PAYROLL_AUTO_SCHEDULE";
  wallet?: string | null;
}): PremiumOfferView {
  const [offer, setOffer] = useState<PremiumOfferView>(null);
  const { circleSocialUuid, feature, wallet } = input;

  useEffect(() => {
    setOffer(null);
    if (!wallet) return;
    let cancelled = false;
    const params = new URLSearchParams({ wallet });
    if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);
    fetch(`/api/one-points/entitlements?${params}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { offers?: Record<string, PremiumOfferView> } | null) => {
        if (!cancelled) setOffer(payload?.offers?.[feature] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [circleSocialUuid, feature, wallet]);

  return offer;
}
