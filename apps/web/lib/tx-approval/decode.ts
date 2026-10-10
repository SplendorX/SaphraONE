// Server-only: decodes what a Circle call actually does, so approvals,
// risk checks and security emails rest on the call itself, not on what the
// page says about it.
import crypto from "node:crypto";

import { decodeFunctionData, erc20Abi, formatUnits, parseAbi, type Hex } from "viem";

import { swiftBatchAbi, swiftPaySendAbi } from "@/lib/contracts";
import { arcTokens } from "@/lib/tokens";
import type { TxCall } from "@/lib/tx-approval/shared";

export type DecodedCall =
  /** Money leaving to `destination`: a Circle transfer, an ERC-20 transfer or a SaphraONE send. */
  | {
      amount: number | null;
      destination: string;
      token: string;
      type: "pay";
      via: "bridge" | "circle-transfer" | "erc20-transfer" | "send-router";
    }
  /** A BulkPay / payroll batch: several recipients in one call. */
  | {
      payments: { amount: number | null; destination: string }[];
      token: string;
      type: "payMany";
    }
  | { spender: string; token: string; tokenAddress: string; type: "approve" }
  | { contract: string; nativeAmount: number; selector: string; type: "contract" }
  | { type: "sign" };

/**
 * A ceiling on what a token is worth in US dollars, for the risk checks.
 * EURC is priced above its usual rate so a euro payment never slips under a
 * dollar limit; an unknown token counts as dollars.
 */
const usdCeiling: Record<string, number> = { EURC: 1.25, USDC: 1 };

export function usdValue(amount: number | null, token: string | null) {
  if (amount === null || !Number.isFinite(amount)) return null;
  return amount * (usdCeiling[token ?? ""] ?? 1);
}

function tokenByAddress(address: string | undefined) {
  if (!address) return null;
  const lower = address.toLowerCase();
  return Object.values(arcTokens).find((token) => token.address.toLowerCase() === lower) ?? null;
}

function lower(value: string | undefined) {
  return value ? value.trim().toLowerCase() : "";
}

export function decodeCall(call: TxCall): DecodedCall {
  if (call.action === "signTypedData") {
    return { type: "sign" };
  }

  if (call.action === "createTransfer") {
    const token = tokenByAddress(call.tokenAddress);
    const amount = Number(call.amount);
    return {
      amount: Number.isFinite(amount) ? amount : null,
      destination: lower(call.destinationAddress),
      token: token?.symbol ?? "USDC",
      type: "pay",
      via: "circle-transfer",
    };
  }

  const contract = lower(call.contractAddress);
  const data = (call.callData ?? "0x") as Hex;
  const nativeAmount = Number(call.amount ?? 0) || 0;
  const token = tokenByAddress(contract);

  try {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
    if (functionName === "transfer" && args) {
      const [to, units] = args as readonly [string, bigint];
      return {
        amount: token ? Number(formatUnits(units, token.decimals)) : null,
        destination: to.toLowerCase(),
        token: token?.symbol ?? "tokens",
        type: "pay",
        via: "erc20-transfer",
      };
    }
    if (functionName === "approve" && args) {
      const [spender] = args as readonly [string, bigint];
      return {
        spender: spender.toLowerCase(),
        token: token?.symbol ?? "tokens",
        tokenAddress: contract,
        type: "approve",
      };
    }
  } catch {
    // Not an ERC-20 call.
  }

  try {
    const { functionName, args } = decodeFunctionData({ abi: swiftPaySendAbi, data });
    if (functionName === "send" && args) {
      const [tokenAddress, recipient, units] = args;
      const sent = tokenByAddress(tokenAddress);
      return {
        amount: sent ? Number(formatUnits(units, sent.decimals)) : null,
        destination: recipient.toLowerCase(),
        token: sent?.symbol ?? "tokens",
        type: "pay",
        via: "send-router",
      };
    }
  } catch {
    // Not a SaphraONE send.
  }

  try {
    const { functionName, args } = decodeFunctionData({ abi: swiftBatchAbi, data });
    if (functionName === "sendBatch" && args) {
      const [tokenAddress, recipients, amounts] = args;
      const sent = tokenByAddress(tokenAddress);
      return {
        payments: recipients.map((recipient, index) => ({
          amount: sent ? Number(formatUnits(amounts[index] ?? 0n, sent.decimals)) : null,
          destination: recipient.toLowerCase(),
        })),
        token: sent?.symbol ?? "tokens",
        type: "payMany",
      };
    }
  } catch {
    // Not a BulkPay batch.
  }

  try {
    // Circle's bridge (CCTP v1 and v2): the burn names who is paid on the
    // other chain, as a 32-byte address.
    const { args } = decodeFunctionData({ abi: cctpBurnAbi, data });
    const [units, , mintRecipient, burnToken] = args as readonly [bigint, number, Hex, string];
    const burned = tokenByAddress(burnToken);
    return {
      amount: burned ? Number(formatUnits(units, burned.decimals)) : null,
      destination: `0x${mintRecipient.slice(-40)}`.toLowerCase(),
      token: burned?.symbol ?? "tokens",
      type: "pay",
      via: "bridge",
    };
  } catch {
    // Not a bridge burn.
  }

  return { contract, nativeAmount, selector: data.slice(0, 10).toLowerCase(), type: "contract" };
}

const cctpBurnAbi = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken)",
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)",
]);

/** Each payment a call makes, whatever its shape. */
export function paymentsOf(decoded: DecodedCall) {
  if (decoded.type === "pay") {
    return [{ amount: decoded.amount, destination: decoded.destination, token: decoded.token }];
  }
  if (decoded.type === "payMany") {
    return decoded.payments.map((payment) => ({ ...payment, token: decoded.token }));
  }
  return [];
}

/** The exact call, hashed: an approval for one call covers that call only. */
export function hashCall(call: TxCall) {
  const normalized = [
    call.action,
    call.walletId,
    lower(call.contractAddress),
    lower(call.callData),
    call.amount?.trim() ?? "",
    lower(call.destinationAddress),
    call.tokenId?.trim() ?? "",
    lower(call.tokenAddress),
    call.blockchain?.trim().toUpperCase() ?? "",
    call.data ?? "",
  ].join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/** A short description of a call for the confirmation sheet and the email. */
export function describeCall(decoded: DecodedCall) {
  switch (decoded.type) {
    case "pay":
      return {
        amount: decoded.amount,
        destination: decoded.destination,
        title: "Send money",
        token: decoded.token,
      };
    case "payMany": {
      const total = decoded.payments.every((payment) => payment.amount !== null)
        ? decoded.payments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0)
        : null;
      return {
        amount: total,
        destination: decoded.payments.length === 1 ? decoded.payments[0].destination : null,
        title: `Pay ${decoded.payments.length} people`,
        token: decoded.token,
      };
    }
    case "approve":
      return {
        amount: null,
        destination: decoded.spender,
        title: `Allow a contract to use your ${decoded.token}`,
        token: decoded.token,
      };
    case "contract":
      return {
        amount: decoded.nativeAmount > 0 ? decoded.nativeAmount : null,
        destination: decoded.contract,
        title: "Confirm a transaction",
        token: decoded.nativeAmount > 0 ? "USDC" : null,
      };
    case "sign":
      return { amount: null, destination: null, title: "Sign an authorization", token: null };
  }
}

