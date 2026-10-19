import { BadgeCheck } from "lucide-react";

import type { DirectoryHit } from "@/lib/business/types";
import { cn } from "@/lib/utils";

type Verification = { kind: "business" } | { kind: "person"; tier: number };

/** What a search hit or profile has earned: a verified business, or a person's KYC tier. */
export function verificationOf(hit: Pick<DirectoryHit, "kind" | "kycTier" | "verificationStatus">): Verification | null {
  if (hit.verificationStatus === "VERIFIED") return { kind: "business" };
  if (hit.kind !== "business" && hit.kycTier && hit.kycTier >= 1) return { kind: "person", tier: Math.min(hit.kycTier, 2) };
  return null;
}

function labelFor(verification: Verification) {
  return verification.kind === "business" ? "Verified business" : `Tier ${verification.tier} verified`;
}

/**
 * The verified seal shown next to a name wherever people are searched.
 * Tier 1 is an outlined green seal, Tier 2 a solid one, and a verified
 * business a solid gold one. `withLabel` turns it into a pill for profiles.
 */
export function VerifiedBadge({
  className,
  hit,
  withLabel = false,
}: {
  className?: string;
  hit: Pick<DirectoryHit, "kind" | "kycTier" | "verificationStatus">;
  withLabel?: boolean;
}) {
  const verification = verificationOf(hit);
  if (!verification) return null;
  const label = labelFor(verification);
  const tone = verification.kind === "business" ? "is-business" : `is-tier${verification.tier}`;

  if (withLabel) {
    return (
      <span className={cn("verified-pill", tone, className)}>
        <BadgeCheck aria-hidden className="verified-seal h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  return (
    <span className={cn("verified-badge", tone, className)} role="img" aria-label={label} title={label}>
      <BadgeCheck aria-hidden className="verified-seal" />
    </span>
  );
}
