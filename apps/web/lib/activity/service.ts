import { formatUnits } from "viem";

import type {
  ActivityBatchDetails,
  AccountActivityEntry,
  ActivityDirection,
  ActivitySource,
} from "@/lib/activity/types";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const activityTable =
  process.env.SUPABASE_ACCOUNT_ACTIVITY_TABLE ?? "account_activity";

/** Per-source cap. The feed is a recent history, not an export. */
const sourceLimit = 200;

type Supabase = ReturnType<typeof createSupabaseAdminClient>;
type Row = Record<string, unknown>;

function readBatchDetails(metadata: Row | null): ActivityBatchDetails | null {
  const list = metadata?.recipients;
  if (!Array.isArray(list) || list.length === 0) return null;
  const recipients = list.flatMap((entry) => {
    const item = entry as Row;
    const wallet = str(item?.wallet);
    const amount = str(item?.amount);
    return wallet && amount ? [{ wallet, amount, label: str(item?.label) }] : [];
  });
  return recipients.length > 0
    ? { recipients, fee: str(metadata?.fee), mode: str(metadata?.mode) }
    : null;
}

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** An amount column: numeric columns can arrive as numbers or strings. */
function amountText(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : str(value);
}

function hashes(...values: unknown[]) {
  const out = new Set<string>();
  for (const value of values) {
    const hash = str(value);
    if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) out.add(hash.toLowerCase());
  }
  return [...out];
}

/** 6-decimal base units (USDC/EURC) stored as text, to a decimal string. */
function fromUnits(value: unknown) {
  const units = str(value);
  if (!units || !/^\d+$/.test(units)) return null;
  return formatUnits(BigInt(units), 6);
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// ── Writes ──────────────────────────────────────────────────────────────

export type RecordAccountActivityInput = {
  walletAddress: string;
  source: ActivitySource;
  direction?: ActivityDirection;
  title?: string | null;
  counterparty?: string | null;
  amount?: string | null;
  token?: string | null;
  txHash?: string | null;
  mirrored?: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Which of these transactions a sender recorded as a BulkPay batch. Used to
 * tell a recipient their payment came "via BulkPay".
 */
export async function findBatchTxHashes(txHashes: string[]) {
  const hashes = [...new Set(txHashes.map((hash) => hash.toLowerCase()))];
  if (hashes.length === 0) return new Set<string>();
  const { data, error } = await createSupabaseAdminClient()
    .from(activityTable)
    .select("tx_hash")
    .eq("source", "batch")
    .in("tx_hash", hashes);
  if (error) return new Set<string>();
  return new Set(
    (data ?? []).map((row: Row) => String(row.tx_hash).toLowerCase()),
  );
}

export async function recordAccountActivity(input: RecordAccountActivityInput) {
  const supabase = createSupabaseAdminClient();
  const row = {
    wallet_address: input.walletAddress.toLowerCase(),
    source: input.source,
    direction: input.direction ?? "out",
    title: input.title ?? null,
    counterparty: input.counterparty ?? null,
    amount: input.amount ?? null,
    token: input.token ?? null,
    tx_hash: input.txHash ? input.txHash.toLowerCase() : null,
    mirrored: input.mirrored ?? false,
    metadata: input.metadata ?? {},
  };

  // A retry of the same confirmed transaction must not list it twice.
  const { error } = row.tx_hash
    ? await supabase.from(activityTable).upsert(row, {
        ignoreDuplicates: true,
        onConflict: "wallet_address,source,tx_hash",
      })
    : await supabase.from(activityTable).insert(row);

  if (error) throw new Error(error.message);
}

// ── Reads: one loader per feature ───────────────────────────────────────

async function loadLedger(db: Supabase, wallet: string, limit = sourceLimit) {
  const { data, error } = await db
    .from(activityTable)
    .select("*")
    .eq("wallet_address", wallet)
    .order("occurred_at", { ascending: false })
    .limit(limit * 2);
  if (error) throw error;

  return (data ?? []).map(
    (row: Row): AccountActivityEntry => ({
      id: `ledger:${row.id}`,
      source: row.source as ActivitySource,
      direction: (row.direction as ActivityDirection) ?? "out",
      title: str(row.title) ?? "",
      counterparty: str(row.counterparty),
      amount: str(row.amount),
      token: str(row.token),
      amountIn: str((row.metadata as Row | null)?.amountIn),
      tokenIn: str((row.metadata as Row | null)?.tokenIn),
      batch: readBatchDetails(row.metadata as Row | null),
      txHashes: hashes(row.tx_hash),
      occurredAt: str(row.occurred_at),
      mirrored: row.mirrored === true,
    }),
  );
}

const saveTitles: Record<string, (pocket: string) => string> = {
  DEPOSIT: (pocket) => `Saved to ${pocket}`,
  WITHDRAWAL: (pocket) => `Withdrew from ${pocket}`,
  SPEND_SAVE: (pocket) => `Spend & Save round-up to ${pocket}`,
  REFUND: (pocket) => `Refund from ${pocket}`,
  REVERSAL: (pocket) => `Reversal on ${pocket}`,
  ADJUSTMENT: (pocket) => `Adjustment on ${pocket}`,
};

async function loadSave(db: Supabase, wallet: string, limit = sourceLimit) {
  const { data, error } = await db
    .from("savings_transactions")
    .select(
      "id,type,amount,currency,tx_hash,related_payment_tx_hash,created_at,confirmed_at,savings_pockets(name)",
    )
    .eq("owner_wallet", wallet)
    .eq("status", "COMPLETED")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row: Row): AccountActivityEntry => {
    const type = String(row.type);
    const pocket =
      str(one(row.savings_pockets as Row | Row[] | null)?.name) ?? "a pocket";
    return {
      id: `save:${row.id}`,
      source: "save",
      direction: type === "DEPOSIT" || type === "SPEND_SAVE" ? "out" : "in",
      title: (saveTitles[type] ?? saveTitles.ADJUSTMENT)(pocket),
      counterparty: pocket,
      amount: str(row.amount),
      token: str(row.currency),
      // Spend & Save rides on the payment that triggered it; claim only its
      // own transfer so the payment keeps its own feature label.
      txHashes: hashes(row.tx_hash),
      occurredAt: str(row.confirmed_at) ?? str(row.created_at),
    };
  });
}

