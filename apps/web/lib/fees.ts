import { formatUnits } from "viem";

import { getSaphraSendAddress } from "@/lib/contracts";

/** Platform fee on direct sends through the old SwiftPaySend router: 0.1%. */
export const SEND_FEE_BPS = 10;

/**
 * SaphraSend's flat fee per amount band, in units of a 6-decimal token
 * (USDC, EURC): a band covers amounts up to and including `upTo`. Above the
 * last band the fee is `sendFeeCap`. The contract holds the same schedule
 * (packages/contracts/config/send-fee-tiers.json); keep the two in step.
 */
export const sendFeeTiers = [
  { upTo: 10_000_000n, fee: 10_000n }, // up to 10 → 0.01
  { upTo: 50_000_000n, fee: 50_000n }, // up to 50 → 0.05
  { upTo: 200_000_000n, fee: 200_000n }, // up to 200 → 0.20
  { upTo: 500_000_000n, fee: 500_000n }, // up to 500 → 0.50
  { upTo: 1_000_000_000n, fee: 1_000_000n }, // up to 1,000 → 1
  { upTo: 5_000_000_000n, fee: 2_000_000n }, // up to 5,000 → 2
  { upTo: 20_000_000_000n, fee: 4_000_000n }, // up to 20,000 → 4
] as const;
export const sendFeeCap = 5_000_000n; // above 20,000 → 5

/**
 * SwiftPaySend routers, which charge a flat 0.1% on-chain. Until the
 * configured router is a SaphraSend, quotes must match what these charge.
 */
const legacySendRouters = new Set([
  "0x0b65bc22f4ad5106abfeb0585e6ae7ab7fcaf2d6", // Arc mainnet
  "0xf787b27ad58848557bfe57e85120127ba7ee2bb4", // Arc testnet
]);

export function usesLegacySendFee(router: string = getSaphraSendAddress()) {
  return legacySendRouters.has(router.trim().toLowerCase());
}

/** The platform fee the send router takes for sending `amountUnits`. */
export function sendFeeUnits(amountUnits: bigint, router?: string): bigint {
  if (amountUnits <= 0n) return 0n;
  if (usesLegacySendFee(router)) return platformFeeUnits(amountUnits, SEND_FEE_BPS);
  return sendFeeTiers.find((tier) => amountUnits <= tier.upTo)?.fee ?? sendFeeCap;
}

/**
 * The most that can be sent from `spendableUnits` once the send fee and a
 * Spend&Save share (`saveBps` of the amount) are added on top.
 */
export function maxSendableUnits(spendableUnits: bigint, saveBps: bigint, router?: string): bigint {
  if (spendableUnits <= 0n) return 0n;
  const denominator = 10_000n + saveBps;
  if (usesLegacySendFee(router)) {
    return (spendableUnits * 10_000n) / (denominator + BigInt(SEND_FEE_BPS));
  }
  // Best amount inside each band (its fee is fixed there), largest wins.
  let best = 0n;
  let bandStart = 0n;
  for (const { upTo, fee } of [...sendFeeTiers, { upTo: null, fee: sendFeeCap }]) {
    if (spendableUnits > fee) {
      const fits = ((spendableUnits - fee) * 10_000n) / denominator;
      const amount = upTo !== null && fits > upTo ? upTo : fits;
      if (amount > bandStart && amount > best) best = amount;
    }
    if (upTo === null) break;
    bandStart = upTo;
  }
  return best;
}

/** The send fee in a sentence, for help answers and marketing copy. */
export function sendFeeSummary() {
  return usesLegacySendFee()
    ? "0.1%"
    : "a flat fee by amount: 0.01 up to 10, 0.05 up to 50, 0.20 up to 200, 0.50 up to 500, 1 up to 1,000, 2 up to 5,000, 4 up to 20,000, and never more than 5";
}

/** How the send fee is named next to its amount. */
export function sendFeeLabel(router?: string) {
  return usesLegacySendFee(router) ? `${feePercentLabel(SEND_FEE_BPS)} service fee` : "Service fee";
}

/** Platform fee on swaps: 0.3%. */
export const SWAP_FEE_BPS = 30;

export const FEE_BPS_DENOMINATOR = 10_000;

export function platformFeeRecipient() {
  return process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim() ?? "";
}

export function platformFeeUnits(
  amountUnits: bigint,
  bps: number = SEND_FEE_BPS,
): bigint {
  if (amountUnits <= 0n || bps <= 0) {
    return 0n;
  }

  return (amountUnits * BigInt(bps)) / BigInt(FEE_BPS_DENOMINATOR);
}

export function formatFeeAmount(amountUnits: bigint, decimals: number) {
  return formatUnits(amountUnits, decimals);
}

export function feePercentLabel(bps: number) {
  const whole = Math.floor(bps / 100);
  const fraction = (bps % 100).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}
