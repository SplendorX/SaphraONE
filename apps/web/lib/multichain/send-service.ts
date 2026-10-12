// Server-only. Sending USDC from the Arc balance to another network.
/**
 * The browser signs the burn (it holds the user's wallet); the server keeps
 * the ledger and decides when a send is done. A transfer is COMPLETED only
 * when the chain agrees on every part:
 *
 *   - the Arc burn took USDC out of the owner's own wallet (Arc RPC)
 *   - Circle's message mints to the recipient and network the owner chose (IRIS)
 *   - Circle's Forwarding Service delivered it at the destination (IRIS)
 *
 * Nothing a request says about a burn is believed until then.
 */
import { getAddress, isAddress } from "viem";

import { platformFeeRecipient } from "@/lib/fees";
import { recordAccountActivity } from "@/lib/activity/service";
import { ARC_CCTP_DOMAIN, multichainChainByCircleBlockchain, type MultichainChain } from "@/lib/multichain/chains";
import { findFollowingBurn, readIrisMessage, usdcDeliveredTo, usdcSentFrom } from "@/lib/multichain/credit";
import { quoteSend, routeFees } from "@/lib/multichain/quote";
import {
  checkOutbound,
  CROSS_CHAIN_SERVICE_FEE_USDC,
  grossForReceive,
  MIN_OUTBOUND_USDC,
  unitsToUsdc,
  usdcToUnits,
  type FeeMode,
} from "@/lib/multichain/rules";
import { MultichainError } from "@/lib/multichain/service";
import {
  getTransfer,
  insertTransfer,
  listBurnedTransfers,
  listTransfersForOwner,
  updateTransfer,
  type ChainTransferRow,
} from "@/lib/multichain/store";

/** A burn IRIS still has not seen after this long goes to a person. */
const UNSEEN_BURN_REVIEW_MS = 60 * 60 * 1000;

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function errorText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : fallback;
  return (text.split("\n")[0] || fallback).slice(0, 500);
}

export function readDestination(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!isAddress(raw) || /^0x0{40}$/i.test(raw)) {
    throw new MultichainError("Enter a valid 0x address on that network.", 400);
  }
  return getAddress(raw);
}

/** Where SaphraONE's service fee goes; without a fee wallet configured, no fee is charged. */
function serviceFeeRecipient() {
  const recipient = platformFeeRecipient();
  return isAddress(recipient) && !/^0x0{40}$/i.test(recipient) ? getAddress(recipient) : null;
}

/**
 * Price an amount for a network. With `feeMode` "add" the amount is what the
 * recipient gets and the fees go on top; otherwise the fees come out of it.
 * Fees: Circle's network fee (taken out of the burn) and SaphraONE's flat
 * service fee (paid separately, before the burn).
 */
export async function quoteFor(chain: MultichainChain, amount: string, feeMode: FeeMode = "deduct") {
  const check = checkOutbound({ amount });
  if (!check.ok) throw new MultichainError(check.message, 400);
  const feeRecipient = serviceFeeRecipient();
  const serviceUnits = feeRecipient ? usdcToUnits(CROSS_CHAIN_SERVICE_FEE_USDC) : 0n;

  let burnUnits: bigint;
  if (feeMode === "add") {
    burnUnits = grossForReceive({ ...(await routeFees(chain)), receiveUnits: check.amountUnits });
  } else {
    burnUnits = check.amountUnits - serviceUnits;
    if (burnUnits < usdcToUnits(MIN_OUTBOUND_USDC)) {
      const smallest = unitsToUsdc(usdcToUnits(MIN_OUTBOUND_USDC) + serviceUnits);
      throw new MultichainError(
        `With the ${CROSS_CHAIN_SERVICE_FEE_USDC} USDC service fee, the smallest send to another network is ${smallest} USDC.`,
        400,
      );
    }
  }
  const quote = await quoteSend(chain, burnUnits);
  const covered = checkOutbound({ amount: unitsToUsdc(burnUnits), quote });
  return {
    /** What is burned on Arc. */
    amount: unitsToUsdc(burnUnits),
    fee: unitsToUsdc(quote.feeUnits),
    feeMode,
    message: covered.ok ? null : covered.message,
    network: chain.key,
    networkName: chain.name,
    receive: unitsToUsdc(quote.receiveUnits),
    serviceFee: unitsToUsdc(serviceUnits),
    serviceFeeRecipient: feeRecipient,
    /** Everything that leaves the balance: the burn plus the service fee. */
    total: unitsToUsdc(burnUnits + serviceUnits),
  };
}

export type NetworkFeeView = {
  /** Fast-transfer fee on top of the flat fee, in basis points of the amount. */
  fastFeeBps: number;
  /** Flat forwarding fee, in USDC. */
  flatFee: string;
  network: string;
};

/** Each network's fee shape, for the network picker. A network Circle won't price is left out. */
export async function networkFees(chains: readonly MultichainChain[]): Promise<NetworkFeeView[]> {
  const settled = await Promise.allSettled(chains.map((chain) => routeFees(chain)));
  return settled.flatMap((result, index) =>
    result.status === "fulfilled"
      ? [
          {
            fastFeeBps: result.value.fastFeeBps,
            flatFee: unitsToUsdc(result.value.forwardFeeUnits),
            network: chains[index].key,
          },
        ]
      : [],
  );
}

