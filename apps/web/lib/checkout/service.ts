// Server-only. SaphraONE Checkout charges: the merchant side (create, list,
// cancel) and the public payer side (view, tip, intent, confirm, storefront).
import { getAddress, isAddress } from "viem";

import { loadAccount, requireBusinessAccount } from "@/lib/account/auth";
import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { moneyNumber, roundMoney } from "@/lib/account/money";
import { loadBusinessProfile } from "@/lib/account/service";
import { createArcRpcClient } from "@/lib/arc-transfers";
import { resolvePaymentIdentity } from "@/lib/business/service";
import { generateChargeCode, normalizeChargeCode } from "@/lib/checkout/codes";
import { checkoutErrors } from "@/lib/checkout/errors";
import {
  CHARGE_TTL_MS,
  SLOW_INTENT_TTL_MS,
  isExpired,
  validateChargeAmount,
  validateTip,
} from "@/lib/checkout/money-rules";
import { syncChargeMatchesFor } from "@/lib/checkout/scan";
import { chargeSummary } from "@/lib/checkout/summary";

export { chargeSummary };
import { claimTransferForCharge } from "@/lib/checkout/settlement";
import type {
  ChargeCurrency,
  ChargeIntentMethod,
  CheckoutLineItem,
  ChargeKind,
  ChargePaymentRecord,
  ChargePaymentSource,
  ChargeRecord,
  ChargeStatus,
  ChargeWithPayments,
  CheckoutBusiness,
  PublicCharge,
  PublicChargePayload,
  PublicOnlineSession,
  PublicStorefrontPayload,
} from "@/lib/checkout/types";
import { verifyChargeTransfer } from "@/lib/checkout/verify";
import { readSessionId } from "@/lib/merchant-api/ids";
import { fillSessionTemplate, siteHostOf } from "@/lib/merchant-api/validate";

const PAGE_SIZE = 20;
const TX_HASH_PATTERN = /^0x[a-f0-9]{64}$/;
const chargeStatuses: readonly ChargeStatus[] = ["OPEN", "PAID", "EXPIRED", "CANCELLED"];

function nowIso() {
  return new Date().toISOString();
}

function isCurrency(value: unknown): value is ChargeCurrency {
  return value === "USDC" || value === "EURC";
}

function optionalNote(value: unknown) {
  if (typeof value !== "string") return null;
  const note = value.trim().replace(/\s+/g, " ");
  return note ? note.slice(0, 140) : null;
}

function readWallet(value: unknown) {
  return typeof value === "string" && isAddress(value.trim())
    ? getAddress(value.trim()).toLowerCase()
    : null;
}

export function readTxHash(value: unknown) {
  const hash = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!TX_HASH_PATTERN.test(hash)) {
    throw checkoutErrors.invalidPayment("Enter a valid transaction hash.");
  }
  return hash;
}

/** The chain head when the charge opened; transfers before it can't pay it. */
async function currentBlock() {
  try {
    return Number(await createArcRpcClient().getBlockNumber());
  } catch (error) {
    console.warn("[checkout] could not read the block number", error);
    return null;
  }
}

// ── Loading ─────────────────────────────────────────────────────────────────

export async function loadChargeById(id: string) {
  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the charge."));
  return (data as ChargeRecord | null) ?? null;
}

/** The charge behind an online checkout session id (cs_live_…). */
async function loadChargeBySessionId(sessionId: string) {
  const { data, error } = await accountDb()
    .from(accountTables.checkoutSessions)
    .select("charge_id")
    .eq("public_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the checkout."));
  const charge = data ? await loadChargeById((data as { charge_id: string }).charge_id) : null;
  if (!charge) throw checkoutErrors.chargeNotFound();
  return expireIfStale(charge);
}

/**
 * A charge by its code, or by an online session id: the hosted checkout page
 * addresses the same public payer routes with the session id.
 */
async function loadChargeByCode(value: string) {
  const decoded = decodeURIComponent(value);
  const sessionId = readSessionId(decoded);
  if (sessionId) return loadChargeBySessionId(sessionId);
  const code = normalizeChargeCode(decoded);
  if (!code) throw checkoutErrors.chargeNotFound();
  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .select("*")
    .eq("public_id", code)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the charge."));
  if (!data) throw checkoutErrors.chargeNotFound();
  return expireIfStale(data as ChargeRecord);
}

