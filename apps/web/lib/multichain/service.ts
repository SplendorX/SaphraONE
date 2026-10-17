// Server-only. Multichain receive: addresses, detection, sweeps to Arc, credit.
/**
 * The pipeline, per deposit address:
 *
 *   detect  → every USDC transfer in becomes a chain_deposits row (idempotent)
 *   sweep   → once the balance passes the network minimum, the whole balance
 *             is burned over CCTP (FAST, Forwarding Service) to the owner's
 *             Arc wallet, read from the database and never from a request
 *   credit  → CREDITED only after the Arc RPC shows the mint reaching the owner
 *
 * Every step is safe to run again. A sweep that stopped partway is resumed
 * with App Kit's `retryBridge` from its last good step, and a sweep whose
 * result was lost is checked against the chain before anything burns again.
 */
import { AppKit } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";

import { recordAccountActivity } from "@/lib/activity/service";
import { readCircleError } from "@/lib/agent-wallet/client";
import { arcAppKitChain, getDepositErrorMessage } from "@/lib/deposit-to-arc";
import {
  multichainChainByCircleBlockchain,
  multichainChainByKey,
  type MultichainChain,
} from "@/lib/multichain/chains";
import { mintSenders } from "@/lib/multichain/senders";
import {
  circleWalletsCredentials,
  createDepositWallet,
  depositUsdcBalance,
  listInboundUsdc,
  listOutbound,
} from "@/lib/multichain/circle";
import { readIrisMessage, usdcMintedTo } from "@/lib/multichain/credit";
import { enabledMultichainChains, multichainEnabled } from "@/lib/multichain/flag";
import {
  depositsForSweep,
  depositStateFromCircle,
  isCircleTxPending,
  MAX_SWEEP_ATTEMPTS,
  planSweep,
  recoverSweepWithoutResult,
  STALE_SWEEP_MS,
  sweepFeeUnits,
  sweepRetryDelayMs,
  unitsToUsdc,
  usdcToUnits,
} from "@/lib/multichain/rules";
import {
  findDepositAddress,
  findOpenSweep,
  getDepositAddress,
  insertDepositAddress,
  insertSweep,
  listActiveDepositAddresses,
  listDepositsBySweepIds,
  listDepositsForAddress,
  listOpenSweeps,
  listStrandedDeposits,
  moveDeposits,
  profileExists,
  recordDeposit,
  touchDepositAddress,
  updateSweep,
  type ChainSweepRow,
  type DepositAddressRow,
} from "@/lib/multichain/store";

export class MultichainError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MultichainError";
  }
}

/** Kill switch: detection keeps running, nothing is burned. */
export function sweepsPaused() {
  return process.env.MULTICHAIN_SWEEPS_PAUSED?.trim() === "true";
}

/**
 * MULTICHAIN_ALLOWED_WALLETS (comma list) limits the feature to a canary set,
 * for the first mainnet days. Unset means every signed-in profile.
 */
export function walletAllowed(wallet: string) {
  const raw = process.env.MULTICHAIN_ALLOWED_WALLETS?.trim();
  if (!raw) return true;
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes(wallet.toLowerCase());
}

export function assertMultichainOpen(wallet: string) {
  if (!multichainEnabled) throw new MultichainError("Receiving from other networks is not available yet.", 404);
  if (!walletAllowed(wallet)) throw new MultichainError("Receiving from other networks is not available on this account yet.", 403);
}

export function enabledChainForKey(key: unknown) {
  const chain = multichainChainByKey(key);
  if (!chain || !enabledMultichainChains().some((entry) => entry.key === chain.key)) {
    throw new MultichainError("Pick a supported network.", 400);
  }
  return chain;
}

function chainFor(row: { chain: string }) {
  const chain = multichainChainByCircleBlockchain(row.chain);
  if (!chain) throw new Error(`Unknown deposit network ${row.chain}.`);
  return chain;
}

