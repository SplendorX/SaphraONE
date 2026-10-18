// Server-only. Rows behind the Naira ramp (packages/database/supabase/ramp.sql).
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import type { RampOrderRow } from "@/lib/ramp/types";

export const rampTables = {
  orders: process.env.SUPABASE_RAMP_ORDERS_TABLE ?? "ramp_orders",
  beneficiaries: process.env.SUPABASE_RAMP_BENEFICIARIES_TABLE ?? "ramp_beneficiaries",
  webhookEvents: process.env.SUPABASE_RAMP_WEBHOOK_EVENTS_TABLE ?? "ramp_webhook_events",
  profiles: process.env.SUPABASE_PROFILES_TABLE ?? "profiles",
};

export type BeneficiaryRow = {
  id: string;
  wallet_address: string;
  currency: "NGN";
  bank_code: string;
  bank_name: string | null;
  account_number: string;
  account_name: string;
  /** Which verified name the account matched (kyb.sql). Null before KYC. */
  name_match?: "OWNER" | "COMPANY" | null;
  created_at: string;
};

type DbError = { code?: string; message?: string } | null;

function db() {
  return createSupabaseAdminClient();
}

function fail(error: DbError, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export function isUniqueViolation(error: DbError) {
  return error?.code === "23505" || /duplicate key/i.test(error?.message ?? "");
}

// ── Orders ──────────────────────────────────────────────────────────────

export type NewOrder = Pick<RampOrderRow, "wallet_address" | "direction" | "environment"> &
  Partial<
    Pick<
      RampOrderRow,
      | "fiat_amount"
      | "usdc_amount"
      | "total_to_pay"
      | "quoted_rate"
      | "quoted_fee"
      | "quoted_receivable"
      | "beneficiary_id"
      | "beneficiary_snapshot"
      | "idempotency_key"
    >
  >;

/** The new row, or null when the idempotency key was already used. */
export async function insertOrder(order: NewOrder): Promise<RampOrderRow | null> {
  const { data, error } = await db().from(rampTables.orders).insert(order).select("*").single();
  if (error) {
    if (isUniqueViolation(error) && order.idempotency_key) return null;
    fail(error, "Could not save the order.");
  }
  return data as RampOrderRow;
}

export async function findOrderForWallet(id: string, wallet: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db()
    .from(rampTables.orders)
    .select("*")
    .eq("id", id)
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (error) fail(error, "Could not load the order.");
  return (data as RampOrderRow | null) ?? null;
}

export async function findOrderByIdempotencyKey(wallet: string, key: string) {
  const { data, error } = await db()
    .from(rampTables.orders)
    .select("*")
    .eq("wallet_address", wallet)
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error) fail(error, "Could not load the order.");
  return (data as RampOrderRow | null) ?? null;
}

export async function findOrderByProviderId(providerOrderId: string) {
  const { data, error } = await db()
    .from(rampTables.orders)
    .select("*")
    .eq("provider", "CENTIIV")
    .eq("provider_order_id", providerOrderId)
    .maybeSingle();
  if (error) fail(error, "Could not load the order.");
  return (data as RampOrderRow | null) ?? null;
}

/**
 * Applies `patch`. With `expectStatus`, only while the row still has that
 * status, so two syncs racing can't apply an older answer over a newer one.
 * Returns the updated row, or null when the guard didn't match.
 */
export async function updateOrder(
  id: string,
  patch: Partial<RampOrderRow>,
  expectStatus?: RampOrderRow["status"],
): Promise<RampOrderRow | null> {
  let query = db()
    .from(rampTables.orders)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (expectStatus) query = query.eq("status", expectStatus);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) fail(error, "Could not update the order.");
  return (data as RampOrderRow | null) ?? null;
}

export async function listOrders(wallet: string, limit = 20) {
  const { data, error } = await db()
    .from(rampTables.orders)
    .select("*")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) fail(error, "Could not load orders.");
  return (data ?? []) as RampOrderRow[];
}

