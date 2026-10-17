// Server-only. Naira on-ramp and off-ramp flows through Centiiv Protocol.
// SwiftPay never holds the money: it quotes, creates the order, shows where
// to pay, verifies the user's Arc transfer and tracks status. Callers pass a
// wallet the signed session already controls.
import type { Hash } from "viem";

import { recordAccountActivity } from "@/lib/activity/service";
import { isArcMainnet } from "@/lib/network";
import {
  createRequest,
  getQuote,
  getRequest,
  listBanks as listCentiivBanks,
  verifyAccount,
} from "@/lib/ramp/centiiv";
import { mapRequestToPatch, payinFromRequest } from "@/lib/ramp/centiiv-map";
import { centiivConfig, rampCurrencies, type CentiivConfig } from "@/lib/ramp/config";
import {
  claimUserTxHash,
  deleteBeneficiaryRow,
  findBeneficiary,
  findOrderByIdempotencyKey,
  findOrderByProviderId,
  findOrderForWallet,
  insertOrder,
  insertWebhookEvent,
  listBeneficiaryRows,
  listOrders as listOrderRows,
  listStaleOpenOrders,
  markWebhookProcessed,
  readProfileContact,
  updateOrder,
  upsertBeneficiary,
  type NewOrder,
} from "@/lib/ramp/db";
import { rampErrors } from "@/lib/ramp/errors";
import {
  decimalText,
  isTerminal,
  maskAccount,
  nextStatus,
  ORDER_TTL_MS,
  parseRampAmount,
  readNuban,
  usdcUnits,
  validateDepositWallet,
} from "@/lib/ramp/rules";
import type {
  CentiivQuote,
  CentiivRequest,
  RampDirection,
  RampOrderRow,
  RampQuote,
  RampStatusInfo,
} from "@/lib/ramp/types";
import { beneficiaryView, orderView } from "@/lib/ramp/view";
import { verifyOfframpDeposit } from "@/lib/ramp/verify";
import { verifySvixSignature } from "@/lib/ramp/webhook-signature";

/** An open order re-reads Centiiv at most this often when the browser polls. */
const REFRESH_AFTER_MS = 10_000;
/** The cron leaves orders alone that something synced this recently. */
const SWEEP_AFTER_MS = 2 * 60_000;
/** An order Centiiv never acknowledged is failed after this long. */
const ORPHAN_AFTER_MS = 10 * 60_000;
const MAX_BENEFICIARIES = 10;
/** Centiiv's off-ramp total may move this far above the reviewed quote. */
const OFFRAMP_TOTAL_SLACK = 1.01;

const UNAVAILABLE_WITHDRAWALS = "Withdrawals are unavailable right now.";

function requireConfig(): CentiivConfig {
  const config = centiivConfig();
  if (!config) throw rampErrors.unavailable();
  return config;
}

function readDirection(value: unknown): RampDirection {
  if (value === "ONRAMP" || value === "OFFRAMP") return value;
  throw rampErrors.invalid("Choose a deposit or a withdrawal.");
}

function requireAmount(value: unknown, direction: RampDirection) {
  const parsed = parseRampAmount(value, direction);
  if (!parsed.ok) throw rampErrors.invalid(parsed.message);
  return parsed.value;
}

export function rampStatus(): RampStatusInfo {
  const config = centiivConfig();
  const currencies = config ? rampCurrencies() : [];
  return {
    enabled: Boolean(config) && currencies.length > 0,
    currencies,
    directions: ["ONRAMP", "OFFRAMP"],
    environment: config?.environment ?? null,
  };
}

// ── Quotes ──────────────────────────────────────────────────────────────

/**
 * Centiiv's `rate` is "to per from": USDC per NGN on an on-ramp (0.00073),
 * NGN per USDC on an off-ramp (1356). The app always shows NGN per USDC.
 */
export function nairaPerUsdc(rate: unknown): string | null {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return null;
  return decimalText(value < 1 ? 1 / value : value, 2);
}