// ─── Addresses ───────────────────────────────────────────────────────────────

/** The owner's deposit address on a network, created on first use. */
export async function ensureDepositAddress(ownerWallet: string, chain: MultichainChain) {
  const owner = ownerWallet.toLowerCase();
  const existing = await findDepositAddress(owner, chain.circleBlockchain);
  if (existing) return existing;

  // Only onboarded accounts get addresses: the sweep's destination is this row.
  if (!(await profileExists(owner))) {
    throw new MultichainError("Finish setting up your account first.", 409);
  }

  const wallet = await createDepositWallet(owner, chain);
  return insertDepositAddress({
    address: wallet.address.toLowerCase(),
    chain: chain.circleBlockchain,
    owner_wallet: owner,
    provider_wallet_id: wallet.walletId,
  });
}

// ─── Detect ──────────────────────────────────────────────────────────────────

/** Record every USDC transfer into the address; returns how many were new. */
export async function detectDeposits(address: DepositAddressRow) {
  if (!address.provider_wallet_id) return 0;
  const chain = chainFor(address);
  const inbound = await listInboundUsdc(address.provider_wallet_id, chain, address.created_at);

  let fresh = 0;
  const confirmedNow: string[] = [];
  const failedNow: string[] = [];
  for (const transfer of inbound) {
    const state = depositStateFromCircle(transfer.state);
    if (!state) continue;
    const inserted = await recordDeposit({
      amount_in: transfer.amount,
      chain: address.chain,
      deposit_address_id: address.id,
      owner_wallet: address.owner_wallet,
      provider_tx_id: transfer.circleTxId,
      sender_address: transfer.sender?.toLowerCase() ?? null,
      source_tx_hash: transfer.txHash.toLowerCase(),
      state,
    });
    if (inserted) fresh += 1;
    if (state === "CONFIRMED") confirmedNow.push(transfer.txHash.toLowerCase());
    if (state === "FAILED") failedNow.push(transfer.txHash.toLowerCase());
  }

  // Rows first seen while Circle was still confirming them catch up here.
  const detected = await listDepositsForAddress(address.id, ["DETECTED"]);
  await moveDeposits(
    { ids: detected.filter((row) => confirmedNow.includes(row.source_tx_hash)).map((row) => row.id) },
    ["DETECTED"],
    { state: "CONFIRMED" },
  );
  await moveDeposits(
    { ids: detected.filter((row) => failedNow.includes(row.source_tx_hash)).map((row) => row.id) },
    ["DETECTED"],
    { state: "FAILED", last_error: "The transfer failed on its network." },
  );

  if (fresh > 0) await touchDepositAddress(address.id, { activity: true });
  return fresh;
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

type BridgeStep = { name?: string; state?: string; txHash?: string; error?: unknown; errorMessage?: string };
type BridgeResultLike = { state?: string; steps?: BridgeStep[] };

const burnSteps = new Set(["burn", "transfer", "depositForBurn"]);
const mintSteps = new Set(["mint", "forward"]);

function stepHash(result: BridgeResultLike, names: Set<string>) {
  return result.steps?.find((step) => names.has(step.name ?? "") && step.txHash)?.txHash?.toLowerCase() ?? null;
}

/**
 * What actually failed under an App Kit error. App Kit files many causes under
 * one label ("RPC endpoint error on Base" covers rate limits and refused gas
 * estimates alike) and keeps the original in `cause.trace.rawError`.
 */
function rawCause(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = (error as { cause?: unknown }).cause as { trace?: { rawError?: unknown } } | undefined;
  const raw = cause?.trace?.rawError ?? cause;
  if (!raw || raw === error) return null;
  const message = readCircleError(raw, "").split("\n")[0].trim();
  return message && message !== error.message ? message : null;
}

/** App Kit results can carry bigints and Error objects; store plain JSON. */
function toJson(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint"
        ? inner.toString()
        : inner instanceof Error
          ? { cause: rawCause(inner), message: inner.message, name: inner.name }
          : inner,
    ),
  ) as unknown;
}