/** Lazy expiry on read; the sweep catches the ones nobody looks at. */
export async function expireIfStale(charge: ChargeRecord) {
  if (!isExpired(charge)) return charge;
  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .update({ status: "EXPIRED", updated_at: nowIso() })
    .eq("id", charge.id)
    .eq("status", "OPEN")
    .select("id");
  if (error) throw new Error(readAccountDbError(error, "Could not update the charge."));
  if (charge.kind === "ONLINE" && (data ?? []).length > 0) {
    await import("@/lib/merchant-api/events")
      .then(({ emitSessionsExpired }) => emitSessionsExpired([charge.id]))
      .catch((cause) => console.error("[checkout] could not emit checkout.session.expired", cause));
  }
  return { ...charge, status: "EXPIRED" as const };
}

export async function loadPayments(chargeIds: string[]) {
  if (chargeIds.length === 0) return new Map<string, ChargePaymentRecord[]>();
  const { data, error } = await accountDb()
    .from(accountTables.chargePayments)
    .select("*")
    .in("charge_id", chargeIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(readAccountDbError(error, "Could not load the charge payments."));
  const byCharge = new Map<string, ChargePaymentRecord[]>();
  for (const payment of (data ?? []) as ChargePaymentRecord[]) {
    const list = byCharge.get(payment.charge_id) ?? [];
    list.push(payment);
    byCharge.set(payment.charge_id, list);
  }
  return byCharge;
}

async function withPayments(charge: ChargeRecord): Promise<ChargeWithPayments> {
  const payments = await loadPayments([charge.id]);
  return { ...charge, payments: payments.get(charge.id) ?? [] };
}

async function loadCheckoutBusiness(wallet: string): Promise<CheckoutBusiness> {
  const [profile, account] = await Promise.all([loadBusinessProfile(wallet), loadAccount(wallet)]);
  return {
    description: profile?.description ?? null,
    logoUrl: profile?.logo_url ?? null,
    name: profile?.business_name ?? account?.display_name ?? account?.username ?? "Business",
    username: account?.username ?? null,
    website: profile?.website ?? null,
  };
}

function toPublicCharge(
  charge: ChargeRecord,
  payments: ChargePaymentRecord[],
  online: PublicOnlineSession | null = null,
): PublicCharge {
  return {
    amount: charge.amount,
    amountReceived: charge.amount_received,
    code: charge.public_id,
    createdAt: charge.created_at,
    currency: charge.currency,
    expiresAt: charge.expires_at,
    kind: charge.kind,
    note: charge.note,
    online,
    paidAt: charge.paid_at,
    pendingMethod: charge.pending_method,
    status: charge.status,
    tipAmount: charge.tip_amount,
    txHashes: payments.map((payment) => payment.tx_hash),
  };
}

// ── Creating ────────────────────────────────────────────────────────────────

async function insertCharge(input: {
  wallet: string;
  kind: ChargeKind;
  amount: string;
  tip?: string;
  currency: ChargeCurrency;
  note: string | null;
  idempotencyKey?: string | null;
  expiresAt?: string;
}) {
  const supabase = accountDb();
  const createdBlock = await currentBlock();
  const expiresAt =
    input.expiresAt ?? new Date(Date.now() + CHARGE_TTL_MS[input.kind]).toISOString();

  // A code collision (23505 on public_id) just draws another code.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from(accountTables.charges)
      .insert({
        amount: input.amount,
        created_at: nowIso(),
        created_block: createdBlock,
        currency: input.currency,
        expires_at: expiresAt,
        idempotency_key: input.idempotencyKey ?? null,
        kind: input.kind,
        note: input.note,
        public_id: generateChargeCode(),
        status: "OPEN",
        tip_amount: input.tip ?? "0",
        updated_at: nowIso(),
        wallet_address: input.wallet,
      })
      .select("*")
      .single();
    if (!error) return data as ChargeRecord;
    if (error.code !== "23505") {
      throw new Error(readAccountDbError(error, "Could not create the charge."));
    }
    if (input.idempotencyKey && /idempotency/i.test(error.message ?? "")) {
      const existing = await supabase
        .from(accountTables.charges)
        .select("*")
        .eq("wallet_address", input.wallet)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing.data) return existing.data as ChargeRecord;
    }
  }
  throw new Error("Could not create the charge. Try again.");
}

// ── Merchant ────────────────────────────────────────────────────────────────

