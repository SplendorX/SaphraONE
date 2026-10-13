// Server-only. See lib/tx-approval/shared.ts for the overview.
import crypto from "node:crypto";

import { getSaphraSendAddress } from "@/lib/contracts";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  decodeCall,
  hashCall,
  paymentsOf,
  usdValue,
  type DecodedCall,
} from "@/lib/tx-approval/decode";
import type { TxCall } from "@/lib/tx-approval/shared";

/** Time to finish approving (long enough to read an emailed code). */
export const PENDING_TTL_MS = 10 * 60_000;
/** Time to use an approval once given. */
export const APPROVED_TTL_MS = 2 * 60_000;
/** Wrong emailed codes before the approval is thrown away. */
const EMAIL_ATTEMPTS = 5;
/** Calls one approval can cover (a payroll or BulkPay approve + batch, a bridge, Earn). */
export const MAX_USES = 12;

function envUsd(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** The risk limits, in US dollars. Above them, an emailed code is needed too. */
export function riskLimits() {
  return {
    daily: envUsd("TX_APPROVAL_DAILY_USD", 5_000),
    large: envUsd("TX_APPROVAL_LARGE_USD", 1_000),
    newRecipient: envUsd("TX_APPROVAL_NEW_RECIPIENT_USD", 100),
  };
}

export type TxApprovalRow = {
  amount: number | null;
  amount_usd: number | null;
  approved_at: string | null;
  call_hashes: string[];
  destination: string | null;
  email_attempts: number;
  email_code_hash: string | null;
  expires_at: string;
  id: string;
  kind: "call" | "flow" | "send" | "sign" | "swap";
  max_uses: number;
  method: string | null;
  method_verified: boolean;
  needs_email_code: boolean;
  owner_wallet: string;
  paid_total: number | null;
  passkey_challenge: string | null;
  recipients: string[];
  status: "approved" | "pending";
  title: string;
  token: string | null;
  updated_at: string;
  uses: number;
  uses_log: unknown[];
  wallet_id: string;
};

const columns =
  "id, owner_wallet, wallet_id, kind, title, amount, token, amount_usd, destination, recipients, paid_total, call_hashes, max_uses, uses, status, method, method_verified, needs_email_code, email_code_hash, email_attempts, passkey_challenge, uses_log, expires_at, approved_at, updated_at";

function table() {
  return createSupabaseAdminClient().from("tx_approvals");
}

/** SaphraONE's own fee wallets: paying them is never a "new recipient". */
function platformAddresses() {
  return new Set(
    [
      process.env["NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT"],
      process.env["SWIFTPAY_FEE_RECIPIENT"],
    ]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
}

/**
 * Contracts SaphraONE trusts to spend a user's tokens: its own send router,
 * BulkPay, Save and Earn vaults and the RecurePay / payroll executors, plus
 * TX_APPROVAL_TRUSTED_SPENDERS (comma-separated; for Circle's swap and bridge
 * contracts once the logs have shown which they are).
 */
export function trustedSpenders() {
  const values = [
    process.env["NEXT_PUBLIC_SAPHRA_SEND_ADDRESS"],
    process.env["NEXT_PUBLIC_SWIFTPAY_SEND_ADDRESS"],
    process.env["SWIFTPAY_SEND_ADDRESS"],
    process.env["NEXT_PUBLIC_SAPHRA_BULKPAY_ADDRESS"],
    process.env["NEXT_PUBLIC_SWIFTBATCH_ADDRESS"],
    process.env["NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS"],
    process.env["NEXT_PUBLIC_EARN_VAULT_ADDRESS"],
    process.env["NEXT_PUBLIC_EARN_AUTOSAVE_EXECUTOR_ADDRESS"],
    process.env["NEXT_PUBLIC_SAPHRA_PAYROLL_ADDRESS"],
    process.env["NEXT_PUBLIC_SWIFTPAY_PAYROLL_EXECUTOR_ADDRESS"],
    process.env["NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS"],
    process.env["NEXT_PUBLIC_SWIFTRECUREPAY_EXECUTOR_ADDRESS"],
    ...(process.env["NEXT_PUBLIC_EARN_AUTOSAVE_EXECUTORS"] ?? "").split(","),
    ...(process.env["TX_APPROVAL_TRUSTED_SPENDERS"] ?? "").split(","),
  ];
  return new Set(
    values
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value && /^0x[0-9a-f]{40}$/.test(value))),
  );
}

/** Refuse approvals to contracts not on the trusted list (else only log them). */
function strictSpenders() {
  return process.env["TX_APPROVAL_STRICT_SPENDERS"]?.trim() === "true";
}

