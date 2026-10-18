// Server-only. Premium offers (lib/premium-offers/rules.ts): the admin's list,
// the price a member pays at checkout, and each purchase an offer applied to.
// Tables: premium_offers, premium_offer_redemptions (premium-offers.sql).
import {
  discountedPrice,
  OFFER_GRACE_MS,
  offerOpen,
  pickOffer,
  PremiumOfferError,
  readOfferInput,
  type PremiumOffer,
  type PremiumOfferView,
  type PremiumOfferProduct,
} from "@/lib/premium-offers/rules";
import { rewardsV2Enabled } from "@/lib/rewards/config";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export { PremiumOfferError };

function db() {
  return createSupabaseAdminClient();
}

function must<T>(result: { data: T | null; error: { message: string } | null }, fallback: string): T {
  if (result.error) {
    if (/premium_offer/.test(result.error.message) && /does not exist|schema cache/.test(result.error.message)) {
      throw new PremiumOfferError("Run packages/database/supabase/premium-offers.sql in Supabase first.");
    }
    throw new PremiumOfferError(result.error.message || fallback);
  }
  if (result.data === null) throw new PremiumOfferError(fallback);
  return result.data;
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export type AdminPremiumOffer = PremiumOffer & { redemptions: number };

export async function listPremiumOffers(): Promise<AdminPremiumOffer[]> {
  const offers = must(
    await db().from("premium_offers").select("*").order("created_at", { ascending: false }).limit(200),
    "Couldn't load offers.",
  ) as PremiumOffer[];
  const counts = await redemptionCounts(offers.map((offer) => offer.id));
  return offers.map((offer) => ({ ...offer, redemptions: counts.all[offer.id] ?? 0 }));
}

export async function createPremiumOffer(body: Record<string, unknown>, createdBy: string) {
  return must(
    await db()
      .from("premium_offers")
      .insert({ ...readOfferInput(body), created_by: createdBy, status: body.publish === true ? "live" : "draft" })
      .select("*")
      .single(),
    "Couldn't save the offer.",
  ) as PremiumOffer;
}

export async function updatePremiumOffer(id: unknown, body: Record<string, unknown>) {
  if (typeof id !== "string" || !id) throw new PremiumOfferError("Which offer?");
  return must(
    await db()
      .from("premium_offers")
      .update({ ...readOfferInput(body), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single(),
    "That offer wasn't found.",
  ) as PremiumOffer;
}

export async function setPremiumOfferStatus(id: unknown, status: PremiumOffer["status"]) {
  if (typeof id !== "string" || !id) throw new PremiumOfferError("Which offer?");
  return must(
    await db()
      .from("premium_offers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single(),
    "That offer wasn't found.",
  ) as PremiumOffer;
}

/** Only an offer nobody used can be deleted; a used one is ended instead. */
export async function deletePremiumOffer(id: unknown) {
  if (typeof id !== "string" || !id) throw new PremiumOfferError("Which offer?");
  const counts = await redemptionCounts([id]);
  if ((counts.all[id] ?? 0) > 0) throw new PremiumOfferError("This offer has been used. End it instead.");
  return must(
    await db().from("premium_offers").delete().eq("id", id).select("id,title").single(),
    "That offer wasn't found.",
  ) as Pick<PremiumOffer, "id" | "title">;
}

// ─── Checkout ────────────────────────────────────────────────────────────────

async function redemptionCounts(offerIds: string[], wallet?: string) {
  const all: Record<string, number> = {};
  const mine: Record<string, number> = {};
  if (!offerIds.length) return { all, mine };
  const { data } = await db()
    .from("premium_offer_redemptions")
    .select("offer_id,wallet_address")
    .in("offer_id", offerIds)
    .limit(100_000);
  for (const row of (data ?? []) as Array<{ offer_id: string; wallet_address: string }>) {
    all[row.offer_id] = (all[row.offer_id] ?? 0) + 1;
    if (wallet && row.wallet_address === wallet) mine[row.offer_id] = (mine[row.offer_id] ?? 0) + 1;
  }
  return { all, mine };
}

/** Live offers (with the grace past their end), newest first; none without the table. */
async function openOffers(at: Date, graceMs: number): Promise<PremiumOffer[]> {
  if (!rewardsV2Enabled()) return [];
  const { data, error } = await db()
    .from("premium_offers")
    .select("*")
    .eq("status", "live")
    .gt("ends_at", new Date(at.getTime() - graceMs).toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return ((data ?? []) as PremiumOffer[]).filter((offer) => offerOpen(offer, at, graceMs));
}

export type PremiumQuote = {
  basePriceUsdc: number;
  bonusDays: number;
  offer: PremiumOffer | null;
  priceUsdc: number;
};

/**
 * What `wallet` pays for `product` now, and any bonus days. `forPayment`
 * keeps an offer that ended in the last half hour, so a payment made while it
 * was on is never rejected for the full price.
 */
export async function quotePremium(input: {
  basePriceUsdc: number;
  forPayment?: boolean;
  product: PremiumOfferProduct;
  wallet: string | null;
}): Promise<PremiumQuote> {
  const none = { basePriceUsdc: input.basePriceUsdc, bonusDays: 0, offer: null, priceUsdc: input.basePriceUsdc };
  try {
    const at = new Date();
    const graceMs = input.forPayment ? OFFER_GRACE_MS : 0;
    const offers = (await openOffers(at, graceMs)).filter((offer) => offer.products.includes(input.product));
    if (!offers.length) return none;
    const wallet = input.wallet?.toLowerCase();
    const counts = await redemptionCounts(
      offers.map((offer) => offer.id),
      wallet,
    );
    const offer = pickOffer(offers, {
      at,
      graceMs,
      product: input.product,
      usedByMember: counts.mine,
      usedInAll: counts.all,
    });
    if (!offer) return none;
    return {
      basePriceUsdc: input.basePriceUsdc,
      bonusDays: offer.bonus_days,
      offer,
      priceUsdc: discountedPrice(input.basePriceUsdc, offer.discount_percent),
    };
  } catch (error) {
    console.warn("[premium-offers] quote", error instanceof Error ? error.message : error);
    return none;
  }
}

/** Record that an offer applied to a purchase. Never fatal: the purchase stands either way. */
export async function recordOfferRedemption(input: {
  product: PremiumOfferProduct;
  purchaseId: string;
  quote: PremiumQuote;
  wallet: string;
}) {
  if (!input.quote.offer) return;
  const { error } = await db().from("premium_offer_redemptions").insert({
    base_price_usdc: input.quote.basePriceUsdc,
    bonus_days: input.quote.bonusDays,
    offer_id: input.quote.offer.id,
    paid_usdc: input.quote.priceUsdc,
    product: input.product,
    purchase_id: input.purchaseId,
    wallet_address: input.wallet.toLowerCase(),
  });
  if (error && error.code !== "23505") console.error("[premium-offers] redemption", error.message);
}

/** Live now (no grace), for Home's banner and the price tags. */
export async function livePremiumOffers(): Promise<PremiumOffer[]> {
  return openOffers(new Date(), 0);
}

export function offerView(quote: PremiumQuote): PremiumOfferView {
  if (!quote.offer) return null;
  return {
    basePriceUsdc: quote.basePriceUsdc,
    bonusDays: quote.bonusDays,
    discountPercent: quote.offer.discount_percent,
    endsAt: quote.offer.ends_at,
    headline: quote.offer.headline,
    priceUsdc: quote.priceUsdc,
    title: quote.offer.title,
  };
}
