/** Pure daily-limit maths. The DB-backed gate lives in service.ts. */

export type KycLimits = {
  t1OnrampNgn: number;
  t1OfframpUsdc: number;
  t2OnrampNgn: number;
  t2OfframpUsdc: number;
  basicOnrampNgn: number;
  basicOfframpUsdc: number;
  fullOnrampNgn: number;
  fullOfframpUsdc: number;
};

export type VolumeUsed = { onrampNgn: number; offrampUsdc: number };

export type Allowance = {
  onrampNgn: number;
  offrampUsdc: number;
  capOnrampNgn: number;
  capOfframpUsdc: number;
  nextTier: number | null;
};

function money(value: number) {
  return Math.max(0, Math.round(value * 100) / 100);
}

function capFor(tier: number, kybLevel: "NONE" | "BASIC" | "FULL", limits: KycLimits) {
  let onramp = 0;
  let offramp = 0;
  if (tier >= 2) {
    onramp = limits.t2OnrampNgn;
    offramp = limits.t2OfframpUsdc;
  } else if (tier >= 1) {
    onramp = limits.t1OnrampNgn;
    offramp = limits.t1OfframpUsdc;
  }
  if (kybLevel === "FULL") {
    onramp = Math.max(onramp, limits.fullOnrampNgn);
    offramp = Math.max(offramp, limits.fullOfframpUsdc);
  } else if (kybLevel === "BASIC") {
    onramp = Math.max(onramp, limits.basicOnrampNgn);
    offramp = Math.max(offramp, limits.basicOfframpUsdc);
  }
  return { onramp, offramp };
}

/**
 * Remaining 24-hour allowance at this personal tier (and optional KYB
 * level). Tier 0 has no allowance. Amounts are major units (naira, USDC).
 */
export function remainingAllowance(
  tier: number,
  used: VolumeUsed,
  limits: KycLimits,
  kybLevel: "NONE" | "BASIC" | "FULL" = "NONE",
): Allowance {
  if (tier < 1) {
    return { onrampNgn: 0, offrampUsdc: 0, capOnrampNgn: 0, capOfframpUsdc: 0, nextTier: 1 };
  }
  const cap = capFor(tier, kybLevel, limits);
  const nextTier = tier >= 2 ? null : 2;
  return {
    onrampNgn: money(cap.onramp - used.onrampNgn),
    offrampUsdc: money(cap.offramp - used.offrampUsdc),
    capOnrampNgn: cap.onramp,
    capOfframpUsdc: cap.offramp,
    nextTier,
  };
}

/** True when `amount` (major units) still fits in `remaining`. */
export function fitsAllowance(remaining: number, amount: number) {
  return Math.round(amount * 100) <= Math.round(remaining * 100);
}

/** True when today's volume, including a just-saved order, is over the cap. */
export function exceedsCap(used: number, cap: number) {
  return Math.round(used * 100) > Math.round(cap * 100);
}

/**
 * The KYB level that counts today. A business that passed CAC and TIN
 * reaches FULL as soon as the owner holds Tier 2, whichever came first.
 */
export function effectiveKybLevel(
  row: { status: string; level: "NONE" | "BASIC" | "FULL"; tin_hash: string | null } | null,
  personalTier: number,
): "NONE" | "BASIC" | "FULL" {
  if (!row || row.status !== "VERIFIED") return "NONE";
  if (row.level === "BASIC" && row.tin_hash && personalTier >= 2) return "FULL";
  return row.level;
}

export const defaultKycLimits: KycLimits = {
  t1OnrampNgn: 500_000,
  t1OfframpUsdc: 500,
  t2OnrampNgn: 5_000_000,
  t2OfframpUsdc: 5_000,
  basicOnrampNgn: 10_000_000,
  basicOfframpUsdc: 10_000,
  fullOnrampNgn: 50_000_000,
  fullOfframpUsdc: 50_000,
};