function errorText(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  const text = getDepositErrorMessage(message.split("\n")[0] || fallback);
  const cause = rawCause(error);
  return (cause ? `${text} (${cause})` : text).slice(0, 500);
}

/** Run (or resume) the CCTP bridge for a claimed sweep and record what happened. */
async function runBridge(sweep: ChainSweepRow, address: DepositAddressRow, resumeFrom?: unknown) {
  const chain = chainFor(address);
  // The destination is the address row's owner, re-checked against profiles.
  if (!(await profileExists(address.owner_wallet))) {
    await updateSweep(sweep.id, ["SWEEPING"], { last_error: "Owner profile is missing.", state: "NEEDS_REVIEW" });
    await moveDeposits({ sweepId: sweep.id }, ["SWEEPING"], { state: "NEEDS_REVIEW" });
    return;
  }

  const adapter = createCircleWalletsAdapter(circleWalletsCredentials());
  const kit = new AppKit();
  let result: BridgeResultLike;
  try {
    result = (
      resumeFrom
        ? await kit.retryBridge(resumeFrom as Parameters<typeof kit.retryBridge>[0], { from: adapter })
        : await kit.bridge({
            amount: sweep.amount,
            config: { transferSpeed: "FAST" },
            from: { adapter, address: address.address, chain: chain.appKitChain },
            to: {
              chain: arcAppKitChain(),
              recipientAddress: address.owner_wallet,
              // Circle relays the Arc mint, so nobody needs gas on Arc.
              useForwarder: true,
            },
          })
    ) as BridgeResultLike;
  } catch (error) {
    // No result to resume from: the next pass checks the chain before retrying.
    await updateSweep(sweep.id, ["SWEEPING"], { last_error: errorText(error, "Sweep failed."), state: "FAILED" });
    await moveDeposits({ sweepId: sweep.id }, ["SWEEPING"], { state: "FAILED" });
    return;
  }

  const stored = toJson(result);
  const burnTx = stepHash(result, burnSteps) ?? sweep.burn_tx_hash;
  const mintTx = stepHash(result, mintSteps) ?? sweep.mint_tx_hash;

  // No burn on record: nothing left the source chain yet. Keep the result so
  // the next pass resumes it instead of starting over.
  if (!burnTx) {
    const failed = result.steps?.find((step) => step.state === "error");
    await updateSweep(sweep.id, ["SWEEPING"], {
      bridge_result: stored,
      last_error: errorText(failed?.error ?? failed?.errorMessage, "Sweep stopped before the burn."),
      state: "FAILED",
    });
    await moveDeposits({ sweepId: sweep.id }, ["SWEEPING"], { state: "FAILED" });
    return;
  }

  // Burned (the Forwarding Service mints on Arc even if App Kit stopped
  // watching), so from here on only credit is left.
  const burned = await updateSweep(sweep.id, ["SWEEPING"], {
    bridge_result: stored,
    burn_tx_hash: burnTx,
    last_error: result.state === "error" ? errorText(result.steps?.find((s) => s.state === "error")?.errorMessage, "") : null,
    mint_tx_hash: mintTx,
    state: "BURNED",
  });
  await moveDeposits({ sweepId: sweep.id }, ["SWEEPING", "FAILED"], { state: "BURNED" });
  if (burned) await tryCredit(burned);
}

/**
 * Bring deposits left on hold by an earlier sweep that never burned into the
 * sweep now taking the balance, so they are credited with the USDC they
 * brought. Only what fits beside the sweep's own deposits moves: money that
 * is no longer at the address is never claimed twice.
 */
