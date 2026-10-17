// Server-only. Housekeeping for Checkout, run by /api/cron/checkout.
import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { syncChargeMatches } from "@/lib/checkout/scan";

/** Marks open charges past their expiry as EXPIRED. Returns how many. */
export async function expireStaleCharges() {
  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
    .eq("status", "OPEN")
    .lt("expires_at", new Date().toISOString())
    .select("id, kind");
  if (error) throw new Error(readAccountDbError(error, "Could not expire charges."));
  const rows = (data ?? []) as Array<{ id: string; kind: string }>;
  const online = rows.filter((row) => row.kind === "ONLINE").map((row) => row.id);
  if (online.length > 0) {
    const { emitSessionsExpired } = await import("@/lib/merchant-api/events");
    await emitSessionsExpired(online);
  }
  return rows.length;
}

/**
 * Scans every merchant still waiting on a card/bank or bridge payment, so a
 * payment lands on its charge even if nobody has the page open. Stops early
 * to stay inside the cron's time budget; the next run picks up the rest.
 */
export async function catchUpChargeScans(options?: { budgetMs?: number; maxWallets?: number }) {
  const startedAt = Date.now();
  const budgetMs = options?.budgetMs ?? 45_000;
  const maxWallets = options?.maxWallets ?? 50;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .select("wallet_address")
    .in("status", ["OPEN", "EXPIRED"])
    .in("pending_method", ["ONRAMP", "BRIDGE"])
    .gte("pending_started_at", since)
    .limit(500);
  if (error) throw new Error(readAccountDbError(error, "Could not load charges to scan."));
  const wallets = [
    ...new Set((data ?? []).map((row) => String((row as { wallet_address: string }).wallet_address))),
  ].slice(0, maxWallets);

  let scanned = 0;
  let claimed = 0;
  const failures: string[] = [];
  for (const wallet of wallets) {
    if (Date.now() - startedAt > budgetMs) break;
    try {
      const result = await syncChargeMatches(wallet, { force: true });
      if (result.scanned) scanned += 1;
      claimed += result.claimed;
    } catch (cause) {
      failures.push(wallet);
      console.warn("[checkout] catch-up scan failed", wallet, cause);
    }
  }
  return { claimed, failures: failures.length, scanned, wallets: wallets.length };
}
