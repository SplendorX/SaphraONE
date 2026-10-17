// Server-only. The admin side of Creator Partners: partners, offers and their
// perks, and the review queue for held members.
import { partnersDb, partnerTables } from "@/lib/partners/db";
import {
  normalizeOfferCode,
  PartnerError,
  readOfferInput,
  readPartnerInput,
  readPerksInput,
} from "@/lib/partners/rules";
import type { MemberRow, OfferRow, PartnerRow, PerkEventRow, PerkRow } from "@/lib/partners/types";
import { referralDb, referralTables } from "@/lib/referral/db";

function fail(message: string | undefined, fallback: string): never {
  if (message?.toLowerCase().includes("does not exist")) {
    throw new PartnerError("Run packages/database/supabase/creator-partners.sql in Supabase first.", 503);
  }
  throw new PartnerError(message || fallback, 500);
}

function id(value: unknown, label = "id") {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new PartnerError(`A valid ${label} is required.`);
  return value;
}

export type AdminOffer = OfferRow & {
  perks: PerkRow[];
  stats: { active: number; held: number; members: number; noPerks: number };
};
export type AdminPartner = PartnerRow & { offers: AdminOffer[]; username: string | null };

/** Every partner with their offers, perks and member counts. */
export async function loadAdminPartners(): Promise<AdminPartner[]> {
  const db = partnersDb();
  const [partners, offers, perks, members] = await Promise.all([
    db.from(partnerTables.partners).select("*").order("created_at", { ascending: false }),
    db.from(partnerTables.offers).select("*").order("created_at", { ascending: false }),
    db.from(partnerTables.perks).select("*"),
    db.from(partnerTables.members).select("offer_id,perks_status").limit(100_000),
  ]);
  if (partners.error) fail(partners.error.message, "Could not load partners.");
  const partnerRows = (partners.data ?? []) as PartnerRow[];
  const usernames = partnerRows.length
    ? await referralDb()
        .from(referralTables.userProfiles)
        .select("wallet_address,username")
        .in("wallet_address", partnerRows.map((row) => row.wallet_address))
    : { data: [] };
  const usernameOf = new Map(
    ((usernames.data ?? []) as Array<{ username: string; wallet_address: string }>).map((row) => [row.wallet_address, row.username]),
  );

  const counts = new Map<string, AdminOffer["stats"]>();
  for (const row of (members.data ?? []) as Array<Pick<MemberRow, "offer_id" | "perks_status">>) {
    const stats = counts.get(row.offer_id) ?? { active: 0, held: 0, members: 0, noPerks: 0 };
    stats.members += 1;
    if (row.perks_status === "ACTIVE") stats.active += 1;
    if (row.perks_status === "HELD") stats.held += 1;
    if (row.perks_status === "NO_PERKS") stats.noPerks += 1;
    counts.set(row.offer_id, stats);
  }
  const perkRows = (perks.data ?? []) as PerkRow[];
  const offerRows = ((offers.data ?? []) as OfferRow[]).map((offer) => ({
    ...offer,
    perks: perkRows.filter((perk) => perk.offer_id === offer.id),
    stats: counts.get(offer.id) ?? { active: 0, held: 0, members: 0, noPerks: 0 },
  }));
  return partnerRows.map((partner) => ({
    ...partner,
    offers: offerRows.filter((offer) => offer.partner_id === partner.id),
    username: usernameOf.get(partner.wallet_address) ?? null,
  }));
}

/** A partner must already have a SaphraONE account: that's where commission is paid. */
async function requireAccount(wallet: string) {
  const { data } = await referralDb()
    .from(referralTables.userProfiles)
    .select("wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (!data) throw new PartnerError("No SaphraONE account uses that wallet. The partner signs up first.");
}

export async function createPartner(body: Record<string, unknown>) {
  const fields = readPartnerInput(body);
  await requireAccount(fields.wallet_address);
  const { data, error } = await partnersDb().from(partnerTables.partners).insert(fields).select("*").single();
  if (error) {
    if (error.code === "23505") throw new PartnerError("That wallet is already a partner.", 409);
    fail(error.message, "The partner could not be saved.");
  }
  return data as PartnerRow;
}

export async function updatePartner(partnerId: unknown, body: Record<string, unknown>) {
  const fields = readPartnerInput(body);
  const { error } = await partnersDb()
    .from(partnerTables.partners)
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id(partnerId, "partner"));
  if (error) fail(error.message, "The partner could not be saved.");
}

