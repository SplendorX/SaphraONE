// Server-only. Rows behind multichain receive (packages/database/supabase/multichain.sql).
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import type { DepositState, OutboundState, SweepState } from "@/lib/multichain/rules";

export type DepositAddressRow = {
  id: string;
  owner_wallet: string;
  chain: string;
  address: string;
  provider: "circle-dcw" | "forwarder";
  provider_wallet_id: string | null;
  last_checked_at: string | null;
  last_activity_at: string | null;
  created_at: string;
};

export type ChainSweepRow = {
  id: string;
  deposit_address_id: string;
  owner_wallet: string;
  chain: string;
  state: SweepState;
  amount: string;
  amount_credited: string | null;
  fee_units: string | null;
  burn_tx_hash: string | null;
  mint_tx_hash: string | null;
  bridge_result: unknown;
  attempts: number;
  last_error: string | null;
  started_at: string;
  credited_at: string | null;
  updated_at: string;
};

export type ChainDepositRow = {
  id: string;
  owner_wallet: string;
  chain: string;
  deposit_address_id: string;
  sweep_id: string | null;
  state: DepositState;
  amount_in: string;
  source_tx_hash: string;
  sender_address: string | null;
  provider_tx_id: string | null;
  last_error: string | null;
  detected_at: string;
  credited_at: string | null;
  created_at: string;
};

function db() {
  return createSupabaseAdminClient();
}

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function profileExists(wallet: string) {
  const { data, error } = await db()
    .from("profiles")
    .select("wallet_address")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();
  if (error) fail(error, "Profile could not be read.");
  return Boolean(data);
}

export async function findDepositAddress(ownerWallet: string, chain: string) {
  const { data, error } = await db()
    .from("deposit_addresses")
    .select("*")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .eq("chain", chain)
    .maybeSingle<DepositAddressRow>();
  if (error) fail(error, "Deposit address could not be read.");
  return data;
}

export async function listDepositAddresses(ownerWallet: string) {
  const { data, error } = await db()
    .from("deposit_addresses")
    .select("*")
    .eq("owner_wallet", ownerWallet.toLowerCase());
  if (error) fail(error, "Deposit addresses could not be read.");
  return (data ?? []) as DepositAddressRow[];
}

export async function getDepositAddress(id: string) {
  const { data, error } = await db()
    .from("deposit_addresses")
    .select("*")
    .eq("id", id)
    .maybeSingle<DepositAddressRow>();
  if (error) fail(error, "Deposit address could not be read.");
  return data;
}

export async function findDepositAddressByWalletId(walletId: string) {
  const { data, error } = await db()
    .from("deposit_addresses")
    .select("*")
    .eq("provider_wallet_id", walletId)
    .maybeSingle<DepositAddressRow>();
  if (error) fail(error, "Deposit address could not be read.");
  return data;
}

/** Insert the owner's address for a network; on a race the first row wins. */
export async function insertDepositAddress(row: {
  owner_wallet: string;
  chain: string;
  address: string;
  provider_wallet_id: string;
}) {
  const { error } = await db()
    .from("deposit_addresses")
    .upsert(
      { ...row, owner_wallet: row.owner_wallet.toLowerCase(), provider: "circle-dcw" },
      { ignoreDuplicates: true, onConflict: "owner_wallet,chain" },
    );
  if (error) fail(error, "Deposit address could not be saved.");
  const saved = await findDepositAddress(row.owner_wallet, row.chain);
  if (!saved) throw new Error("Deposit address could not be saved.");
  return saved;
}

export async function touchDepositAddress(id: string, fields: { checked?: boolean; activity?: boolean }) {
  const now = new Date().toISOString();
  const { error } = await db()
    .from("deposit_addresses")
    .update({
      ...(fields.checked ? { last_checked_at: now } : {}),
      ...(fields.activity ? { last_activity_at: now } : {}),
      updated_at: now,
    })
    .eq("id", id);
  if (error) fail(error, "Deposit address could not be updated.");
}