type MerchantInput = {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  workspaceId?: unknown;
};

async function merchantWallet(input: MerchantInput) {
  const { actorWallet, businessWallet } = await requireBusinessAccount(input);
  return (businessWallet || actorWallet).toLowerCase();
}

export async function createCharge(
  input: MerchantInput & {
    amount: unknown;
    currency?: unknown;
    note?: unknown;
    idempotencyKey?: string | null;
  },
) {
  const wallet = await merchantWallet(input);
  const amount = validateChargeAmount(input.amount, "MERCHANT");
  if (!amount.ok) throw checkoutErrors.invalidCharge(amount.message);
  const profile = await loadBusinessProfile(wallet);
  const currency = isCurrency(input.currency) ? input.currency : (profile?.currency ?? "USDC");
  const charge = await insertCharge({
    amount: amount.amount,
    currency,
    idempotencyKey: input.idempotencyKey,
    kind: "MERCHANT",
    note: optionalNote(input.note),
    wallet,
  });
  return withPayments(charge);
}

/**
 * The charge behind a new online checkout session (lib/merchant-api). The
 * caller is already authenticated by API key; the idempotency key makes a
 * retried create land on the same charge.
 */
export async function createOnlineCharge(input: {
  wallet: string;
  amount: unknown;
  currency: ChargeCurrency;
  description: string | null;
  expiresAt: string;
  idempotencyKey: string | null;
}) {
  const amount = validateChargeAmount(input.amount, "ONLINE");
  if (!amount.ok) throw checkoutErrors.invalidCharge(amount.message);
  return insertCharge({
    amount: amount.amount,
    currency: input.currency,
    expiresAt: input.expiresAt,
    idempotencyKey: input.idempotencyKey ? `api:${input.idempotencyKey}` : null,
    kind: "ONLINE",
    note: input.description,
    wallet: input.wallet.toLowerCase(),
  });
}

/** Session id and order id of online charges, for the merchant's list. */
async function loadSessionRefs(chargeIds: string[]) {
  const refs = new Map<string, { public_id: string; client_reference_id: string | null }>();
  if (chargeIds.length === 0) return refs;
  const { data, error } = await accountDb()
    .from(accountTables.checkoutSessions)
    .select("charge_id,public_id,client_reference_id")
    .in("charge_id", chargeIds);
  if (error) throw new Error(readAccountDbError(error, "Could not load checkout sessions."));
  for (const row of (data ?? []) as Array<{
    charge_id: string;
    public_id: string;
    client_reference_id: string | null;
  }>) {
    refs.set(row.charge_id, { client_reference_id: row.client_reference_id, public_id: row.public_id });
  }
  return refs;
}

/** `kind`: IN_PERSON (counter and storefront) or ONLINE (checkout sessions); omitted = all. */
export async function listCharges(
  input: MerchantInput & { status?: unknown; page?: number; kind?: unknown },
) {
  const wallet = await merchantWallet(input);
  const page = Number.isFinite(input.page) && (input.page ?? 1) > 0 ? Math.floor(input.page ?? 1) : 1;
  let query = accountDb()
    .from(accountTables.charges)
    .select("*")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (typeof input.status === "string" && chargeStatuses.includes(input.status as ChargeStatus)) {
    query = query.eq("status", input.status);
  }
  if (input.kind === "ONLINE") query = query.eq("kind", "ONLINE");
  if (input.kind === "IN_PERSON") query = query.in("kind", ["MERCHANT", "STOREFRONT"]);
  const { data, error } = await query;
  if (error) throw new Error(readAccountDbError(error, "Could not load charges."));
  const rows = await Promise.all(((data ?? []) as ChargeRecord[]).map(expireIfStale));
  const [payments, summary, sessions] = await Promise.all([
    loadPayments(rows.map((row) => row.id)),
    chargeSummary(wallet),
    loadSessionRefs(rows.filter((row) => row.kind === "ONLINE").map((row) => row.id)),
  ]);
  return {
    charges: rows.map((row) => ({
      ...row,
      payments: payments.get(row.id) ?? [],
      ...(row.kind === "ONLINE" ? { session: sessions.get(row.id) ?? null } : {}),
    })),
    page,
    summary,
  };
}