async function loadEarn(db: Supabase, wallet: string, limit = sourceLimit) {
  const [deposits, withdrawals] = await Promise.all(
    ["earn_deposits", "earn_withdrawals"].map((table) =>
      db
        .from(table)
        .select("id,assets,tx_hash,timestamp,created_at")
        .ilike("wallet_address", wallet)
        .order("created_at", { ascending: false })
        .limit(limit),
    ),
  );
  if (deposits.error) throw deposits.error;
  if (withdrawals.error) throw withdrawals.error;

  const map =
    (kind: "deposit" | "withdrawal") =>
    (row: Row): AccountActivityEntry => ({
      id: `earn:${kind}:${row.id}`,
      source: "earn",
      direction: kind === "deposit" ? "out" : "in",
      title: kind === "deposit" ? "Invested in vault" : "Withdrew from Invest vault",
      counterparty: "Invest vault",
      amount: str(row.assets),
      token: "USDC",
      txHashes: hashes(row.tx_hash),
      occurredAt: str(row.timestamp) ?? str(row.created_at),
    });

  return [
    ...(deposits.data ?? []).map(map("deposit")),
    ...(withdrawals.data ?? []).map(map("withdrawal")),
  ];
}

async function loadRecurePay(db: Supabase, wallet: string, limit = sourceLimit) {
  const { data, error } = await db
    .from("recurring_executions")
    .select(
      "id,tx_hash,completed_at,created_at,recurring_schedules(amount,token_symbol,beneficiary_username,beneficiary_label,beneficiary_wallet)",
    )
    .eq("owner_wallet", wallet)
    // "confirmed": paid by the user from the page. "COMPLETED": settled in the
    // background by Autopay. Both are finished payments.
    .in("status", ["confirmed", "COMPLETED"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row: Row): AccountActivityEntry => {
    const schedule = one(row.recurring_schedules as Row | Row[] | null);
    const username = str(schedule?.beneficiary_username);
    const to =
      (username ? `${username.replace(/^@/, "")}.one` : null) ??
      str(schedule?.beneficiary_label) ??
      str(schedule?.beneficiary_wallet);
    return {
      id: `recurepay:${row.id}`,
      source: "recurepay",
      direction: "out",
      title: to ? `Scheduled payment to ${to}` : "Scheduled payment",
      counterparty: to,
      amount: str(schedule?.amount),
      token: str(schedule?.token_symbol),
      txHashes: hashes(row.tx_hash),
      occurredAt: str(row.completed_at) ?? str(row.created_at),
    };
  });
}

