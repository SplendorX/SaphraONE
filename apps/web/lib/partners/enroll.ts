// Server-only. Signing up through a creator's link: who becomes a member, and
// whether their welcome period starts with perks, waits for review or has none.
import crypto from "node:crypto";

import {
  creatorPartnersEnabled,
  NEW_REFERRAL_WINDOW_MS,
  SIGNUPS_PER_IP_PER_HOUR,
} from "@/lib/partners/config";
import { loadMember, loadOfferByCode, partnersDb, partnerTables } from "@/lib/partners/db";
import { memberWindow, normalizeOfferCode, offerAvailability, unavailableLabels } from "@/lib/partners/rules";
import type { MemberPerksStatus, MemberRow } from "@/lib/partners/types";
import type { ReferralRecord } from "@/lib/referral/types";

/** A short one-way hash, so the network and browser can be compared but not read. */
export function signupFingerprint(value: string | null | undefined) {
  const clean = value?.trim();
  return clean ? crypto.createHash("sha256").update(clean).digest("hex").slice(0, 16) : null;
}

/**
 * Make a new account a member of the offer it signed up through. Only for an
 * account whose referral to the offer's partner was created just now, so an
 * existing user can't collect a creator's welcome package by opening a link
 * later. Never throws: a failure here must not stop the signup.
 */
export async function enrollPartnerMember(input: {
  agentHash: string | null;
  ipHash: string | null;
  offerCode: string;
  referral: ReferralRecord | null;
  wallet: string;
  now?: Date;
}): Promise<MemberRow | null> {
  try {
    if (!creatorPartnersEnabled()) return null;
    const code = normalizeOfferCode(input.offerCode);
    const wallet = input.wallet.toLowerCase();
    const referral = input.referral;
    if (!code || !referral) return null;

    const now = input.now ?? new Date();
    const loaded = await loadOfferByCode(code);
    if (!loaded) return null;
    const { offer, partner } = loaded;

    // The account must be the partner's referral, attached by this signup.
    if (referral.referred_wallet.toLowerCase() !== wallet) return null;
    if (referral.referrer_wallet.toLowerCase() !== partner.wallet_address.toLowerCase()) return null;
    const attachedAt = Date.parse(referral.signed_up_at ?? referral.created_at);
    if (!Number.isFinite(attachedAt) || now.getTime() - attachedAt > NEW_REFERRAL_WINDOW_MS) return null;

    const existing = await loadMember(wallet);
    if (existing) return existing;

    let status: MemberPerksStatus = "ACTIVE";
    let reason: string | null = null;
    const availability = offerAvailability(offer, partner, now);
    if (!availability.available) {
      status = "NO_PERKS";
      reason = unavailableLabels[availability.reason];
    } else {
      const held = await reviewReason({ agentHash: input.agentHash, ipHash: input.ipHash, now, offerId: offer.id });
      if (held) {
        status = "HELD";
        reason = held;
      }
      const { data: seated } = await partnersDb().rpc("partner_take_seat", { p_offer_id: offer.id });
      if (seated !== true) {
        status = "NO_PERKS";
        reason = unavailableLabels.full;
      }
    }

    const window = memberWindow(now, offer.perk_days);
    const { data, error } = await partnersDb()
      .from(partnerTables.members)
      .insert({
        no_perks_reason: reason,
        offer_id: offer.id,
        partner_id: partner.id,
        perks_end_at: window.endsAt,
        perks_start_at: window.startsAt,
        perks_status: status,
        referral_id: referral.id,
        signup_agent_hash: input.agentHash,
        signup_ip_hash: input.ipHash,
        wallet_address: wallet,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") return loadMember(wallet);
      throw new Error(error.message);
    }
    return data as MemberRow;
  } catch (cause) {
    console.warn("[partners] enrol", cause instanceof Error ? cause.message : cause);
    return null;
  }
}

/**
 * Why a new member's perks should wait for a person to look: the same
 * browser on the same network as an earlier member of any offer (one
 * welcome package per person), or a burst of signups from one network.
 */
async function reviewReason(input: { agentHash: string | null; ipHash: string | null; now: Date; offerId: string }) {
  if (!input.ipHash) return null;
  const db = partnersDb();
  const hourAgo = new Date(input.now.getTime() - 3_600_000).toISOString();
  const [sameDevice, burst] = await Promise.all([
    input.agentHash
      ? db
          .from(partnerTables.members)
          .select("wallet_address", { count: "exact", head: true })
          .eq("signup_ip_hash", input.ipHash)
          .eq("signup_agent_hash", input.agentHash)
      : Promise.resolve({ count: 0 }),
    db
      .from(partnerTables.members)
      .select("wallet_address", { count: "exact", head: true })
      .eq("offer_id", input.offerId)
      .eq("signup_ip_hash", input.ipHash)
      .gte("created_at", hourAgo),
  ]);
  if ((sameDevice.count ?? 0) > 0) return "Another member signed up from the same device and network.";
  if ((burst.count ?? 0) >= SIGNUPS_PER_IP_PER_HOUR) return "Many signups from one network within an hour.";
  return null;
}
