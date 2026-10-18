// Server-only. What /admin/merchant-api reads and the one change it makes:
// revoking a business's API key, with a reason the business is told.
import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import {
  ADMIN_WINDOW_DAYS,
  type AdminBusinessRow,
  type AdminChargeRow,
  type AdminDeliveryRow,
  type AdminEndpointRow,
  type AdminKeyRow,
  readRevokeReason,
  summarizeMerchantApi,
} from "@/lib/merchant-api/admin-rules";
import { createSavingsNotificationResult } from "@/lib/save/notifications";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) {
  const { data, error } = await query;
  if (error) throw new Error(readAccountDbError(error, `Could not load ${what}.`));
  return (data ?? []) as T[];
}

/** Every business with API keys, its last 7 days of sessions, and its webhook health. */
export async function loadMerchantApiOverview() {
  const since = new Date(Date.now() - ADMIN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const keys = await rows<AdminKeyRow>(
    accountDb()
      .from(accountTables.merchantApiKeys)
      .select("id, wallet_address, mode, name, key_prefix, last_used_at, revoked_at, created_at")
      .order("created_at", { ascending: false })
      .limit(2000),
    "API keys",
  );
  const wallets = [...new Set(keys.map((key) => key.wallet_address.toLowerCase()))];
  if (wallets.length === 0) {
    return summarizeMerchantApi({ businesses: [], charges: [], deliveries: [], endpoints: [], keys });
  }

  const [charges, endpoints, deliveries, profiles, accounts] = await Promise.all([
    rows<AdminChargeRow>(
      accountDb()
        .from(accountTables.charges)
        .select("wallet_address, status, amount_received, currency")
        .eq("kind", "ONLINE")
        .gte("created_at", since)
        .limit(20_000),
      "checkout sessions",
    ),
    rows<AdminEndpointRow>(
      accountDb()
        .from(accountTables.webhookEndpoints)
        .select("id, wallet_address, url, disabled_at, failing_since")
        .in("wallet_address", wallets),
      "webhook endpoints",
    ),
    rows<AdminDeliveryRow>(
      accountDb()
        .from(accountTables.webhookDeliveries)
        .select("wallet_address, endpoint_id, status, attempts")
        .in("status", ["PENDING", "FAILED"])
        .gte("created_at", since)
        .limit(20_000),
      "webhook deliveries",
    ),
    rows<{ wallet_address: string; business_name: string | null; verification_status: string | null }>(
      accountDb()
        .from(accountTables.businessProfiles)
        .select("wallet_address, business_name, verification_status")
        .in("wallet_address", wallets),
      "business profiles",
    ),
    rows<{ wallet_address: string; username: string | null }>(
      accountDb().from(accountTables.profiles).select("wallet_address, username").in("wallet_address", wallets),
      "accounts",
    ),
  ]);

  const usernames = new Map(accounts.map((row) => [row.wallet_address.toLowerCase(), row.username]));
  const businesses: AdminBusinessRow[] = wallets.map((wallet) => {
    const profile = profiles.find((row) => row.wallet_address.toLowerCase() === wallet);
    return {
      business_name: profile?.business_name ?? null,
      username: usernames.get(wallet) ?? null,
      verification_status: profile?.verification_status ?? null,
      wallet_address: wallet,
    };
  });

  return summarizeMerchantApi({ businesses, charges, deliveries, endpoints, keys });
}

/**
 * Revokes a key at once (a leak, abuse, or a business that shouldn't take
 * payments) and tells the business why. The site's API calls with it fail
 * from the next request.
 */
export async function adminRevokeApiKey(input: { keyId: unknown; reason: unknown }) {
  const keyId = typeof input.keyId === "string" ? input.keyId : "";
  if (!uuidPattern.test(keyId)) throw new Error("Unknown API key.");
  const reason = readRevokeReason(input.reason);

  const { data, error } = await accountDb()
    .from(accountTables.merchantApiKeys)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .is("revoked_at", null)
    .select("id, wallet_address, mode, name, key_prefix");
  if (error) throw new Error(readAccountDbError(error, "Could not revoke the API key."));
  const key = ((data ?? []) as Pick<AdminKeyRow, "id" | "wallet_address" | "mode" | "name" | "key_prefix">[])[0];
  if (!key) throw new Error("That key is already revoked, or doesn't exist.");

  void createSavingsNotificationResult({
    body: `SaphraONE revoked your ${key.mode} API key "${key.name}" (${key.key_prefix}…). Reason: ${reason}. Requests with it now fail. Contact support if you have questions.`,
    fallbackKind: "reconciliation_alert",
    kind: "reconciliation_alert",
    metadata: { keyId: key.id, type: "api_key_revoked_by_admin" },
    ownerWallet: key.wallet_address,
    title: "API key revoked",
  });

  return { key, reason };
}
