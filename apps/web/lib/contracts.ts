import type { Abi } from "viem";

/**
 * @deprecated Legacy merchant treasury stub ABI (apps/web/abi.json).
 * Earn uses `lib/earn/*` — Circle App Kit Earn vaults.
 */
import legacyTreasuryAbiJson from "@/abi.json";

/** @deprecated Prefer swiftPayVaultAbi from @/lib/earn/abis */
export const swiftPayVaultAbi = legacyTreasuryAbiJson as Abi;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export const swiftBatchAddress =
  process.env.NEXT_PUBLIC_SWIFTBATCH_ADDRESS?.trim() ?? "";

export const swiftBatchFeeRecipient =
  process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim() ?? "";

/** Platform fee for BulkPay and RecurePay: 1% = 100 bps. */
export const swiftBatchFeeBasisPoints = 100;

/** Same 1% platform fee for recurring (RecurePay) payments. */
export const recurringPlatformFeeBasisPoints = 100;

export const swiftBatchMaxRecipients = 500;

export const swiftRecurepayExecutorAddress =
  process.env.NEXT_PUBLIC_SWIFTRECUREPAY_EXECUTOR_ADDRESS?.trim() ?? "";

/** Direct-send router (SaphraSend: flat fee by amount band; SwiftPaySend: 0.1%) + optional Spend&Save in one call. */
export function getSaphraSendAddress() {
  // Bracket access so Next does not inline an empty string at compile time.
  return (
    process.env["NEXT_PUBLIC_SWIFTPAY_SEND_ADDRESS"]?.trim() ||
    process.env["SWIFTPAY_SEND_ADDRESS"]?.trim() ||
    ""
  );
}

export const swiftPaySendAbi = [
  {
    type: "function",
    name: "send",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "vault", type: "address" },
      { name: "pocketId", type: "bytes32" },
      { name: "saveAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "feeRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "PLATFORM_FEE_BASIS_POINTS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // SaphraSend: the flat fee for an amount, from its fee bands.
  {
    type: "function",
    name: "feeFor",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const swiftRecurepayExecutorAbi = [
  {
    type: "function",
    name: "operator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "executeRecurringPayment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "executionId", type: "bytes32" },
      { name: "mandateId", type: "bytes32" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "createMandate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "token", type: "address" },
      { name: "maxPerPeriod", type: "uint256" },
      { name: "period", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
    ],
    outputs: [{ name: "mandateId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancelMandate",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "mandates",
    stateMutability: "view",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [
      { name: "payer", type: "address" },
      { name: "recipient", type: "address" },
      { name: "token", type: "address" },
      { name: "period", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "windowStart", type: "uint64" },
      { name: "active", type: "bool" },
      { name: "maxPerPeriod", type: "uint256" },
      { name: "spentInWindow", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "remainingInPeriod",
    stateMutability: "view",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "MandateCreated",
    inputs: [
      { name: "mandateId", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "maxPerPeriod", type: "uint256", indexed: false },
      { name: "period", type: "uint64", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
    ],
  },
  {
    type: "function",
    name: "consumedExecutionIds",
    stateMutability: "view",
    inputs: [{ name: "executionId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const swiftBatchAbi = [
  {
    type: "function",
    name: "sendBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "feeRecipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "PLATFORM_FEE_BASIS_POINTS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_RECIPIENTS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** SwiftPayrollExecutor: pays only payees the business registered, within their caps. */
export const swiftPayrollExecutorAbi = [
  {
    inputs: [
      { name: "executionId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "payer", type: "address" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    name: "executePayroll",
    outputs: [
      { name: "grossAmount", type: "uint256" },
      { name: "feeAmount", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "recipients", type: "address[]" },
      { name: "caps", type: "uint256[]" },
      { name: "period", type: "uint64" },
    ],
    name: "setPayees",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "payer", type: "address" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
    ],
    name: "payees",
    outputs: [
      { name: "maxPerPeriod", type: "uint256" },
      { name: "spentInWindow", type: "uint256" },
      { name: "period", type: "uint64" },
      { name: "windowStart", type: "uint64" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "payer", type: "address" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
    ],
    name: "remainingInPeriod",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "PLATFORM_FEE_BASIS_POINTS",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