export async function setPartnerStatus(partnerId: unknown, status: unknown) {
  if (status !== "ACTIVE" && status !== "PAUSED" && status !== "ENDED") throw new PartnerError("Unknown status.");
  const { error } = await partnersDb()
    .from(partnerTables.partners)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id(partnerId, "partner"));
  if (error) fail(error.message, "The partner could not be updated.");
}

async function loadOfferRow(offerId: string) {
  const { data, error } = await partnersDb().from(partnerTables.offers).select("*").eq("id", offerId).maybeSingle();
  if (error) fail(error.message, "Could not load the offer.");
  if (!data) throw new PartnerError("Offer not found.", 404);
  return data as OfferRow;
}

async function replacePerks(offerId: string, perks: ReturnType<typeof readPerksInput>) {
  const db = partnersDb();
  const removed = await db.from(partnerTables.perks).delete().eq("offer_id", offerId);
  if (removed.error) fail(removed.error.message, "The perks could not be saved.");
  if (!perks.length) return;
  const { error } = await db
    .from(partnerTables.perks)
    .insert(perks.map((perk) => ({ config: perk.config, kind: perk.kind, offer_id: offerId })));
  if (error) fail(error.message, "The perks could not be saved.");
}

/** A new offer, as a draft, with its perks. */
export async function createOffer(body: Record<string, unknown>) {
  const partnerId = id(body.partnerId, "partner");
  const fields = readOfferInput(body);
  const perks = readPerksInput(body.perks ?? []);
  const { data, error } = await partnersDb()
    .from(partnerTables.offers)
    .insert({ ...fields, partner_id: partnerId, status: "DRAFT" })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") throw new PartnerError("That link code is taken. Choose another.", 409);
    fail(error.message, "The offer could not be saved.");
  }
  const offer = data as OfferRow;
  await replacePerks(offer.id, perks);
  return offer;
}

/**
 * Change an offer. Its perks can only change while it's a draft: members
 * who joined a live offer keep the package they signed up for.
 */
export async function updateOffer(offerId: unknown, body: Record<string, unknown>) {
  const offer = await loadOfferRow(id(offerId, "offer"));
  // Fields the request leaves out keep their current values.
  const fields = readOfferInput({ ...offer, ...body, code: body.code ?? offer.code });
  if (offer.status !== "DRAFT" && fields.code !== offer.code) {
    throw new PartnerError("A live offer's link code can't change: people already have the link.");
  }
  if (Number(fields.budget_usdc) < Number(offer.spent_usdc)) {
    throw new PartnerError(`The budget can't be lower than what's already spent ($${Number(offer.spent_usdc).toFixed(2)}).`);
  }
  const { error } = await partnersDb()
    .from(partnerTables.offers)
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", offer.id);
  if (error) {
    if (error.code === "23505") throw new PartnerError("That link code is taken. Choose another.", 409);
    fail(error.message, "The offer could not be saved.");
  }
  if (body.perks !== undefined) {
    if (offer.status !== "DRAFT") throw new PartnerError("Perks can only change while the offer is a draft.");
    await replacePerks(offer.id, readPerksInput(body.perks));
  }
}

/** Go live, pause or end an offer. Going live needs perks and a budget. */
export async function setOfferStatus(offerId: unknown, status: unknown) {
  if (status !== "LIVE" && status !== "PAUSED" && status !== "ENDED") throw new PartnerError("Unknown status.");
  const offer = await loadOfferRow(id(offerId, "offer"));
  if (offer.status === "ENDED") throw new PartnerError("An ended offer can't change.");
  if (status === "LIVE") {
    const { count } = await partnersDb()
      .from(partnerTables.perks)
      .select("id", { count: "exact", head: true })
      .eq("offer_id", offer.id);
    if (!count) throw new PartnerError("Add at least one perk before going live.");
    if (!(Number(offer.budget_usdc) > 0)) throw new PartnerError("Give the offer a budget before going live.");
  }
  const { error } = await partnersDb()
    .from(partnerTables.offers)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", offer.id);
  if (error) fail(error.message, "The offer could not be updated.");
}

