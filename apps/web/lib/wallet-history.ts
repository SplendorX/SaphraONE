// Server-only. A wallet's USDC/EURC history from the Arc RPC, kept in
// wallet_transfer_history so a page load only reads what is new (see
// packages/database/supabase/wallet-transfer-history.sql).
import { erc20Abi, zeroAddress, type Address, type Hash } from "viem";

import {
  createArcRpcClient,
  fetchWalletTransfersFromRpc,
  withBlockTimestamps,
} from "@/lib/arc-transfers";
import { getPlatformFeeRecipientAddresses, type WalletTransfer } from "@/lib/arcscan-history";
import { arcChain } from "@/lib/chains";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";

const historyTable = "wallet_transfer_history";
const cursorTable = "wallet_history_cursors";

// Arc makes a block about every half second.
/** How far back a wallet's history is filled: about 90 days (Transaction History's window). */
const HISTORY_DEPTH_BLOCKS = 15_552_000n;
/** The first read covers about 3 hours, so recent activity shows at once. */
const FIRST_READ_BLOCKS = 21_600n;
/** Most new blocks one load reads (~6 hours); a longer gap catches up over loads. */
const MAX_FORWARD_BLOCKS = 43_200n;
/** Skip a wallet read this recently (another tab, the overview). */
const MIN_SYNC_INTERVAL_MS = 15_000;
/** Rows returned, newest first, like the explorer's list. */
const HISTORY_LIMIT = 100;

type Cursor = { newestBlock: bigint; oldestBlock: bigint; floorBlock: bigint; updatedAt: number };

type HistoryRow = {
  tx_hash: string;
  log_index: number;
  direction: "in" | "out";
  counterparty: string;
  symbol: ArcTokenSymbol;
  amount: string;
  block_number: number | string;
  occurred_at: string | null;
};

function db() {
  return createSupabaseAdminClient();
}

async function readCursor(wallet: string): Promise<Cursor | null> {
  const { data, error } = await db()
    .from(cursorTable)
    .select("newest_block, oldest_block, floor_block, updated_at")
    .eq("chain_id", arcChain.id)
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    floorBlock: BigInt(data.floor_block),
    newestBlock: BigInt(data.newest_block),
    oldestBlock: BigInt(data.oldest_block),
    updatedAt: Date.parse(data.updated_at),
  };
}

async function writeCursor(wallet: string, cursor: Omit<Cursor, "updatedAt">) {
  const { error } = await db()
    .from(cursorTable)
    .upsert(
      {
        chain_id: arcChain.id,
        floor_block: cursor.floorBlock.toString(),
        newest_block: cursor.newestBlock.toString(),
        oldest_block: cursor.oldestBlock.toString(),
        updated_at: new Date().toISOString(),
        wallet_address: wallet,
      },
      { onConflict: "chain_id,wallet_address" },
    );
  if (error) throw error;
}

async function storeTransfers(wallet: string, transfers: WalletTransfer[]) {
  if (transfers.length === 0) return;
  const timed = await withBlockTimestamps(transfers);
  const { error } = await db()
    .from(historyTable)
    .upsert(
      timed.map((transfer) => ({
        amount: transfer.amount,
        block_number: transfer.blockNumber,
        chain_id: arcChain.id,
        counterparty: transfer.counterparty.toLowerCase(),
        direction: transfer.direction,
        log_index: transfer.logIndex,
        occurred_at: transfer.timestamp,
        symbol: transfer.symbol,
        tx_hash: transfer.hash.toLowerCase(),
        wallet_address: wallet,
      })),
      { ignoreDuplicates: true, onConflict: "chain_id,wallet_address,tx_hash,log_index,direction" },
    );
  if (error) throw error;
}

async function readRange(
  wallet: string,
  range: { fromBlock: bigint; toBlock: bigint },
  client: ReturnType<typeof createArcRpcClient>,
) {
  // One direction at a time keeps the request rate down.
  const incoming = await fetchWalletTransfersFromRpc(wallet, range, "in", client);
  const outgoing = await fetchWalletTransfersFromRpc(wallet, range, "out", client);
  return [...incoming, ...outgoing];
}

/**
 * Reads what is new since the last load and fills a little more of the past.
 * The cursor only moves once the blocks it covers are stored, so a failed
 * read is retried next time rather than skipped.
 */
