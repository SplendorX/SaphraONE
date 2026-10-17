/**
 * Creator Partners: input checks, offer availability, the welcome window and
 * every perk's math. Pure, so the API, the cron and the tests all run exactly
 * this.
 */
import {
  BUDGET_USD_PER_POINT,
  DEFAULT_PERK_DAYS,
  defaultPerkConfigs,
  discountableProducts,
  perkKinds,
  rebateSources,
  type DiscountableProduct,
  type PerkConfigs,
  type PerkKind,
  type RebateSource,
} from "@/lib/partners/config";
import type { CommissionMode, OfferRow, PartnerRow } from "@/lib/partners/types";

export class PartnerError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PartnerError";
    this.status = status;
  }
}

const DAY_MS = 86_400_000;

/** Round down to whole micro-USDC, so a payout never exceeds what was earned. */
export function floorUsdc(value: number) {
  return Math.floor(Math.max(0, value) * 1e6 + 1e-6) / 1e6;
}

/** Round down to 1/100 of a point, as the ledger keeps them. */
export function floorPoints(value: number) {
  return Math.floor(Math.max(0, value) * 100 + 1e-9) / 100;
}

/** A link code: 3–32 of a–z, 0–9 and inner hyphens, lowercased. */
export function normalizeOfferCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(code) ? code : null;
}

export function isPerkKind(value: unknown): value is PerkKind {
  return perkKinds.includes(value as PerkKind);
}

function numberIn(raw: unknown, fallback: number, min: number, max: number, label: string) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new PartnerError(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function listOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T[], label: string): T[] {
  if (raw === undefined || raw === null) return fallback;
  const items = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((item) => String(item).trim())
    .filter(Boolean);
  const bad = items.filter((item) => !allowed.includes(item as T));
  if (bad.length) throw new PartnerError(`${label}: unknown ${bad.join(", ")}.`);
  if (!items.length) throw new PartnerError(`${label}: choose at least one.`);
  return [...new Set(items)] as T[];
}

/**
 * A perk's config with defaults filled in and every number checked. Accepts
 * the stored snake_case shape and the camelCase one admins send.
 */
export function readPerkConfig<K extends PerkKind>(kind: K, raw: unknown): PerkConfigs[K] {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (camel: string, snake: string) => input[camel] ?? input[snake];
  const defaults = defaultPerkConfigs[kind];
  let config: PerkConfigs[PerkKind];
  switch (kind) {
    case "FEE_REBATE": {
      const d = defaults as PerkConfigs["FEE_REBATE"];
      config = {
        capUsdc: numberIn(pick("capUsdc", "cap_usdc"), d.capUsdc, 0.01, 1000, "Fee rebate cap"),
        percent: numberIn(pick("percent", "percent"), d.percent, 1, 100, "Fee rebate percent"),
        sources: listOf<RebateSource>(pick("sources", "sources"), rebateSources, d.sources, "Fee rebate payments"),
      };
      break;
    }
    case "WELCOME_POINTS": {
      const d = defaults as PerkConfigs["WELCOME_POINTS"];
      config = { points: numberIn(pick("points", "points"), d.points, 1, 100_000, "Welcome points") };
      break;
    }
    case "CASHBACK_BOOST": {
      const d = defaults as PerkConfigs["CASHBACK_BOOST"];
      config = {
        capPoints: numberIn(pick("capPoints", "cap_points"), d.capPoints, 1, 100_000, "Cashback boost cap"),
        multiplier: numberIn(pick("multiplier", "multiplier"), d.multiplier, 1.1, 10, "Cashback multiplier"),
      };
      break;
    }
    case "ALLIE_PRO_TRIAL": {
      const d = defaults as PerkConfigs["ALLIE_PRO_TRIAL"];
      config = {
        budgetUsd: numberIn(pick("budgetUsd", "budget_usd"), d.budgetUsd, 0, 100, "ALLIE trial budget cost"),
        days: numberIn(pick("days", "days"), d.days, 1, 365, "ALLIE trial days"),
      };
      break;
    }
    case "PREMIUM_DISCOUNT": {
      const d = defaults as PerkConfigs["PREMIUM_DISCOUNT"];
      config = {
        percent: numberIn(pick("percent", "percent"), d.percent, 1, 100, "Premium discount percent"),
        products: listOf<DiscountableProduct>(
          pick("products", "products"),
          discountableProducts,
          d.products,
          "Premium discount products",
        ),
        withinDays: numberIn(pick("withinDays", "within_days"), d.withinDays, 1, 365, "Premium discount days"),
      };
      break;
    }
    default:
      throw new PartnerError("Unknown perk.");
  }
  return config as PerkConfigs[K];
}

