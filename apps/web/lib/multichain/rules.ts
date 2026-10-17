/**
 * Multichain receive rules. Pure, so the tests exercise exactly what the
 * server runs: state transitions, the below-minimum rule, sweep amounts and
 * fee math. Amounts are USDC with 6 decimals, carried as bigint units.
 */

export const DEPOSIT_STATES = [
  "DETECTED",
  "CONFIRMED",
  "BELOW_MIN",
  "SWEEPING",
  "BURNED",
  "CREDITED",
  "FAILED",
  "NEEDS_REVIEW",
] as const;

export type DepositState = (typeof DEPOSIT_STATES)[number];

export const SWEEP_STATES = ["SWEEPING", "BURNED", "CREDITED", "FAILED", "NEEDS_REVIEW"] as const;

export type SweepState = (typeof SWEEP_STATES)[number];



const depositTransitions: Record<DepositState, readonly DepositState[]> = {
  DETECTED: ["CONFIRMED", "FAILED", "NEEDS_REVIEW"],
  CONFIRMED: ["BELOW_MIN", "SWEEPING", "NEEDS_REVIEW"],
  BELOW_MIN: ["CONFIRMED", "SWEEPING", "NEEDS_REVIEW"],
  SWEEPING: ["BURNED", "FAILED", "CREDITED", "NEEDS_REVIEW"],
  BURNED: ["CREDITED", "FAILED", "NEEDS_REVIEW"],
  // A failed sweep is retried (resumed) from where it stopped.
  FAILED: ["SWEEPING", "BURNED", "CREDITED", "NEEDS_REVIEW"],
  CREDITED: [],
  NEEDS_REVIEW: ["CONFIRMED", "SWEEPING", "CREDITED", "FAILED"],
};

const sweepTransitions: Record<SweepState, readonly SweepState[]> = {
  SWEEPING: ["BURNED", "CREDITED", "FAILED", "NEEDS_REVIEW"],
  BURNED: ["CREDITED", "FAILED", "NEEDS_REVIEW"],
  FAILED: ["SWEEPING", "BURNED", "CREDITED", "NEEDS_REVIEW"],
  CREDITED: [],
  NEEDS_REVIEW: ["SWEEPING", "BURNED", "CREDITED", "FAILED"],
};

export function canMoveDeposit(from: DepositState, to: DepositState) {
  return from === to || depositTransitions[from].includes(to);
}

export function canMoveSweep(from: SweepState, to: SweepState) {
  return from === to || sweepTransitions[from].includes(to);
}

/** A sweep that holds the address: only one may be in flight at a time. */
export function isSweepInFlight(state: SweepState) {
  return state === "SWEEPING" || state === "BURNED";
}

const USDC_DECIMALS = 6;
const unitAmountPattern = /^\d+(\.\d+)?$/;

/** "12.5" → 12_500_000n. Extra decimals are cut, never rounded up. */
export function usdcToUnits(value: string | number): bigint {
  const raw = typeof value === "number" ? value.toFixed(USDC_DECIMALS) : value.trim();
  if (!unitAmountPattern.test(raw)) {
    throw new Error(`Not a USDC amount: ${raw}`);
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) + BigInt((fraction + "000000").slice(0, USDC_DECIMALS));
}

/** 12_500_000n → "12.5" */
export function unitsToUsdc(units: bigint): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** An 18-decimal native Arc amount (the native USDC event) in 6-decimal units, cut. */
export function nativeArcToUnits(value: bigint) {
  return value / 10n ** 12n;
}

export type SweepPlan =
  | { action: "sweep"; amountUnits: bigint }
  | { action: "wait"; reason: "below-min" | "empty" | "paused" | "in-flight" };

/**
 * Whether an address's balance should go to Arc now. The whole balance moves
 * in one sweep, so deposits below the minimum add up until they pass it.
 */
