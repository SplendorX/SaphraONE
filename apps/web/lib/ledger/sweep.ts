// Server-only. Fills the transaction ledger from what the live hooks can't
// see: ALLIE Agent Wallet payments (submitted before they confirm) and history
// from before the ledger existed. Run by /api/cron/ledger and from admin.
import { loadAgentWalletConfig } from "@/lib/agent-wallet/config";
import { recordLedgerTransaction } from "@/lib/ledger/transactions";
import {
  paymentIntentsTable,
  paymentSettlementsTable,
} from "@/lib/payment-engine/ledger";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const stateTable = "ledger_backfill_state";
const activityTable = process.env.SUPABASE_ACCOUNT_ACTIVITY_TABLE ?? "account_activity";

/** How far back the Agent Wallet sweep looks for settled payments. */
const agentLookbackHours = 72;

type Counts = { recorded: number; skipped: number; failed: number };

function tally(counts: Counts, result: "recorded" | "skipped" | "failed") {
  counts[result] += 1;
}

/** Stop starting new work after this long, so a run ends inside its limit. */
function deadline(budgetMs: number) {
  const end = Date.now() + budgetMs;
  return () => Date.now() > end;
}

async function agentAddressFor(owner: string, cache: Map<string, string | null>) {
  if (!cache.has(owner)) {
    const config = await loadAgentWalletConfig(owner).catch(() => null);
    cache.set(owner, config?.walletAddress?.toLowerCase() ?? null);
  }
  return cache.get(owner) ?? null;
}

/**
 * ALLIE's payments from the last few days. They are recorded once confirmed,
 * credited to the owner and verified against the Agent Wallet that sent them.
 * Every leg of a batch is its own transaction.
 */
export async function sweepAgentPayments(budgetMs = 60_000): Promise<Counts> {
  const counts: Counts = { failed: 0, recorded: 0, skipped: 0 };
  const expired = deadline(budgetMs);
  const db = createSupabaseAdminClient();
  const since = new Date(Date.now() - agentLookbackHours * 3_600_000).toISOString();

  const { data: settlements, error } = await db
    .from(paymentSettlementsTable)
    .select("intent_id,tx_hash,settled_at")
    .gte("settled_at", since)
    .not("tx_hash", "is", null)
    .limit(500);
  if (error) throw new Error(error.message);
  if (!settlements?.length) return counts;

  const { data: intents, error: intentError } = await db
    .from(paymentIntentsTable)
    .select("intent_id,initiator_id,initiator_type,metadata")
    .in("intent_id", [...new Set(settlements.map((row) => row.intent_id as string))]);
  if (intentError) throw new Error(intentError.message);

  const byIntent = new Map((intents ?? []).map((row) => [row.intent_id as string, row]));
  const agents = new Map<string, string | null>();

  for (const settlement of settlements) {
    if (expired()) break;
    const intent = byIntent.get(settlement.intent_id as string);
    if (!intent || intent.initiator_type !== "agent") continue;
    const owner = String(intent.initiator_id).toLowerCase();
    const agent = await agentAddressFor(owner, agents);
    if (!agent) continue;

    const legs = Array.isArray((intent.metadata as { batch?: unknown } | null)?.batch)
      ? ((intent.metadata as { batch: Array<{ kind?: string; txHash?: string }> }).batch)
      : [];
    const hashes = new Set<string>([
      String(settlement.tx_hash),
      ...legs.filter((leg) => leg.kind === "payment" && leg.txHash).map((leg) => String(leg.txHash)),
    ]);

    for (const txHash of hashes) {
      tally(
        counts,
        await recordLedgerTransaction({
          metadata: { intentId: intent.intent_id },
          occurredAt: settlement.settled_at as string,
          sender: agent,
          source: "agent",
          txHash,
          wallet: owner,
        }),
      );
    }
  }
  return counts;
}

type ActivityRow = {
  id: string;
  wallet_address: string;
  source: string;
  tx_hash: string;
  occurred_at: string | null;
  created_at: string;
};

/**
 * Backfill from the app's own activity records, oldest first, resuming where
 * the last run stopped. Each record names its feature and transaction; the
 * ledger re-reads the transaction from the chain like any other.
 */
export async function backfillFromActivity(input: { limit?: number; budgetMs?: number } = {}) {
  const limit = input.limit ?? 200;
  const expired = deadline(input.budgetMs ?? 120_000);
  const counts: Counts = { failed: 0, recorded: 0, skipped: 0 };
  const db = createSupabaseAdminClient();

  const { data: state } = await db.from(stateTable).select("*").eq("id", "account_activity").maybeSingle();
  const cursorAt = (state?.cursor_at as string | null) ?? null;
  const cursorId = (state?.cursor_id as string | null) ?? null;

  let query = db
    .from(activityTable)
    .select("id,wallet_address,source,tx_hash,occurred_at,created_at")
    .eq("mirrored", false)
    .eq("direction", "out")
    .not("tx_hash", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (cursorAt) query = query.gte("created_at", cursorAt);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // Rows sharing the cursor's timestamp were done up to the cursor's id.
  const rows = ((data ?? []) as ActivityRow[]).filter(
    (row) => !(cursorAt && row.created_at === cursorAt && cursorId && row.id <= cursorId),
  );

  const agents = new Map<string, string | null>();
  let last: ActivityRow | null = null;
  for (const row of rows) {
    if (expired()) break;
    const owner = row.wallet_address.toLowerCase();
    const sender = row.source === "agent" ? await agentAddressFor(owner, agents) : null;
    if (row.source === "agent" && !sender) {
      counts.skipped += 1;
    } else {
      tally(
        counts,
        await recordLedgerTransaction({
          metadata: { backfill: true },
          occurredAt: row.occurred_at ?? row.created_at,
          sender: sender ?? undefined,
          source: row.source,
          txHash: row.tx_hash,
          wallet: owner,
        }),
      );
    }
    last = row;
  }

  if (last) {
    await db.from(stateTable).upsert({
      cursor_at: last.created_at,
      cursor_id: last.id,
      id: "account_activity",
      processed: Number(state?.processed ?? 0) + rows.indexOf(last) + 1,
      updated_at: new Date().toISOString(),
    });
  }

  return { ...counts, done: rows.length === 0, processed: last ? rows.indexOf(last) + 1 : 0 };
}

/** What the admin page shows about the ledger. */
export async function ledgerStatus() {
  const db = createSupabaseAdminClient();
  const [total, eligible, latest, state] = await Promise.all([
    db.from("transaction_ledger").select("id", { count: "exact", head: true }),
    db.from("transaction_ledger").select("id", { count: "exact", head: true }).eq("eligible", true),
    db.from("transaction_ledger").select("recorded_at").order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    db.from(stateTable).select("cursor_at,processed,updated_at").eq("id", "account_activity").maybeSingle(),
  ]);
  if (total.error) throw new Error(total.error.message);
  return {
    backfill: state.data
      ? { cursorAt: state.data.cursor_at as string | null, processed: Number(state.data.processed), updatedAt: state.data.updated_at as string }
      : null,
    eligibleRows: eligible.count ?? 0,
    lastRecordedAt: (latest.data?.recorded_at as string | undefined) ?? null,
    totalRows: total.count ?? 0,
  };
}
