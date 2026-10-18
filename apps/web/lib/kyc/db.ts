// Server-only. Rows behind personal KYC and business KYB.
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const kycTables = {
  profiles: "kyc_profiles",
  attempts: "kyc_attempts",
  kyb: "kyb_profiles",
  rampOrders: process.env.SUPABASE_RAMP_ORDERS_TABLE ?? "ramp_orders",
};

export type KycStatus = "NONE" | "PENDING" | "VERIFIED" | "MANUAL_REVIEW" | "REJECTED";
export type KycIdType = "BVN" | "NIN";

export type KycProfileRow = {
  wallet_address: string;
  country: string;
  tier: number;
  status: KycStatus;
  provider: string;
  id_type: KycIdType | null;
  id_hash: string | null;
  id_last4: string | null;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  dob: string | null;
  phone_e164: string | null;
  phone_verified_at: string | null;
  otp_provider: string | null;
  tier1_verified_at: string | null;
  tier2_verified_at: string | null;
  liveness_score: number | null;
  face_match_score: number | null;
  flags: Record<string, unknown>;
  provider_ref: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type KybLevel = "NONE" | "BASIC" | "FULL";

export type KybDocument = { path: string; name: string; type: string; size: number; uploaded_at: string };

export type KybProfileRow = {
  wallet_address: string;
  country: string;
  level: KybLevel;
  status: KycStatus;
  company_type: "RC" | "BN" | "IT" | null;
  rc_number: string | null;
  company_name: string | null;
  registration_date: string | null;
  cac_status: string | null;
  tin_hash: string | null;
  tin_last4: string | null;
  tin_name: string | null;
  director_match: Record<string, unknown> | null;
  flags: Record<string, unknown>;
  /** Review papers in the private kyb-documents bucket (kyb.sql). */
  documents?: KybDocument[];
  provider_ref_cac: string | null;
  provider_ref_tin: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type DbError = { code?: string; message?: string } | null;

function db() {
  return createSupabaseAdminClient();
}

export function missingKycTable(error: DbError) {
  return Boolean(error && (/kyc_profiles|kyc_attempts|kyb_profiles/.test(error.message ?? "") || error.code === "42P01"));
}

function nowIso() {
  return new Date().toISOString();
}

export async function loadKycProfile(wallet: string) {
  const { data, error } = await db()
    .from(kycTables.profiles)
    .select("*")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();
  if (missingKycTable(error)) return { ready: false as const, row: null };
  if (error) throw new Error(error.message);
  return { ready: true as const, row: (data as KycProfileRow | null) ?? null };
}

export async function upsertKycProfile(wallet: string, patch: Partial<KycProfileRow>) {
  const owner = wallet.toLowerCase();
  const existing = await loadKycProfile(owner);
  if (!existing.ready) throw new Error("KYC isn't set up yet: run packages/database/supabase/kyc.sql.");
  const row = {
    wallet_address: owner,
    country: "NG",
    ...existing.row,
    ...patch,
    updated_at: nowIso(),
    created_at: existing.row?.created_at ?? nowIso(),
  };
  const { data, error } = await db().from(kycTables.profiles).upsert(row, { onConflict: "wallet_address" }).select("*").single();
  if (error) throw new Error(error.message);
  return data as KycProfileRow;
}

export async function recordAttempt(input: {
  wallet: string;
  subject?: "PERSON" | "BUSINESS";
  step: string;
  idHash?: string | null;
  result: "PASS" | "FAIL" | "ERROR";
  reasonCode?: string | null;
  providerCode?: string | null;
  providerRef?: string | null;
}) {
  const { error } = await db().from(kycTables.attempts).insert({
    wallet_address: input.wallet.toLowerCase(),
    subject: input.subject ?? "PERSON",
    step: input.step,
    id_hash: input.idHash ?? null,
    result: input.result,
    reason_code: input.reasonCode ?? null,
    provider_code: input.providerCode ?? null,
    provider_ref: input.providerRef ?? null,
  });
  if (error && !missingKycTable(error)) console.warn("[kyc] attempt", error.message);
}

export async function countAttempts(wallet: string, step: string, result: "FAIL" | "ERROR" | "PASS", sinceIso: string) {
  const { count, error } = await db()
    .from(kycTables.attempts)
    .select("id", { count: "exact", head: true })
    .eq("wallet_address", wallet.toLowerCase())
    .eq("step", step)
    .eq("result", result)
    .gte("created_at", sinceIso);
  // Fail closed: an unreadable attempt log must not lift the attempt limits.
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function countHashFails(idHash: string, sinceIso: string) {
  const { count, error } = await db()
    .from(kycTables.attempts)
    .select("id", { count: "exact", head: true })
    .eq("id_hash", idHash)
    .eq("result", "FAIL")
    .gte("created_at", sinceIso);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function findVerifiedHash(idHash: string, wallet: string) {
  const { data, error } = await db()
    .from(kycTables.profiles)
    .select("wallet_address")
    .eq("id_hash", idHash)
    .eq("status", "VERIFIED")
    .neq("wallet_address", wallet.toLowerCase())
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function listKybReviewQueue(status: "MANUAL_REVIEW" | "ALL") {
  let query = db().from(kycTables.kyb).select("*").order("updated_at", { ascending: false }).limit(100);
  if (status === "MANUAL_REVIEW") query = query.eq("status", "MANUAL_REVIEW");
  const { data, error } = await query;
  if (error) throw new Error(missingKycTable(error) ? "KYB isn't set up yet." : error.message);
  return (data ?? []) as KybProfileRow[];
}

export async function listReviewQueue(status: "MANUAL_REVIEW" | "ALL") {
  let query = db().from(kycTables.profiles).select("*").order("updated_at", { ascending: false }).limit(100);
  if (status === "MANUAL_REVIEW") query = query.eq("status", "MANUAL_REVIEW");
  const { data, error } = await query;
  if (error) throw new Error(missingKycTable(error) ? "KYC isn't set up yet." : error.message);
  return (data ?? []) as KycProfileRow[];
}

export async function listAttemptsFor(wallet: string, limit = 20) {
  const { data, error } = await db()
    .from(kycTables.attempts)
    .select("step, result, reason_code, provider_code, created_at")
    .eq("wallet_address", wallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

const countedStatuses = ["PENDING", "PROCESSING", "FULFILLED"];

export async function sumRampVolume(wallet: string, sinceIso: string) {
  const { data, error } = await db()
    .from(kycTables.rampOrders)
    .select("direction, fiat_amount, usdc_amount, status")
    .eq("wallet_address", wallet.toLowerCase())
    .gte("created_at", sinceIso);
  // Fail closed: an unreadable order history must not lift the daily limits.
  if (error) throw new Error(error.message);
  let onrampNgn = 0;
  let offrampUsdc = 0;
  for (const row of (data ?? []) as { direction: string; fiat_amount: string | null; usdc_amount: string | null; status: string }[]) {
    if (!countedStatuses.includes(row.status)) continue;
    if (row.direction === "ONRAMP") onrampNgn += Number(row.fiat_amount ?? 0);
    if (row.direction === "OFFRAMP") offrampUsdc += Number(row.usdc_amount ?? 0);
  }
  return { onrampNgn, offrampUsdc };
}

export async function loadKybProfile(wallet: string) {
  const { data, error } = await db()
    .from(kycTables.kyb)
    .select("*")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();
  if (missingKycTable(error)) return { ready: false as const, row: null };
  if (error) throw new Error(error.message);
  return { ready: true as const, row: (data as KybProfileRow | null) ?? null };
}

export async function upsertKybProfile(wallet: string, patch: Partial<KybProfileRow>) {
  const owner = wallet.toLowerCase();
  const existing = await loadKybProfile(owner);
  if (!existing.ready) throw new Error("KYB isn't set up yet: run packages/database/supabase/kyb.sql.");
  const row = {
    wallet_address: owner,
    country: "NG",
    ...existing.row,
    ...patch,
    updated_at: nowIso(),
    created_at: existing.row?.created_at ?? nowIso(),
  };
  const { data, error } = await db().from(kycTables.kyb).upsert(row, { onConflict: "wallet_address" }).select("*").single();
  if (error) throw new Error(error.message);
  return data as KybProfileRow;
}

export async function findVerifiedCompany(companyType: string, rcNumber: string, wallet: string) {
  const { data, error } = await db()
    .from(kycTables.kyb)
    .select("wallet_address")
    .eq("company_type", companyType)
    .eq("rc_number", rcNumber)
    .eq("status", "VERIFIED")
    .neq("wallet_address", wallet.toLowerCase())
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