/** Open orders not synced since `before`, oldest first. */
export async function listStaleOpenOrders(before: Date, limit = 50) {
  const { data, error } = await db()
    .from(rampTables.orders)
    .select("*")
    .in("status", ["PENDING", "PROCESSING"])
    .or(`last_synced_at.is.null,last_synced_at.lt.${before.toISOString()}`)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) fail(error, "Could not load open orders.");
  return (data ?? []) as RampOrderRow[];
}

/**
 * Records the user's off-ramp transfer once. "claimed" when it is now on
 * this order, "taken" when another order already holds that hash.
 */
export async function claimUserTxHash(id: string, txHash: string): Promise<"claimed" | "taken" | "other"> {
  const { data, error } = await db()
    .from(rampTables.orders)
    .update({ user_tx_hash: txHash, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("user_tx_hash", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) return "taken";
    fail(error, "Could not record the transfer.");
  }
  return data ? "claimed" : "other";
}

export async function readProfileContact(wallet: string) {
  const { data } = await db()
    .from(rampTables.profiles)
    .select("display_name, contact_email, phone")
    .eq("wallet_address", wallet)
    .maybeSingle();
  const row = (data ?? {}) as Record<string, unknown>;
  const read = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return { fullName: read(row.display_name), email: read(row.contact_email), phone: read(row.phone) };
}

// ── Beneficiaries ───────────────────────────────────────────────────────

export async function listBeneficiaryRows(wallet: string) {
  const { data, error } = await db()
    .from(rampTables.beneficiaries)
    .select("*")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false });
  if (error) fail(error, "Could not load bank accounts.");
  return (data ?? []) as BeneficiaryRow[];
}

export async function findBeneficiary(id: string, wallet: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db()
    .from(rampTables.beneficiaries)
    .select("*")
    .eq("id", id)
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (error) fail(error, "Could not load the bank account.");
  return (data as BeneficiaryRow | null) ?? null;
}

export async function upsertBeneficiary(
  row: Omit<BeneficiaryRow, "id" | "created_at">,
): Promise<BeneficiaryRow> {
  const save = (values: typeof row) =>
    db()
      .from(rampTables.beneficiaries)
      .upsert(values, { onConflict: "wallet_address,bank_code,account_number" })
      .select("*")
      .single();
  const { name_match: nameMatch, ...base } = row;
  let { data, error } = await save(nameMatch ? row : base);
  // name_match comes with kyb.sql. Without it, save the account anyway:
  // createOfframp re-checks the name on every payout.
  if (error && nameMatch && /name_match/.test(error.message ?? "")) ({ data, error } = await save(base));
  if (error) fail(error, "Could not save the bank account.");
  return data as BeneficiaryRow;
}

export async function deleteBeneficiaryRow(id: string, wallet: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const { data, error } = await db()
    .from(rampTables.beneficiaries)
    .delete()
    .eq("id", id)
    .eq("wallet_address", wallet)
    .select("id");
  if (error) fail(error, "Could not remove the bank account.");
  return (data ?? []).length > 0;
}

// ── Webhook events ──────────────────────────────────────────────────────

/** False when this delivery (svix-id) was already stored. */
export async function insertWebhookEvent(input: {
  eventId: string;
  providerOrderId: string | null;
  payload: unknown;
}) {
  const { error } = await db().from(rampTables.webhookEvents).insert({
    provider: "CENTIIV",
    event_id: input.eventId,
    provider_order_id: input.providerOrderId,
    payload: input.payload ?? {},
  });
  if (error) {
    if (isUniqueViolation(error)) return false;
    fail(error, "Could not store the webhook.");
  }
  return true;
}

export async function markWebhookProcessed(eventId: string) {
  await db()
    .from(rampTables.webhookEvents)
    .update({ processed_at: new Date().toISOString() })
    .eq("provider", "CENTIIV")
    .eq("event_id", eventId);
}
