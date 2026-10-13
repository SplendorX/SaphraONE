import { formatUnits } from "viem";

import {
  getSaphraSendAddress,
  isLegacyContract,
  payrollExecutorAddressValue,
  recurringPlatformFeeBasisPoints,
  swiftBatchAddress,
  swiftBatchFeeBasisPoints,
  swiftRecurepayExecutorAddress,
} from "@/lib/contracts";

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

type FeeBand = { readonly upTo: bigint; readonly fee: bigint };

function bandFee(tiers: readonly FeeBand[], cap: bigint, amountUnits: bigint) {
  return tiers.find((tier) => amountUnits <= tier.upTo)?.fee ?? cap;
}

/**
 * SaphraBulkPay and SaphraPayroll: a flat fee on the batch (or run) total,
 * never less than `bulkRecipientFeeMin` per person paid. Same schedule as
 * packages/contracts/config/bulkpay-fee-tiers.json; keep the two in step.
 */
export const bulkFeeTiers = [
  { upTo: 50_000_000n, fee: 100_000n }, // up to 50 → 0.10
  { upTo: 200_000_000n, fee: 500_000n }, // up to 200 → 0.50
  { upTo: 1_000_000_000n, fee: 2_000_000n }, // up to 1,000 → 2
  { upTo: 5_000_000_000n, fee: 5_000_000n }, // up to 5,000 → 5
  { upTo: 20_000_000_000n, fee: 10_000_000n }, // up to 20,000 → 10
  { upTo: 100_000_000_000n, fee: 20_000_000n }, // up to 100,000 → 20
] as const;
export const bulkFeeCap = 25_000_000n; // above 100,000 → 25
export const bulkRecipientFeeMin = 10_000n; // 0.01 per person

/**
 * SaphraRecurePay: a flat fee per payment. Same schedule as
 * packages/contracts/config/recurepay-fee-tiers.json; keep the two in step.
 */
export const recurringFeeTiers = [
  { upTo: 10_000_000n, fee: 20_000n }, // up to 10 → 0.02
  { upTo: 50_000_000n, fee: 100_000n }, // up to 50 → 0.10
  { upTo: 200_000_000n, fee: 300_000n }, // up to 200 → 0.30
  { upTo: 500_000_000n, fee: 750_000n }, // up to 500 → 0.75
  { upTo: 1_000_000_000n, fee: 1_500_000n }, // up to 1,000 → 1.50
  { upTo: 5_000_000_000n, fee: 3_000_000n }, // up to 5,000 → 3
  { upTo: 20_000_000_000n, fee: 6_000_000n }, // up to 20,000 → 6
] as const;
export const recurringFeeCap = 8_000_000n; // above 20,000 → 8

/** The old BatchPay is configured (1%), not SaphraBulkPay. */
export function usesLegacyBulkFee(contract: string = swiftBatchAddress) {
  return !contract || isLegacyContract(contract, "bulkPay");
}

/** The old SwiftPayrollExecutor is configured (1%), not SaphraPayroll. */
export function usesLegacyPayrollFee(contract: string = payrollExecutorAddressValue) {
  return !contract || isLegacyContract(contract, "payroll");
}

/** The old RecurePayExecutor (1%), not SaphraRecurePay. */
export function usesLegacyRecurringFee(executor: string = swiftRecurepayExecutorAddress) {
  return !executor || isLegacyContract(executor, "recurePay");
}

/** The banded batch fee: the band for the total, or 0.01 per person if more. */
function bandedBatchFee(totalUnits: bigint, recipientCount: number) {
  const banded = bandFee(bulkFeeTiers, bulkFeeCap, totalUnits);
  const floor = bulkRecipientFeeMin * BigInt(Math.max(0, recipientCount));
  return floor > banded ? floor : banded;
}

/** The fee BulkPay takes for paying `totalUnits` to `recipientCount` people. */
export function bulkFeeUnits(totalUnits: bigint, recipientCount: number, contract?: string): bigint {
  if (totalUnits <= 0n) return 0n;
  if (usesLegacyBulkFee(contract)) return platformFeeUnits(totalUnits, swiftBatchFeeBasisPoints);
  return bandedBatchFee(totalUnits, recipientCount);
}

/** The fee a payroll run pays: BulkPay's bands and per-person minimum. */
export function payrollFeeUnits(totalUnits: bigint, recipientCount: number, contract?: string): bigint {
  if (totalUnits <= 0n) return 0n;
  if (usesLegacyPayrollFee(contract)) return platformFeeUnits(totalUnits, swiftBatchFeeBasisPoints);
  return bandedBatchFee(totalUnits, recipientCount);
}

/** The fee one RecurePay payment pays, on `executor` (the configured one by default). */
export function recurringFeeUnits(amountUnits: bigint, executor?: string): bigint {
  if (amountUnits <= 0n) return 0n;
  if (usesLegacyRecurringFee(executor)) {
    return platformFeeUnits(amountUnits, recurringPlatformFeeBasisPoints);
  }
  return bandFee(recurringFeeTiers, recurringFeeCap, amountUnits);
}

/**
 * How a batch's fee is named next to its amount: the rate on the old
 * contract, and when the 0.01-per-person minimum is what applies, that.
 */
export function bulkFeeLabel(totalUnits: bigint, recipientCount: number, legacy = usesLegacyBulkFee()) {
  if (legacy) return `Service fee (${feePercentLabel(swiftBatchFeeBasisPoints)})`;
  const floorApplies =
    bulkRecipientFeeMin * BigInt(Math.max(0, recipientCount)) > bandFee(bulkFeeTiers, bulkFeeCap, totalUnits);
  return floorApplies ? "Service fee (0.01 per person minimum)" : "Service fee";
}

/** One line on what BulkPay (or Payroll) charges, before any amounts. */
export function bulkFeeNote(legacy = usesLegacyBulkFee()) {
  return legacy
    ? `A ${feePercentLabel(swiftBatchFeeBasisPoints)} service fee, shown before you confirm`
    : "A flat service fee from 0.10, never more than 25, shown before you confirm";
}

/** The BulkPay / Payroll fee in a sentence. */
export function bulkFeeSummary(legacy = usesLegacyBulkFee()) {
  return legacy
    ? `${feePercentLabel(swiftBatchFeeBasisPoints)} of the total`
    : "a flat fee by total: 0.10 up to 50, 0.50 up to 200, 2 up to 1,000, 5 up to 5,000, 10 up to 20,000, 20 up to 100,000, and never more than 25 — at least 0.01 per person paid";
}

/** The RecurePay fee for a decimal amount, as a decimal (for display). */
export function recurringFeeForAmount(amount: number, executor?: string) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Number(recurringFeeUnits(BigInt(Math.round(amount * 1_000_000)), executor)) / 1_000_000;
}

/** "(1%)" while the old executor is configured; nothing for a flat band fee. */
export function recurringFeeRateNote() {
  return usesLegacyRecurringFee() ? ` (${feePercentLabel(recurringPlatformFeeBasisPoints)})` : "";
}

/** The RecurePay fee in a sentence. */
export function recurringFeeSummary() {
  return usesLegacyRecurringFee()
    ? `${feePercentLabel(recurringPlatformFeeBasisPoints)} of each payment`
    : "a flat fee per payment: 0.02 up to 10, 0.10 up to 50, 0.30 up to 200, 0.75 up to 500, 1.50 up to 1,000, 3 up to 5,000, 6 up to 20,000, and never more than 8";
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