export async function syncWalletHistory(walletInput: string) {
  const wallet = walletInput.toLowerCase();
  const cursor = await readCursor(wallet);
  if (cursor && Date.now() - cursor.updatedAt < MIN_SYNC_INTERVAL_MS) return;

  const client = createArcRpcClient();
  const head = await client.getBlockNumber();

  let next: Omit<Cursor, "updatedAt">;
  if (!cursor) {
    const fromBlock = head > FIRST_READ_BLOCKS ? head - FIRST_READ_BLOCKS : 0n;
    await storeTransfers(wallet, await readRange(wallet, { fromBlock, toBlock: head }, client));
    next = {
      floorBlock: head > HISTORY_DEPTH_BLOCKS ? head - HISTORY_DEPTH_BLOCKS : 0n,
      newestBlock: head,
      oldestBlock: fromBlock,
    };
  } else {
    next = { ...cursor };
    // Wallets first read with a shallower depth keep filling to the current one.
    const floor = head > HISTORY_DEPTH_BLOCKS ? head - HISTORY_DEPTH_BLOCKS : 0n;
    if (floor < cursor.floorBlock) next.floorBlock = floor;
    // Forward: everything new, up to the per-load cap.
    if (cursor.newestBlock < head) {
      const fromBlock = cursor.newestBlock + 1n;
      const toBlock = head - fromBlock + 1n > MAX_FORWARD_BLOCKS ? fromBlock + MAX_FORWARD_BLOCKS - 1n : head;
      await storeTransfers(wallet, await readRange(wallet, { fromBlock, toBlock }, client));
      next.newestBlock = toBlock;
    }
  }
  // Backward: as much of the past as the time budget allows, down to the floor.
  if (next.oldestBlock > next.floorBlock) {
    next.oldestBlock = await backfill(wallet, next, client);
  }
  await writeCursor(wallet, next);
}

/** How long one load spends filling the past. */
const BACKFILL_BUDGET_MS = 7_000;
/** The widest span checked in one step; a quiet wallet skips this much at once. */
const MAX_SKIP_BLOCKS = 2_000_000n;
/** Below this, a span with movement is read with getLogs. */
const SCAN_BLOCKS = 9_999n;

type BalanceReader = ReturnType<typeof createArcRpcClient>;

/**
 * The wallet's USDC and EURC balances and transaction count at a block.
 * Equal at both ends of a span means no transfer happened in between (bar an
 * exact in-and-out of the same amount), so that span needs no log reads.
 */
async function walletStateAt(client: BalanceReader, wallet: Address, block: bigint, cache: Map<bigint, string>) {
  const known = cache.get(block);
  if (known) return known;
  const eurc = arcTokens.EURC.address;
  // One at a time: the public RPC rate-limits bursts.
  const usdc = await client.getBalance({ address: wallet, blockNumber: block });
  const nonce = await client.getTransactionCount({ address: wallet, blockNumber: block });
  const eurcBalance =
    eurc === zeroAddress
      ? 0n
      : await client.readContract({ abi: erc20Abi, address: eurc, args: [wallet], blockNumber: block, functionName: "balanceOf" });
  const state = `${usdc}:${eurcBalance}:${nonce}`;
  cache.set(block, state);
  return state;
}

/**
 * Fills history below `oldestBlock`, newest first, within the time budget.
 * The public RPC allows only 10,000 blocks per log query (about 3,000 queries
 * for 90 days), so spans where the wallet's balances didn't change are
 * skipped whole and only spans with movement are read. Returns the new
 * oldest block: everything from it upward is stored.
 */
async function backfill(wallet: string, cursor: Omit<Cursor, "updatedAt">, client: BalanceReader) {
  const deadline = Date.now() + BACKFILL_BUDGET_MS;
  const address = wallet as Address;
  const states = new Map<bigint, string>();
  let oldest = cursor.oldestBlock;
  let span = MAX_SKIP_BLOCKS;
  while (oldest > cursor.floorBlock && Date.now() < deadline) {
    try {
      ({ oldest, span } = await backfillStep(wallet, address, cursor.floorBlock, oldest, span, client, states));
    } catch (error) {
      // Busy RPC: keep what's done; the next load carries on from here.
      console.warn("[wallet-history] backfill paused", wallet, error instanceof Error ? error.message : error);
      break;
    }
  }
  return oldest;
}

