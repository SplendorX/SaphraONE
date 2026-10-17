// Server-only. Reads of the Creator Partners tables.
import { readPerkConfig } from "@/lib/partners/rules";
import type { PerkConfigs, PerkKind } from "@/lib/partners/config";
import type { MemberRow, OfferRow, PartnerRow, PerkRow } from "@/lib/partners/types";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const partnerTables = {
  claims: "partner_perk_claims",
  events: "partner_perk_events",
  members: "partner_members",
  offers: "partner_offers",
  partners: "creator_partners",
  perks: "partner_offer_perks",
} as const;

export function partnersDb() {
  return createSupabaseAdminClient();
}

/** An offer's perks as checked configs, by kind. */
export type OfferPerks = Partial<{ [K in PerkKind]: PerkConfigs[K] }>;

export function perksByKind(rows: PerkRow[]): OfferPerks {
  const perks: OfferPerks = {};
  for (const row of rows) {
    try {
      (perks as Record<string, unknown>)[row.kind] = readPerkConfig(row.kind, row.config);
    } catch {
      // A config that no longer reads is skipped rather than guessed at.
    }
  }
  return perks;
}

export type LoadedOffer = { offer: OfferRow; partner: PartnerRow; perks: OfferPerks; perkRows: PerkRow[] };

async function withPartnerAndPerks(offer: OfferRow | null): Promise<LoadedOffer | null> {
  if (!offer) return null;
  const db = partnersDb();
  const [partner, perks] = await Promise.all([
    db.from(partnerTables.partners).select("*").eq("id", offer.partner_id).maybeSingle(),
    db.from(partnerTables.perks).select("*").eq("offer_id", offer.id),
  ]);
  if (!partner.data) return null;
  const perkRows = (perks.data ?? []) as PerkRow[];
  return { offer, partner: partner.data as PartnerRow, perkRows, perks: perksByKind(perkRows) };
}

/** An offer by its link code, with its partner and perks; null if there's none (or no table yet). */
export async function loadOfferByCode(code: string) {
  const { data, error } = await partnersDb()
    .from(partnerTables.offers)
    .select("*")
    .eq("code", code.toLowerCase())
    .maybeSingle();
  if (error) return null;
  return withPartnerAndPerks((data as OfferRow | null) ?? null);
}

export async function loadOfferById(id: string) {
  const { data, error } = await partnersDb().from(partnerTables.offers).select("*").eq("id", id).maybeSingle();
  if (error) return null;
  return withPartnerAndPerks((data as OfferRow | null) ?? null);
}

/** The member row for a wallet, or null (also when the tables don't exist yet). */
export async function loadMember(walletAddress: string): Promise<MemberRow | null> {
  const { data, error } = await partnersDb()
    .from(partnerTables.members)
    .select("*")
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();
  if (error) return null;
  return (data as MemberRow | null) ?? null;
}

/** The creator partner behind a wallet, if it is one. */
export async function loadPartnerByWallet(walletAddress: string): Promise<PartnerRow | null> {
  const { data, error } = await partnersDb()
    .from(partnerTables.partners)
    .select("*")
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();
  if (error) return null;
  return (data as PartnerRow | null) ?? null;
}

export async function updateMember(walletAddress: string, fields: Partial<MemberRow>) {
  const { error } = await partnersDb()
    .from(partnerTables.members)
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("wallet_address", walletAddress.toLowerCase());
  if (error) throw new Error(error.message);
}