export async function getChargeForOwner(
  input: MerchantInput & { chargeId: string; scan?: boolean },
) {
  const wallet = await merchantWallet(input);
  let charge = await loadChargeById(input.chargeId);
  if (!charge) throw checkoutErrors.chargeNotFound();
  if (charge.wallet_address !== wallet) throw checkoutErrors.chargeNotOwned();
  // Polling drives matching for card/bank and bridge payments.
  if (input.scan && (await syncChargeMatchesFor(charge))) {
    charge = (await loadChargeById(charge.id)) ?? charge;
  }
  return withPayments(await expireIfStale(charge));
}

export async function cancelCharge(input: MerchantInput & { chargeId: string }) {
  const current = await getChargeForOwner(input);
  if (current.status === "CANCELLED") return current;
  if (current.status !== "OPEN" || current.payments.length > 0) {
    throw checkoutErrors.chargeNotOpen("Only an unpaid, open charge can be cancelled.");
  }
  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .update({ status: "CANCELLED", updated_at: nowIso() })
    .eq("id", current.id)
    .eq("status", "OPEN")
    .eq("amount_received", "0")
    .select("id");
  if (error) throw new Error(readAccountDbError(error, "Could not cancel the charge."));
  if ((data ?? []).length === 0) {
    throw checkoutErrors.chargeNotOpen("A payment arrived first; this charge can't be cancelled.");
  }
  return getChargeForOwner(input);
}

// ── Public payer ────────────────────────────────────────────────────────────

/** What the hosted page may show of a session: never metadata, email or order id. */
async function loadPublicOnlineSession(charge: ChargeRecord): Promise<PublicOnlineSession | null> {
  if (charge.kind !== "ONLINE") return null;
  const { data, error } = await accountDb()
    .from(accountTables.checkoutSessions)
    .select("public_id,line_items,success_url,cancel_url")
    .eq("charge_id", charge.id)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the checkout."));
  if (!data) return null;
  const row = data as {
    public_id: string;
    line_items: CheckoutLineItem[] | null;
    success_url: string;
    cancel_url: string | null;
  };
  return {
    cancelUrl: row.cancel_url,
    description: charge.note,
    lineItems: Array.isArray(row.line_items) ? row.line_items : [],
    sessionId: row.public_id,
    siteHost: siteHostOf(row.success_url),
    successUrl: fillSessionTemplate(row.success_url, row.public_id),
  };
}

async function publicPayload(charge: ChargeRecord): Promise<PublicChargePayload> {
  const [business, payments, online] = await Promise.all([
    loadCheckoutBusiness(charge.wallet_address),
    loadPayments([charge.id]),
    loadPublicOnlineSession(charge),
  ]);
  return {
    business,
    charge: toPublicCharge(charge, payments.get(charge.id) ?? [], online),
    destinationWallet: charge.wallet_address,
  };
}

export async function getPublicCharge(code: string, options?: { scan?: boolean }) {
  const charge = await loadChargeByCode(code);
  if (options?.scan && (await syncChargeMatchesFor(charge))) {
    return publicPayload(await loadChargeByCode(code));
  }
  return publicPayload(charge);
}

function requireOpen(charge: ChargeRecord) {
  if (charge.status === "PAID") throw checkoutErrors.chargeNotOpen("This charge is already paid.");
  if (charge.status === "CANCELLED") throw checkoutErrors.chargeNotOpen("This charge was cancelled.");
  if (charge.status === "EXPIRED") throw checkoutErrors.chargeNotOpen("This charge has expired. Ask for a new one.");
}

/** The tip the payer picked; a hint for the total shown and for matching. */
export async function setChargeTip(input: { code: string; tip: unknown }) {
  const charge = await loadChargeByCode(input.code);
  requireOpen(charge);
  if (charge.kind === "ONLINE") throw checkoutErrors.invalidCharge("Online checkouts don't take tips.");
  const tip = validateTip(input.tip, charge.amount);
  if (!tip.ok) throw checkoutErrors.invalidCharge(tip.message);
  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .update({ tip_amount: tip.amount, updated_at: nowIso() })
    .eq("id", charge.id)
    .eq("status", "OPEN")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not save the tip."));
  if (!data) throw checkoutErrors.chargeNotOpen();
  return publicPayload(data as ChargeRecord);
}

/**
 * The payer is about to pay by `method`. Card/bank and bridge payments land
 * without an Arc hash we can confirm, so they keep the charge open longer and
 * mark it for the matcher.
 */