/** Addresses worth checking in the background: recent activity or recently shown. */
export async function listActiveDepositAddresses(sinceIso: string, limit = 200) {
  const { data, error } = await db()
    .from("deposit_addresses")
    .select("*")
    .or(`last_activity_at.gte.${sinceIso},created_at.gte.${sinceIso},last_checked_at.gte.${sinceIso}`)
    .limit(limit);
  if (error) fail(error, "Deposit addresses could not be listed.");
  return (data ?? []) as DepositAddressRow[];
}

/** Record a transfer once; a replay of the same (chain, tx) changes nothing. */
export async function recordDeposit(row: {
  owner_wallet: string;
  chain: string;
  deposit_address_id: string;
  amount_in: string;
  source_tx_hash: string;
  sender_address: string | null;
  provider_tx_id: string;
  state: DepositState;
}) {
  const { data, error } = await db()
    .from("chain_deposits")
    .upsert(row, { ignoreDuplicates: true, onConflict: "chain,source_tx_hash" })
    .select("id");
  if (error) fail(error, "Deposit could not be recorded.");
  return (data ?? []).length > 0;
}

export async function listDepositsForAddress(depositAddressId: string, states: readonly DepositState[]) {
  const { data, error } = await db()
    .from("chain_deposits")
    .select("*")
    .eq("deposit_address_id", depositAddressId)
    .in("state", states as DepositState[]);
  if (error) fail(error, "Deposits could not be read.");
  return (data ?? []) as ChainDepositRow[];
}

export async function listDepositsForOwner(ownerWallet: string, limit = 25) {
  const { data, error } = await db()
    .from("chain_deposits")
    .select("*")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail(error, "Deposits could not be read.");
  return (data ?? []) as ChainDepositRow[];
}

/** Move deposits to a state, but only those currently in one of `from`. */
export async function moveDeposits(
  where: { ids?: string[]; sweepId?: string },
  from: readonly DepositState[],
  patch: { state: DepositState; sweep_id?: string | null; last_error?: string | null; credited_at?: string },
) {
  let query = db()
    .from("chain_deposits")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .in("state", from as DepositState[]);
  if (where.ids) {
    if (where.ids.length === 0) return;
    query = query.in("id", where.ids);
  }
  if (where.sweepId) query = query.eq("sweep_id", where.sweepId);
  const { error } = await query;
  if (error) fail(error, "Deposits could not be updated.");
}



