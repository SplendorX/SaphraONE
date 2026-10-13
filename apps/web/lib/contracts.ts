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

/**
 * Contract addresses. Each reads its SaphraONE name first and the old SwiftPay
 * name second, so an environment set before the rename keeps working.
 */
export const swiftBatchAddress =
  process.env.NEXT_PUBLIC_SAPHRA_BULKPAY_ADDRESS?.trim() ||
  process.env.NEXT_PUBLIC_SWIFTBATCH_ADDRESS?.trim() ||
  "";

export const swiftBatchFeeRecipient =
  process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim() ?? "";

/** The old BatchPay, RecurePayExecutor and payroll contracts' fee: 1% = 100 bps. */
export const swiftBatchFeeBasisPoints = 100;

/** Same 1% on the old RecurePayExecutor. */
export const recurringPlatformFeeBasisPoints = 100;

export const swiftBatchMaxRecipients = 500;

export const swiftRecurepayExecutorAddress =
  process.env.NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS?.trim() ||
  process.env.NEXT_PUBLIC_SWIFTRECUREPAY_EXECUTOR_ADDRESS?.trim() ||
  "";

export const payrollExecutorAddressValue =
  process.env.NEXT_PUBLIC_SAPHRA_PAYROLL_ADDRESS?.trim() ||
  process.env.NEXT_PUBLIC_SWIFTPAY_PAYROLL_EXECUTOR_ADDRESS?.trim() ||
  "";

/**
 * The 1% contracts the Saphra ones replace, by chain (Arc mainnet 5042, Arc
 * testnet 5042002). Fees are quoted at 1% while one of these is configured,
 * and RecurePay mandates made on the old executor keep being paid there.
 */
export const legacyFeeContracts = {
  bulkPay: {
    5042: "0x4fe71EA6edAa8ac55c134d3de29A6b682Cc398E5",
    5042002: "0x69d00620ffC46d722922F0F03905788732323304",
  },
  recurePay: {
    5042: "0x23C1565446F57Bb2c12287fE5d8D667a88fe7928",
    5042002: "0xf71F81084c7a3CFD2e5fc89908F036c0E496ec77",
  },
  payroll: {
    5042: "0xC189c6b4fB836381de9702B9dE957020e630Fc26",
    5042002: "0x25C1a5423BaDdA3cbf502A8eEC7a99FD8dc6eB83",
  },
} as const;

/** Whether `address` is one of the old 1% contracts of `kind`. */
export function isLegacyContract(address: string, kind: keyof typeof legacyFeeContracts) {
  const value = address.trim().toLowerCase();
  return Object.values(legacyFeeContracts[kind]).some((legacy) => legacy.toLowerCase() === value);
}

/** Direct-send router (SaphraSend: flat fee by amount band; SwiftPaySend: 0.1%) + optional Spend&Save in one call. */
export function getSaphraSendAddress() {
  // Bracket access so Next does not inline an empty string at compile time.
  return (
    process.env["NEXT_PUBLIC_SAPHRA_SEND_ADDRESS"]?.trim() ||
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