/** Open a transfer before the wallet signs, so a burn always has a row to land in. */
export async function startTransfer(input: {
  owner: string;
  chain: MultichainChain;
  destination: unknown;
  amount: unknown;
  feeMode?: FeeMode;
}) {
  const destination = readDestination(input.destination);
  const amount = typeof input.amount === "string" ? input.amount.trim() : "";
  const quote = await quoteFor(input.chain, amount, input.feeMode);
  if (quote.message) throw new MultichainError(quote.message, 400);

  const row = await insertTransfer({
    amount: quote.amount,
    dest_address: destination.toLowerCase(),
    dest_chain: input.chain.circleBlockchain,
    fee_units: usdcToUnits(quote.fee).toString(),
    owner_wallet: input.owner.toLowerCase(),
    service_fee_units: usdcToUnits(quote.serviceFee).toString(),
  });
  return { quote, transfer: row };
}

async function ownTransfer(owner: string, id: string) {
  const row = await getTransfer(id).catch(() => null);
  if (!row || row.owner_wallet !== owner.toLowerCase()) {
    throw new MultichainError("Transfer not found.", 404);
  }
  return row;
}

/** The wallet reported its burn. Recorded, then checked against the chain. */
export async function reportBurn(owner: string, id: string, burnTxHash: unknown, bridgeResult?: unknown) {
  const row = await ownTransfer(owner, id);
  const hash = typeof burnTxHash === "string" ? burnTxHash.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new MultichainError("A valid burn transaction hash is required.", 400);
  if (row.burn_tx_hash && row.burn_tx_hash !== hash) {
    throw new MultichainError("This transfer already has a different burn.", 409);
  }
  const updated =
    (await updateTransfer(row.id, ["PENDING", "FAILED"], {
      bridge_result: bridgeResult ?? row.bridge_result,
      burn_tx_hash: hash,
      last_error: null,
      state: "BURNED",
    })) ?? (await getTransfer(row.id));
  return updated ? advanceTransfer(updated) : row;
}

/** The wallet paid SaphraONE's service fee for this send (before its burn). */
export async function reportServiceFee(owner: string, id: string, feeTxHash: unknown) {
  const row = await ownTransfer(owner, id);
  const hash = typeof feeTxHash === "string" ? feeTxHash.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new MultichainError("A valid fee transaction hash is required.", 400);
  if (row.service_fee_tx_hash) return row;
  return (await updateTransfer(row.id, ["PENDING", "FAILED"], { service_fee_tx_hash: hash })) ?? row;
}

/**
 * The wallet stopped before burning (declined, or a step failed). When the
 * service fee was already paid and nothing went out, the error says so: these
 * rows (state FAILED with a service_fee_tx_hash) are owed a refund unless the
 * send is retried.
 */
export async function reportFailure(owner: string, id: string, error: unknown, bridgeResult?: unknown) {
  const row = await ownTransfer(owner, id);
  const reason = errorText(error, "The send stopped before the burn.");
  return (
    (await updateTransfer(row.id, ["PENDING"], {
      bridge_result: bridgeResult ?? row.bridge_result,
      last_error: row.service_fee_tx_hash
        ? `Service fee paid, nothing sent (refund due): ${reason}`.slice(0, 500)
        : reason,
      state: "FAILED",
    })) ?? row
  );
}

/**
 * The browser lost track of a send: it can't tell whether the burn happened.
 * Keep the reason, but leave the send open (PENDING): marking it FAILED would
 * hide a burn that did go through.
 */
export async function reportUnconfirmed(owner: string, id: string, error: unknown) {
  const row = await ownTransfer(owner, id);
  const reason = errorText(error, "The browser couldn't confirm this send.");
  return (
    (await updateTransfer(row.id, ["PENDING"], {
      last_error: `Unconfirmed in the browser: ${reason}`.slice(0, 500),
    })) ?? row
  );
}

async function review(row: ChainTransferRow, reason: string) {
  return (await updateTransfer(row.id, ["BURNED"], { last_error: reason, state: "NEEDS_REVIEW" })) ?? row;
}

