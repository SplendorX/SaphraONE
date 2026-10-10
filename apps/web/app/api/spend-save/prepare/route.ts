import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { assertSavingsAccess, normalizeOwnerWallet } from "@/lib/save/auth";
import { swiftSaveVaultAddress } from "@/lib/save/config";
import { pocketIdToBytes32 } from "@/lib/save/pocket-id";
import {
  createSpendSaveEvent,
  evaluateSpendSaveForPayment,
  getOrCreatePendingTransaction,
  readSavingsSupabaseError,
  updateSpendSaveEvent,
} from "@/lib/save/service";
import {
  normalizeAmount,
  normalizeCurrency,
  normalizeIdempotencyKey,
  isValidPaymentTxRef,
} from "@/lib/save/validation";
import { arcTokens } from "@/lib/tokens";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

/**
 * After payment is submitted, prepare the linked savings leg.
 * Creates Spend&Save event + pending SPEND_SAVE transaction (idempotent).
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("A valid JSON body is required.", 400);
  }

  const ownerWallet = normalizeOwnerWallet(body.ownerWallet);
  if (!ownerWallet) {
    return jsonError("A valid owner wallet is required.", 400);
  }

  const canAccess = await assertSavingsAccess({
    circleSocialUuid: body.circleSocialUuid,
    ownerWallet,
  });
  if (!canAccess) {
    return jsonError("Authorize this wallet before preparing Spend&Save.", 401);
  }

  const currency = normalizeCurrency(body.currency);
  const amount = normalizeAmount(body.amount, currency);
  if (!amount) {
    return jsonError("Enter a valid payment amount.", 400);
  }

  const rawPaymentTx =
    typeof body.paymentTxHash === "string" ? body.paymentTxHash.trim() : null;
  const paymentTxHash =
    rawPaymentTx && isValidPaymentTxRef(rawPaymentTx) ? rawPaymentTx : null;

  if (!paymentTxHash && body.requirePaymentTx === true) {
    return jsonError(
      "Payment transaction reference is required before preparing savings.",
      400,
    );
  }

  try {
    const evaluation = await evaluateSpendSaveForPayment({
      ownerWallet,
      paymentAmountUnits: BigInt(amount.amount_units),
      currency,
      paymentKind:
        typeof body.paymentKind === "string" ? body.paymentKind : "outgoing",
    });

    if (!evaluation) {
      return jsonError("Spend&Save is not active for this payment.", 400);
    }

    if (BigInt(evaluation.quote.saveAmountUnits) <= 0n) {
      return jsonError("Calculated savings amount is zero.", 400);
    }

    const vault = swiftSaveVaultAddress();
    if (!vault) {
      return jsonError(
        "SwiftSaveVault is not configured. Set NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS.",
        503,
      );
    }

    const idempotencyKey =
      normalizeIdempotencyKey(body.idempotencyKey) ??
      `spend_save:${ownerWallet}:${paymentTxHash ?? randomUUID()}:${evaluation.quote.saveAmountUnits}`;

    const transaction = await getOrCreatePendingTransaction({
      ownerWallet,
      pocketId: evaluation.pocket.id,
      type: "SPEND_SAVE",
      amount: evaluation.quote.saveAmount,
      amountUnits: evaluation.quote.saveAmountUnits,
      currency,
      idempotencyKey,
      relatedPaymentId:
        typeof body.paymentId === "string" ? body.paymentId : null,
      relatedPaymentTxHash: paymentTxHash,
      metadata: {
        percentage: evaluation.quote.percentage,
        paymentAmount: evaluation.quote.paymentAmount,
        paymentAmountUnits: evaluation.quote.paymentAmountUnits,
      },
    });

    let event = await createSpendSaveEvent({
      ownerWallet,
      config: evaluation.config,
      paymentAmount: evaluation.quote.paymentAmount,
      paymentAmountUnits: evaluation.quote.paymentAmountUnits,
      saveAmount: evaluation.quote.saveAmount,
      saveAmountUnits: evaluation.quote.saveAmountUnits,
      currency,
      paymentId: typeof body.paymentId === "string" ? body.paymentId : null,
      paymentTxHash,
      savingsTransactionId: transaction.id,
      status: paymentTxHash ? "PAYMENT_SUBMITTED" : "PENDING",
    });

    if (paymentTxHash) {
      event = await updateSpendSaveEvent(event.id, ownerWallet, {
        status: "PAYMENT_CONFIRMED",
        payment_tx_hash: paymentTxHash,
        savings_transaction_id: transaction.id,
      });
    }

    const token = arcTokens[currency];

    return NextResponse.json({
      event,
      transaction,
      vaultAddress: vault,
      pocketIdBytes32: pocketIdToBytes32(evaluation.pocket.id),
      tokenAddress: token.address,
      amountUnits: evaluation.quote.saveAmountUnits,
      quote: evaluation.quote,
      message:
        "Execute vault.deposit for the savings amount, then call /api/spend-save/complete.",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : readSavingsSupabaseError(null, "Spend&Save could not be prepared.");
    return jsonError(message, 500);
  }
}