async function adoptStrandedDeposits(address: DepositAddressRow, sweep: ChainSweepRow) {
  const stranded = await listStrandedDeposits(address.id);
  if (stranded.length === 0) return;
  const carried = (await listDepositsBySweepIds([sweep.id])).reduce((sum, row) => sum + usdcToUnits(row.amount_in), 0n);
  const adopted = depositsForSweep(stranded, usdcToUnits(sweep.amount) - carried);
  await moveDeposits({ ids: adopted.map((row) => row.id) }, ["NEEDS_REVIEW"], {
    last_error: null,
    state: "SWEEPING",
    sweep_id: sweep.id,
  });
}

/** Credit a burned sweep once the Arc mint is on chain. */
export async function tryCredit(sweep: ChainSweepRow) {
  if (!sweep.burn_tx_hash) return sweep;
  const chain = chainFor(sweep);

  let mintTx = sweep.mint_tx_hash;
  if (!mintTx) {
    const message = await readIrisMessage(chain.cctpDomain, sweep.burn_tx_hash).catch(() => null);
    mintTx = message?.forwardTxHash?.toLowerCase() ?? null;
    if (!mintTx) {
      if (message?.forwardState?.toUpperCase() === "FAILED") {
        await updateSweep(sweep.id, ["BURNED", "FAILED"], {
          last_error: "Circle's Forwarding Service could not mint on Arc. Mint it by hand (runbook).",
          state: "NEEDS_REVIEW",
        });
        await moveDeposits({ sweepId: sweep.id }, ["BURNED", "FAILED"], { state: "NEEDS_REVIEW" });
      }
      return sweep;
    }
  }

  const minted = await usdcMintedTo(mintTx, sweep.owner_wallet);
  if (minted === null) {
    // Not mined yet; remember the hash so the next pass skips IRIS.
    if (!sweep.mint_tx_hash) await updateSweep(sweep.id, ["BURNED", "FAILED"], { mint_tx_hash: mintTx });
    return sweep;
  }
  if (minted === 0n) {
    await updateSweep(sweep.id, ["BURNED", "FAILED"], {
      last_error: "The Arc mint did not reach the owner's wallet.",
      mint_tx_hash: mintTx,
      state: "NEEDS_REVIEW",
    });
    await moveDeposits({ sweepId: sweep.id }, ["BURNED", "FAILED"], { state: "NEEDS_REVIEW" });
    return sweep;
  }

  const now = new Date().toISOString();
  const credited = await updateSweep(sweep.id, ["BURNED", "FAILED"], {
    amount_credited: unitsToUsdc(minted),
    credited_at: now,
    fee_units: sweepFeeUnits(usdcToUnits(sweep.amount), minted).toString(),
    last_error: null,
    mint_tx_hash: mintTx,
    state: "CREDITED",
  });
  await moveDeposits({ sweepId: sweep.id }, ["SWEEPING", "BURNED", "FAILED"], { credited_at: now, state: "CREDITED" });
  if (credited) {
    // Activity names the payer on the other network ("Received from 0x6f97…464f
    // on Base"), not the Arc mint. Never fatal: the money is there either way.
    const from = (await mintSenders(sweep.owner_wallet, [mintTx]).catch(() => null))?.[mintTx.toLowerCase()];
    const label = from?.label ?? chain.name;
    await recordAccountActivity({
      amount: unitsToUsdc(minted),
      counterparty: label,
      direction: "in",
      metadata: { network: chain.key, sender: from?.sender ?? null, swept: sweep.amount, sweepId: sweep.id },
      source: "deposit",
      title: `Received from ${label}`,
      token: "USDC",
      txHash: mintTx,
      walletAddress: sweep.owner_wallet,
    }).catch((error) => console.error("[multichain] activity", error instanceof Error ? error.message : error));
  }
  return credited ?? sweep;
}