function quoteView(quote: CentiivQuote): RampQuote | null {
  const rate = nairaPerUsdc(quote.rate);
  const fees = decimalText(quote.fees, 6);
  const receive = decimalText(quote.estimatedReceivableAmount, 6);
  const totalToPay = decimalText(quote.totalToPay, 6);
  if (!rate || !receive || !totalToPay) return null;
  return { rate, fees: fees ?? "0", receive, totalToPay };
}

async function fetchQuote(config: CentiivConfig, direction: RampDirection, amount: string) {
  const result = await getQuote(config, {
    fromAsset: direction === "ONRAMP" ? "NGN" : "USDC",
    toAsset: direction === "ONRAMP" ? "USDC" : "NGN",
    amount: Number(amount),
  });
  if (!result.ok) throw rampErrors.provider(result.message);
  const quote = quoteView(result.data ?? {});
  if (!quote) throw rampErrors.provider("Couldn't get a rate right now. Try again in a moment.");
  return quote;
}

export async function quote(input: { direction: unknown; amount: unknown }) {
  const config = requireConfig();
  const direction = readDirection(input.direction);
  const amount = requireAmount(input.amount, direction);
  return fetchQuote(config, direction, amount);
}

// ── Orders ──────────────────────────────────────────────────────────────

/** A row for a new order, or the existing one when the key was used before. */
async function startOrder(order: NewOrder) {
  const created = await insertOrder(order);
  if (created) return { row: created, existing: false };
  const existing = await findOrderByIdempotencyKey(order.wallet_address, order.idempotency_key!);
  if (!existing) throw rampErrors.conflict("That request is already in progress.");
  return { row: existing, existing: true };
}

async function failOrder(order: RampOrderRow, reason: string) {
  await updateOrder(order.id, { status: "FAILED", failure_reason: reason }).catch((error) =>
    console.error("[ramp] could not mark order failed", order.id, error),
  );
}

function expiryFrom(request: CentiivRequest) {
  const created = request.createdAt ? Date.parse(request.createdAt) : Number.NaN;
  return new Date((Number.isNaN(created) ? Date.now() : created) + ORDER_TTL_MS).toISOString();
}

export async function createOrder(input: {
  wallet: string;
  direction: unknown;
  amount: unknown;
  beneficiaryId?: unknown;
  idempotencyKey: string | null;
}) {
  const direction = readDirection(input.direction);
  if (!input.idempotencyKey) throw rampErrors.invalid("An Idempotency-Key header is required.");
  return direction === "ONRAMP"
    ? createOnramp({ wallet: input.wallet, amountNgn: input.amount, idempotencyKey: input.idempotencyKey })
    : createOfframp({
        wallet: input.wallet,
        amountUsdc: input.amount,
        beneficiaryId: input.beneficiaryId,
        idempotencyKey: input.idempotencyKey,
      });
}

