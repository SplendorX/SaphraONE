import {
  createPublicClient,
  http,
  type Address,
  type Hash,
  type TransactionReceipt,
  zeroAddress,
} from "viem";

import { swiftSaveVaultAddress } from "@/lib/save/config";
import { isValidTxHash } from "@/lib/save/validation";
import { arcChain } from "@/lib/chains";
import { circleDb, circleTables, readCircleDbError } from "@/lib/swift-circle/db";
import { logCircleEvent } from "@/lib/swift-circle/logging";
import { parseUnits } from "@/lib/swift-circle/money";
import { arcTokens } from "@/lib/tokens";

/** ERC-20 Transfer(address,address,uint256) topic. */
export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type DepositVerification =
  | { ok: true; creditedUnits: bigint }
  | { ok: false; pending: true; reason: string }
  | { ok: false; pending: false; reason: string };

type ReceiptLog = {
  address: string;
  topics: readonly string[];
  data: string;
};

export function normalizeTxHash(value: unknown): Hash | null {
  if (!isValidTxHash(value)) return null;
  return value.toLowerCase() as Hash;
}

function addressFromTopic(topic: string): Address | null {
  if (!topic || topic.length < 42) return null;
  const value = `0x${topic.slice(-40)}`;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value.toLowerCase() as Address;
}

/**
 * Sum ERC-20 Transfer value received by `destination` for `token`.
 * Works for SwiftPaySend router deposits: the router transfers USDC to treasury.
 */
export function tokenReceivedBy(
  logs: readonly ReceiptLog[],
  token: Address,
  destination: Address,
): bigint {
  const tokenAddr = token.toLowerCase();
  const dest = destination.toLowerCase();
  let total = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== tokenAddr) continue;
    const topic0 = log.topics[0]?.toLowerCase();
    if (topic0 !== ERC20_TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    const to = addressFromTopic(log.topics[2] ?? "");
    if (to !== dest) continue;
    try {
      const amount = BigInt(log.data || "0x0");
      if (amount > 0n) total += amount;
    } catch {
      // skip malformed log data
    }
  }
  return total;
}

export function verifyDepositReceipt(input: {
  receipt: Pick<TransactionReceipt, "status" | "logs"> | null;
  token: Address;
  treasury: Address;
  expectedUnits: bigint;
}): DepositVerification {
  if (!input.receipt) {
    return {
      ok: false,
      pending: true,
      reason: "The Arc transaction is not indexed yet.",
    };
  }
  if (input.receipt.status !== "success") {
    return {
      ok: false,
      pending: false,
      reason: "The deposit transaction reverted on Arc.",
    };
  }
  if (input.expectedUnits <= 0n) {
    return {
      ok: false,
      pending: false,
      reason: "Deposit amount must be greater than zero.",
    };
  }
  if (input.token.toLowerCase() === zeroAddress) {
    return {
      ok: false,
      pending: true,
      reason: "The USDC contract address is not configured.",
    };
  }
  const received = tokenReceivedBy(
    input.receipt.logs as ReceiptLog[],
    input.token,
    input.treasury,
  );
  if (received < input.expectedUnits) {
    return {
      ok: false,
      pending: false,
      reason: "On-chain USDC did not arrive at the Circle Save vault for this amount.",
    };
  }
  return { ok: true, creditedUnits: input.expectedUnits };
}

function createDepositPublicClient() {
  return createPublicClient({
    chain: arcChain,
    transport: http(arcChain.rpcUrls.default.http[0], { timeout: 8_000 }),
  });
}

export async function readArcReceipt(
  txHash: Hash,
  waitMs = 0,
): Promise<TransactionReceipt | null> {
  const publicClient = createDepositPublicClient();
  try {
    return await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    // not indexed yet
  }
  if (waitMs <= 0) return null;
  try {
    return await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
      pollingInterval: 400,
      timeout: waitMs,
    });
  } catch {
    return null;
  }
}

export async function findContributionByTxHash<T>(
  table: string,
  txHash: string,
): Promise<T | null> {
  const hash = normalizeTxHash(txHash);
  if (!hash) return null;
  const supabase = circleDb();
  const { data, error } = await supabase.from(table).select("*").ilike("tx_hash", hash).limit(2);
  if (error) {
    throw new Error(readCircleDbError(error, "Could not look up the deposit."));
  }
  const rows = (data ?? []) as T[];
  return rows[0] ?? null;
}

export async function txHashAlreadyConfirmed(input: {
  txHash: string;
  exceptId?: string;
}) {
  const hash = normalizeTxHash(input.txHash);
  if (!hash) return false;
  const supabase = circleDb();
  const [save, earn] = await Promise.all([
    supabase
      .from(circleTables.saveContributions)
      .select("id")
      .ilike("tx_hash", hash)
      .eq("status", "confirmed")
      .limit(2),
    supabase
      .from(circleTables.earnContributions)
      .select("id")
      .ilike("tx_hash", hash)
      .eq("status", "confirmed")
      .limit(2),
  ]);
  const ids = [...(save.data ?? []), ...(earn.data ?? [])]
    .map((row) => String((row as { id?: string }).id ?? ""))
    .filter(Boolean);
  return ids.some((id) => id !== input.exceptId);
}

export async function attachContributionTx(input: {
  table: string;
  id: string;
  actorWallet: string;
  txHash: Hash | null;
  transactionId?: string | null;
}) {
  const supabase = circleDb();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (input.txHash) patch.tx_hash = input.txHash;
  if (input.transactionId) patch.transaction_id = input.transactionId;
  const { data, error } = await supabase
    .from(input.table)
    .update(patch)
    .eq("id", input.id)
    .eq("user_wallet", input.actorWallet)
    .in("status", ["proposed", "submitted"])
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not record the deposit transaction."));
  }
  return data;
}

export async function markContributionFailed(table: string, id: string) {
  const supabase = circleDb();
  await supabase
    .from(table)
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["proposed", "submitted"]);
}

export async function listSubmittedDeposits<T>(table: string, circleId: string) {
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("circle_id", circleId)
    .eq("status", "submitted")
    .not("tx_hash", "is", null)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load submitted deposits."));
  }
  return (data ?? []) as T[];
}

export async function verifyContributionRow(input: {
  amountUnits: string;
  asset: string;
  txHash: string | null;
  waitMs?: number;
}): Promise<DepositVerification> {
  const hash = normalizeTxHash(input.txHash);
  if (!hash) {
    return {
      ok: false,
      pending: true,
      reason: "Waiting for the on-chain transaction hash.",
    };
  }
  const expectedUnits = parseUnits(input.amountUnits);
  const vault = swiftSaveVaultAddress();
  if (!vault) {
    return {
      ok: false,
      pending: true,
      reason: "SwiftSaveVault is not configured.",
    };
  }
  const tokenInfo =
    input.asset === "EURC" ? arcTokens.EURC : arcTokens.USDC;
  const receipt = await readArcReceipt(hash, input.waitMs ?? 0);
  return verifyDepositReceipt({
    receipt,
    token: tokenInfo.address,
    treasury: vault,
    expectedUnits,
  });
}

export function logDeposit(input: {
  product: "save" | "earn";
  status: string;
  circleId?: string;
  txHash?: string | null;
  extra?: Record<string, unknown>;
}) {
  logCircleEvent({
    operation: `deposit.${input.product}`,
    status: input.status,
    circleId: input.circleId,
    transactionId: input.txHash,
    extra: input.extra,
  });
}