/** `[{ kind, config }]` from an admin request; at most one of each kind. */
export function readPerksInput(raw: unknown) {
  if (!Array.isArray(raw)) throw new PartnerError("Choose the offer's perks.");
  const seen = new Set<PerkKind>();
  return raw.map((item) => {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (!isPerkKind(entry.kind)) throw new PartnerError("Unknown perk.");
    if (seen.has(entry.kind)) throw new PartnerError("Each perk can only be added once.");
    seen.add(entry.kind);
    return { config: readPerkConfig(entry.kind, entry.config), kind: entry.kind };
  });
}

function text(raw: unknown, max: number) {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

function optionalDate(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const time = Date.parse(String(raw));
  if (!Number.isFinite(time)) throw new PartnerError(`${label} is not a valid date.`);
  return new Date(time).toISOString();
}

/** A partner's fields from an admin request. */
export function readPartnerInput(body: Record<string, unknown>) {
  const wallet = text(body.walletAddress ?? body.wallet_address, 64).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new PartnerError("Enter the partner's SaphraONE wallet address.");
  const displayName = text(body.displayName ?? body.display_name, 80);
  if (!displayName) throw new PartnerError("Enter the partner's name.");
  const rawBps = body.commissionBps ?? body.commission_bps;
  const commissionBps =
    rawBps === undefined || rawBps === null || rawBps === ""
      ? null
      : Math.round(numberIn(rawBps, 0, 0, 5000, "Commission (basis points)"));
  const mode = body.commissionMode ?? body.commission_mode;
  const commissionMode: CommissionMode = mode === "FIXED" ? "FIXED" : "AT_LEAST_TIER";
  const contractStartsAt = optionalDate(body.contractStartsAt ?? body.contract_starts_at, "Contract start");
  const contractEndsAt = optionalDate(body.contractEndsAt ?? body.contract_ends_at, "Contract end");
  if (contractStartsAt && contractEndsAt && contractEndsAt <= contractStartsAt) {
    throw new PartnerError("The contract must end after it starts.");
  }
  const handle = text(body.handle, 40).replace(/^@/, "") || null;
  const avatar = text(body.avatarUrl ?? body.avatar_url, 500);
  if (avatar && !/^https:\/\//i.test(avatar)) throw new PartnerError("The avatar must be an https:// link.");
  const kyc = body.kycStatus ?? body.kyc_status;
  return {
    avatar_url: avatar || null,
    bounty_monthly_cap: Math.round(numberIn(body.bountyMonthlyCap ?? body.bounty_monthly_cap, 0, 0, 100_000, "Monthly bounty cap")),
    bounty_usdc: numberIn(body.bountyUsdc ?? body.bounty_usdc, 0, 0, 100, "Bounty per activated member"),
    commission_bps: commissionBps,
    commission_mode: commissionMode,
    contract_ends_at: contractEndsAt,
    contract_starts_at: contractStartsAt,
    display_name: displayName,
    handle,
    kyc_status: kyc === "PENDING" || kyc === "VERIFIED" ? kyc : "NONE",
    notes: text(body.notes, 2000),
    wallet_address: wallet,
  } as const;
}

/** An offer's fields from an admin request. */
export function readOfferInput(body: Record<string, unknown>) {
  const code = normalizeOfferCode(body.code);
  if (!code) throw new PartnerError("The link code needs 3–32 letters, numbers or hyphens.");
  const title = text(body.title, 120);
  if (!title) throw new PartnerError("Give the offer a title.");
  const startsAt = optionalDate(body.startsAt ?? body.starts_at, "Start") ?? new Date().toISOString();
  const endsAt = optionalDate(body.endsAt ?? body.ends_at, "End");
  if (endsAt && endsAt <= startsAt) throw new PartnerError("The offer must end after it starts.");
  const rawMax = body.maxMembers ?? body.max_members;
  return {
    budget_usdc: numberIn(body.budgetUsdc ?? body.budget_usdc, 0, 0, 1_000_000, "Budget"),
    code,
    ends_at: endsAt,
    headline: text(body.headline, 280),
    max_members:
      rawMax === undefined || rawMax === null || rawMax === ""
        ? null
        : Math.round(numberIn(rawMax, 0, 1, 10_000_000, "Member cap")),
    perk_days: Math.round(numberIn(body.perkDays ?? body.perk_days, DEFAULT_PERK_DAYS, 1, 365, "Welcome period (days)")),
    starts_at: startsAt,
    terms_md: text(body.termsMd ?? body.terms_md, 20_000),
    title,
  } as const;
}

export type OfferUnavailableReason =
  | "not_live"
  | "not_started"
  | "ended"
  | "full"
  | "out_of_budget"
  | "partner_inactive";

/** Whether a new signup through this offer gets the welcome package now. */
export function offerAvailability(
  offer: Pick<OfferRow, "budget_usdc" | "ends_at" | "max_members" | "members_count" | "spent_usdc" | "starts_at" | "status">,
  partner: Pick<PartnerRow, "status">,
  now = new Date(),
): { available: true; reason: null } | { available: false; reason: OfferUnavailableReason } {
  const at = now.getTime();
  if (partner.status !== "ACTIVE") return { available: false, reason: "partner_inactive" };
  if (offer.status === "ENDED" || (offer.ends_at && Date.parse(offer.ends_at) <= at)) {
    return { available: false, reason: "ended" };
  }
  if (offer.status !== "LIVE") return { available: false, reason: "not_live" };
  if (Date.parse(offer.starts_at) > at) return { available: false, reason: "not_started" };
  if (offer.max_members !== null && offer.members_count >= offer.max_members) {
    return { available: false, reason: "full" };
  }
  if (Number(offer.spent_usdc) >= Number(offer.budget_usdc)) return { available: false, reason: "out_of_budget" };
  return { available: true, reason: null };
}

export const unavailableLabels: Record<OfferUnavailableReason, string> = {
  ended: "This offer has ended.",
  full: "This offer is full.",
  not_live: "This offer isn't available right now.",
  not_started: "This offer hasn't started yet.",
  out_of_budget: "This offer has ended.",
  partner_inactive: "This offer isn't available right now.",
};

/** A member's welcome period: from signup, `perkDays` long. */
export function memberWindow(start: Date, perkDays: number) {
  return {
    endsAt: new Date(start.getTime() + perkDays * DAY_MS).toISOString(),
    startsAt: start.toISOString(),
  };
}

export function windowOpen(member: { perks_end_at: string; perks_start_at: string }, now = new Date()) {
  const at = now.getTime();
  return Date.parse(member.perks_start_at) <= at && at < Date.parse(member.perks_end_at);
}

/** Whole days left, counting a part day as one; 0 once it's over. */
export function daysLeft(endsAt: string, now = new Date()) {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now.getTime()) / DAY_MS));
}

