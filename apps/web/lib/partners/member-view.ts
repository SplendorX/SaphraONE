// Server-only. What a member sees of their welcome package (GET /api/partners/me).
import { usdcPerkKinds } from "@/lib/partners/claims";
import { MIN_PERK_CLAIM_USDC, perkKinds, perkLabels } from "@/lib/partners/config";
import { loadMember, loadOfferById, partnersDb, partnerTables } from "@/lib/partners/db";
import { ensureAllieTrial } from "@/lib/partners/perks";
import { daysLeft, floorUsdc, perkSummary } from "@/lib/partners/rules";
import type { PerkEventRow, WelcomePerks } from "@/lib/partners/types";

function money(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function points(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const statusNotes: Partial<Record<WelcomePerks["status"], string>> = {
  ENDED: "Your welcome period has ended. Rebates you earned can still be claimed.",
  HELD: "Your welcome perks are being reviewed. They keep counting and can be claimed once that's done.",
  REVOKED: "Your welcome perks were cancelled after a review.",
};

/** The member's package, or null if the account didn't join through a creator's link. */
export async function loadWelcomePerks(walletAddress: string, now = new Date()): Promise<WelcomePerks | null> {
  const wallet = walletAddress.toLowerCase();
  let member = await loadMember(wallet);
  if (!member) return null;
  const loaded = await loadOfferById(member.offer_id);
  if (!loaded) return null;

  // The trial starts once the account is set up as personal.
  if (await ensureAllieTrial(member).catch(() => false)) {
    member = (await loadMember(wallet)) ?? member;
  }

  const { data } = await partnersDb()
    .from(partnerTables.events)
    .select("kind,amount_usdc,points,status,claimable_at")
    .eq("wallet_address", wallet)
    .neq("status", "REVERSED");
  const events = (data ?? []) as Array<Pick<PerkEventRow, "amount_usdc" | "claimable_at" | "kind" | "points" | "status">>;
  const usdcEvents = events.filter((event) => (usdcPerkKinds as readonly string[]).includes(event.kind));
  const sum = (rows: typeof events, status: string[]) =>
    floorUsdc(rows.filter((row) => status.includes(row.status)).reduce((total, row) => total + Number(row.amount_usdc), 0));
  const pendingUsdc = usdcEvents.filter((event) => event.status === "PENDING");

  const used = (kind: string) => events.filter((event) => event.kind === kind);
  const { perks, offer, partner } = loaded;

  return {
    daysLeft: daysLeft(member.perks_end_at, now),
    endsAt: member.perks_end_at,
    note: member.perks_status === "NO_PERKS" ? member.no_perks_reason : (statusNotes[member.perks_status] ?? null),
    offer: { code: offer.code, title: offer.title },
    partner: { avatarUrl: partner.avatar_url, displayName: partner.display_name, handle: partner.handle },
    pendingPoints: events
      .filter((event) => event.status === "PENDING")
      .reduce((total, event) => total + Number(event.points), 0),
    perks:
      member.perks_status === "NO_PERKS"
        ? []
        : perkKinds
            .filter((kind) => perks[kind])
            .map((kind) => {
              const rows = used(kind);
              let usage: string | null = null;
              if (kind === "FEE_REBATE" && perks.FEE_REBATE) {
                usage = `${money(rows.reduce((total, row) => total + Number(row.amount_usdc), 0))} of ${money(perks.FEE_REBATE.capUsdc)} used`;
              } else if (kind === "CASHBACK_BOOST" && perks.CASHBACK_BOOST) {
                usage = `${points(rows.reduce((total, row) => total + Number(row.points), 0))} of ${points(perks.CASHBACK_BOOST.capPoints)} extra points`;
              } else if (kind === "WELCOME_POINTS") {
                usage = rows.length ? "Earned" : "After your first payment";
              } else if (kind === "ALLIE_PRO_TRIAL") {
                usage = member!.trial_granted_at ? "Active" : "Starts when your account is set up";
              } else if (kind === "PREMIUM_DISCOUNT") {
                usage = rows.length ? `Used on ${rows.length} purchase${rows.length === 1 ? "" : "s"}` : null;
              }
              return { kind, name: perkLabels[kind].name, summary: perkSummary(kind, perks[kind], offer.perk_days), usage };
            }),
    rebates: {
      claimableUsdc: sum(usdcEvents, ["CLAIMABLE"]),
      claimedUsdc: sum(usdcEvents, ["CLAIMED"]),
      minClaimUsdc: MIN_PERK_CLAIM_USDC,
      nextClaimableAt: pendingUsdc.map((event) => event.claimable_at).sort()[0] ?? null,
      pendingUsdc: sum(usdcEvents, ["PENDING"]),
    },
    startsAt: member.perks_start_at,
    status: member.perks_status,
  };
}