/** Move a burned transfer forward once the chain and Circle agree. */
export async function advanceTransfer(row: ChainTransferRow): Promise<ChainTransferRow> {
  if (row.state !== "BURNED" || !row.burn_tx_hash) return row;
  const chain = multichainChainByCircleBlockchain(row.dest_chain);
  if (!chain) return review(row, `Unknown destination network ${row.dest_chain}.`);

  const sent = await usdcSentFrom(row.burn_tx_hash, row.owner_wallet);
  if (sent === null) return row; // not mined yet
  if (sent === 0n) {
    // Usually the wallet reported its approve instead of the burn after it.
    const burn = await findFollowingBurn(row.burn_tx_hash, row.owner_wallet, usdcToUnits(row.amount)).catch(() => null);
    const fixed = burn
      ? await updateTransfer(row.id, ["BURNED"], { burn_tx_hash: burn }).catch(() => null)
      : null;
    if (fixed) return advanceTransfer(fixed);
    return review(row, "The burn did not move USDC out of this wallet.");
  }

  const message = await readIrisMessage(ARC_CCTP_DOMAIN, row.burn_tx_hash).catch(() => null);
  if (!message) {
    const age = Date.now() - new Date(row.updated_at).getTime();
    return age > UNSEEN_BURN_REVIEW_MS ? review(row, "Circle has no record of this burn.") : row;
  }
  if (message.mintRecipient && message.mintRecipient !== row.dest_address) {
    return review(row, "The burn mints to a different address than the one chosen.");
  }
  if (message.destinationDomain !== null && message.destinationDomain !== chain.cctpDomain) {
    return review(row, "The burn goes to a different network than the one chosen.");
  }

  if (message.forwardState?.toUpperCase() === "FAILED") {
    return review(row, "Circle's Forwarding Service could not deliver it. Mint it by hand (runbook).");
  }
  if (!message.forwardTxHash) return row;

  // Circle can report the forward as CONFIRMED long after the mint landed, so
  // the destination network itself is asked whether the recipient got it.
  const delivered = await usdcDeliveredTo(chain, message.forwardTxHash, row.dest_address);
  if (delivered === null) return row;
  if (delivered === 0n) return review(row, "The delivery transaction did not pay the recipient.");

  const burned = message.amount ? BigInt(message.amount) : usdcToUnits(row.amount);
  const fee = burned > delivered ? burned - delivered : 0n;
  const completed = await updateTransfer(row.id, ["BURNED"], {
    amount_received: unitsToUsdc(delivered),
    fee_units: fee.toString(),
    last_error: null,
    mint_tx_hash: message.forwardTxHash.toLowerCase(),
    state: "COMPLETED",
  });
  if (completed) {
    await recordAccountActivity({
      amount: row.amount,
      counterparty: row.dest_address,
      direction: "out",
      metadata: {
        destinationTx: completed.mint_tx_hash,
        network: chain.key,
        received: completed.amount_received,
        transferId: row.id,
      },
      source: "send",
      title: `Sent to ${shortAddress(row.dest_address)} on ${chain.name}`,
      token: "USDC",
      txHash: row.burn_tx_hash,
      walletAddress: row.owner_wallet,
    }).catch((error) => console.error("[multichain] send activity", error instanceof Error ? error.message : error));
  }
  return completed ?? row;
}

export type OutboundTransferView = {
  id: string;
  amount: string;
  fee: string | null;
  /** SaphraONE's service fee, paid separately from the burn. */
  serviceFee: string | null;
  received: string | null;
  network: string;
  networkName: string;
  destination: string;
  status: "pending" | "sending" | "delivered" | "failed" | "on-hold";
  burnTxHash: string | null;
  destinationTxUrl: string | null;
  error: string | null;
  createdAt: string;
};

export function transferView(row: ChainTransferRow): OutboundTransferView | null {
  const chain = multichainChainByCircleBlockchain(row.dest_chain);
  if (!chain) return null;
  const status: OutboundTransferView["status"] =
    row.state === "COMPLETED"
      ? "delivered"
      : row.state === "BURNED"
        ? "sending"
        : row.state === "FAILED"
          ? "failed"
          : row.state === "NEEDS_REVIEW"
            ? "on-hold"
            : "pending";
  return {
    amount: row.amount,
    burnTxHash: row.burn_tx_hash,
    createdAt: row.created_at,
    destination: row.dest_address,
    destinationTxUrl: row.mint_tx_hash ? chain.explorerTx(row.mint_tx_hash) : null,
    error: row.state === "FAILED" ? row.last_error : null,
    fee: row.fee_units ? unitsToUsdc(BigInt(row.fee_units)) : null,
    id: row.id,
    serviceFee: row.service_fee_units ? unitsToUsdc(BigInt(row.service_fee_units)) : null,
    network: chain.key,
    networkName: chain.name,
    received: row.amount_received,
    status,
  };
}

/** The owner's recent sends, with any in flight moved forward first. */
export async function listTransfers(owner: string) {
  const rows = await listTransfersForOwner(owner);
  const advanced = await Promise.all(
    rows.map((row) => (row.state === "BURNED" ? advanceTransfer(row).catch(() => row) : row)),
  );
  return advanced.map(transferView).filter((view): view is OutboundTransferView => view !== null);
}

export async function getTransferView(owner: string, id: string) {
  const row = await ownTransfer(owner, id);
  return transferView(row.state === "BURNED" ? await advanceTransfer(row).catch(() => row) : row);
}

/** Background pass for the cron. */
export async function advanceBurnedTransfers() {
  const results: { id: string; state: string }[] = [];
  for (const row of await listBurnedTransfers()) {
    const next = await advanceTransfer(row).catch(() => row);
    results.push({ id: row.id, state: next.state });
  }
  return results;
}