/** The burn of a sweep, found on chain: an outbound tx IRIS knows as a CCTP message. */
async function findBurnSince(address: DepositAddressRow, since: string) {
  const chain = chainFor(address);
  const outbound = await listOutbound(address.provider_wallet_id!, chain, since);
  let burnTxHash: string | null = null;
  for (const tx of outbound) {
    if (!tx.txHash) continue;
    if (await readIrisMessage(chain.cctpDomain, tx.txHash).catch(() => null)) {
      burnTxHash = tx.txHash.toLowerCase();
      break;
    }
  }
  return { burnTxHash, pendingOutbound: outbound.some((tx) => isCircleTxPending(tx.state)) };
}

/** Move an open sweep forward: resume, recover or credit it. */
async function advanceSweep(sweep: ChainSweepRow, address: DepositAddressRow) {
  if (sweep.state === "BURNED") return tryCredit(sweep);

  const result = sweep.bridge_result as BridgeResultLike | null;
  const fresh = Date.now() - new Date(sweep.started_at).getTime() < STALE_SWEEP_MS;

  // Another worker is mid-bridge; leave it alone.
  if (sweep.state === "SWEEPING" && fresh) return sweep;

  if (sweep.burn_tx_hash) {
    const burned = await updateSweep(sweep.id, ["SWEEPING", "FAILED"], { state: "BURNED" }, sweep.updated_at);
    return burned ? tryCredit(burned) : sweep;
  }

  // Nothing burned yet, so the USDC is still on its own network: keep trying,
  // spaced out, rather than parking the deposit for a person. An outage at
  // Circle or the network's RPC clears on its own.
  if (sweep.state === "FAILED" && Date.now() - new Date(sweep.updated_at).getTime() < sweepRetryDelayMs(sweep.attempts)) {
    return sweep;
  }
  if (sweep.attempts >= MAX_SWEEP_ATTEMPTS) {
    console.error("[multichain] sweep keeps failing", sweep.id, `attempt ${sweep.attempts + 1}`, sweep.last_error);
  }

  if (sweepsPaused()) return sweep;

  // A result App Kit can resume from: retryBridge never burns twice.
  if (sweep.state === "FAILED" && result?.steps?.length) {
    const claimed = await updateSweep(
      sweep.id,
      ["FAILED"],
      { attempts: sweep.attempts + 1, started_at: new Date().toISOString(), state: "SWEEPING" },
      sweep.updated_at,
    );
    if (!claimed) return sweep;
    await moveDeposits({ sweepId: sweep.id }, ["FAILED"], { state: "SWEEPING" });
    await adoptStrandedDeposits(address, claimed);
    await runBridge(claimed, address, result);
    return claimed;
  }

  // No result on record: ask the chain what already happened.
  const found = await findBurnSince(address, sweep.started_at);
  const decision = recoverSweepWithoutResult({
    burnTxHash: found.burnTxHash,
    pendingOutbound: found.pendingOutbound,
  });

  if (decision === "burned") {
    const burned = await updateSweep(
      sweep.id,
      ["SWEEPING", "FAILED"],
      { burn_tx_hash: found.burnTxHash, state: "BURNED" },
      sweep.updated_at,
    );
    await moveDeposits({ sweepId: sweep.id }, ["SWEEPING", "FAILED"], { state: "BURNED" });
    return burned ? tryCredit(burned) : sweep;
  }
  if (decision === "wait") return sweep;

  // Nothing burned and nothing moving: start over with what is there now.
  const balance = await depositUsdcBalance(address.provider_wallet_id!, chainFor(address));
  if (balance <= 0n) {
    await updateSweep(
      sweep.id,
      ["SWEEPING", "FAILED"],
      { last_error: "Nothing left to sweep and no burn found.", state: "NEEDS_REVIEW" },
      sweep.updated_at,
    );
    await moveDeposits({ sweepId: sweep.id }, ["SWEEPING", "FAILED"], { state: "NEEDS_REVIEW" });
    return sweep;
  }
  const claimed = await updateSweep(
    sweep.id,
    ["SWEEPING", "FAILED"],
    {
      amount: unitsToUsdc(balance),
      attempts: sweep.attempts + 1,
      bridge_result: null,
      started_at: new Date().toISOString(),
      state: "SWEEPING",
    },
    sweep.updated_at,
  );
  if (!claimed) return sweep;
  await moveDeposits({ sweepId: sweep.id }, ["FAILED"], { state: "SWEEPING" });
  await adoptStrandedDeposits(address, claimed);
  await runBridge(claimed, address);
  return claimed;
}