export async function createOnramp(input: { wallet: string; amountNgn: unknown; idempotencyKey: string }) {
  const config = requireConfig();
  const amount = requireAmount(input.amountNgn, "ONRAMP");

  const previous = await findOrderByIdempotencyKey(input.wallet, input.idempotencyKey);
  if (previous) return orderView(previous);

  const quoted = await fetchQuote(config, "ONRAMP", amount);
  const { row, existing } = await startOrder({
    wallet_address: input.wallet,
    direction: "ONRAMP",
    environment: config.environment,
    fiat_amount: amount,
    usdc_amount: quoted.receive,
    total_to_pay: quoted.totalToPay,
    quoted_rate: quoted.rate,
    quoted_fee: quoted.fees,
    quoted_receivable: quoted.receive,
    idempotency_key: input.idempotencyKey,
  });
  if (existing) return orderView(row);

  const contact = await readProfileContact(input.wallet).catch(() => null);
  const sender: Record<string, string> = { externalId: input.wallet };
  if (contact?.fullName) sender.fullName = contact.fullName;
  if (contact?.email) sender.email = contact.email;
  if (contact?.phone) sender.phone = contact.phone;

  // The destination is always the signed-in wallet, never the request body.
  const result = await createRequest(
    config,
    {
      fromAsset: "NGN",
      toAsset: "USDC",
      amount: Number(amount),
      destinationAddress: input.wallet,
      sender,
      metadata: { swiftpayOrderId: row.id },
    },
    `swiftpay-${row.id}`,
  );
  if (!result.ok) {
    await failOrder(row, result.message);
    throw rampErrors.provider(result.message);
  }

  const payin = payinFromRequest(result.data);
  if (!payin) {
    console.error("[ramp] on-ramp request has no virtual account", result.data?.id);
    await failOrder(row, "No bank account was issued for this payment.");
    throw rampErrors.unavailable("Naira deposits are unavailable right now.");
  }

  const patch = mapRequestToPatch(result.data);
  const updated = await updateOrder(row.id, {
    provider_order_id: patch.provider_order_id ?? null,
    payin_instructions: payin,
    total_to_pay: patch.total_to_pay ?? row.total_to_pay,
    status: nextStatus(row.status, patch.status ?? null),
    deposit_expires_at: patch.deposit_expires_at ?? expiryFrom(result.data),
    last_synced_at: new Date().toISOString(),
  });
  return orderView(updated ?? row);
}

export async function createOfframp(input: {
  wallet: string;
  amountUsdc: unknown;
  beneficiaryId: unknown;
  idempotencyKey: string;
}) {
  const config = requireConfig();
  const amount = requireAmount(input.amountUsdc, "OFFRAMP");

  const previous = await findOrderByIdempotencyKey(input.wallet, input.idempotencyKey);
  if (previous) return orderView(previous);

  const beneficiary =
    typeof input.beneficiaryId === "string" ? await findBeneficiary(input.beneficiaryId, input.wallet) : null;
  if (!beneficiary) throw rampErrors.invalid("Choose a bank account to withdraw to.");

  const quoted = await fetchQuote(config, "OFFRAMP", amount);
  const { row, existing } = await startOrder({
    wallet_address: input.wallet,
    direction: "OFFRAMP",
    environment: config.environment,
    usdc_amount: amount,
    fiat_amount: quoted.receive,
    total_to_pay: quoted.totalToPay,
    quoted_rate: quoted.rate,
    quoted_fee: quoted.fees,
    quoted_receivable: quoted.receive,
    beneficiary_id: beneficiary.id,
    beneficiary_snapshot: {
      bankName: beneficiary.bank_name,
      bankCode: beneficiary.bank_code,
      accountMasked: maskAccount(beneficiary.account_number),
      accountName: beneficiary.account_name,
    },
    idempotency_key: input.idempotencyKey,
  });
  if (existing) return orderView(row);

  // Refunds go back to the signed-in wallet, never an address from the body.
  const result = await createRequest(
    config,
    {
      fromAsset: "USDC",
      toAsset: "NGN",
      amount: Number(amount),
      refundAddress: input.wallet,
      beneficiary: {
        externalId: input.wallet,
        destination: {
          type: "BANK",
          bankCode: beneficiary.bank_code,
          accountNumber: beneficiary.account_number,
        },
      },
      metadata: { swiftpayOrderId: row.id },
    },
    `swiftpay-${row.id}`,
  );
  if (!result.ok) {
    await failOrder(row, result.message);
    throw rampErrors.provider(result.message);
  }

  const patch = mapRequestToPatch(result.data);
  const wallet = validateDepositWallet(result.data.temporaryWallet, { mainnet: isArcMainnet() });
  if (!wallet.ok) {
    console.error("[ramp] unsafe off-ramp deposit wallet", result.data?.id, wallet.reason);
    await updateOrder(row.id, { provider_order_id: patch.provider_order_id ?? null });
    await failOrder(row, wallet.reason);
    throw rampErrors.unavailable(UNAVAILABLE_WITHDRAWALS);
  }

  // The user sends exactly this, so it must be a clean 6-decimal amount and
  // no more than the total they reviewed (plus a little rate movement).
  const total = patch.total_to_pay ?? quoted.totalToPay;
  const totalUnits = usdcUnits(total);
  const reviewedUnits = usdcUnits(quoted.totalToPay);
  if (
    !totalUnits ||
    !reviewedUnits ||
    Number(totalUnits) > Number(reviewedUnits) * OFFRAMP_TOTAL_SLACK
  ) {
    console.error("[ramp] off-ramp total out of range", result.data?.id, total, quoted.totalToPay);
    await updateOrder(row.id, { provider_order_id: patch.provider_order_id ?? null });
    await failOrder(row, `Withdrawal total ${total} USDC didn't match the quote.`);
    throw rampErrors.conflict("The rate moved. Start the withdrawal again.");
  }

  const updated = await updateOrder(row.id, {
    provider_order_id: patch.provider_order_id ?? null,
    deposit_address: wallet.address,
    deposit_expires_at: wallet.expiresAt ?? expiryFrom(result.data),
    total_to_pay: total,
    status: nextStatus(row.status, patch.status ?? null),
    last_synced_at: new Date().toISOString(),
  });
  return orderView(updated ?? row);
}

