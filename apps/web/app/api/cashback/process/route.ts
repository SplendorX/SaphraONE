import { after, type NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";
import { processTransactionCashback } from "@/lib/referral/cashback-service";
import { readJsonRecord, jsonError, jsonOk } from "@/lib/http";
import { ledgerSourceFor, recordLedgerTransaction } from "@/lib/ledger/transactions";
import { assertRecurringAccess } from "@/lib/recurring-auth";
import { verifyWalletOutflow } from "@/lib/referral/verify-activity";

export const runtime = "nodejs";

type ProcessCashbackBody = {
  circleSocialUuid?: unknown;
  walletAddress?: unknown;
  txHash?: unknown;
  /** Labels the transaction in the ledger; never affects what it earns. */
  activityType?: unknown;
  source?: unknown;
};

/**
 * Award transaction cashback for a confirmed payment. The caller must control
 * the wallet, and the amount and token come from the transaction on Arc, not
 * from the request; the hash keys the award so a payment earns it once.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRecord<ProcessCashbackBody>(request);
    if (!body) {
      return jsonError("A valid JSON body is required.", 400);
    }

    if (typeof body.walletAddress !== "string" || !isAddress(body.walletAddress)) {
      return jsonError("A valid wallet address is required.", 400);
    }
    const wallet = getAddress(body.walletAddress).toLowerCase();

    const canAccess = await assertRecurringAccess({
      circleSocialUuid: body.circleSocialUuid,
      ownerWallet: wallet,
    });
    if (!canAccess) {
      return jsonError("Unauthorized: sign in with this wallet first.", 401);
    }

    const txHash =
      typeof body.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.txHash.trim())
        ? (body.txHash.trim().toLowerCase() as `0x${string}`)
        : undefined;
    if (!txHash) {
      return jsonError("A confirmed transaction hash is required.", 400);
    }

    const verified = await verifyWalletOutflow(txHash, wallet);
    if (!verified) {
      return jsonError(
        "This transaction is not confirmed yet or did not send funds from this wallet.",
        422,
      );
    }

    after(() =>
      recordLedgerTransaction({
        source: ledgerSourceFor(
          typeof body.activityType === "string" ? body.activityType : "TRANSFER",
          body.source,
        ),
        txHash,
        verified,
        wallet,
      }),
    );

    const result = await processTransactionCashback({
      walletAddress: wallet,
      amount: verified.amount,
      feePaid: verified.feePaid,
      token: verified.token,
      transactionId: txHash,
      txHash,
    });

    return jsonOk({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process cashback.";
    return jsonError(message, 500);
  }
}
