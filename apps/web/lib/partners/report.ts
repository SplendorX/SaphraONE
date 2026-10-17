// Server-only. What each offer brought in: the funnel (clicks → signups →
// with perks → activated), the money (volume, fees, perks, partner pay) and
// the net. Shared by the admin report and the partner's own dashboard.
import { partnersDb, partnerTables } from "@/lib/partners/db";
import { floorUsdc } from "@/lib/partners/rules";
import type { MemberRow, OfferRow, PartnerRow } from "@/lib/partners/types";
import { referralDb, referralTables } from "@/lib/referral/db";
import { loadTierPolicy } from "@/lib/referral/usdc-commission";

/** Earnings rows that are a bounty rather than a share of a fee. */
export const BOUNTY_SOURCE = "partner_bounty";

const ACTIVE_WINDOW_MS = 30 * 86_400_000;

export type OfferReport = {
  offerId: string;
  code: string;
  title: string;
  status: OfferRow["status"];
  clicks: number;
  signups: number;
  withPerks: number;
  held: number;
  activated: number;
  volumeUsd: number;
  feesUsd: number;
  /** Perks paid or credited so far, in USD (points at $0.01). */
  perksPaidUsd: number;
  /** Budget taken, including perks still on hold. */
  perksCommittedUsd: number;
  budgetUsd: number;
  commissionUsdc: number;
  bountiesUsdc: number;
  /** Fees less perks committed less partner pay. */
  netUsd: number;
  costPerActivatedUsd: number | null;
};

type EarningRow = {
  amount_usdc: number;
  created_at: string;
  fee_usd: number;
  referred_wallet: string;
  source: string;
  status: string;
  volume_usd: number;
};

/** The report for these offers (each partner's own), newest first. */
export async function offerReports(offers: OfferRow[], partners: PartnerRow[]): Promise<OfferReport[]> {
  if (!offers.length) return [];
  const db = partnersDb();
  const offerIds = offers.map((offer) => offer.id);
  const [membersResult, eventsResult, policy] = await Promise.all([
    db.from(partnerTables.members).select("wallet_address,offer_id,perks_status").in("offer_id", offerIds).limit(100_000),
    db
      .from(partnerTables.events)
      .select("offer_id,amount_usdc,points,budget_usd,status")
      .in("offer_id", offerIds)
      .in("status", ["CLAIMED", "CREDITED", "GRANTED"])
      .limit(100_000),
    loadTierPolicy(),
  ]);
  const members = (membersResult.data ?? []) as Array<Pick<MemberRow, "offer_id" | "perks_status" | "wallet_address">>;
  const offerOf = new Map(members.map((member) => [member.wallet_address, member.offer_id]));
  const activeMin = policy[0]?.activeMinTransactions ?? 5;

  // Referral earnings of every member: their fees, volume and what the partner earned.
  const earnings: EarningRow[] = [];
  const wallets = [...offerOf.keys()];
  for (let start = 0; start < wallets.length; start += 200) {
    const { data } = await referralDb()
      .from("referral_fee_earnings")
      .select("referred_wallet,amount_usdc,fee_usd,volume_usd,source,status,created_at")
      .in("referred_wallet", wallets.slice(start, start + 200))
      .neq("status", "REVERSED")
      .limit(100_000);
    earnings.push(...((data ?? []) as EarningRow[]));
  }

  const clicks = await Promise.all(
    offers.map(async (offer) => {
      const partner = partners.find((row) => row.id === offer.partner_id);
      if (!partner) return 0;
      const { count } = await referralDb()
        .from(referralTables.attributions)
        .select("id", { count: "exact", head: true })
        .eq("referrer_wallet", partner.wallet_address)
        .eq("metadata->>offer_code", offer.code);
      return count ?? 0;
    }),
  );

  const since = Date.now() - ACTIVE_WINDOW_MS;
  return offers.map((offer, index) => {
    const own = members.filter((member) => member.offer_id === offer.id);
    const rows = earnings.filter((row) => offerOf.get(row.referred_wallet) === offer.id);
    const feeRows = rows.filter((row) => row.source !== BOUNTY_SOURCE);
    const recent = new Map<string, number>();
    for (const row of feeRows) {
      if (Date.parse(row.created_at) >= since) recent.set(row.referred_wallet, (recent.get(row.referred_wallet) ?? 0) + 1);
    }
    const activated = [...recent.values()].filter((count) => count >= activeMin).length;
    const paidEvents = ((eventsResult.data ?? []) as Array<{ amount_usdc: number; budget_usd: number; offer_id: string; points: number }>).filter(
      (event) => event.offer_id === offer.id,
    );
    const feesUsd = feeRows.reduce((sum, row) => sum + Number(row.fee_usd), 0);
    const commissionUsdc = feeRows.reduce((sum, row) => sum + Number(row.amount_usdc), 0);
    const bountiesUsdc = rows.filter((row) => row.source === BOUNTY_SOURCE).reduce((sum, row) => sum + Number(row.amount_usdc), 0);
    const perksCommittedUsd = Number(offer.spent_usdc);
    const cost = perksCommittedUsd + commissionUsdc + bountiesUsdc;
    return {
      activated,
      budgetUsd: Number(offer.budget_usdc),
      bountiesUsdc: floorUsdc(bountiesUsdc),
      clicks: clicks[index],
      code: offer.code,
      commissionUsdc: floorUsdc(commissionUsdc),
      costPerActivatedUsd: activated ? Math.round((cost / activated) * 100) / 100 : null,
      feesUsd: floorUsdc(feesUsd),
      held: own.filter((member) => member.perks_status === "HELD").length,
      netUsd: Math.round((feesUsd - cost) * 100) / 100,
      offerId: offer.id,
      perksCommittedUsd: floorUsdc(perksCommittedUsd),
      perksPaidUsd: floorUsdc(paidEvents.reduce((sum, event) => sum + Number(event.budget_usd), 0)),
      signups: own.length,
      status: offer.status,
      title: offer.title,
      volumeUsd: Math.round(feeRows.reduce((sum, row) => sum + Number(row.volume_usd), 0) * 100) / 100,
      withPerks: own.filter((member) => member.perks_status !== "NO_PERKS").length,
    };
  });
}

/** Every referral earning of a partner (fees and bounties) as CSV, for a payout statement. */
export async function partnerStatementCsv(partner: PartnerRow, from?: string, to?: string) {
  let query = referralDb()
    .from("referral_fee_earnings")
    .select("created_at,referred_wallet,source,tx_hash,fee_usd,commission_bps,amount_usdc,status")
    .eq("referrer_wallet", partner.wallet_address)
    .order("created_at", { ascending: true })
    .limit(100_000);
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ["date", "member_wallet", "type", "transaction", "fee_usd", "commission_bps", "earned_usdc", "status"];
  const lines = ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
    [
      row.created_at,
      row.referred_wallet,
      row.source === BOUNTY_SOURCE ? "bounty" : `commission (${row.source})`,
      String(row.tx_hash ?? "").startsWith("bounty:") ? "" : row.tx_hash,
      row.fee_usd,
      row.commission_bps,
      row.amount_usdc,
      row.status,
    ]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
