/**
 * Detect incoming stablecoin transfers on the Arc RPC and create in-app
 * notifications.
 */
import { findBatchTxHashes } from "@/lib/activity/service";
import { agentWalletOwners } from "@/lib/agent-wallet/config";
import {
  createArcRpcClient,
  fetchIncomingTransfersFromRpc,
  withBlockTimestamps,
} from "@/lib/arc-transfers";
import type { WalletTransfer } from "@/lib/arcscan-history";
import { usernamesForWallets } from "@/lib/business/service";
import { arcChain } from "@/lib/chains";
import { mintSenders, type MintSender } from "@/lib/multichain/senders";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  copyPaymentReceived,
  createIncomingPaymentNotification,
} from "@/lib/save/notifications";

/**
 * Who sent each transfer. A payment ALLIE made comes from the sender's Agent
 * Wallet, which has no username of its own, so it is traced back to the
 * owner. Never fatal: without it the sender shows as an address.
 */
async function identifySenders(transfers: WalletTransfer[]) {
  const senders = transfers.map((t) => t.counterparty);
  const agentOwners = await agentWalletOwners(senders).catch(
    () => ({}) as Record<string, string>,
  );
  const usernames = await usernamesForWallets([
    ...senders,
    ...Object.values(agentOwners),
  ]).catch(() => ({}) as Record<string, string>);
  return { agentOwners, usernames };
}

const MAX_INCOMING_TO_SCAN = 25;
// Arc makes a block about every half second.
/** How far back a wallet's first scan looks: about 1 hour. */
const FIRST_SCAN_BLOCKS = 7_200n;
/** How far back a scan catches up after a long gap: about 6 hours. */
const MAX_CATCH_UP_BLOCKS = 43_200n;
/** Skip a wallet scanned this recently, e.g. by another open tab. */
const MIN_SCAN_INTERVAL_MS = 15_000;
const cursorTable = "incoming_transfer_cursors";

function shorten(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function readCursor(
  wallet: string,
): Promise<{ lastBlock: bigint; updatedAt: number } | null> {
  try {
    const { data } = await createSupabaseAdminClient()
      .from(cursorTable)
      .select("last_block, updated_at")
      .eq("chain_id", arcChain.id)
      .eq("wallet_address", wallet)
      .maybeSingle();
    return data?.last_block != null
      ? {
          lastBlock: BigInt(data.last_block),
          updatedAt: Date.parse(data.updated_at),
        }
      : null;
  } catch {
    // Table not created yet: every scan reads the first-scan window.
    return null;
  }
}

async function writeCursor(wallet: string, block: bigint) {
  try {
    await createSupabaseAdminClient()
      .from(cursorTable)
      .upsert(
        {
          chain_id: arcChain.id,
          wallet_address: wallet,
          last_block: block.toString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "chain_id,wallet_address" },
      );
  } catch {
    // Non-fatal: the next scan re-reads the window; inserts are idempotent.
  }
}

/**
 * Transfers received since the wallet's last scan, newest first. `head` is
 * null when the scan was skipped because it ran moments ago.
 */
async function fetchIncomingTransfers(wallet: string) {
  const cursor = await readCursor(wallet);
  if (cursor && Date.now() - cursor.updatedAt < MIN_SCAN_INTERVAL_MS) {
    return { head: null, transfers: [] as WalletTransfer[] };
  }

  const client = createArcRpcClient();
  const head = await client.getBlockNumber();
  const earliest = head > MAX_CATCH_UP_BLOCKS ? head - MAX_CATCH_UP_BLOCKS : 0n;
  let fromBlock =
    cursor != null
      ? cursor.lastBlock + 1n
      : head > FIRST_SCAN_BLOCKS
        ? head - FIRST_SCAN_BLOCKS
        : 0n;
  if (fromBlock < earliest) fromBlock = earliest;
  if (fromBlock > head) return { head, transfers: [] as WalletTransfer[] };

  const transfers = await fetchIncomingTransfersFromRpc(
    wallet,
    { fromBlock, toBlock: head },
    client,
  );
  return {
    head,
    transfers: await withBlockTimestamps(
      transfers.slice(0, MAX_INCOMING_TO_SCAN),
      client,
    ),
  };
}

/**
 * Sync recent incoming payments into the notification feed.
 * Idempotent via related_tx_hash unique index.
 */
export async function syncIncomingPaymentNotifications(ownerWallet: string) {
  const wallet = ownerWallet.toLowerCase();
  let created = 0;
  let scanned = 0;

  try {
    const { head, transfers: incoming } = await fetchIncomingTransfers(wallet);
    const [{ agentOwners, usernames }, batchHashes, senderByMint] = await Promise.all([
      identifySenders(incoming),
      findBatchTxHashes(incoming.map((t) => t.hash)).catch(() => new Set<string>()),
      mintSenders(wallet, incoming.map((t) => t.hash)).catch(() => ({}) as Record<string, MintSender>),
    ]);

    for (const transfer of incoming) {
      scanned += 1;

      // Skip dust / zero
      const amountNum = Number(transfer.amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        continue;
      }

      const [whole, frac = ""] = transfer.amount.split(".");
      const amountDisplay = `${whole}.${(frac + "00").slice(0, 2)}`;
      // Name the sender: @username when they have a SaphraONE account, the
      // owner "via ALLIE" when their Agent Wallet paid, and "via BulkPay"
      // when the sender recorded this transaction as a batch.
      const agentOwner = agentOwners[transfer.counterparty.toLowerCase()];
      const senderWallet = agentOwner ?? transfer.counterparty.toLowerCase();
      const username = usernames[senderWallet];
      const sender = username ? `${username}.one` : shorten(senderWallet);
      const viaBatch = batchHashes.has(transfer.hash.toLowerCase());
      // USDC that came in on another network was minted here by CCTP.
      // Name the payer on that network, not the mint.
      const fromNetwork = senderByMint[transfer.hash.toLowerCase()];
      const copy = copyPaymentReceived(
        amountDisplay,
        transfer.symbol,
        fromNetwork
          ? fromNetwork.label
          : agentOwner
            ? `${sender} via ALLIE`
            : viaBatch
              ? `${sender} via BulkPay`
              : sender,
      );

      const row = await createIncomingPaymentNotification({
        ownerWallet: wallet,
        title: copy.title,
        body: copy.body,
        relatedTxHash: transfer.hash,
        metadata: {
          amount: amountDisplay,
          symbol: transfer.symbol,
          from: transfer.counterparty.toLowerCase(),
          fromUsername: username ?? null,
          fromNetwork: fromNetwork?.networkName ?? null,
          fromNetworkSender: fromNetwork?.sender ?? null,
          viaAllie: Boolean(agentOwner),
          fromOwner: agentOwner ?? null,
          viaBatch,
          blockNumber: transfer.blockNumber,
          timestamp: transfer.timestamp,
        },
      });

      if (row) {
        created += 1;
      }
    }

    // Only once every transfer is recorded, so a failure retries the blocks.
    if (head != null) {
      await writeCursor(wallet, head);
    }
  } catch (error) {
    console.warn(
      "[incoming-payments]",
      error instanceof Error ? error.message : "sync failed",
    );
  }

  return { scanned, created };
}