/** The address's open sweep (in flight or failed and resumable), if any. */
export async function findOpenSweep(depositAddressId: string) {
  const { data, error } = await db()
    .from("chain_sweeps")
    .select("*")
    .eq("deposit_address_id", depositAddressId)
    .in("state", ["SWEEPING", "BURNED", "FAILED"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ChainSweepRow>();
  if (error) fail(error, "Sweep could not be read.");
  return data;
}

/**
 * Claim the address for a new sweep. Returns null when another sweep is
 * already in flight (the one-in-flight index refused the row).
 */
export async function insertSweep(row: {
  deposit_address_id: string;
  owner_wallet: string;
  chain: string;
  amount: string;
}) {
  const { data, error } = await db().from("chain_sweeps").insert(row).select("*").maybeSingle<ChainSweepRow>();
  if (error) {
    if (error.code === "23505") return null;
    fail(error, "Sweep could not be started.");
  }
  return data;
}

/**
 * Update a sweep, but only while it is still in `from` (guards against a
 * racing worker). `expectUpdatedAt` makes it a claim: only the worker that
 * read the row last can move it, so two workers never both restart a bridge.
 * Returns null when the row had moved on.
 */
export async function updateSweep(
  id: string,
  from: readonly SweepState[],
  patch: Partial<ChainSweepRow>,
  expectUpdatedAt?: string,
) {
  let query = db()
    .from("chain_sweeps")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("state", from as SweepState[]);
  if (expectUpdatedAt) query = query.eq("updated_at", expectUpdatedAt);
  const { data, error } = await query.select("*").maybeSingle<ChainSweepRow>();
  if (error) {
    if (error.code === "23505") return null;
    fail(error, "Sweep could not be updated.");
  }
  return data;
}

export async function listOpenSweeps(limit = 100) {
  const { data, error } = await db()
    .from("chain_sweeps")
    .select("*")
    .in("state", ["SWEEPING", "BURNED", "FAILED"])
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) fail(error, "Sweeps could not be listed.");
  return (data ?? []) as ChainSweepRow[];
}

export async function listSweepsByIds(ids: string[]) {
  if (ids.length === 0) return [] as ChainSweepRow[];
  const { data, error } = await db().from("chain_sweeps").select("*").in("id", ids);
  if (error) fail(error, "Sweeps could not be read.");
  return (data ?? []) as ChainSweepRow[];
}

/** Credited sweeps by their Arc mint hash, for Activity labels ("From Base"). */
export async function sweepsByMintHashes(ownerWallet: string, hashes: string[]) {
  if (hashes.length === 0) return [] as ChainSweepRow[];
  const { data, error } = await db()
    .from("chain_sweeps")
    .select("*")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .in("mint_tx_hash", hashes);
  if (error) fail(error, "Sweeps could not be read.");
  return (data ?? []) as ChainSweepRow[];
}

/** The deposits each sweep carried, for naming who sent them. */
export async function listDepositsBySweepIds(sweepIds: string[]) {
  if (sweepIds.length === 0) return [] as ChainDepositRow[];
  const { data, error } = await db().from("chain_deposits").select("*").in("sweep_id", sweepIds);
  if (error) fail(error, "Deposits could not be read.");
  return (data ?? []) as ChainDepositRow[];
}

// ─── Outbound transfers (Arc → another network) ──────────────────────────────

export type ChainTransferRow = {
  id: string;
  intent_id: string | null;
  owner_wallet: string;
  dest_chain: string;
  dest_address: string;
  amount: string;
  fee_units: string | null;
  /** SaphraONE's service fee (units), and the Arc transfer that paid it. */
  service_fee_units: string | null;
  service_fee_tx_hash: string | null;
  amount_received: string | null;
  burn_tx_hash: string | null;
  mint_tx_hash: string | null;
  bridge_result: unknown;
  state: OutboundState;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export async function insertTransfer(row: {
  owner_wallet: string;
  dest_chain: string;
  dest_address: string;
  amount: string;
  fee_units: string;
  service_fee_units: string;
}) {
  const { data, error } = await db().from("chain_transfers").insert(row).select("*").single<ChainTransferRow>();
  if (error) fail(error, "Transfer could not be started.");
  return data;
}

export async function getTransfer(id: string) {
  const { data, error } = await db().from("chain_transfers").select("*").eq("id", id).maybeSingle<ChainTransferRow>();
  if (error) fail(error, "Transfer could not be read.");
  return data;
}

/** Update a transfer only while it is in one of `from`. Null when it had moved on. */
export async function updateTransfer(id: string, from: readonly OutboundState[], patch: Partial<ChainTransferRow>) {
  const { data, error } = await db()
    .from("chain_transfers")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("state", from as OutboundState[])
    .select("*")
    .maybeSingle<ChainTransferRow>();
  if (error) {
    if (error.code === "23505") throw new Error("That burn is already recorded for another transfer.");
    fail(error, "Transfer could not be updated.");
  }
  return data;
}

export async function listTransfersForOwner(ownerWallet: string, limit = 20) {
  const { data, error } = await db()
    .from("chain_transfers")
    .select("*")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail(error, "Transfers could not be read.");
  return (data ?? []) as ChainTransferRow[];
}

export async function listBurnedTransfers(limit = 100) {
  const { data, error } = await db()
    .from("chain_transfers")
    .select("*")
    .eq("state", "BURNED")
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) fail(error, "Transfers could not be listed.");
  return (data ?? []) as ChainTransferRow[];
}
