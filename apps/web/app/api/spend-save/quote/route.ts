import { NextResponse, type NextRequest } from "next/server";

import { assertSavingsAccess, normalizeOwnerWallet } from "@/lib/save/auth";
import {
  evaluateSpendSaveForPayment,
  readSavingsSupabaseError,
} from "@/lib/save/service";
import { sendFeeUnits } from "@/lib/fees";
import {
  normalizeAmount,
  normalizeCurrency,
} from "@/lib/save/validation";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

/**
 * Server-enforced Spend&Save quote for an outgoing payment.
 * Used by the payment UI before submission — never trust client-only math.
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
    return jsonError("Authorize this wallet before quoting Spend&Save.", 401);
  }

  const currency = normalizeCurrency(body.currency);
  const amount = normalizeAmount(body.amount, currency);
  if (!amount) {
    return jsonError("Enter a valid payment amount.", 400);
  }

  try {
    const paymentAmountUnits = BigInt(amount.amount_units);
    const evaluation = await evaluateSpendSaveForPayment({
      ownerWallet,
      paymentAmountUnits,
      currency,
      paymentKind:
        typeof body.paymentKind === "string" ? body.paymentKind : "outgoing",
      platformFeeUnits: sendFeeUnits(paymentAmountUnits),
    });

    if (!evaluation) {
      return NextResponse.json({
        active: false,
        quote: null,
        pocket: null,
        config: null,
        message: "Spend&Save is not active for this payment.",
      });
    }

    const feeNote =
      evaluation.quote.targetCapped
        ? ` (capped to target remaining for ${evaluation.pocket.name})`
        : "";

    return NextResponse.json({
      active: true,
      quote: evaluation.quote,
      breakdown: {
        payment: evaluation.quote.paymentAmount,
        savings: evaluation.quote.saveAmount,
        networkFee: evaluation.quote.networkFeeAmount,
        platformFee: evaluation.quote.platformFeeAmount,
        totalRequired: evaluation.quote.totalRequired,
        currency,
      },
      pocket: evaluation.pocket,
      config: evaluation.config,
      message: `Save ${evaluation.quote.saveAmount} ${currency} (${evaluation.quote.percentage}%) to ${evaluation.pocket.name}${feeNote}. Total required: ${evaluation.quote.totalRequired} ${currency}.`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : readSavingsSupabaseError(null, "Spend&Save quote failed.");
    return jsonError(message, 500);
  }
}
