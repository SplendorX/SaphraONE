import { getAddress, isAddress, type Address } from "viem";

import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const agentWalletConfigsTable =
  process.env.SUPABASE_AGENT_WALLET_CONFIGS_TABLE ?? "agent_wallet_configs";

export type AgentWalletStatus = "active" | "paused" | "revoked";

export type AgentWalletConfig = {
  ownerWallet: string;
  walletSetId: string;
  walletId: string;
  walletAddress: Address;
  blockchain: string;
  status: AgentWalletStatus;
  createdAt: string;
  updatedAt: string;
};

type AgentWalletRow = {
  owner_wallet: string;
  wallet_set_id: string;
  wallet_id: string;
  wallet_address: string;
  blockchain: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function statusFromRow(value: string): AgentWalletStatus {
  return value === "paused" || value === "revoked" || value === "active"
    ? value
    : "revoked";
}

function configFromRow(row: AgentWalletRow): AgentWalletConfig {
  return {
    ownerWallet: row.owner_wallet,
    walletSetId: row.wallet_set_id,
    walletId: row.wallet_id,
    walletAddress: row.wallet_address as Address,
    blockchain: row.blockchain,
    status: statusFromRow(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadAgentWalletConfig(
  ownerWallet: string,
): Promise<AgentWalletConfig | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from(agentWalletConfigsTable)
    .select("*")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .maybeSingle<AgentWalletRow>();

  if (error) {
    throw new Error(error.message || "Agent wallet could not be loaded.");
  }

  return data ? configFromRow(data) : null;
}

export async function saveAgentWalletConfig(config: AgentWalletConfig) {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from(agentWalletConfigsTable).upsert(
    {
      owner_wallet: config.ownerWallet.toLowerCase(),
      wallet_set_id: config.walletSetId,
      wallet_id: config.walletId,
      wallet_address: config.walletAddress.toLowerCase(),
      blockchain: config.blockchain,
      status: config.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_wallet" },
  );

  if (error) {
    throw new Error(error.message || "Agent wallet could not be saved.");
  }
}

export async function updateAgentWalletStatus(
  ownerWallet: string,
  status: AgentWalletStatus,
) {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from(agentWalletConfigsTable)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("owner_wallet", ownerWallet.toLowerCase());

  if (error) {
    throw new Error(error.message || "Agent wallet could not be updated.");
  }
}

/** A revoked or paused agent wallet can never execute, whatever the policy says. */
/**
 * Whose ALLIE Agent Wallet each address is, keyed by lowercased agent wallet
 * address. Lets a recipient see "@owner via ALLIE" instead of the agent
 * wallet's bare address. Any status counts: a payment made before the wallet
 * was paused or revoked was still made by that owner.
 */
export async function agentWalletOwners(addresses: string[]) {
  const wanted = [...new Set(addresses.filter((a) => isAddress(a)).map((a) => a.toLowerCase()))];
  if (wanted.length === 0) return {} as Record<string, string>;

  // Stored checksummed or lowercased; ask for both spellings.
  const spellings = wanted.flatMap((address) => [address, getAddress(address)]);
  const { data, error } = await createSupabaseAdminClient()
    .from(agentWalletConfigsTable)
    .select("owner_wallet,wallet_address")
    .in("wallet_address", spellings);
  if (error) throw new Error(error.message);

  const owners: Record<string, string> = {};
  for (const row of (data ?? []) as { owner_wallet: string; wallet_address: string }[]) {
    owners[row.wallet_address.toLowerCase()] = row.owner_wallet.toLowerCase();
  }
  return owners;
}