export async function registerChargeIntent(input: {
  code: string;
  method: unknown;
  payerWallet?: unknown;
  reference?: unknown;
  allowedMethods?: readonly ChargeIntentMethod[];
}) {
  const allowed = input.allowedMethods ?? ["WALLET", "SWIFTPAY", "BRIDGE"];
  if (typeof input.method !== "string" || !allowed.includes(input.method as ChargeIntentMethod)) {
    throw checkoutErrors.invalidCharge("Choose how you want to pay.");
  }
  const method = input.method as ChargeIntentMethod;
  const charge = await loadChargeByCode(input.code);
  requireOpen(charge);
  const slow = method === "ONRAMP" || method === "BRIDGE";
  const extended = new Date(Date.now() + SLOW_INTENT_TTL_MS).toISOString();
  const reference =
    typeof input.reference === "string" && input.reference.trim()
      ? input.reference.trim().slice(0, 200)
      : null;
  const payerWallet = readWallet(input.payerWallet);
  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .update({
      pending_method: method,
      pending_ref: reference,
      pending_started_at: nowIso(),
      updated_at: nowIso(),
      ...(payerWallet ? { payer_wallet: payerWallet } : {}),
      ...(slow && extended > charge.expires_at ? { expires_at: extended } : {}),
    })
    .eq("id", charge.id)
    .eq("status", "OPEN")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not start the payment."));
  if (!data) throw checkoutErrors.chargeNotOpen();
  return publicPayload(data as ChargeRecord);
}

/**
 * The payer's transaction hash. The amount is whatever the chain says reached
 * the merchant wallet, never what the browser claims. An EXPIRED charge still
 * accepts it: money that arrived must never go unattributed.
 */
export async function confirmChargePayment(input: {
  code: string;
  txHash: unknown;
  payerWallet?: unknown;
  source: Extract<ChargePaymentSource, "WALLET" | "SWIFTPAY" | "BRIDGE">;
}) {
  const txHash = readTxHash(input.txHash);
  const charge = await loadChargeByCode(input.code);
  if (charge.status === "CANCELLED") {
    throw checkoutErrors.chargeNotOpen("This charge was cancelled.");
  }

  // Retried confirms of a hash this charge already holds are a no-op.
  const existing = await accountDb()
    .from(accountTables.chargePayments)
    .select("charge_id")
    .eq("tx_hash", txHash)
    .maybeSingle();
  if ((existing.data as { charge_id: string } | null)?.charge_id === charge.id) {
    return publicPayload(charge);
  }

  const transfer = await verifyChargeTransfer({
    currency: charge.currency,
    destination: charge.wallet_address,
    txHash: txHash as `0x${string}`,
  });
  if (!transfer) {
    throw checkoutErrors.invalidPayment(
      "This transaction isn't confirmed yet, or it didn't pay this business. Try again in a moment.",
    );
  }
  // A transfer mined before the charge existed can't be paying it.
  if (charge.created_block !== null && transfer.blockNumber < BigInt(charge.created_block)) {
    throw checkoutErrors.invalidPayment("This transaction was made before the charge was created.");
  }

  const result = await claimTransferForCharge({
    amount: transfer.amount,
    blockNumber: transfer.blockNumber,
    charge,
    from: readWallet(input.payerWallet) ?? transfer.from,
    matchedBy: "RECEIPT",
    source: input.source,
    txHash,
  });
  return publicPayload(result.charge);
}

/**
 * The card/bank widget (or a bridge) says the money is on its way. The amount
 * it reports narrows the match; the scan then runs right away.
 */