export function planSweep(input: {
  balanceUnits: bigint;
  hasSweepInFlight: boolean;
  minDeposit: number;
  paused: boolean;
}): SweepPlan {
  if (input.hasSweepInFlight) return { action: "wait", reason: "in-flight" };
  if (input.balanceUnits <= 0n) return { action: "wait", reason: "empty" };
  if (input.paused) return { action: "wait", reason: "paused" };
  if (input.balanceUnits < usdcToUnits(input.minDeposit)) {
    return { action: "wait", reason: "below-min" };
  }
  return { action: "sweep", amountUnits: input.balanceUnits };
}

/**
 * Which recorded deposits a sweep carries: oldest first, while they fit in
 * the swept amount. Circle can count a transfer in the balance before it
 * calls the transfer complete, so unconfirmed rows qualify too; one that
 * does not fit waits for the next sweep.
 */
export function depositsForSweep<T extends { amount_in: string; detected_at: string }>(
  deposits: readonly T[],
  sweptUnits: bigint,
): T[] {
  const ordered = [...deposits].sort((a, b) => a.detected_at.localeCompare(b.detected_at));
  const carried: T[] = [];
  let total = 0n;
  for (const deposit of ordered) {
    const units = usdcToUnits(deposit.amount_in);
    if (total + units > sweptUnits) break;
    total += units;
    carried.push(deposit);
  }
  return carried;
}

/** What Circle kept (forward and fast-transfer fees): swept minus credited, never negative. */
export function sweepFeeUnits(sweptUnits: bigint, creditedUnits: bigint) {
  return sweptUnits > creditedUnits ? sweptUnits - creditedUnits : 0n;
}

/** Circle's inbound transaction state → the deposit state SaphraONE records. */
export function depositStateFromCircle(state: string | null | undefined): DepositState | null {
  switch ((state ?? "").toUpperCase()) {
    case "COMPLETE":
      return "CONFIRMED";
    case "FAILED":
    case "DENIED":
    case "CANCELLED":
      return "FAILED";
    case "INITIATED":
    case "PENDING_RISK_SCREENING":
    case "QUEUED":
    case "SENT":
    case "CONFIRMED":
      return "DETECTED";
    default:
      return null;
  }
}

/** Circle transaction states that are still moving. */
export function isCircleTxPending(state: string | null | undefined) {
  return ["INITIATED", "PENDING_RISK_SCREENING", "QUEUED", "SENT", "CONFIRMED", "CLEARED"].includes(
    (state ?? "").toUpperCase(),
  );
}

/** A sweep that started this long ago and never recorded a result is checked by hand. */
export const STALE_SWEEP_MS = 10 * 60 * 1000;
/**
 * After this many tries the logs raise an alert. Retries go on: until the
 * burn, the USDC is still on its own network and trying again is safe.
 */
export const MAX_SWEEP_ATTEMPTS = 5;

const FIRST_RETRY_MS = 60 * 1000;
const LAST_RETRY_MS = 60 * 60 * 1000;

/**
 * How long a failed sweep waits before its next try: 1, 2, 4… minutes, at
 * most an hour. Retrying at once only spends every try on the same outage.
 */
