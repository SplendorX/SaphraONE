// Server-only. Secret API keys of the Checkout API. Only a SHA-256 of each key
// is stored; the key itself is shown once, when it is created.
import crypto from "node:crypto";

import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { accountErrors } from "@/lib/account/errors";
import { loadBusinessProfile } from "@/lib/account/service";
import { type ApiMode, apiKeyPrefix, generateApiKey } from "@/lib/merchant-api/ids";
import { isArcMainnet } from "@/lib/network";
import { createSavingsNotificationResult } from "@/lib/save/notifications";

export const MAX_ACTIVE_KEYS = 5;

export type ApiKeyRecord = {
  id: string;
  wallet_address: string;
  mode: ApiMode;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_by_wallet: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

/** What the dashboard lists: never the hash. */
export type ApiKeySummary = Omit<ApiKeyRecord, "key_hash" | "wallet_address">;

/** Keys made here work here: live on the mainnet deployment, test on testnet. */
export function deploymentMode(): ApiMode {
  return isArcMainnet() ? "live" : "test";
}

export function hashApiKey(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function summarize(record: ApiKeyRecord): ApiKeySummary {
  return {
    created_at: record.created_at,
    created_by_wallet: record.created_by_wallet,
    id: record.id,
    key_prefix: record.key_prefix,
    last_used_at: record.last_used_at,
    mode: record.mode,
    name: record.name,
    revoked_at: record.revoked_at,
  };
}

export async function listApiKeys(wallet: string) {
  const { data, error } = await accountDb()
    .from(accountTables.merchantApiKeys)
    .select("*")
    .eq("wallet_address", wallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(readAccountDbError(error, "Could not load API keys."));
  return ((data ?? []) as ApiKeyRecord[]).map(summarize);
}

/**
 * A new key for the business. Live keys need a verified business, so a
 * stranger can't take real payments under a name they made up.
 */
export async function createApiKey(input: { wallet: string; actorWallet: string; name: unknown }) {
  const wallet = input.wallet.toLowerCase();
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  if (!name) throw accountErrors.invalid("Give the key a name, such as the site it is for.");
  const mode = deploymentMode();

  if (mode === "live") {
    const profile = await loadBusinessProfile(wallet);
    if (profile?.verification_status !== "VERIFIED") {
      throw accountErrors.forbidden("Verify your business before creating a live API key.");
    }
  }

  const active = await accountDb()
    .from(accountTables.merchantApiKeys)
    .select("id", { count: "exact", head: true })
    .eq("wallet_address", wallet)
    .is("revoked_at", null);
  if (active.error) throw new Error(readAccountDbError(active.error, "Could not check your API keys."));
  if ((active.count ?? 0) >= MAX_ACTIVE_KEYS) {
    throw accountErrors.invalid(`You can have ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`);
  }

  const key = generateApiKey(mode);
  const { data, error } = await accountDb()
    .from(accountTables.merchantApiKeys)
    .insert({
      created_by_wallet: input.actorWallet.toLowerCase(),
      key_hash: hashApiKey(key),
      key_prefix: apiKeyPrefix(key),
      mode,
      name,
      wallet_address: wallet,
    })
    .select("*")
    .single();
  if (error) throw new Error(readAccountDbError(error, "Could not create the API key."));

  void createSavingsNotificationResult({
    body: `A ${mode} API key "${name}" was created for your business. If this wasn't you, revoke it in Developers.`,
    fallbackKind: "reconciliation_alert",
    kind: "reconciliation_alert",
    metadata: { keyId: (data as ApiKeyRecord).id, type: "api_key_created" },
    ownerWallet: wallet,
    title: "New API key created",
  });

  return { key, record: summarize(data as ApiKeyRecord) };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function revokeApiKey(input: { wallet: string; keyId: string }) {
  if (!uuidPattern.test(input.keyId)) throw accountErrors.notFound("Active API key");
  const { data, error } = await accountDb()
    .from(accountTables.merchantApiKeys)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.keyId)
    .eq("wallet_address", input.wallet.toLowerCase())
    .is("revoked_at", null)
    .select("*");
  if (error) throw new Error(readAccountDbError(error, "Could not revoke the API key."));
  const record = ((data ?? []) as ApiKeyRecord[])[0];
  if (!record) throw accountErrors.notFound("Active API key");
  return summarize(record);
}

export async function findApiKeyByHash(hash: string) {
  const { data, error } = await accountDb()
    .from(accountTables.merchantApiKeys)
    .select("*")
    .eq("key_hash", hash)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not check the API key."));
  return (data as ApiKeyRecord | null) ?? null;
}

/** At most once a minute per key, so busy sites don't write on every call. */
export async function touchApiKey(record: ApiKeyRecord) {
  const last = record.last_used_at ? new Date(record.last_used_at).getTime() : 0;
  if (Date.now() - last < 60_000) return;
  const { error } = await accountDb()
    .from(accountTables.merchantApiKeys)
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", record.id);
  if (error) console.warn("[merchant-api] could not stamp last_used_at", error.message);
}