const ORPHAN_REVIEW_MS = 60 * 60 * 1000;

/** Sweep the address if it is due, or move its open sweep forward. */
export async function sweepAddress(address: DepositAddressRow) {
  if (!address.provider_wallet_id) return null;
  const chain = chainFor(address);

  const open = await findOpenSweep(address.id);
  if (open) return advanceSweep(open, address);

  const balance = await depositUsdcBalance(address.provider_wallet_id, chain);
  const waiting = await listDepositsForAddress(address.id, ["DETECTED", "CONFIRMED", "BELOW_MIN"]);
  const plan = planSweep({
    balanceUnits: balance,
    hasSweepInFlight: false,
    minDeposit: chain.minDeposit,
    paused: sweepsPaused(),
  });

  if (plan.action === "wait") {
    if (plan.reason === "below-min") {
      await moveDeposits({ ids: waiting.map((row) => row.id) }, ["CONFIRMED"], { state: "BELOW_MIN" });
    }
    if (plan.reason === "empty") {
      // Confirmed after the balance had already gone out with an earlier
      // sweep; those funds were credited then. Anything else is for a person.
      const stale = waiting.filter((row) => row.state !== "DETECTED" && Date.now() - new Date(row.detected_at).getTime() > ORPHAN_REVIEW_MS);
      await moveDeposits({ ids: stale.map((row) => row.id) }, ["CONFIRMED", "BELOW_MIN"], {
        last_error: "Recorded but no balance left to sweep. Check whether an earlier sweep carried it.",
        state: "NEEDS_REVIEW",
      });
    }
    return null;
  }

  const sweep = await insertSweep({
    amount: unitsToUsdc(plan.amountUnits),
    chain: address.chain,
    deposit_address_id: address.id,
    owner_wallet: address.owner_wallet,
  });
  // Another worker claimed the address first.
  if (!sweep) return null;

  await moveDeposits(
    { ids: depositsForSweep(waiting, plan.amountUnits).map((row) => row.id) },
    ["DETECTED", "CONFIRMED", "BELOW_MIN"],
    { state: "SWEEPING", sweep_id: sweep.id },
  );
  await adoptStrandedDeposits(address, sweep);
  await runBridge(sweep, address);
  return sweep;
}

// ─── Entry points ────────────────────────────────────────────────────────────

/** Detect, then sweep. Errors are kept per address so one bad row never stops the rest. */
export async function processDepositAddress(address: DepositAddressRow) {
  try {
    await detectDeposits(address);
    await touchDepositAddress(address.id, { checked: true });
    await sweepAddress(address);
    return { id: address.id, ok: true as const };
  } catch (error) {
    console.error("[multichain] address", address.id, error instanceof Error ? error.message : error);
    return { error: error instanceof Error ? error.message : "failed", id: address.id, ok: false as const };
  }
}



/** Background pass: every open sweep, then every recently active address. */
export async function processDue() {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  const seen = new Set<string>();

  for (const sweep of await listOpenSweeps()) {
    if (seen.has(sweep.deposit_address_id)) continue;
    seen.add(sweep.deposit_address_id);
    const address = await getDepositAddress(sweep.deposit_address_id);
    if (address) results.push(await processDepositAddress(address));
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const address of await listActiveDepositAddresses(since)) {
    if (seen.has(address.id)) continue;
    seen.add(address.id);
    results.push(await processDepositAddress(address));
  }

  return results;
}