async function loadInvoicesReceived(db: Supabase, wallet: string, limit = sourceLimit) {
  const { data, error } = await db
    .from("business_invoices")
    .select(
      "id,invoice_number,customer_name,customer_company,business_invoice_payments(id,tx_hash,amount,asset,status,paid_at)",
    )
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).flatMap((invoice: Row) => {
    const payments = (invoice.business_invoice_payments as Row[] | null) ?? [];
    const customer =
      str(invoice.customer_company) ?? str(invoice.customer_name);
    const number = str(invoice.invoice_number);
    return payments
      .filter((payment) => String(payment.status) === "CONFIRMED")
      .map(
        (payment): AccountActivityEntry => ({
          id: `invoice:${payment.id}`,
          source: "invoice",
          direction: "in",
          title: number ? `Invoice ${number} paid` : "Invoice paid",
          counterparty: customer,
          amount: str(payment.amount),
          token: str(payment.asset),
          txHashes: hashes(payment.tx_hash),
          occurredAt: str(payment.paid_at),
        }),
      );
  });
}

async function loadCheckout(db: Supabase, wallet: string, limit = sourceLimit) {
  const { data, error } = await db
    .from("business_charges")
    .select("id,public_id,kind,note,business_charge_payments(id,tx_hash,amount,asset,status,payer_wallet,paid_at)")
    .eq("wallet_address", wallet)
    .neq("amount_received", "0")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).flatMap((charge: Row) => {
    const payments = (charge.business_charge_payments as Row[] | null) ?? [];
    const storefront = String(charge.kind) === "STOREFRONT";
    const note = str(charge.note);
    return payments
      .filter((payment) => String(payment.status) === "CONFIRMED")
      .map(
        (payment): AccountActivityEntry => ({
          id: `checkout:${payment.id}`,
          source: "checkout",
          direction: "in",
          title: note ?? (storefront ? "Storefront payment" : "Checkout payment"),
          counterparty: str(payment.payer_wallet)?.toLowerCase() ?? null,
          amount: str(payment.amount),
          token: str(payment.asset),
          txHashes: hashes(payment.tx_hash),
          occurredAt: str(payment.paid_at),
        }),
      );
  });
}

