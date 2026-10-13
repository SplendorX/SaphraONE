import { NextResponse, type NextRequest } from "next/server";
import { isAddress, zeroHash } from "viem";

import { getSaphraSendAddress, swiftBatchFeeRecipient } from "@/lib/contracts";
import {
  feePercentLabel,
  formatFeeAmount,
  SEND_FEE_BPS,
  sendFeeUnits,
  usesLegacySendFee,
} from "@/lib/fees";
import { assertSavingsAccess, normalizeOwnerWallet } from "@/lib/save/auth";
import { swiftSaveVaultAddress } from "@/lib/save/config";
import { pocketIdToBytes32 } from "@/lib/save/pocket-id";
import {
  evaluateSpendSaveForPayment,
  readSavingsSupabaseError,
} from "@/lib/save/service";
import {
  normalizeAmount,
  normalizeCurrency,
} from "@/lib/save/validation";
import { arcTokens } from "@/lib/tokens";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

/**
 * Backend-authored send quote: platform fee is always applied, and Spend&Save
 * is included only when the server says the rule is active.
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
    return jsonError("Authorize this wallet before quoting a payment.", 401);
  }

  const currency = normalizeCurrency(body.currency);
  const amount = normalizeAmount(body.amount, currency);
  if (!amount) {
    return jsonError("Enter a valid payment amount.", 400);
  }

  const decimals = arcTokens[currency].decimals;
  const paymentAmountUnits = BigInt(amount.amount_units);
  const sendRouter = getSaphraSendAddress();
  const feeUnits = sendFeeUnits(paymentAmountUnits, sendRouter);
  const feeRecipient = swiftBatchFeeRecipient;
  const vault = swiftSaveVaultAddress();

  try {
    const evaluation = await evaluateSpendSaveForPayment({
      ownerWallet,
      paymentAmountUnits,
      currency,
      paymentKind:
        typeof body.paymentKind === "string" ? body.paymentKind : "outgoing",
      platformFeeUnits: feeUnits,
    });

    const saveUnits = evaluation
      ? BigInt(evaluation.quote.saveAmountUnits)
      : 0n;
    const totalUnits = paymentAmountUnits + feeUnits + saveUnits;

    return NextResponse.json({
      paymentAmount: amount.amount,
      paymentAmountUnits: paymentAmountUnits.toString(),
      // A flat band fee has no rate: 0 bps, and the label names it.
      platformFeeBps: usesLegacySendFee(sendRouter) ? SEND_FEE_BPS : 0,
      platformFeeLabel: usesLegacySendFee(sendRouter) ? feePercentLabel(SEND_FEE_BPS) : "Service fee",
      platformFeeAmount: formatFeeAmount(feeUnits, decimals),
      platformFeeUnits: feeUnits.toString(),
      feeRecipient: isAddress(feeRecipient) ? feeRecipient : "",
      sendRouter: isAddress(sendRouter) ? sendRouter : "",
      vaultAddress: vault ?? "",
      spendSave: evaluation
        ? {
            active: true,
            saveAmount: evaluation.quote.saveAmount,
            saveAmountUnits: evaluation.quote.saveAmountUnits,
            percentage: evaluation.quote.percentage,
            pocketName: evaluation.pocket.name,
            pocketId: evaluation.pocket.id,
            pocketIdBytes32: pocketIdToBytes32(evaluation.pocket.id),
            targetCapped: evaluation.quote.targetCapped,
          }
        : {
            active: false,
            saveAmount: "0",
            saveAmountUnits: "0",
            percentage: "0",
            pocketIdBytes32: zeroHash,
          },
      totalRequired: formatFeeAmount(totalUnits, decimals),
      totalRequiredUnits: totalUnits.toString(),
      currency,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : readSavingsSupabaseError(null, "Payment quote failed.");
    return jsonError(message, 500);
  }
}
