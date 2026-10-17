/**
 * Checkout money rules. Pure, so the tests exercise exactly what the server
 * runs.
 */
import { moneyNumber, roundMoney } from "@/lib/account/money";
import type { ChargeKind, ChargeStatus } from "@/lib/checkout/types";

export const CHARGE_MIN_AMOUNT = 0.5;
export const CHARGE_MAX_AMOUNT: Record<ChargeKind, number> = {
  MERCHANT: 50_000,
  STOREFRONT: 10_000,
  ONLINE: 10_000,
};
export const TIP_MAX_MULTIPLE = 3;
export const TIP_MAX_AMOUNT = 5_000;

/** How long a charge stays payable. A card/bank or bridge intent extends it. */
export const CHARGE_TTL_MS: Record<ChargeKind, number> = {
  MERCHANT: 24 * 60 * 60 * 1000,
  STOREFRONT: 6 * 60 * 60 * 1000,
  // The default; a session sets its own between 30 minutes and a day.
  ONLINE: 60 * 60 * 1000,
};
export const SLOW_INTENT_TTL_MS = 72 * 60 * 60 * 1000;

/** Float dust from summing decimal strings never decides paid vs. not. */
const EPSILON = 0.000001;

const amountPattern = /^\d+(\.\d{1,6})?$/;

function readAmount(value: unknown) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!amountPattern.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

export type AmountCheck = { ok: true; amount: string } | { ok: false; message: string };

export function validateChargeAmount(value: unknown, kind: ChargeKind): AmountCheck {
  const amount = readAmount(value);
  if (amount === null) return { ok: false, message: "Enter a valid amount." };
  if (amount < CHARGE_MIN_AMOUNT) {
    return { ok: false, message: `The smallest charge is ${CHARGE_MIN_AMOUNT.toFixed(2)}.` };
  }
  const max = CHARGE_MAX_AMOUNT[kind];
  if (amount > max) {
    return { ok: false, message: `The largest charge is ${max.toLocaleString("en-US")}.` };
  }
  return { ok: true, amount: roundMoney(amount) };
}

/** Online checkout takes no tips: anything above the amount is overpayment. */
export function maxTipFor(amount: string, kind?: ChargeKind) {
  if (kind === "ONLINE") return 0;
  return Math.min(moneyNumber(amount) * TIP_MAX_MULTIPLE, TIP_MAX_AMOUNT);
}

export function validateTip(value: unknown, amount: string): AmountCheck {
  if (value === undefined || value === null || value === "") return { ok: true, amount: "0" };
  const tip = readAmount(value);
  if (tip === null) return { ok: false, message: "Enter a valid tip." };
  if (tip > maxTipFor(amount) + EPSILON) {
    return { ok: false, message: "That tip is larger than this charge allows." };
  }
  return { ok: true, amount: roundMoney(tip) };
}

/** Base amount plus the tip the payer picked: what the payer page asks for. */
export function chargeTotal(charge: { amount: string; tip_amount: string }) {
  return roundMoney(moneyNumber(charge.amount) + moneyNumber(charge.tip_amount));
}

/**
 * A charge's state after its payments add up to `received` (the sum of every
 * claimed transfer). Paid once the base amount arrived; anything above it is
 * the tip, up to the tip cap, and the rest is overpayment. Short payments
 * leave the status alone so "received X of Y" can accumulate.
 */
export function applyPaymentToCharge(input: {
  charge: { amount: string; status: ChargeStatus; kind?: ChargeKind };
  received: number;
}) {
  const base = moneyNumber(input.charge.amount);
  const received = Math.max(0, input.received);
  const paid = received + EPSILON >= base;
  const excess = paid ? Math.max(0, received - base) : 0;
  const tip = Math.min(excess, maxTipFor(input.charge.amount, input.charge.kind));
  return {
    amountReceived: roundMoney(received),
    overpayment: roundMoney(Math.max(0, excess - tip)),
    status: (paid ? "PAID" : input.charge.status) as ChargeStatus,
    tipAmount: roundMoney(tip),
  };
}

export function isExpired(charge: { expires_at: string; status: ChargeStatus }, now = Date.now()) {
  return charge.status === "OPEN" && new Date(charge.expires_at).getTime() <= now;
}