/**
 * Whether this payment also needs an emailed code: a large amount, a first
 * payment to a recipient, or past the day's total. An amount the server
 * can't price (an unknown contract) is judged on what the page declared.
 */
export async function needsEmailCode(input: {
  amountUsd: number | null;
  destinations: string[];
  ownerWallet: string;
}) {
  const limits = riskLimits();
  const usd = input.amountUsd ?? 0;
  if (usd >= limits.large) return true;

  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: today, error } = await table()
    .select("amount_usd")
    .eq("owner_wallet", input.ownerWallet)
    .eq("status", "approved")
    .gte("created_at", since);
  if (error) throw error;
  const spent = (today ?? []).reduce(
    (sum, row) => sum + (Number((row as { amount_usd: number | null }).amount_usd) || 0),
    0,
  );
  if (spent + usd > limits.daily) return true;

  const platform = platformAddresses();
  const destinations = [...new Set(input.destinations.map((d) => d.toLowerCase()))].filter(
    (destination) => !platform.has(destination) && destination !== input.ownerWallet,
  );
  if (destinations.length > 0 && usd >= limits.newRecipient) {
    const [single, many] = await Promise.all([
      table()
        .select("destination")
        .eq("owner_wallet", input.ownerWallet)
        .in("destination", destinations)
        .gt("uses", 0),
      table()
        .select("recipients")
        .eq("owner_wallet", input.ownerWallet)
        .overlaps("recipients", destinations)
        .gt("uses", 0),
    ]);
    if (single.error) throw single.error;
    if (many.error) throw many.error;
    const known = new Set<string>([
      ...(single.data ?? []).map((row) => (row as { destination: string }).destination),
      ...(many.data ?? []).flatMap((row) => (row as { recipients: string[] }).recipients ?? []),
    ]);
    if (destinations.some((destination) => !known.has(destination))) return true;
  }
  return false;
}

export async function createApproval(input: {
  amount: number | null;
  amountUsd: number | null;
  callHashes: string[];
  destination: string | null;
  kind: TxApprovalRow["kind"];
  maxUses: number;
  needsEmailCode: boolean;
  ownerWallet: string;
  recipients: string[];
  title: string;
  token: string | null;
  walletId: string;
}) {
  const { data, error } = await table()
    .insert({
      amount: input.amount,
      amount_usd: input.amountUsd,
      call_hashes: input.callHashes,
      destination: input.destination,
      expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
      kind: input.kind,
      max_uses: Math.min(Math.max(Math.trunc(input.maxUses), 1), MAX_USES),
      needs_email_code: input.needsEmailCode,
      owner_wallet: input.ownerWallet,
      recipients: input.recipients,
      title: input.title.slice(0, 120),
      token: input.token,
      wallet_id: input.walletId,
    })
    .select(columns)
    .single();
  if (error) throw error;
  return data as TxApprovalRow;
}

export async function findApproval(id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await table().select(columns).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as TxApprovalRow | null) ?? null;
}