async function loadPayroll(db: Supabase, wallet: string, limit = sourceLimit) {
  const [runs, received] = await Promise.all([
    db
      .from("payroll_runs")
      .select(
        "id,name,asset,total_amount,total_fees,recipient_count,completed_at,updated_at,payroll_items(blockchain_tx_hash,status,total_amount,recipient_name_snapshot,recipient_destination_snapshot)",
      )
      .eq("account_id", wallet)
      .in("status", ["COMPLETED", "PARTIALLY_COMPLETED"])
      .order("updated_at", { ascending: false })
      .limit(limit),
    db
      .from("payroll_items")
      .select(
        "id,total_amount,asset,blockchain_tx_hash,completed_at,settled_at,updated_at,payroll_runs(name,account_id)",
      )
      .ilike("recipient_destination_snapshot", wallet)
      .eq("status", "COMPLETED")
      .order("updated_at", { ascending: false })
      .limit(limit),
  ]);
  if (runs.error) throw runs.error;
  if (received.error) throw received.error;

  const paid = (runs.data ?? []).map((run: Row): AccountActivityEntry => {
    const items = ((run.payroll_items as Row[] | null) ?? []).filter(
      (item) => String(item.status) === "COMPLETED",
    );
    const count = items.length || Number(run.recipient_count) || 0;
    // Everyone the run paid, so its receipt lists the team, not one transfer.
    const recipients = items.flatMap((item) => {
      const wallet = str(item.recipient_destination_snapshot);
      const amount = amountText(item.total_amount);
      return wallet && amount
        ? [{ wallet, amount, label: str(item.recipient_name_snapshot) }]
        : [];
    });
    const asset = str(run.asset) ?? "USDC";
    const fee = amountText(run.total_fees);
    return {
      id: `payroll:run:${run.id}`,
      source: "payroll",
      direction: "out",
      title: `Payroll run · ${str(run.name) ?? "Untitled"}`,
      counterparty: `${count} ${count === 1 ? "recipient" : "recipients"}`,
      amount: str(run.total_amount),
      token: str(run.asset),
      txHashes: hashes(...items.map((item) => item.blockchain_tx_hash)),
      occurredAt: str(run.completed_at) ?? str(run.updated_at),
      batch: recipients.length
        ? {
            recipients,
            fee: fee ? `${fee} ${asset}` : null,
            mode: "Business wallet",
            kind: "payroll",
            name: str(run.name),
          }
        : null,
    };
  });

  const earned = (received.data ?? []).map((item: Row): AccountActivityEntry => {
    const run = one(item.payroll_runs as Row | Row[] | null);
    return {
      id: `payroll:item:${item.id}`,
      source: "payroll",
      direction: "in",
      title: `Salary received · ${str(run?.name) ?? "Payroll"}`,
      counterparty: str(run?.account_id),
      amount: str(item.total_amount),
      token: str(item.asset),
      txHashes: hashes(item.blockchain_tx_hash),
      occurredAt:
        str(item.settled_at) ?? str(item.completed_at) ?? str(item.updated_at),
    };
  });

  return [...paid, ...earned];
}

async function loadAllie(db: Supabase, wallet: string, limit = sourceLimit) {
  const { data, error } = await db
    .from("payment_intents")
    .select(
      "intent_id,recipient,asset,amount_units,metadata,completed_at,updated_at,payment_settlements(tx_hash,settled_at)",
    )
    .ilike("initiator_id", wallet)
    .eq("initiator_type", "agent")
    // The execute route leaves a paid intent at "submitted" (its settlement
    // carries the hash); nothing moves it on to "completed". Count every
    // stage past submission, as ALLIE's own spend context does.
    .in("status", ["submitted", "confirming", "completed"])
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const settled = (data ?? []).filter((row: Row) =>
    ((row.payment_settlements as Row[] | null) ?? []).some((s) => str(s.tx_hash)),
  );

  return settled.map((row: Row): AccountActivityEntry => {
    const settlements = (row.payment_settlements as Row[] | null) ?? [];
    const metadata = (row.metadata as Row | null) ?? {};
    const to = str(metadata.recipientLabel) ?? str(row.recipient);
    return {
      id: `agent:${row.intent_id}`,
      source: "agent",
      direction: "out",
      title: to ? `ALLIE paid ${to}` : "ALLIE payment",
      counterparty: to,
      amount: fromUnits(row.amount_units),
      token: str(row.asset),
      txHashes: hashes(...settlements.map((s) => s.tx_hash)),
      occurredAt:
        str(settlements[0]?.settled_at) ??
        str(row.completed_at) ??
        str(row.updated_at),
    };
  });
}

const circleTitles: Record<string, string> = {
  contribution: "Contributed to",
  payment: "Paid from",
  withdrawal: "Withdrew from",
  refund: "Refund from",
  reversal: "Reversal in",
  yield_adjustment: "Yield in",
};

async function loadCircle(db: Supabase, wallet: string, limit = sourceLimit) {
  const { data, error } = await db
    .from("circle_ledger_entries")
    .select(
      "id,entry_type,product_type,amount_units,asset,tx_hash,created_at,circles(name)",
    )
    .ilike("actor_user_wallet", wallet)
    .eq("status", "confirmed")
    .neq("entry_type", "failed_transaction")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row: Row): AccountActivityEntry => {
    const type = String(row.entry_type);
    const circle = str(one(row.circles as Row | Row[] | null)?.name) ?? "a circle";
    return {
      id: `circle:${row.id}`,
      source: "circle",
      direction: type === "contribution" ? "out" : "in",
      title: `${circleTitles[type] ?? "Activity in"} ${circle}`,
      counterparty: circle,
      amount: fromUnits(row.amount_units),
      token: str(row.asset),
      txHashes: hashes(row.tx_hash),
      occurredAt: str(row.created_at),
    };
  });
}

