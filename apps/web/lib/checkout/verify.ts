// Server-only. Reads a charge payment off the chain instead of trusting the
// payer's browser for it.
import { decodeEventLog, formatUnits, getAddress, parseAbi, type Hash } from "viem";

import { receivedAmount } from "@/lib/account/verify-invoice-payment";
import {
  NATIVE_USDC_DECIMALS,
  NATIVE_USDC_EVENT_ADDRESS,
  createArcRpcClient,
} from "@/lib/arc-transfers";
import { refundTransferProven, sentByWallet } from "@/lib/checkout/refund-rules";
import type { ChargeCurrency } from "@/lib/checkout/types";
import { arcTokens } from "@/lib/tokens";

const transferEventAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

type TransferLog = { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] | [] };

/** The first sender of a credited transfer, for the payer exclusion rule. */
function firstSender(logs: readonly TransferLog[], emitter: string, destination: string) {
  const target = getAddress(destination);
  for (const log of logs) {
    if (log.address.toLowerCase() !== emitter.toLowerCase()) continue;
    try {
      const event = decodeEventLog({
        abi: transferEventAbi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (getAddress(event.args.to) === target && getAddress(event.args.from) !== target) {
        return event.args.from.toLowerCase();
      }
    } catch {
      // Not a Transfer event.
    }
  }
  return null;
}

/**
 * How much of the charge currency the logs delivered to `destination`.
 *
 * Arc emits a 6-decimal event from the USDC contract for an ERC-20 send and
 * an 18-decimal event from the native system address for every USDC move, so
 * an ERC-20 send shows up twice. The ERC-20 events win; the native ones count
 * only when there are none (a plain native send). Never both.
 */
export function receivedChargeAmount(input: {
  logs: readonly TransferLog[];
  currency: ChargeCurrency;
  destination: string;
}): { amount: number; from: string | null } | null {
  const token = arcTokens[input.currency];
  const erc20 = receivedAmount({ destination: input.destination, logs: input.logs, token });
  if (erc20 !== null) {
    return { amount: erc20, from: firstSender(input.logs, token.address, input.destination) };
  }
  if (input.currency !== "USDC") return null;

  const target = getAddress(input.destination);
  let total = 0n;
  for (const log of input.logs) {
    if (log.address.toLowerCase() !== NATIVE_USDC_EVENT_ADDRESS) continue;
    try {
      const event = decodeEventLog({
        abi: transferEventAbi,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (getAddress(event.args.to) === target && getAddress(event.args.from) !== target) {
        total += event.args.value;
      }
    } catch {
      // Not a Transfer event.
    }
  }
  if (total <= 0n) return null;
  return {
    amount: Number(formatUnits(total, NATIVE_USDC_DECIMALS)),
    from: firstSender(input.logs, NATIVE_USDC_EVENT_ADDRESS, input.destination),
  };
}

/**
 * Whether a confirmed transaction refunded `amount` of `currency` from the
 * merchant wallet to `destination` (directly or through the SaphraSend
 * router). The block time comes back so the caller can refuse a transfer
 * older than the refund. Null when it failed or isn't mined yet.
 */
export async function verifyRefundTransfer(input: {
  txHash: Hash;
  currency: ChargeCurrency;
  merchantWallet: string;
  destination: string;
  amount: string;
}): Promise<{ proven: boolean; received: number | null; blockTime: Date } | null> {
  const client = createArcRpcClient();
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: input.txHash });
  } catch {
    return null;
  }
  if (receipt.status !== "success") return null;
  const received =
    receivedChargeAmount({ currency: input.currency, destination: input.destination, logs: receipt.logs })?.amount ??
    null;
  const emitters = [arcTokens[input.currency].address, ...(input.currency === "USDC" ? [NATIVE_USDC_EVENT_ADDRESS] : [])];
  const sentByMerchant = sentByWallet({ emitters, logs: receipt.logs, wallet: input.merchantWallet });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return {
    blockTime: new Date(Number(block.timestamp) * 1000),
    proven: refundTransferProven({ amount: input.amount, received, sentByMerchant }),
    received,
  };
}

/**
 * What a confirmed transaction paid the merchant wallet, or null when it
 * failed, isn't mined yet, or paid nothing there.
 */
export async function verifyChargeTransfer(input: {
  txHash: Hash;
  currency: ChargeCurrency;
  destination: string;
}): Promise<{ amount: number; from: string | null; blockNumber: bigint } | null> {
  const client = createArcRpcClient();
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: input.txHash });
  } catch {
    return null;
  }
  if (receipt.status !== "success") return null;
  const received = receivedChargeAmount({
    currency: input.currency,
    destination: input.destination,
    logs: receipt.logs,
  });
  if (!received) return null;
  return { ...received, blockNumber: receipt.blockNumber, from: received.from ?? receipt.from.toLowerCase() };
}
