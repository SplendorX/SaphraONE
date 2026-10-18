/**
 * Refund rules for Checkout charges. Pure, so the tests exercise exactly what
 * the server runs.
 *
 * - Any charge that received money can be refunded, in part or in full, as
 *   many times as needed, until the refunds (requested or sent) reach what
 *   arrived.
 * - The money goes back to the payer's wallet only when that wallet is known:
 *   every payment came from one wallet straight (WALLET) or from a SaphraONE
 *   account (SWIFTPAY). For card/bank (ONRAMP), cross-chain (BRIDGE) and
 *   hand-attached (RECONCILE) payments the Arc sender is Circle's onramp, the
 *   CCTP mint or unknown, so the merchant must give the buyer's wallet.
 */
import { decodeEventLog, getAddress, parseAbi } from "viem";

import { moneyNumber, roundMoney } from "@/lib/account/money";
import type { ChargePaymentSource } from "@/lib/checkout/types";

export const MIN_REFUND_AMOUNT = 0.01;
export const MAX_REFUND_REASON_LENGTH = 200;

/** Floating-point slack when comparing decimal money amounts. */
const EPSILON = 0.000001;

const addressPattern = /^0x[0-9a-fA-F]{40}$/;

type RefundLike = { amount: string; status: "REQUESTED" | "SUCCEEDED" | "CANCELLED" };
type PaymentLike = { source: ChargePaymentSource; payer_wallet: string | null };

/** What can still be refunded: received minus every refund not cancelled. */
export function refundableAmount(input: { amountReceived: string; refunds: RefundLike[] }) {
  const reserved = input.refunds
    .filter((refund) => refund.status !== "CANCELLED")
    .reduce((sum, refund) => sum + moneyNumber(refund.amount), 0);
  return Math.max(0, moneyNumber(input.amountReceived) - reserved);
}

/** The sum of refunds that were sent and verified. */
export function refundedAmount(refunds: RefundLike[]) {
  return refunds
    .filter((refund) => refund.status === "SUCCEEDED")
    .reduce((sum, refund) => sum + moneyNumber(refund.amount), 0);
}

export type RefundCheck<T> = { ok: true; value: T } | { ok: false; message: string };

/** The refund amount (decimal string); empty means everything still refundable. */
export function readRefundAmount(value: unknown, refundable: number): RefundCheck<string> {
  if (refundable < MIN_REFUND_AMOUNT - EPSILON) {
    return { message: "Nothing is left to refund on this payment.", ok: false };
  }
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: roundMoney(refundable) };
  }
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    return { message: "Enter the refund amount as a number, such as 12.50.", ok: false };
  }
  const amount = Number(text);
  if (amount < MIN_REFUND_AMOUNT - EPSILON) {
    return { message: `The smallest refund is ${MIN_REFUND_AMOUNT.toFixed(2)}.`, ok: false };
  }
  if (amount > refundable + EPSILON) {
    return { message: `You can refund at most ${roundMoney(refundable)}.`, ok: false };
  }
  return { ok: true, value: roundMoney(amount) };
}

/** The payer's wallet when every payment came straight from one wallet, else null. */
export function defaultRefundDestination(payments: PaymentLike[]) {
  if (payments.length === 0) return null;
  const wallets = new Set<string>();
  for (const payment of payments) {
    if (payment.source !== "WALLET" && payment.source !== "SWIFTPAY") return null;
    if (!payment.payer_wallet || !addressPattern.test(payment.payer_wallet)) return null;
    wallets.add(payment.payer_wallet.toLowerCase());
  }
  return wallets.size === 1 ? [...wallets][0] : null;
}

/**
 * Where the refund goes: the given wallet, else the payer's when it is known.
 * Never the merchant's own wallet.
 */
export function readRefundDestination(input: {
  value: unknown;
  payments: PaymentLike[];
  merchantWallet: string;
}): RefundCheck<string> {
  const given = typeof input.value === "string" ? input.value.trim() : "";
  let destination: string | null = null;
  if (given) {
    if (!addressPattern.test(given)) return { message: "Enter the buyer's wallet address (0x…).", ok: false };
    destination = given.toLowerCase();
  } else {
    destination = defaultRefundDestination(input.payments);
    if (!destination) {
      return {
        message:
          "This payment came by card, bank or another chain, so SaphraONE can't see the buyer's wallet. Enter the wallet to refund to.",
        ok: false,
      };
    }
  }
  if (destination === input.merchantWallet.toLowerCase()) {
    return { message: "A refund can't go to your own wallet.", ok: false };
  }
  return { ok: true, value: destination };
}

export function readRefundReason(value: unknown): RefundCheck<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { message: "The reason must be text.", ok: false };
  const reason = value.trim().replace(/\s+/g, " ");
  if (!reason) return { ok: true, value: null };
  if (reason.length > MAX_REFUND_REASON_LENGTH) {
    return { message: `Keep the reason under ${MAX_REFUND_REASON_LENGTH} characters.`, ok: false };
  }
  return { ok: true, value: reason };
}

// ── The refund transfer on chain ────────────────────────────────────────────

const transferEventAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

type TransferLog = { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] | [] };

/**
 * Whether the logs hold a transfer of the charge currency (`emitters`: the
 * token contract, plus Arc's native USDC event address for USDC) sent by the
 * merchant wallet. A direct send and the SaphraSend router path (merchant →
 * router → buyer) both have one.
 */
export function sentByWallet(input: { logs: readonly TransferLog[]; emitters: string[]; wallet: string }) {
  const emitters = new Set(input.emitters.map((emitter) => emitter.toLowerCase()));
  const sender = getAddress(input.wallet);
  for (const log of input.logs) {
    if (!emitters.has(log.address.toLowerCase())) continue;
    try {
      const event = decodeEventLog({
        abi: transferEventAbi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (getAddress(event.args.from) === sender && event.args.value > 0n) return true;
    } catch {
      // Not a Transfer event.
    }
  }
  return false;
}

/** The refund is proven when the buyer got at least the amount and the merchant sent it. */
export function refundTransferProven(input: {
  received: number | null;
  amount: string;
  sentByMerchant: boolean;
}) {
  return input.sentByMerchant && input.received !== null && input.received + EPSILON >= moneyNumber(input.amount);
}
