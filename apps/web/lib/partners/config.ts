/**
 * Creator Partners (CREATOR-PARTNERS-PLAN.md): the perk kinds, their default
 * numbers and the program's fixed rules. Shared by the browser (to explain the
 * perks) and the server (to apply them).
 */

/**
 * Live everywhere; nothing happens until an admin makes an offer live.
 * NEXT_PUBLIC_CREATOR_PARTNERS=false is only an emergency off switch.
 */
export function creatorPartnersEnabled() {
  return process.env.NEXT_PUBLIC_CREATOR_PARTNERS?.trim() !== "false";
}

/** The cookie /join/<code> sets so sign-up knows which offer brought someone. */
export const PARTNER_OFFER_COOKIE = "saphra_partner_offer";

export const perkKinds = [
  "FEE_REBATE",
  "WELCOME_POINTS",
  "CASHBACK_BOOST",
  "ALLIE_PRO_TRIAL",
  "PREMIUM_DISCOUNT",
] as const;

export type PerkKind = (typeof perkKinds)[number];

/** Premium products a PREMIUM_DISCOUNT can apply to. */
export const discountableProducts = ["ALLIE_PRO", "EARN_AUTO_DEPOSIT", "PAYROLL_AUTO_SCHEDULE"] as const;
export type DiscountableProduct = (typeof discountableProducts)[number];

/** Payment sources a fee rebate covers (the activity route's types, lowercased). */
export const rebateSources = [
  "transfer",
  "invoice_payment",
  "payroll_disbursement",
  "batch_payment",
] as const;
export type RebateSource = (typeof rebateSources)[number];

export type PerkConfigs = {
  ALLIE_PRO_TRIAL: { budgetUsd: number; days: number };
  CASHBACK_BOOST: { capPoints: number; multiplier: number };
  FEE_REBATE: { capUsdc: number; percent: number; sources: RebateSource[] };
  PREMIUM_DISCOUNT: { percent: number; products: DiscountableProduct[]; withinDays: number };
  WELCOME_POINTS: { points: number };
};

/** The standard welcome package (plan section 1). */
export const defaultPerkConfigs: PerkConfigs = {
  ALLIE_PRO_TRIAL: { budgetUsd: 1, days: 30 },
  CASHBACK_BOOST: { capPoints: 500, multiplier: 2 },
  FEE_REBATE: { capUsdc: 10, percent: 100, sources: [...rebateSources] },
  PREMIUM_DISCOUNT: { percent: 50, products: [...discountableProducts], withinDays: 60 },
  WELCOME_POINTS: { points: 300 },
};

export const perkLabels: Record<PerkKind, { name: string; paidAs: string }> = {
  ALLIE_PRO_TRIAL: { name: "ALLIE Pro free trial", paidAs: "Subscription" },
  CASHBACK_BOOST: { name: "Cashback boost", paidAs: "ONE Points" },
  FEE_REBATE: { name: "Fee rebates", paidAs: "USDC" },
  PREMIUM_DISCOUNT: { name: "Premium discount", paidAs: "USDC back" },
  WELCOME_POINTS: { name: "Welcome points", paidAs: "ONE Points" },
};

/** Default length of a member's welcome period. */
export const DEFAULT_PERK_DAYS = 30;

/** Rebates and bonus points wait this long, so a reviewed account can lose them. */
export const PERK_HOLD_DAYS = 7;

/** Smallest rebate claim; below it rebates keep adding up. */
export const MIN_PERK_CLAIM_USDC = 1;

/** At the end of the period, a balance at least this big is paid without a claim. */
export const AUTO_PAYOUT_MIN_USDC = 0.1;

/** What a point costs an offer's budget, in USD. */
export const BUDGET_USD_PER_POINT = 0.01;

/** Signups from one network in an hour, per offer, before new ones are held. */
export const SIGNUPS_PER_IP_PER_HOUR = 3;

/** A referral this old is an existing account, not a signup through the link. */
export const NEW_REFERRAL_WINDOW_MS = 15 * 60_000;

/** Members are told this many days before their welcome period ends. */
export const ENDING_NOTICE_DAYS = 3;
