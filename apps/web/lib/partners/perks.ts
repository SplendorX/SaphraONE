// Server-only. Applying a member's welcome perks to what they do: a verified
// payment (fee rebate, welcome points, cashback boost) or a premium purchase
// (USDC back). Every use is one partner_perk_events row, keyed so a retry
// never pays twice, and paid for from the offer's budget first.
import { creatorPartnersEnabled, PERK_HOLD_DAYS, type PerkKind } from "@/lib/partners/config";
import { loadMember, loadOfferById, partnersDb, partnerTables, updateMember } from "@/lib/partners/db";
import {
  budgetCostUsd,
  cashbackBoostFor,
  claimableAtFrom,
  feeRebateFor,
  premiumDiscountFor,
  windowOpen,
} from "@/lib/partners/rules";
import type { MemberRow, PerkEventRow } from "@/lib/partners/types";
import { referralDb, referralTables } from "@/lib/referral/db";
import { saveAllieSubscription, loadAllieSubscription } from "@/lib/allie/monetization";

/** Payments smaller than this don't unlock the welcome points. */
const MIN_WELCOME_PAYMENT_USD = 1;

const businessNote = "Business accounts don't get welcome perks.";

async function accountType(wallet: string) {
  const { data } = await referralDb()
    .from(referralTables.userProfiles)
    .select("account_type,account_type_selected")
    .eq("wallet_address", wallet)
    .maybeSingle();
  const row = data as { account_type?: string; account_type_selected?: boolean } | null;
  return { business: row?.account_type === "BUSINESS", chosen: Boolean(row?.account_type_selected) };
}

/**
 * The member, if their perks apply right now: personal account, welcome
 * period open, perks active (or held, so they're counted but wait for
 * review). Ends or removes perks it finds no longer apply.
 */
async function eligibleMember(wallet: string, now = new Date()): Promise<MemberRow | null> {
  if (!creatorPartnersEnabled()) return null;
  const member = await loadMember(wallet);
  if (!member || (member.perks_status !== "ACTIVE" && member.perks_status !== "HELD")) return null;
  if (!windowOpen(member, now)) {
    if (member.perks_status === "ACTIVE" && Date.parse(member.perks_end_at) <= now.getTime()) {
      await updateMember(wallet, { perks_status: "ENDED" }).catch(() => undefined);
    }
    return null;
  }
  if ((await accountType(wallet)).business) {
    await updateMember(wallet, { no_perks_reason: businessNote, perks_status: "NO_PERKS" }).catch(() => undefined);
    return null;
  }
  return member;
}

async function usedSoFar(wallet: string, kind: PerkKind) {
  const { data } = await partnersDb()
    .from(partnerTables.events)
    .select("amount_usdc,points")
    .eq("wallet_address", wallet)
    .eq("kind", kind)
    .neq("status", "REVERSED");
  const rows = (data ?? []) as Array<{ amount_usdc: number; points: number }>;
  return {
    points: rows.reduce((sum, row) => sum + Number(row.points), 0),
    usdc: rows.reduce((sum, row) => sum + Number(row.amount_usdc), 0),
  };
}

/**
 * Take the budget, then record the use. If the use was already recorded (a
 * retry), the budget goes back. Returns the new row, or null when the budget
 * is spent or it was a repeat.
 */
async function recordPerkUse(input: {
  amountUsdc?: number;
  claimableAt: string;
  details?: Record<string, unknown>;
  kind: PerkKind;
  member: MemberRow;
  points?: number;
  status?: PerkEventRow["status"];
  useKey: string;
  budgetUsd?: number;
}): Promise<PerkEventRow | null> {
  const db = partnersDb();
  const budget = input.budgetUsd ?? budgetCostUsd({ amountUsdc: input.amountUsdc, points: input.points });
  const { data: reserved, error: reserveError } = await db.rpc("partner_reserve_budget", {
    p_amount: budget,
    p_offer_id: input.member.offer_id,
  });
  if (reserveError) throw new Error(reserveError.message);
  if (reserved !== true) return null;

  const { data, error } = await db
    .from(partnerTables.events)
    .insert({
      amount_usdc: input.amountUsdc ?? 0,
      budget_usd: budget,
      claimable_at: input.claimableAt,
      details: input.details ?? {},
      kind: input.kind,
      offer_id: input.member.offer_id,
      points: input.points ?? 0,
      status: input.status ?? "PENDING",
      use_key: input.useKey,
      wallet_address: input.member.wallet_address,
    })
    .select("*")
    .single();
  if (error) {
    await db.rpc("partner_release_budget", { p_amount: budget, p_offer_id: input.member.offer_id });
    if (error.code === "23505") return null;
    throw new Error(error.message);
  }
  return data as PerkEventRow;
}