/** When a perk earned `at` can be claimed or credited. */
export function claimableAtFrom(at: Date, holdDays: number) {
  return new Date(at.getTime() + holdDays * DAY_MS).toISOString();
}

/** A fee rebate: `percent` of the verified fee, never past what's left of the cap. */
export function feeRebateFor(input: { capUsdc: number; feeUsd: number; percent: number; usedUsdc: number }) {
  if (!(input.feeUsd > 0)) return 0;
  const left = Math.max(0, input.capUsdc - input.usedUsdc);
  return floorUsdc(Math.min((input.feeUsd * input.percent) / 100, left, input.feeUsd));
}

/** Extra points from a cashback boost: (multiplier − 1) × the cashback, within the cap. */
export function cashbackBoostFor(input: {
  capPoints: number;
  cashbackPoints: number;
  multiplier: number;
  usedPoints: number;
}) {
  if (!(input.cashbackPoints > 0) || !(input.multiplier > 1)) return 0;
  const left = Math.max(0, input.capPoints - input.usedPoints);
  return floorPoints(Math.min(input.cashbackPoints * (input.multiplier - 1), left));
}

/**
 * USDC back on a premium purchase: once per product, within `withinDays` of
 * joining, on a product the offer covers.
 */
export function premiumDiscountFor(input: {
  alreadyUsed: boolean;
  amountUsdc: number;
  config: PerkConfigs["PREMIUM_DISCOUNT"];
  memberSince: string;
  now?: Date;
  product: string;
}) {
  const now = input.now ?? new Date();
  if (input.alreadyUsed || !(input.amountUsdc > 0)) return 0;
  if (!input.config.products.includes(input.product as DiscountableProduct)) return 0;
  if (now.getTime() - Date.parse(input.memberSince) > input.config.withinDays * DAY_MS) return 0;
  return floorUsdc((input.amountUsdc * input.config.percent) / 100);
}

