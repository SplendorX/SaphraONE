/**
 * Ramp rules. Pure, so the tests exercise exactly what the server runs:
 * amount parsing, the status machine, the deposit-wallet safety check and
 * picking Centiiv's delivery transaction.
 */
import type {
  CentiivRequest,
  CentiivTemporaryWallet,
  RampDirection,
  RampStatus,
} from "@/lib/ramp/types";
import { rampStatuses } from "@/lib/ramp/types";

/**
 * Per-order limits SwiftPay enforces before asking Centiiv. Centiiv applies
 * its own per-rail limits too and says so in its 400 message.
 */
export const RAMP_LIMITS = {
  ONRAMP: { min: 1_000, max: 15_000_000, currency: "NGN" },
  OFFRAMP: { min: 1, max: 10_000, currency: "USDC" },
} as const;

/** Re-fetch and refuse to sign when a deposit wallet closes sooner than this. */
export const EXPIRY_MARGIN_MS = 3 * 60 * 1000;

/** A request with no deposit expires after this long (Centiiv's rule). */
export const ORDER_TTL_MS = 30 * 60 * 1000;

const terminal = new Set<RampStatus>(["FULFILLED", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"]);

export type AmountResult = { ok: true; value: string } | { ok: false; message: string };

function formatLimit(value: number, currency: string) {
  const text = value.toLocaleString("en-US");
  return currency === "NGN" ? `₦${text}` : `${text} ${currency}`;
}

/**
 * A positive amount with at most 2 decimals, within the direction's limits,
 * as a plain decimal string. Thousands commas ("150,000") are accepted.
 */
export function parseRampAmount(value: unknown, direction: RampDirection): AmountResult {
  const limits = RAMP_LIMITS[direction];
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim().replace(/,/g, "")
        : "";
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { ok: false, message: "Enter an amount with up to 2 decimal places." };
  }
  const amount = Number(raw);
  if (!(amount > 0)) return { ok: false, message: "Enter an amount above zero." };
  if (amount < limits.min) {
    return { ok: false, message: `The minimum is ${formatLimit(limits.min, limits.currency)}.` };
  }
  if (amount > limits.max) {
    return { ok: false, message: `The maximum is ${formatLimit(limits.max, limits.currency)}.` };
  }
  return { ok: true, value: raw.replace(/^0+(?=\d)/, "") };
}

export function parseNgnAmount(value: unknown) {
  return parseRampAmount(value, "ONRAMP");
}

export function parseUsdcAmount(value: unknown) {
  return parseRampAmount(value, "OFFRAMP");
}

/**
 * A decimal string from a number or string Centiiv returned, or null. Numbers
 * are rounded to `decimals` first, so 0.1 + 0.2 prints as "0.3".
 */
export function decimalText(value: unknown, decimals = 6): string | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    text = value.toFixed(decimals);
  } else if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
    text = value.trim();
  } else {
    return null;
  }
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text.replace(/^0+(?=\d)/, "");
}

/** A USDC amount as a 6-decimal string with no float drift. */
export function toUsdcString(value: number | string) {
  return decimalText(value, 6);
}

/**
 * USDC base units (6 decimals) for an exact amount, or null when the text has
 * more precision than USDC can carry. Never rounds: the off-ramp deposit
 * must match exactly.
 */
export function usdcUnits(text: string | null | undefined): bigint | null {
  const value = text?.trim() ?? "";
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const units = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return units > 0n ? units : null;
}

export function readStatus(value: unknown): RampStatus | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (rampStatuses as readonly string[]).includes(upper) ? (upper as RampStatus) : null;
}

export function isTerminal(status: RampStatus) {
  return terminal.has(status);
}

/**
 * The status to store when Centiiv reports `incoming`. A terminal status
 * never changes, and the only move between open statuses is
 * PENDING → PROCESSING, so a late or replayed update can't walk an order back.
 */
export function nextStatus(current: RampStatus, incoming: RampStatus | null): RampStatus {
  if (!incoming || incoming === current || isTerminal(current)) return current;
  if (isTerminal(incoming)) return incoming;
  return current === "PENDING" && incoming === "PROCESSING" ? incoming : current;
}

export type DepositWalletCheck =
  | { ok: true; address: string; expiresAt: string | null }
  | { ok: false; reason: string };

/**
 * Whether an off-ramp deposit wallet is safe to show: a real EVM address, on
 * Arc, and on the same kind of network (testnet or mainnet) as this build.
 */
export function validateDepositWallet(
  wallet: CentiivTemporaryWallet | null | undefined,
  input: { mainnet: boolean },
): DepositWalletCheck {
  const address = wallet?.publicAddress?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) {
    return { ok: false, reason: "Deposit wallet address is missing or invalid." };
  }
  if ((wallet?.network ?? "").trim().toUpperCase() !== "ARC") {
    return { ok: false, reason: `Deposit wallet is on ${wallet?.network ?? "an unknown network"}, not Arc.` };
  }
  if (typeof wallet?.isTestnet === "boolean" && wallet.isTestnet === input.mainnet) {
    return {
      ok: false,
      reason: wallet.isTestnet
        ? "Deposit wallet is on testnet but this is a mainnet build."
        : "Deposit wallet is on mainnet but this is a testnet build.",
    };
  }
  const expiresAt = wallet?.expiresAt && !Number.isNaN(Date.parse(wallet.expiresAt)) ? wallet.expiresAt : null;
  return { ok: true, address: address.toLowerCase(), expiresAt };
}

/** Centiiv's confirmed USDC delivery on Arc (on-ramp), or null. */
export function pickDeliveryTx(
  request: Pick<CentiivRequest, "blockchainTxs">,
): { hash: string; amount: string | null } | null {
  for (const tx of request.blockchainTxs ?? []) {
    if ((tx.direction ?? "").toUpperCase() !== "OUTGOING") continue;
    if ((tx.status ?? "").toUpperCase() !== "CONFIRMED") continue;
    if ((tx.network ?? "").toUpperCase() !== "ARC") continue;
    const hash = tx.txHash?.trim() ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) continue;
    return { hash: hash.toLowerCase(), amount: decimalText(tx.amount) };
  }
  return null;
}

/** "0123456789" → "•••• 6789". */
export function maskAccount(accountNumber: string) {
  const digits = accountNumber.replace(/\D/g, "");
  return `•••• ${digits.slice(-4)}`;
}

/** A 10-digit Nigerian (NUBAN) account number, or null. */
export function readNuban(value: unknown) {
  const digits = typeof value === "string" ? value.replace(/\s/g, "") : "";
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * Whether a deposit window closes within `marginMs` of `now` (or already
 * has). An unreadable time counts as closing; no time at all does not.
 */
export function expiresSoon(expiresAt: string | null | undefined, now: number, marginMs: number) {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return true;
  return at - now < marginMs;
}

/** Centiiv's message for a 400, trimmed for display. */
export function displayMessage(message: unknown, fallback: string) {
  if (typeof message !== "string" || !message.trim()) return fallback;
  const text = message.trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}