/** Whether any payee is a member of the same offer: such payments never earn perks. */
async function paysFellowMember(member: MemberRow, payees: string[]) {
  const others = payees.map((payee) => payee.toLowerCase()).filter((payee) => payee !== member.wallet_address);
  if (!others.length) return false;
  const { count } = await partnersDb()
    .from(partnerTables.members)
    .select("wallet_address", { count: "exact", head: true })
    .eq("offer_id", member.offer_id)
    .in("wallet_address", others);
  return (count ?? 0) > 0;
}

/**
 * Perks for one verified payment, called after its cashback is credited.
 * Never throws to the caller's response; failures are logged.
 */
export async function applyPartnerPerks(input: {
  /** Cashback points this payment just earned (for the boost). */
  cashbackPoints: number;
  /** The fee the payment paid, verified on Arc, in USD. */
  feeUsd: number;
  /** Who was paid (lowercase addresses). */
  payees: string[];
  /** The payment's type, lowercased (transfer, invoice_payment…). */
  source: string;
  txHash: string;
  volumeUsd: number;
  wallet: string;
}) {
  const wallet = input.wallet.toLowerCase();
  try {
    const member = await eligibleMember(wallet);
    if (!member) return;
    const loaded = await loadOfferById(member.offer_id);
    if (!loaded) return;
    const { perks } = loaded;
    if (await paysFellowMember(member, input.payees)) return;

    const now = new Date();
    const claimableAt = claimableAtFrom(now, PERK_HOLD_DAYS);
    const txKey = input.txHash.toLowerCase();

    if (perks.FEE_REBATE && (perks.FEE_REBATE.sources as string[]).includes(input.source)) {
      const used = await usedSoFar(wallet, "FEE_REBATE");
      const amount = feeRebateFor({
        capUsdc: perks.FEE_REBATE.capUsdc,
        feeUsd: input.feeUsd,
        percent: perks.FEE_REBATE.percent,
        usedUsdc: used.usdc,
      });
      if (amount > 0) {
        await recordPerkUse({
          amountUsdc: amount,
          claimableAt,
          details: { feeUsd: input.feeUsd, source: input.source },
          kind: "FEE_REBATE",
          member,
          useKey: txKey,
        });
      }
    }

    if (perks.WELCOME_POINTS && input.volumeUsd >= MIN_WELCOME_PAYMENT_USD) {
      await recordPerkUse({
        claimableAt,
        details: { txHash: txKey },
        kind: "WELCOME_POINTS",
        member,
        points: perks.WELCOME_POINTS.points,
        useKey: "welcome",
      });
    }

    if (perks.CASHBACK_BOOST && input.cashbackPoints > 0) {
      const used = await usedSoFar(wallet, "CASHBACK_BOOST");
      const points = cashbackBoostFor({
        capPoints: perks.CASHBACK_BOOST.capPoints,
        cashbackPoints: input.cashbackPoints,
        multiplier: perks.CASHBACK_BOOST.multiplier,
        usedPoints: used.points,
      });
      if (points > 0) {
        await recordPerkUse({
          claimableAt,
          details: { cashbackPoints: input.cashbackPoints },
          kind: "CASHBACK_BOOST",
          member,
          points,
          useKey: txKey,
        });
      }
    }

    await ensureAllieTrial(member).catch((cause) => {
      console.warn("[partners] trial", cause instanceof Error ? cause.message : cause);
    });
  } catch (cause) {
    console.error("[partners] perks", cause instanceof Error ? cause.message : cause);
  }
}