export async function findOfferByCode(raw: unknown) {
  const code = normalizeOfferCode(raw);
  if (!code) throw new PartnerError("Enter a valid link code.");
  const { data } = await partnersDb().from(partnerTables.offers).select("id").eq("code", code).maybeSingle();
  return data as { id: string } | null;
}

export type HeldMember = MemberRow & { offer_code: string; username: string | null };

/** Members whose perks wait for review, oldest first. */
export async function loadHeldMembers(): Promise<HeldMember[]> {
  const db = partnersDb();
  const { data, error } = await db
    .from(partnerTables.members)
    .select("*")
    .eq("perks_status", "HELD")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return [];
  const rows = (data ?? []) as MemberRow[];
  if (!rows.length) return [];
  const [offers, users] = await Promise.all([
    db.from(partnerTables.offers).select("id,code").in("id", [...new Set(rows.map((row) => row.offer_id))]),
    referralDb()
      .from(referralTables.userProfiles)
      .select("wallet_address,username")
      .in("wallet_address", rows.map((row) => row.wallet_address)),
  ]);
  const codeOf = new Map(((offers.data ?? []) as Array<{ code: string; id: string }>).map((row) => [row.id, row.code]));
  const nameOf = new Map(
    ((users.data ?? []) as Array<{ username: string; wallet_address: string }>).map((row) => [row.wallet_address, row.username]),
  );
  return rows.map((row) => ({
    ...row,
    offer_code: codeOf.get(row.offer_id) ?? "",
    username: nameOf.get(row.wallet_address) ?? null,
  }));
}

function memberWallet(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new PartnerError("A valid member wallet is required.");
  return value.toLowerCase();
}

/** Release a held member: their perks go on as normal. */
export async function releaseMember(wallet: unknown, reviewer: string) {
  const { data, error } = await partnersDb()
    .from(partnerTables.members)
    .update({ no_perks_reason: null, perks_status: "ACTIVE", reviewed_by: reviewer, updated_at: new Date().toISOString() })
    .eq("wallet_address", memberWallet(wallet))
    .eq("perks_status", "HELD")
    .select("wallet_address");
  if (error) fail(error.message, "The member could not be released.");
  if (!data?.length) throw new PartnerError("That member isn't waiting for review.", 409);
}

/**
 * Revoke a member's perks: everything not yet paid or credited is reversed
 * and its budget goes back to the offer. What was already paid stays paid.
 */
export async function revokeMember(wallet: unknown, reviewer: string, reason: unknown) {
  const address = memberWallet(wallet);
  const db = partnersDb();
  const { data, error } = await db
    .from(partnerTables.members)
    .update({
      no_perks_reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : "Revoked after review.",
      perks_status: "REVOKED",
      reviewed_by: reviewer,
      updated_at: new Date().toISOString(),
    })
    .eq("wallet_address", address)
    .in("perks_status", ["ACTIVE", "HELD", "ENDED"])
    .select("wallet_address");
  if (error) fail(error.message, "The member could not be revoked.");
  if (!data?.length) throw new PartnerError("That member has no perks to revoke.", 409);

  const { data: open } = await db
    .from(partnerTables.events)
    .update({ status: "REVERSED" })
    .eq("wallet_address", address)
    .in("status", ["PENDING", "CLAIMABLE"])
    .select("offer_id,budget_usd");
  for (const event of (open ?? []) as Array<Pick<PerkEventRow, "budget_usd" | "offer_id">>) {
    if (Number(event.budget_usd) > 0) {
      await db.rpc("partner_release_budget", { p_amount: Number(event.budget_usd), p_offer_id: event.offer_id });
    }
  }
  return { reversed: open?.length ?? 0 };
}
