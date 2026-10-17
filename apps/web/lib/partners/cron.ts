// Server-only. The daily Creator Partners job: perks past their hold become
// claimable (USDC) or are credited (points), welcome periods that are over
// end, and small rebate balances left at the end are paid without a claim.
import { claimPerkRebates } from "@/lib/partners/claims";
import { AUTO_PAYOUT_MIN_USDC, MIN_PERK_CLAIM_USDC } from "@/lib/partners/config";
import { partnersDb, partnerTables } from "@/lib/partners/db";
import { floorUsdc } from "@/lib/partners/rules";
import type { MemberRow, PerkEventRow } from "@/lib/partners/types";
import { recordLedgerEntry } from "@/lib/referral/ledger-service";

const batch = 500;

const pointsEntry: Record<string, { entryType: "PARTNER_CASHBACK_BOOST" | "PARTNER_WELCOME_POINTS"; label: string }> = {
  CASHBACK_BOOST: { entryType: "PARTNER_CASHBACK_BOOST", label: "Partner cashback boost" },
  WELCOME_POINTS: { entryType: "PARTNER_WELCOME_POINTS", label: "Welcome points" },
};

/** Move held perks on once their hold is over and their member isn't under review. */
async function releaseDuePerks(now: Date) {
  const db = partnersDb();
  const { data, error } = await db
    .from(partnerTables.events)
    .select("*")
    .eq("status", "PENDING")
    .lte("claimable_at", now.toISOString())
    .order("claimable_at")
    .limit(batch);
  if (error) throw new Error(error.message);
  const events = (data ?? []) as PerkEventRow[];
  if (!events.length) return { claimable: 0, credited: 0 };

  const { data: members } = await db
    .from(partnerTables.members)
    .select("wallet_address,perks_status")
    .in("wallet_address", [...new Set(events.map((event) => event.wallet_address))]);
  const statusOf = new Map(
    ((members ?? []) as Array<Pick<MemberRow, "perks_status" | "wallet_address">>).map((row) => [row.wallet_address, row.perks_status]),
  );

  let claimable = 0;
  let credited = 0;
  for (const event of events) {
    const status = statusOf.get(event.wallet_address);
    // Held members wait for review; revoked ones were reversed already.
    if (status !== "ACTIVE" && status !== "ENDED" && status !== "NO_PERKS") continue;

    const entry = pointsEntry[event.kind];
    if (!entry) {
      const { data: moved } = await db
        .from(partnerTables.events)
        .update({ status: "CLAIMABLE" })
        .eq("id", event.id)
        .eq("status", "PENDING")
        .select("id");
      claimable += moved?.length ?? 0;
      continue;
    }

    try {
      const ledger = await recordLedgerEntry({
        description: entry.label,
        entryType: entry.entryType,
        idempotencyKey: `partner_perk_${event.id}`,
        metadata: { offerId: event.offer_id, source: "creator_partner", useKey: event.use_key },
        points: Number(event.points),
        walletAddress: event.wallet_address,
      });
      await db
        .from(partnerTables.events)
        .update({ ledger_entry_id: ledger.entry.id, status: "CREDITED" })
        .eq("id", event.id)
        .eq("status", "PENDING");
      credited += 1;
    } catch (cause) {
      console.error("[partners] credit points", event.id, cause instanceof Error ? cause.message : cause);
    }
  }
  return { claimable, credited };
}

/** Welcome periods that are over. */
async function endWindows(now: Date) {
  const { data, error } = await partnersDb()
    .from(partnerTables.members)
    .update({ perks_status: "ENDED", updated_at: now.toISOString() })
    .eq("perks_status", "ACTIVE")
    .lte("perks_end_at", now.toISOString())
    .select("wallet_address");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/**
 * Members whose period ended with nothing still on hold and a USDC balance
 * too small to claim by hand: pay it, so no one loses a small amount.
 */
async function payLeftovers() {
  const db = partnersDb();
  const { data } = await db
    .from(partnerTables.events)
    .select("wallet_address,amount_usdc")
    .eq("status", "CLAIMABLE")
    .gt("amount_usdc", 0)
    .limit(5000);
  const totals = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ amount_usdc: number; wallet_address: string }>) {
    totals.set(row.wallet_address, (totals.get(row.wallet_address) ?? 0) + Number(row.amount_usdc));
  }
  const small = [...totals].filter(([, total]) => {
    const amount = floorUsdc(total);
    return amount >= AUTO_PAYOUT_MIN_USDC && amount < MIN_PERK_CLAIM_USDC;
  });
  if (!small.length) return 0;

  const [ended, pending] = await Promise.all([
    db
      .from(partnerTables.members)
      .select("wallet_address")
      .eq("perks_status", "ENDED")
      .in("wallet_address", small.map(([wallet]) => wallet)),
    db
      .from(partnerTables.events)
      .select("wallet_address")
      .eq("status", "PENDING")
      .in("wallet_address", small.map(([wallet]) => wallet)),
  ]);
  const waiting = new Set(((pending.data ?? []) as Array<{ wallet_address: string }>).map((row) => row.wallet_address));
  let paid = 0;
  for (const { wallet_address: wallet } of (ended.data ?? []) as Array<{ wallet_address: string }>) {
    if (waiting.has(wallet)) continue;
    try {
      await claimPerkRebates(wallet, { automatic: true });
      paid += 1;
    } catch (cause) {
      console.warn("[partners] leftover payout", wallet, cause instanceof Error ? cause.message : cause);
    }
  }
  return paid;
}

export async function runPartnerPerksCron(now = new Date()) {
  const released = await releaseDuePerks(now);
  const ended = await endWindows(now);
  const leftoversPaid = await payLeftovers();
  return { ...released, ended, leftoversPaid };
}