/**
 * USDC back on a premium purchase (the PREMIUM_DISCOUNT perk), once per
 * product. Recorded on the purchase too, so a points discount is then only
 * claimed on what was really paid. Returns the amount, or 0.
 */
export async function applyPremiumDiscount(input: {
  amountUsdc: number;
  product: string;
  purchaseId: string;
  wallet: string;
}): Promise<number> {
  const wallet = input.wallet.toLowerCase();
  try {
    const member = await eligibleMember(wallet);
    if (!member) return 0;
    const loaded = await loadOfferById(member.offer_id);
    const config = loaded?.perks.PREMIUM_DISCOUNT;
    if (!config) return 0;

    const { count } = await partnersDb()
      .from(partnerTables.events)
      .select("id", { count: "exact", head: true })
      .eq("wallet_address", wallet)
      .eq("kind", "PREMIUM_DISCOUNT")
      .neq("status", "REVERSED")
      .contains("details", { product: input.product });
    const amount = premiumDiscountFor({
      alreadyUsed: (count ?? 0) > 0,
      amountUsdc: input.amountUsdc,
      config,
      memberSince: member.perks_start_at,
      product: input.product,
    });
    if (!(amount > 0)) return 0;

    // Verified on Arc and not reversible, so it can be claimed right away.
    const event = await recordPerkUse({
      amountUsdc: amount,
      claimableAt: new Date().toISOString(),
      details: { product: input.product, purchaseId: input.purchaseId },
      kind: "PREMIUM_DISCOUNT",
      member,
      useKey: input.purchaseId,
    });
    if (!event) return 0;
    await referralDb()
      .from("premium_purchases")
      .update({ partner_rebate_usdc: amount })
      .eq("id", input.purchaseId);
    return amount;
  } catch (cause) {
    console.error("[partners] premium discount", cause instanceof Error ? cause.message : cause);
    return 0;
  }
}

/**
 * The ALLIE Pro trial, granted once the account has chosen to be personal
 * (business accounts get no perks). A member already on Pro keeps their own
 * term; the trial never shortens it.
 */
export async function ensureAllieTrial(member: MemberRow) {
  if (member.trial_granted_at || member.perks_status !== "ACTIVE" || !windowOpen(member)) return false;
  const type = await accountType(member.wallet_address);
  if (!type.chosen || type.business) return false;
  const loaded = await loadOfferById(member.offer_id);
  const config = loaded?.perks.ALLIE_PRO_TRIAL;
  if (!config) return false;

  // Claim the grant first, so two requests can't both give it.
  const { data: claimed } = await partnersDb()
    .from(partnerTables.members)
    .update({ trial_granted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("wallet_address", member.wallet_address)
    .is("trial_granted_at", null)
    .select("wallet_address");
  if (!claimed?.length) return false;

  const event = await recordPerkUse({
    budgetUsd: config.budgetUsd,
    claimableAt: new Date().toISOString(),
    details: { days: config.days },
    kind: "ALLIE_PRO_TRIAL",
    member,
    status: "GRANTED",
    useKey: "trial",
  });
  if (!event) {
    // No budget left: the trial isn't given, and isn't tried again.
    return false;
  }

  const current = await loadAllieSubscription(member.wallet_address);
  const activeUntil =
    current?.tier === "pro" && current.expiresAt ? Date.parse(current.expiresAt) : current?.tier === "pro" ? Infinity : 0;
  const trialEnds = Date.now() + config.days * 86_400_000;
  if (activeUntil >= trialEnds) return true;
  await saveAllieSubscription({
    expiresAt: new Date(Math.max(activeUntil, Date.now()) + config.days * 86_400_000).toISOString(),
    ownerWallet: member.wallet_address,
    recurringScheduleId: current?.recurringScheduleId ?? null,
    tier: "pro",
  });
  return true;
}