export async function listOrders(wallet: string) {
  return (await listOrderRows(wallet, 20)).map(orderView);
}

export async function getOrder(input: { wallet: string; id: string }) {
  const order = await findOrderForWallet(input.id, input.wallet);
  if (!order) throw rampErrors.notFound();
  const lastSynced = order.last_synced_at ? Date.parse(order.last_synced_at) : 0;
  if (!isTerminal(order.status) && Date.now() - lastSynced > REFRESH_AFTER_MS) {
    return orderView(await syncOrder(order));
  }
  return orderView(order);
}

/**
 * Re-reads the order from Centiiv and applies it. Shared by polling, the
 * webhook and the cron. A failed read leaves the order as it was.
 */
export async function syncOrder(order: RampOrderRow): Promise<RampOrderRow> {
  const config = centiivConfig();
  if (!config || !order.provider_order_id || isTerminal(order.status)) {
    return order.status === "FULFILLED" ? await recordRampActivity(order) : order;
  }

  const result = await getRequest(config, order.provider_order_id);
  if (!result.ok) return order;

  const patch = mapRequestToPatch(result.data);
  const status = nextStatus(order.status, patch.status ?? null);
  const update: Partial<RampOrderRow> = {
    status,
    last_synced_at: new Date().toISOString(),
  };
  // The off-ramp amount and deposit wallet are fixed at creation: the user
  // may already have sent exactly that.
  if (order.direction === "ONRAMP") {
    if (patch.payin_instructions) update.payin_instructions = patch.payin_instructions;
    if (patch.delivery_tx_hash) update.delivery_tx_hash = patch.delivery_tx_hash;
    if (patch.usdc_amount) update.usdc_amount = patch.usdc_amount;
  }
  if (status !== order.status && isTerminal(status)) {
    update.failure_reason = status === "FULFILLED" ? null : (patch.failure_reason ?? null);
  }

  const updated = (await updateOrder(order.id, update, order.status)) ?? order;
  return updated.status === "FULFILLED" ? recordRampActivity(updated) : updated;
}