export function sweepRetryDelayMs(attempts: number) {
  return Math.min(LAST_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}

/**
 * What to do with a sweep that has no recorded bridge result (the process
 * stopped mid-bridge, or App Kit threw). Re-bridging blindly could burn twice,
 * so the chain decides: a burn already on record wins, anything still moving
 * means wait, and only a clean source lets the sweep start over.
 */
export function recoverSweepWithoutResult(input: {
  burnTxHash: string | null;
  pendingOutbound: boolean;
}): "burned" | "wait" | "restart" {
  if (input.burnTxHash) return "burned";
  if (input.pendingOutbound) return "wait";
  return "restart";
}

/**
 * Deterministic UUID (v4 layout) from a string, for Circle idempotency keys:
 * a retried "create my Base address" returns the first wallet instead of a
 * second one.
 */
export function idempotencyUuid(hexDigest: string) {
  const hex = hexDigest.replace(/[^0-9a-f]/gi, "").toLowerCase().padEnd(32, "0").slice(0, 32);
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ─── Outbound (send to another network) ──────────────────────────────────────

export const OUTBOUND_STATES = ["PENDING", "BURNED", "COMPLETED", "FAILED", "NEEDS_REVIEW"] as const;

export type OutboundState = (typeof OUTBOUND_STATES)[number];

/** The smallest cross-network send, in USDC. Below it the fee eats the payment. */
export const MIN_OUTBOUND_USDC = 1;
/**
 * SaphraONE's flat service fee on each send to another network, in USDC. Paid
 * as its own transfer to the platform fee wallet just before the burn, under
 * the same confirmation (see components/send/cross-chain-send.tsx).
 */
export const CROSS_CHAIN_SERVICE_FEE_USDC = "0.5";
/** What the recipient must get at least, after fees, in units (1 cent). */
const MIN_RECEIVE_UNITS = 10_000n;

export type OutboundQuote = { feeUnits: bigint; receiveUnits: bigint };

/**
 * What Circle keeps and what arrives: the Forwarding Service fee plus the
 * fast-transfer fee (basis points, can be fractional), both taken out of the
 * amount burned. Rounded up so the quote never promises more than arrives.
 */
export function quoteOutbound(input: { amountUnits: bigint; fastFeeBps: number; forwardFeeUnits: bigint }): OutboundQuote {
  // Basis points to 1/100 precision: 0.35 bps → 35 / 1_000_000.
  const bpsHundredths = BigInt(Math.max(0, Math.ceil(input.fastFeeBps * 100)));
  const fastFee = (input.amountUnits * bpsHundredths + 999_999n) / 1_000_000n;
  const feeUnits = input.forwardFeeUnits + fastFee;
  return { feeUnits, receiveUnits: input.amountUnits > feeUnits ? input.amountUnits - feeUnits : 0n };
}

/**
 * Who pays the network fee: taken out of the amount ("deduct", the recipient
 * gets less) or added on top ("add", the recipient gets the amount typed).
 */
export type FeeMode = "deduct" | "add";

export function readFeeMode(value: unknown): FeeMode {
  return value === "add" ? "add" : "deduct";
}

/** The smallest burn that still delivers `receiveUnits` after fees. */
export function grossForReceive(input: { fastFeeBps: number; forwardFeeUnits: bigint; receiveUnits: bigint }): bigint {
  const bpsHundredths = BigInt(Math.max(0, Math.ceil(input.fastFeeBps * 100)));
  const denominator = 1_000_000n - bpsHundredths;
  if (denominator <= 0n) throw new Error("Fee rate out of range.");
  let gross = ((input.receiveUnits + input.forwardFeeUnits) * 1_000_000n + denominator - 1n) / denominator;
  // The fast fee rounds up per unit, so step until the arrival is covered.
  while (quoteOutbound({ amountUnits: gross, ...input }).receiveUnits < input.receiveUnits) gross += 1n;
  return gross;
}

export type OutboundCheck ={ ok: true; amountUnits: bigint } | { ok: false; message: string };

/** Whether an amount can go out, given the quote and the sender's balance. */
export function checkOutbound(input: { amount: string; balanceUnits?: bigint; quote?: OutboundQuote }): OutboundCheck {
  let amountUnits: bigint;
  try {
    amountUnits = usdcToUnits(input.amount);
  } catch {
    return { message: "Enter a valid amount.", ok: false };
  }
  if (!/^\d+(\.\d{1,6})?$/.test(input.amount.trim())) return { message: "Use up to 6 decimals.", ok: false };
  if (amountUnits < usdcToUnits(MIN_OUTBOUND_USDC)) {
    return { message: `The smallest send to another network is ${MIN_OUTBOUND_USDC} USDC.`, ok: false };
  }
  if (input.balanceUnits !== undefined && amountUnits > input.balanceUnits) {
    return { message: "That is more than your USDC balance.", ok: false };
  }
  if (input.quote && input.quote.receiveUnits < MIN_RECEIVE_UNITS) {
    return { message: "The amount does not cover the network fee.", ok: false };
  }
  return { amountUnits, ok: true };
}
