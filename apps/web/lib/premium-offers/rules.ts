/**
 * Premium offers: campaigns on premium purchases. A live offer lowers the
 * USDC price at checkout and/or adds bonus days to the term bought. Pure, so
 * the admin page, the checkout server and the tests read the same rules.
 */

export const premiumOfferProducts = ["ALLIE_PRO", "EARN_AUTO_DEPOSIT", "PAYROLL_AUTO_SCHEDULE"] as const;
export type PremiumOfferProduct = (typeof premiumOfferProducts)[number];

export const premiumOfferProductLabels: Record<PremiumOfferProduct, string> = {
  ALLIE_PRO: "ALLIE Pro",
  EARN_AUTO_DEPOSIT: "Automatic deposits",
  PAYROLL_AUTO_SCHEDULE: "Automatic payroll",
};

/** Where each product is bought, for Home's banner. */
export const premiumOfferProductHrefs: Record<PremiumOfferProduct, string> = {
  ALLIE_PRO: "/settings?focus=allie-pro#agent-wallet",
  EARN_AUTO_DEPOSIT: "/earn",
  PAYROLL_AUTO_SCHEDULE: "/business/payroll",
};

export const MAX_DISCOUNT_PERCENT = 90;
export const MAX_BONUS_DAYS = 365;
/** A payment started before an offer ended still gets it, for this long. */
export const OFFER_GRACE_MS = 30 * 60 * 1000;

export type PremiumOffer = {
  bonus_days: number;
  created_at: string;
  created_by: string;
  discount_percent: number;
  ends_at: string;
  headline: string;
  id: string;
  max_per_member: number;
  max_redemptions: number | null;
  products: PremiumOfferProduct[];
  starts_at: string;
  status: "draft" | "live" | "ended";
  title: string;
  updated_at: string;
};

/** What the browser is told about a member's offer on a product: enough for a price tag. */
export type PremiumOfferView = {
  basePriceUsdc: number;
  bonusDays: number;
  discountPercent: number;
  endsAt: string;
  headline: string;
  priceUsdc: number;
  title: string;
} | null;

export function isPremiumOfferProduct(value: unknown): value is PremiumOfferProduct {
  return premiumOfferProducts.includes(value as PremiumOfferProduct);
}

/** Where an offer stands now, for the admin list. */
export function offerState(offer: PremiumOffer, now = new Date()) {
  if (offer.status === "draft") return "draft" as const;
  if (offer.status === "ended" || Date.parse(offer.ends_at) <= now.getTime()) return "ended" as const;
  if (Date.parse(offer.starts_at) > now.getTime()) return "scheduled" as const;
  return "live" as const;
}

/** Whether an offer applies at `at`; `graceMs` keeps it a little past its end, for payments in flight. */
export function offerOpen(offer: PremiumOffer, at: Date, graceMs = 0) {
  if (offer.status !== "live") return false;
  const time = at.getTime();
  return Date.parse(offer.starts_at) <= time && time < Date.parse(offer.ends_at) + graceMs;
}

/** The price after the discount, to the cent, never below 1 cent. */
export function discountedPrice(basePriceUsdc: number, discountPercent: number) {
  if (!(discountPercent > 0)) return basePriceUsdc;
  const price = Math.round(basePriceUsdc * (100 - Math.min(discountPercent, MAX_DISCOUNT_PERCENT))) / 100;
  return Math.max(0.01, price);
}

/**
 * The offer a purchase gets: the biggest discount among those still open to
 * this member (under their limit and the total cap), then the most bonus days.
 */
export function pickOffer(
  offers: readonly PremiumOffer[],
  input: {
    at: Date;
    graceMs?: number;
    product: PremiumOfferProduct;
    /** Purchases each offer already applied to: this member's, and everyone's. */
    usedByMember: Record<string, number>;
    usedInAll: Record<string, number>;
  },
): PremiumOffer | null {
  const open = offers.filter(
    (offer) =>
      offer.products.includes(input.product) &&
      offerOpen(offer, input.at, input.graceMs) &&
      (input.usedByMember[offer.id] ?? 0) < offer.max_per_member &&
      (offer.max_redemptions === null || (input.usedInAll[offer.id] ?? 0) < offer.max_redemptions),
  );
  open.sort((a, b) => b.discount_percent - a.discount_percent || b.bonus_days - a.bonus_days);
  return open[0] ?? null;
}

/** The short line for a banner or a price tag: "50% off · +7 days". */
export function offerSummary(offer: Pick<PremiumOffer, "bonus_days" | "discount_percent">) {
  const parts: string[] = [];
  if (offer.discount_percent > 0) parts.push(`${offer.discount_percent}% off`);
  if (offer.bonus_days > 0) parts.push(`+${offer.bonus_days} bonus day${offer.bonus_days === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export class PremiumOfferError extends Error {}

function whole(value: unknown, label: string, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim() || 0);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new PremiumOfferError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return parsed;
}

/** What an admin sends, checked: the same rules as the table's. */
export function readOfferInput(body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
  if (!title) throw new PremiumOfferError("Give the offer a name.");
  if (title.length > 80) throw new PremiumOfferError("The name can be at most 80 characters.");
  const headline = typeof body.headline === "string" ? body.headline.trim().replace(/\s+/g, " ") : "";
  if (headline.length > 140) throw new PremiumOfferError("The headline can be at most 140 characters.");

  const products = Array.isArray(body.products) ? [...new Set(body.products)] : [];
  if (!products.length || !products.every(isPremiumOfferProduct)) {
    throw new PremiumOfferError("Choose at least one product.");
  }

  const discount = whole(body.discountPercent, "Discount", 0, MAX_DISCOUNT_PERCENT);
  const bonus = whole(body.bonusDays, "Bonus days", 0, MAX_BONUS_DAYS);
  if (discount === 0 && bonus === 0) throw new PremiumOfferError("Add a discount, bonus days, or both.");

  const perMember = whole(body.maxPerMember ?? 1, "Uses per member", 1, 100);
  const cap =
    body.maxRedemptions === null || body.maxRedemptions === undefined || body.maxRedemptions === ""
      ? null
      : whole(body.maxRedemptions, "Total uses", 1, 1_000_000);

  const startsAt = body.startsAt ? Date.parse(String(body.startsAt)) : Date.now();
  const endsAt = Date.parse(String(body.endsAt ?? ""));
  if (!Number.isFinite(startsAt)) throw new PremiumOfferError("The start isn't a valid date.");
  if (!Number.isFinite(endsAt)) throw new PremiumOfferError("Set when the offer ends.");
  if (endsAt <= startsAt) throw new PremiumOfferError("The end must be after the start.");

  return {
    bonus_days: bonus,
    discount_percent: discount,
    ends_at: new Date(endsAt).toISOString(),
    headline,
    max_per_member: perMember,
    max_redemptions: cap,
    products: products as PremiumOfferProduct[],
    starts_at: new Date(startsAt).toISOString(),
    title,
  };
}
