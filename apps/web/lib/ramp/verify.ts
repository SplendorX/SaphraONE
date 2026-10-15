// Server-only. Reads an off-ramp deposit off the chain instead of trusting
// the browser: the transfer must have succeeded, paid Centiiv's deposit
// wallet the full amount, and come from the order's wallet.
import { getAddress, type Hash } from "viem";

import { createArcRpcClient } from "@/lib/arc-transfers";
import { receivedChargeAmount } from "@/lib/checkout/verify";

/** Rounding slack when comparing 6-decimal amounts read as numbers. */
const TOLERANCE = 0.000001;

type TransferLog = { address: string; data: `0x${string}`; topics: readonly `0x${string}`[] | [] };

export type DepositCheck =
  | { status: "ok"; amount: number; from: string }
  | { status: "pending" }
  | { status: "invalid"; reason: string };

/** The pure part: what a mined, successful receipt's logs prove. */
export function checkOfframpDeposit(input: {
  logs: readonly TransferLog[];
  depositAddress: string;
  totalToPay: string;
  wallet: string;
}): DepositCheck {
  const received = receivedChargeAmount({
    logs: input.logs,
    currency: "USDC",
    destination: input.depositAddress,
  });
  if (!received) {
    return { status: "invalid", reason: "That transaction didn't send USDC to the withdrawal address." };
  }
  if (received.amount + TOLERANCE < Number(input.totalToPay)) {
    return {
      status: "invalid",
      reason: `That transaction sent ${received.amount} USDC; the withdrawal needs ${input.totalToPay}.`,
    };
  }
  if (!received.from || getAddress(received.from) !== getAddress(input.wallet)) {
    return { status: "invalid", reason: "That transaction came from a different wallet." };
  }
  return { status: "ok", amount: received.amount, from: received.from.toLowerCase() };
}

export async function verifyOfframpDeposit(input: {
  txHash: Hash;
  depositAddress: string;
  totalToPay: string;
  wallet: string;
}): Promise<DepositCheck> {
  let receipt;
  try {
    receipt = await createArcRpcClient().getTransactionReceipt({ hash: input.txHash });
  } catch {
    // Not mined yet, or the RPC hiccupped: the browser retries.
    return { status: "pending" };
  }
  if (receipt.status !== "success") {
    return { status: "invalid", reason: "That transaction failed on-chain." };
  }
  return checkOfframpDeposit({ ...input, logs: receipt.logs });
}