async function backfillStep(
  wallet: string,
  address: Address,
  floor: bigint,
  oldest: bigint,
  span: bigint,
  client: BalanceReader,
  states: Map<bigint, string>,
): Promise<{ oldest: bigint; span: bigint }> {
  {
    const hi = oldest - 1n;
    const lo = hi - span + 1n > floor ? hi - span + 1n : floor;
    if (hi - lo + 1n <= SCAN_BLOCKS) {
      await storeTransfers(wallet, await readRange(wallet, { fromBlock: lo, toBlock: hi }, client));
      return { oldest: lo, span: MAX_SKIP_BLOCKS };
    }
    const before = lo === 0n ? "0:0:0" : await walletStateAt(client, address, lo - 1n, states);
    const after = await walletStateAt(client, address, hi, states);
    // Unchanged: skip the span whole. Changed: look closer at the newer half.
    return before === after ? { oldest: lo, span: MAX_SKIP_BLOCKS } : { oldest, span: span / 2n };
  }
}

/** Known SaphraONE contracts, labelled "App action" on receipts like the explorer did. */
function platformContracts() {
  return new Set(
    [
      process.env.NEXT_PUBLIC_SAPHRA_SEND_ADDRESS,
      process.env.NEXT_PUBLIC_SWIFTPAY_SEND_ADDRESS,
      process.env.NEXT_PUBLIC_SAPHRA_BULKPAY_ADDRESS,
      process.env.NEXT_PUBLIC_SWIFTBATCH_ADDRESS,
      process.env.NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS,
    ]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
}

/**
 * The stored history, newest first, in the explorer's shape. By default the
 * newest 100 with platform fee legs hidden (what Activity shows); a statement
 * asks for a date range, and referral progress for every outflow.
 */
export async function readWalletHistory(
  walletInput: string,
  options: {
    from?: Date;
    to?: Date;
    direction?: "in" | "out";
    includePlatformFees?: boolean;
    limit?: number;
  } = {},
): Promise<WalletTransfer[]> {
  const wallet = walletInput.toLowerCase();
  const limit = options.limit ?? HISTORY_LIMIT;
  let query = db()
    .from(historyTable)
    .select("tx_hash, log_index, direction, counterparty, symbol, amount, block_number, occurred_at")
    .eq("chain_id", arcChain.id)
    .eq("wallet_address", wallet)
    .order("block_number", { ascending: false })
    .order("log_index", { ascending: false })
    .limit(limit + 20);
  if (options.from) query = query.gte("occurred_at", options.from.toISOString());
  if (options.to) query = query.lte("occurred_at", options.to.toISOString());
  if (options.direction) query = query.eq("direction", options.direction);
  const { data, error } = await query;
  if (error) throw error;

  const feeRecipients = new Set(options.includePlatformFees ? [] : getPlatformFeeRecipientAddresses());
  const contracts = platformContracts();
  return ((data ?? []) as HistoryRow[])
    // Platform fee legs are hidden from end-user history, as before.
    .filter((row) => !(row.direction === "out" && feeRecipients.has(row.counterparty)))
    .slice(0, limit)
    .map((row) => ({
      amount: row.amount,
      blockNumber: Number(row.block_number),
      counterparty: row.counterparty as Address,
      counterpartyIsContract: contracts.has(row.counterparty),
      direction: row.direction,
      hash: row.tx_hash as Hash,
      logIndex: row.log_index,
      method: null,
      symbol: row.symbol,
      timestamp: row.occurred_at,
    }));
}

/**
 * From when the stored history is complete: the time of the oldest block
 * read so far. Null before the first read. Statements say so when their range
 * starts earlier, since only SaphraONE's own records reach back further.
 */
export async function walletHistoryCoverage(walletInput: string) {
  const cursor = await readCursor(walletInput.toLowerCase()).catch(() => null);
  if (!cursor) return null;
  try {
    const block = await createArcRpcClient().getBlock({ blockNumber: cursor.oldestBlock });
    return new Date(Number(block.timestamp) * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * A wallet's history from the RPC store: brought up to date first, then read.
 * If the sync fails (RPC busy), whatever is stored is still returned.
 */
export async function walletHistoryFromRpc(
  wallet: string,
  options?: Parameters<typeof readWalletHistory>[1],
) {
  try {
    await syncWalletHistory(wallet);
  } catch (error) {
    console.warn("[wallet-history] sync failed", wallet, error instanceof Error ? error.message : error);
  }
  return readWalletHistory(wallet, options);
}
