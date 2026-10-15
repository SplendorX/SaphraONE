// Server-only. The admin platform's Transactions tool, read from the verified
// transaction ledger (transaction-ledger.sql).
import { isAddress } from "viem";

import { adminTableError } from "@/lib/admin/team";
import { AdminUserError } from "@/lib/admin/users";
import { formatUsernameLabel, normalizeUsername } from "@/lib/profile-utils";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const ledgerTable = process.env.SUPABASE_TRANSACTION_LEDGER_TABLE ?? "transaction_ledger";
const profilesTable = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";

/** At or above this (USD), a payment is flagged for a look. ADMIN_LARGE_TX_USD, default 1,000. */
export function largeTransactionUsd() {
  const value = Number(process.env.ADMIN_LARGE_TX_USD);
  return Number.isFinite(value) && value > 0 ? value : 1000;
}

const periods = { "24h": 1, "30d": 30, "7d": 7, "90d": 90 } as const;
export type LedgerPeriod = keyof typeof periods;

export type LedgerFilters = {
  account?: string | null;
  flaggedOnly?: boolean;
  minUsd?: number | null;
  period?: LedgerPeriod;
  source?: string | null;
};

type LedgerRow = {
  amount: number | string;
  amount_usd: number | string;
  chain_id: number;
  eligible: boolean;
  fee_usd: number | string;
  id: string;
  ineligible_reason: string | null;
  occurred_at: string;
  payee_count: number;
  source: string;
  token: string;
  tx_hash: string;
  wallet_address: string;
};

/** A ONE ID or wallet as the wallet to filter on. */
async function walletFor(account: string) {
  const value = account.trim();
  if (isAddress(value)) return value.toLowerCase();
  const { data } = await createSupabaseAdminClient()
    .from(profilesTable)
    .select("wallet_address")
    .eq("username", normalizeUsername(value))
    .maybeSingle();
  const wallet = (data as { wallet_address?: string } | null)?.wallet_address;
  if (!wallet) throw new AdminUserError("No account has that ONE ID.", 404);
  return wallet.toLowerCase();
}

export async function listLedger(filters: LedgerFilters) {
  const days = periods[filters.period ?? "7d"] ?? 7;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const large = largeTransactionUsd();

  let query = createSupabaseAdminClient()
    .from(ledgerTable)
    .select(
      "id, tx_hash, wallet_address, source, token, amount, amount_usd, fee_usd, payee_count, eligible, ineligible_reason, chain_id, occurred_at",
    )
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (filters.account?.trim()) query = query.eq("wallet_address", await walletFor(filters.account));
  if (filters.source?.trim()) query = query.eq("source", filters.source.trim());
  if (filters.minUsd && filters.minUsd > 0) query = query.gte("amount_usd", filters.minUsd);

  const { data, error } = await query;
  if (error) {
    throw new AdminUserError(
      /transaction_ledger|relation|does not exist/i.test(error.message)
        ? "Run packages/database/supabase/transaction-ledger.sql in Supabase first."
        : error.message,
      409,
    );
  }

  const rows = (data ?? []) as LedgerRow[];
  const flagOf = (row: LedgerRow) =>
    Number(row.amount_usd) >= large
      ? "Large payment"
      : !row.eligible
        ? row.ineligible_reason || "Ineligible"
        : null;
  const shown = filters.flaggedOnly ? rows.filter((row) => flagOf(row)) : rows;

  // ONE IDs for the wallets on screen.
  const wallets = [...new Set(shown.map((row) => row.wallet_address.toLowerCase()))];
  const names = new Map<string, string>();
  if (wallets.length) {
    const { data: profiles } = await createSupabaseAdminClient()
      .from(profilesTable)
      .select("wallet_address, username")
      .in("wallet_address", wallets);
    for (const profile of (profiles ?? []) as Array<{ username: string | null; wallet_address: string }>) {
      if (profile.username) names.set(profile.wallet_address.toLowerCase(), formatUsernameLabel(profile.username));
    }
  }

  const bySource = new Map<string, { count: number; volumeUsd: number }>();
  let volumeUsd = 0;
  let feesUsd = 0;
  for (const row of rows) {
    volumeUsd += Number(row.amount_usd) || 0;
    feesUsd += Number(row.fee_usd) || 0;
    const entry = bySource.get(row.source) ?? { count: 0, volumeUsd: 0 };
    entry.count += 1;
    entry.volumeUsd += Number(row.amount_usd) || 0;
    bySource.set(row.source, entry);
  }

  return {
    largeThresholdUsd: large,
    summary: {
      accounts: new Set(rows.map((row) => row.wallet_address)).size,
      bySource: [...bySource.entries()]
        .map(([source, value]) => ({ source, ...value }))
        .sort((a, b) => b.volumeUsd - a.volumeUsd),
      count: rows.length,
      feesUsd,
      flagged: rows.filter((row) => flagOf(row)).length,
      truncated: rows.length === 500,
      volumeUsd,
    },
    transactions: shown.map((row) => ({
      amount: Number(row.amount),
      amountUsd: Number(row.amount_usd),
      chainId: row.chain_id,
      feeUsd: Number(row.fee_usd),
      flag: flagOf(row),
      id: row.id,
      occurredAt: row.occurred_at,
      oneId: names.get(row.wallet_address.toLowerCase()) ?? null,
      payeeCount: row.payee_count,
      source: row.source,
      token: row.token,
      txHash: row.tx_hash,
      wallet: row.wallet_address,
    })),
  };
}

export async function listAuditLog(filters: { target?: string | null } = {}) {
  let query = createSupabaseAdminClient()
    .from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters.target?.trim()) query = query.eq("target", filters.target.trim().toLowerCase());
  const { data, error } = await query;
  if (error) throw adminTableError(error);
  return data ?? [];
}