export async function updateApproval(id: string, patch: Partial<TxApprovalRow>) {
  const { error } = await table()
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export function hashEmailCode(id: string, code: string) {
  return crypto.createHash("sha256").update(`swiftpay-tx:${id}:${code}`).digest("hex");
}

export function newEmailCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Whether `code` is the emailed one. A code sent while adding a security
 * email is bound to that address (`email`), so it only counts for it.
 */
export function emailCodeMatches(row: TxApprovalRow, code: string, email?: string) {
  if (!row.email_code_hash || !/^\d{6}$/.test(code)) return false;
  const expected = Buffer.from(row.email_code_hash, "hex");
  const actual = Buffer.from(hashEmailCode(email ? `${row.id}:${email}` : row.id, code), "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function recordWrongEmailCode(row: TxApprovalRow) {
  const attempts = row.email_attempts + 1;
  if (attempts >= EMAIL_ATTEMPTS) {
    await table().delete().eq("id", row.id);
    return 0;
  }
  await updateApproval(row.id, { email_attempts: attempts });
  return EMAIL_ATTEMPTS - attempts;
}

/** Mark approved once every check it needs has passed. Starts the use window. */
export async function approve(row: TxApprovalRow, method: string) {
  await updateApproval(row.id, {
    approved_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + APPROVED_TTL_MS).toISOString(),
    method,
    method_verified: true,
    status: "approved",
  });
}

export function isLive(row: TxApprovalRow) {
  return Date.parse(row.expires_at) > Date.now();
}

/** A thousandth of a cent of slack for decimal formatting. */
const AMOUNT_SLACK = 1e-6;

/**
 * Whether `call` may be made under `row`.
 *
 * - Letting a contract spend tokens: a send may only let the send router; any
 *   other kind is checked against the trusted contracts.
 * - A one-call approval then covers that exact call only.
 * - A send pays only its recipient, up to its amount.
 * - A swap never pays anyone.
 * - A flow (BulkPay, payroll, Save, Earn, bridge, RecurePay) pays only the
 *   recipients it declared, and no more than its amount in total.
 */
export function callFitsApproval(row: TxApprovalRow, call: TxCall): string | null {
  const decoded: DecodedCall = decodeCall(call);

  if (decoded.type === "approve") {
    if (row.kind === "send") {
      const router = getSaphraSendAddress().toLowerCase();
      return router && decoded.spender === router
        ? null
        : "This approval doesn't match the payment you approved.";
    }
    if (!trustedSpenders().has(decoded.spender)) {
      if (strictSpenders()) {
        return "This transaction would let an unknown contract spend your money.";
      }
      console.warn("[tx-approval] approval to an unlisted contract:", decoded.spender, decoded.token);
    }
  }

  if (row.call_hashes.length > 0) {
    return row.call_hashes.includes(hashCall(call))
      ? null
      : "This transaction doesn't match the one you approved.";
  }

  const payments = paymentsOf(decoded);

  if (row.kind === "send") {
    if (decoded.type === "approve") return null;
    if (decoded.type !== "pay") return "This transaction isn't part of the payment you approved.";
    if (!row.destination || decoded.destination !== row.destination) {
      return "The recipient doesn't match the payment you approved.";
    }
    if (row.token && decoded.token !== row.token) {
      return "The currency doesn't match the payment you approved.";
    }
    if (decoded.amount === null || row.amount === null || decoded.amount > Number(row.amount) + AMOUNT_SLACK) {
      return "The amount is more than the payment you approved.";
    }
    return null;
  }

  if (row.kind === "swap") {
    return payments.length > 0 ? "A swap can't send money to someone else." : null;
  }

  if (row.kind === "flow") {
    if (payments.length === 0) return null;
    const allowed = new Set(row.recipients ?? []);
    if (payments.some((payment) => !allowed.has(payment.destination))) {
      return "This pays someone you didn't approve.";
    }
    if (row.token && payments.some((payment) => payment.token !== row.token)) {
      return "The currency doesn't match what you approved.";
    }
    const total = paidBy(decoded);
    if (
      total === null ||
      row.amount === null ||
      Number(row.paid_total ?? 0) + total > Number(row.amount) + AMOUNT_SLACK
    ) {
      return "This pays more than you approved.";
    }
    return null;
  }

  return "This transaction doesn't match the one you approved.";
}

/** The total a call pays out, or null when part of it can't be priced. */
function paidBy(decoded: DecodedCall) {
  const payments = paymentsOf(decoded);
  if (payments.some((payment) => payment.amount === null)) return null;
  return payments.reduce((sum, payment) => sum + (payment.amount ?? 0), 0);
}

export type ApprovalClaim = { paid: number; usesAfter: number };

/**
 * Claim one use (and the amount it pays) before Circle is asked, so two calls
 * racing on one approval can't both get through. Null when another request
 * claimed it first.
 */
export async function consumeApproval(row: TxApprovalRow, call: TxCall): Promise<ApprovalClaim | null> {
  const decoded = decodeCall(call);
  const paid = paidBy(decoded) ?? 0;
  const entry = {
    action: call.action,
    at: new Date().toISOString(),
    contract: call.contractAddress?.toLowerCase() ?? null,
    paid,
    selector: decoded.type === "contract" ? decoded.selector : decoded.type,
  };
  const { data, error } = await table()
    .update({
      paid_total: Number(row.paid_total ?? 0) + paid,
      updated_at: new Date().toISOString(),
      uses: row.uses + 1,
      uses_log: [...(Array.isArray(row.uses_log) ? row.uses_log : []), entry],
    })
    .eq("id", row.id)
    .eq("uses", row.uses)
    .select("id");
  if (error) throw error;
  return data && data.length > 0 ? { paid, usesAfter: row.uses + 1 } : null;
}

/** Give a use (and its amount) back when Circle refused the call it was claimed for. */
export async function releaseApproval(row: TxApprovalRow, claim: ApprovalClaim) {
  const { error } = await table()
    .update({
      paid_total: Math.max(Number(row.paid_total ?? 0), 0),
      updated_at: new Date().toISOString(),
      uses: claim.usesAfter - 1,
    })
    .eq("id", row.id)
    .eq("uses", claim.usesAfter);
  if (error) throw error;
}

export { usdValue };