/** Writes the order's Activity row once it has completed. */
async function recordRampActivity(order: RampOrderRow): Promise<RampOrderRow> {
  if (order.activity_recorded_at || order.status !== "FULFILLED") return order;

  const metadata = {
    rampOrderId: order.id,
    fiatAmount: order.fiat_amount,
    fiatCurrency: order.fiat_currency,
    provider: "centiiv",
  };
  try {
    if (order.direction === "ONRAMP" && order.delivery_tx_hash) {
      await recordAccountActivity({
        walletAddress: order.wallet_address,
        source: "ramp",
        direction: "in",
        title: "Bought USDC with Naira",
        counterparty: "Bank transfer",
        amount: order.usdc_amount,
        token: "USDC",
        txHash: order.delivery_tx_hash,
        metadata,
      });
    } else if (order.direction === "OFFRAMP" && order.user_tx_hash) {
      const bank = order.beneficiary_snapshot;
      const destination = [bank?.bankName, bank?.accountMasked].filter(Boolean).join(" ") || "bank";
      await recordAccountActivity({
        walletAddress: order.wallet_address,
        source: "ramp",
        direction: "out",
        title: `Withdrew to ${destination}`,
        counterparty: bank?.accountName ?? "Bank account",
        amount: order.total_to_pay,
        token: "USDC",
        txHash: order.user_tx_hash,
        metadata,
      });
    }
    // Without a hash there is nothing to tie the row to; the on-chain
    // transfer still shows in the wallet feed.
  } catch (error) {
    console.error("[ramp] activity record failed", order.id, error);
    return order;
  }
  return (await updateOrder(order.id, { activity_recorded_at: new Date().toISOString() })) ?? order;
}

export async function reportCryptoSent(input: { wallet: string; id: string; txHash: unknown }) {
  const txHash = typeof input.txHash === "string" ? input.txHash.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw rampErrors.invalid("A valid transaction hash is required.");

  const order = await findOrderForWallet(input.id, input.wallet);
  if (!order || order.direction !== "OFFRAMP") throw rampErrors.notFound("Withdrawal");
  if (order.user_tx_hash) {
    if (order.user_tx_hash !== txHash) {
      throw rampErrors.conflict("A different transaction is already recorded for this withdrawal.");
    }
    return { pending: false, order: orderView(await syncOrder(order)) };
  }
  if (!order.deposit_address || !order.total_to_pay) {
    throw rampErrors.conflict("This withdrawal has no deposit address.");
  }

  const check = await verifyOfframpDeposit({
    txHash: txHash as Hash,
    depositAddress: order.deposit_address,
    totalToPay: order.total_to_pay,
    wallet: input.wallet,
  });
  if (check.status === "pending") return { pending: true, order: orderView(order) };
  if (check.status === "invalid") throw rampErrors.invalid(check.reason);

  const claim = await claimUserTxHash(order.id, txHash);
  if (claim === "taken") throw rampErrors.conflict("That transaction is already recorded for another withdrawal.");
  const fresh = (await findOrderForWallet(order.id, input.wallet)) ?? order;
  if (claim === "other" && fresh.user_tx_hash !== txHash) {
    throw rampErrors.conflict("A different transaction is already recorded for this withdrawal.");
  }
  return { pending: false, order: orderView(await syncOrder(fresh)) };
}

// ── Webhooks and the cron ───────────────────────────────────────────────