async function loadPointsPurchases(db: Supabase, wallet: string, limit = sourceLimit) {
  const { data, error } = await db
    .from("swiftpoints_purchases")
    .select("id,points,usdc_amount,tx_hash,created_at")
    .eq("wallet_address", wallet)
    .eq("status", "COMPLETED")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  // The payment is a plain USDC transfer to the points treasury; claiming its
  // hash here keeps it from being listed as a send to whoever holds that wallet.
  return (data ?? []).map(
    (row: Row): AccountActivityEntry => ({
      id: `points:${row.id}`,
      source: "points",
      direction: "out",
      title: `Bought ${Number(row.points).toLocaleString("en-US")} OnePoints`,
      counterparty: "OnePoints",
      amount: amountText(row.usdc_amount),
      token: "USDC",
      txHashes: hashes(row.tx_hash),
      occurredAt: str(row.created_at),
    }),
  );
}

const loaders: Array<[string, (db: Supabase, wallet: string, limit?: number) => Promise<AccountActivityEntry[]>]> = [
  ["ledger", loadLedger],
  ["save", loadSave],
  ["earn", loadEarn],
  ["recurepay", loadRecurePay],
  ["invoice", loadInvoicesReceived],
  ["checkout", loadCheckout],
  ["payroll", loadPayroll],
  ["agent", loadAllie],
  ["circle", loadCircle],
  ["points", loadPointsPurchases],
];

/**
 * Every feature's confirmed activity for one wallet. A feature whose table is
 * missing or failing is skipped rather than blanking the whole feed.
 */
export async function listAccountActivity(
  walletAddress: string,
  options: {
    /** Rows read per feature, newest first (a statement reads further back). */
    limit?: number;
    /** Keep only entries in this window; undated entries are kept. */
    from?: Date;
    to?: Date;
  } = {},
) {
  const wallet = walletAddress.toLowerCase();
  const db = createSupabaseAdminClient();
  const results = await Promise.allSettled(
    loaders.map(([, load]) => load(db, wallet, options.limit ?? sourceLimit)),
  );

  const entries: AccountActivityEntry[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      entries.push(...result.value);
    } else {
      console.warn(
        `[account-activity] ${loaders[index][0]} skipped:`,
        result.reason instanceof Error
          ? result.reason.message
          : (result.reason as { message?: string })?.message ?? result.reason,
      );
    }
  });

  const from = options.from?.getTime() ?? -Infinity;
  const to = options.to?.getTime() ?? Infinity;
  return dedupeByTxHash(entries).filter((entry) => {
    const at = entry.occurredAt ? Date.parse(entry.occurredAt) : Number.NaN;
    return Number.isNaN(at) || (at >= from && at <= to);
  });
}

/**
 * A browser-reported ledger row and a feature's own record can describe the
 * same transaction (e.g. a RecurePay run). Keep the feature's own record, as
 * it carries the richer title, unless the ledger row is the only one.
 *
 * Only the same feature counts: a bundled Send & Save is one transaction
 * holding both the payment and the round-up, and the Save record must not
 * swallow the Send row.
 */
function dedupeByTxHash(entries: AccountActivityEntry[]) {
  const claimed = new Set<string>();
  for (const entry of entries) {
    if (!entry.id.startsWith("ledger:")) {
      entry.txHashes.forEach((hash) => claimed.add(`${entry.source}:${hash}`));
    }
  }

  return entries.filter(
    (entry) =>
      !entry.id.startsWith("ledger:") ||
      entry.txHashes.length === 0 ||
      !entry.txHashes.every((hash) => claimed.has(`${entry.source}:${hash}`)),
  );
}