export async function reportChargeSettled(input: {
  code: string;
  amount?: unknown;
  tokenSymbol?: unknown;
  reference?: unknown;
}) {
  const charge = await loadChargeByCode(input.code);
  if (charge.pending_method !== "ONRAMP" && charge.pending_method !== "BRIDGE") {
    throw checkoutErrors.chargeNotOpen("This charge isn't waiting on a card, bank or bridge payment.");
  }
  if (charge.status === "CANCELLED") throw checkoutErrors.chargeNotOpen("This charge was cancelled.");
  if (charge.status === "PAID") return publicPayload(charge);

  const symbol = typeof input.tokenSymbol === "string" ? input.tokenSymbol.trim().toUpperCase() : null;
  const raw = typeof input.amount === "number" ? String(input.amount) : input.amount;
  const reported =
    typeof raw === "string" && /^\d+(\.\d{1,18})?$/.test(raw.trim()) && moneyNumber(raw) > 0
      ? roundMoney(moneyNumber(raw))
      : null;
  const reference =
    typeof input.reference === "string" && input.reference.trim()
      ? input.reference.trim().slice(0, 200)
      : null;
  const update = {
    updated_at: nowIso(),
    ...(reported && (!symbol || symbol === charge.currency) ? { reported_amount: reported } : {}),
    ...(reference ? { pending_ref: reference } : {}),
  };
  const { error } = await accountDb()
    .from(accountTables.charges)
    .update(update)
    .eq("id", charge.id)
    .in("status", ["OPEN", "EXPIRED"]);
  if (error) throw new Error(readAccountDbError(error, "Could not save the payment details."));
  return getPublicCharge(input.code, { scan: true });
}

/**
 * The merchant's fallback when a real payment wasn't matched: any confirmed
 * transfer into their wallet, credited to this charge.
 */
export async function reconcileCharge(input: MerchantInput & { chargeId: string; txHash: unknown }) {
  const txHash = readTxHash(input.txHash);
  const charge = await getChargeForOwner(input);
  if (charge.status === "CANCELLED") throw checkoutErrors.chargeNotOpen("This charge was cancelled.");
  const transfer = await verifyChargeTransfer({
    currency: charge.currency,
    destination: charge.wallet_address,
    txHash: txHash as `0x${string}`,
  });
  if (!transfer) {
    throw checkoutErrors.invalidPayment(
      `That transaction didn't send ${charge.currency} to your wallet, or isn't confirmed yet.`,
    );
  }
  await claimTransferForCharge({
    amount: transfer.amount,
    blockNumber: transfer.blockNumber,
    charge,
    from: transfer.from,
    matchedBy: "RECEIPT",
    source: "RECONCILE",
    txHash,
  });
  return getChargeForOwner(input);
}

/** Marks the charge as paid by card/bank; the onramp route mints the session. */
export async function startChargeOnramp(code: string) {
  const charge = await loadChargeByCode(code);
  if (charge.currency !== "USDC") {
    throw checkoutErrors.invalidCharge("Card and bank payments are only available for USDC charges.");
  }
  const payload = await registerChargeIntent({ allowedMethods: ["ONRAMP"], code, method: "ONRAMP" });
  return { destinationWallet: charge.wallet_address, payload };
}

// ── Storefront ──────────────────────────────────────────────────────────────

async function resolveStorefront(username: string) {
  const handle = decodeURIComponent(username).trim().replace(/^@+/, "").replace(/\.one$/i, "");
  if (!/^[a-z0-9_.-]{1,40}$/i.test(handle)) throw checkoutErrors.storefrontNotFound();
  const identity = await resolvePaymentIdentity(handle);
  const wallet = identity?.profile_wallet ?? identity?.destination_wallet;
  if (!wallet) throw checkoutErrors.storefrontNotFound();
  const account = await loadAccount(wallet);
  if (!account || account.account_type !== "BUSINESS") throw checkoutErrors.storefrontNotFound();
  return account.wallet_address.toLowerCase();
}

export async function getPublicStorefront(username: string): Promise<PublicStorefrontPayload> {
  const wallet = await resolveStorefront(username);
  const [business, profile] = await Promise.all([
    loadCheckoutBusiness(wallet),
    loadBusinessProfile(wallet),
  ]);
  return { business, currency: profile?.currency ?? "USDC", destinationWallet: wallet };
}

export async function createStorefrontCharge(input: {
  username: string;
  amount: unknown;
  tip?: unknown;
  currency?: unknown;
}) {
  const wallet = await resolveStorefront(input.username);
  const amount = validateChargeAmount(input.amount, "STOREFRONT");
  if (!amount.ok) throw checkoutErrors.invalidCharge(amount.message);
  const tip = validateTip(input.tip, amount.amount);
  if (!tip.ok) throw checkoutErrors.invalidCharge(tip.message);
  const profile = await loadBusinessProfile(wallet);
  const currency = isCurrency(input.currency) ? input.currency : (profile?.currency ?? "USDC");
  const charge = await insertCharge({
    amount: amount.amount,
    currency,
    kind: "STOREFRONT",
    note: null,
    tip: tip.amount,
    wallet,
  });
  return { code: charge.public_id, wallet };
}