/** What a perk use takes from the offer's budget, in USD. */
export function budgetCostUsd(input: { amountUsdc?: number; points?: number }) {
  return floorUsdc((input.amountUsdc ?? 0) + (input.points ?? 0) * BUDGET_USD_PER_POINT);
}

export function contractActive(
  partner: Pick<PartnerRow, "commission_bps" | "contract_ends_at" | "contract_starts_at" | "status">,
  now = new Date(),
) {
  if (partner.status !== "ACTIVE" || partner.commission_bps === null) return false;
  const at = now.getTime();
  if (partner.contract_starts_at && Date.parse(partner.contract_starts_at) > at) return false;
  if (partner.contract_ends_at && Date.parse(partner.contract_ends_at) <= at) return false;
  return true;
}

/** The commission a partner earns: their contract while it runs, else their tier. */
export function effectiveCommissionBps(
  partner: Pick<PartnerRow, "commission_bps" | "commission_mode" | "contract_ends_at" | "contract_starts_at" | "status"> | null,
  tierBps: number,
  now = new Date(),
) {
  if (!partner || !contractActive(partner, now)) return tierBps;
  const contract = partner.commission_bps ?? tierBps;
  return partner.commission_mode === "FIXED" ? contract : Math.max(contract, tierBps);
}

function money(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: value % 1 ? 2 : 0 })}`;
}

const productNames: Record<DiscountableProduct, string> = {
  ALLIE_PRO: "ALLIE Pro",
  EARN_AUTO_DEPOSIT: "automatic deposits",
  PAYROLL_AUTO_SCHEDULE: "automatic payroll",
};

/** One plain line per perk, for the landing page and the member's card. */
export function perkSummary(kind: PerkKind, raw: unknown, perkDays = DEFAULT_PERK_DAYS) {
  switch (kind) {
    case "FEE_REBATE": {
      const config = readPerkConfig(kind, raw);
      const share = config.percent >= 100 ? "Your payment fees back" : `${config.percent}% of your payment fees back`;
      return `${share} for ${perkDays} days, up to ${money(config.capUsdc)} in USDC`;
    }
    case "WELCOME_POINTS": {
      const config = readPerkConfig(kind, raw);
      return `${config.points.toLocaleString("en-US")} ONE Points after your first payment`;
    }
    case "CASHBACK_BOOST": {
      const config = readPerkConfig(kind, raw);
      return `${config.multiplier}× cashback for ${perkDays} days, up to ${config.capPoints.toLocaleString("en-US")} extra points`;
    }
    case "ALLIE_PRO_TRIAL": {
      const config = readPerkConfig(kind, raw);
      return `ALLIE Pro free for ${config.days} days`;
    }
    case "PREMIUM_DISCOUNT": {
      const config = readPerkConfig(kind, raw);
      const products = config.products.map((product) => productNames[product]);
      if (products.length === 1) {
        return `${config.percent}% back on your first ${products[0]} purchase in your first ${config.withinDays} days`;
      }
      const list = `${products.slice(0, -1).join(", ")} and ${products.at(-1)}`;
      return `${config.percent}% back once on each of ${list}, in your first ${config.withinDays} days`;
    }
    default:
      return "";
  }
}