function requestIdFrom(payload: unknown): string | null {
  const row = (payload ?? {}) as Record<string, unknown>;
  const data = (row.data ?? {}) as Record<string, unknown>;
  for (const value of [data.id, data.requestId, row.id, row.requestId]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * A signed Centiiv webhook. Its payload shape isn't public, so it is only a
 * nudge: the request id is read from it and the order is re-read from
 * Centiiv's API, so a forged or odd payload can't change state.
 */
export async function handleWebhook(rawBody: string, headers: Headers) {
  const signature = verifySvixSignature({
    rawBody,
    headers,
    secret: process.env.CENTIIV_WEBHOOK_SECRET,
  });
  if (!signature.ok) {
    console.warn("[ramp] webhook rejected:", signature.reason);
    return { status: 401, body: { message: "Invalid signature." } };
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 200, body: { ignored: true } };
  }
  const requestId = requestIdFrom(payload);
  const eventId = signature.eventId ?? `unsigned-${Date.now()}`;
  if (!(await insertWebhookEvent({ eventId, providerOrderId: requestId, payload }))) {
    return { status: 200, body: { duplicate: true } };
  }

  if (requestId) {
    const order = await findOrderByProviderId(requestId);
    if (order) await syncOrder(order);
  }
  await markWebhookProcessed(eventId).catch(() => undefined);
  return { status: 200, body: { received: true } };
}

/** Cron: re-syncs open orders nothing has looked at recently. */
export async function sweepOpenOrders() {
  const now = Date.now();
  const stale = await listStaleOpenOrders(new Date(now - SWEEP_AFTER_MS), 50);
  let synced = 0;
  let orphaned = 0;
  for (const order of stale) {
    try {
      if (!order.provider_order_id) {
        // Saved but never acknowledged by Centiiv (the create call died).
        if (now - Date.parse(order.created_at) > ORPHAN_AFTER_MS) {
          await updateOrder(
            order.id,
            { status: "FAILED", failure_reason: "The order was never confirmed by the bank transfer service." },
            order.status,
          );
          orphaned += 1;
        }
        continue;
      }
      await syncOrder(order);
      synced += 1;
    } catch (error) {
      console.error("[ramp] sweep failed for order", order.id, error);
    }
  }
  return { checked: stale.length, synced, orphaned };
}

// ── Banks and saved accounts ────────────────────────────────────────────

export async function listBanks() {
  const result = await listCentiivBanks(requireConfig());
  if (!result.ok) throw rampErrors.provider(result.message);
  return result.data;
}

async function resolveAccount(bankCodeInput: unknown, accountNumberInput: unknown) {
  const config = requireConfig();
  const accountNumber = readNuban(accountNumberInput);
  if (!accountNumber) throw rampErrors.invalid("Enter the 10-digit account number.");
  const bankCode = typeof bankCodeInput === "string" ? bankCodeInput.trim() : "";
  const banks = await listCentiivBanks(config);
  if (!banks.ok) throw rampErrors.provider(banks.message);
  const bank = banks.data.find((entry) => entry.code === bankCode);
  if (!bank) throw rampErrors.invalid("Choose your bank from the list.");

  const result = await verifyAccount(config, { bankCode, accountNumber });
  if (!result.ok) throw rampErrors.provider(result.message);
  return { ...result.data, bankCode, accountNumber, bankName: result.data.bankName ?? bank.name };
}

export async function verifyBeneficiary(input: { bankCode: unknown; accountNumber: unknown }) {
  return resolveAccount(input.bankCode, input.accountNumber);
}

export async function listBeneficiaries(wallet: string) {
  return (await listBeneficiaryRows(wallet)).map(beneficiaryView);
}

export async function addBeneficiary(input: { wallet: string; bankCode: unknown; accountNumber: unknown }) {
  const existing = await listBeneficiaryRows(input.wallet);
  const account = await resolveAccount(input.bankCode, input.accountNumber);
  const duplicate = existing.find(
    (row) => row.bank_code === account.bankCode && row.account_number === account.accountNumber,
  );
  if (!duplicate && existing.length >= MAX_BENEFICIARIES) {
    throw rampErrors.conflict(`You can save up to ${MAX_BENEFICIARIES} bank accounts. Remove one first.`);
  }
  // The name always comes from the bank's records, never from the user.
  const row = await upsertBeneficiary({
    wallet_address: input.wallet,
    currency: "NGN",
    bank_code: account.bankCode,
    bank_name: account.bankName,
    account_number: account.accountNumber,
    account_name: account.accountName,
  });
  return beneficiaryView(row);
}

export async function deleteBeneficiary(input: { wallet: string; id: unknown }) {
  const id = typeof input.id === "string" ? input.id : "";
  if (!(await deleteBeneficiaryRow(id, input.wallet))) throw rampErrors.notFound("Bank account");
  return { deleted: true };
}
