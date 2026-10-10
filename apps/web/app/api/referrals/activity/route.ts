import { after, type NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";
import {
  evaluateReferralProgressAndQualify,
  referralContribution,
} from "@/lib/referral/qualification-service";
import { processReferralActivityCashback } from "@/lib/referral/activity-service";
import { processTransactionCashback } from "@/lib/referral/cashback-service";
import { getReferralForUser } from "@/lib/referral/attribution-service";
import { readJsonRecord, jsonError, jsonOk } from "@/lib/http";
import { ledgerSourceFor, recordLedgerTransaction } from "@/lib/ledger/transactions";
import { assertRecurringAccess } from "@/lib/recurring-auth";
import { stablecoinUsdValue } from "@/lib/referral/fx";
import { verifyWalletOutflow } from "@/lib/referral/verify-activity";
import type { ReferralActivityType } from "@/lib/referral/types";
import { accrueReferralCommission } from "@/lib/referral/usdc-commission";
import { rewardsV2Enabled } from "@/lib/rewards/config";

export const runtime = "nodejs";

type ReferralActivityBody = {
  circleSocialUuid?: unknown;
  walletAddress?: unknown;
  transactionId?: unknown;
  txHash?: unknown;
  amount?: unknown;
  amountUsdc?: unknown;
  token?: unknown;
  activityType?: unknown;
  accountType?: unknown;
  /** The feature that made the transaction (checkout, recurepay…), for the ledger. */
  source?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRecord<ReferralActivityBody>(request);
    if (!body) {
      return jsonError("A valid JSON body is required.", 400);
    }

    if (typeof body.walletAddress !== "string" || !isAddress(body.walletAddress)) {
      return jsonError("A valid wallet address is required.", 400);
    }

    const wallet = getAddress(body.walletAddress).toLowerCase();

    // Points and referral rewards are money-adjacent: the caller must control
    // the wallet, and the reward is sized from the chain, never the request.
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
      return jsonError("A confirmed transaction hash is required for cashback.", 400);
    }

    const verified = await verifyWalletOutflow(txHash, wallet);
    if (!verified) {
      return jsonError(
        "This transaction is not confirmed yet or did not send funds from this wallet.",
        422,
      );
    }

    // One reward per on-chain transaction: key everything on the hash.
    const transactionId = txHash;
    const token = verified.token;
    const amountUsdc = verified.amount;
    // Referral volume is in USD: EURC counts at the live EUR→USD rate.
    const referralAmountUsd = await stablecoinUsdValue(verified.amount, token);

    const validActivityTypes: ReferralActivityType[] = [
      "TRANSFER",
      "INVOICE_PAYMENT",
      "PAYROLL_DISBURSEMENT",
      "SWAP",
      "POCKET_DEPOSIT",
      "BATCH_PAYMENT",
    ];

    const activityType: ReferralActivityType =
      typeof body.activityType === "string" &&
      validActivityTypes.includes(body.activityType as ReferralActivityType)
        ? (body.activityType as ReferralActivityType)
        : "TRANSFER";

    const effectiveId = txHash;

    // The verified transaction ledger (campaigns, leaderboards), after the response.
    after(() =>
      recordLedgerTransaction({
        source: ledgerSourceFor(activityType, body.source),
        txHash,
        verified,
        wallet,
      }),
    );

    // Always process general transaction cashback for all SaphraONE accounts (>= 20 USDC/EURC)
    const userGeneralCashback = await processTransactionCashback({
      walletAddress: wallet,
      amount: amountUsdc,
      feePaid: verified.feePaid,
      token,
      transactionId,
      txHash,
    }).catch(() => null);

    // 1. Check if user was referred
    const referral = await getReferralForUser(wallet);
    if (!referral) {
      return jsonOk({
        isReferred: false,
        qualified: false,
        cashbackAwarded: false,
        userCashback: userGeneralCashback,
      });
    }

    // Invite & Earn v2: the referrer earns a USDC share of the fee this
    // transaction actually paid; the old points milestones no longer apply.
    if (rewardsV2Enabled()) {
      const earning = await accrueReferralCommission({
        feeUsd: await stablecoinUsdValue(verified.feePaid, token),
        referredWallet: wallet,
        source: activityType.toLowerCase(),
        txHash,
        volumeUsd: referralAmountUsd,
      }).catch((cause) => {
        console.error("[referral:commission]", cause instanceof Error ? cause.message : cause);
        return null;
      });
      return jsonOk({
        isReferred: true,
        referrerCommissionUsdc: earning ? Number(earning.amount_usdc) : 0,
        userCashback: userGeneralCashback,
      });
    }

    // 2. If not yet qualified, evaluate qualification criteria
    if (referral.status !== "QUALIFIED" && referral.status !== "REWARDED") {
      const evalResult = await evaluateReferralProgressAndQualify({
        referredWallet: wallet,
        contributions: [await referralContribution(txHash, verified)],
        metadata: {
          activityType,
          transactionId: effectiveId,
          txHash,
          token,
        },
      });

      if (evalResult.qualified) {
        return jsonOk({
          isReferred: true,
          qualified: true,
          qualificationResult: evalResult.qualificationResult,
          cashbackAwarded: false, // Milestone reached! Double-sided qualification reward issued
          userCashback: userGeneralCashback,
        });
      }

      return jsonOk({
        isReferred: true,
        volumeUsd: evalResult.volumeUsd,
        qualified: false,
        cashbackAwarded: false,
        userCashback: userGeneralCashback,
      });
    }

    // 3. If already qualified, process ongoing activity cashback for Referrer
    const cashbackResult = await processReferralActivityCashback({
      userWallet: wallet,
      transactionId: effectiveId,
      amountUsdc: referralAmountUsd,
      feePaidUsd: await stablecoinUsdValue(verified.feePaid, token),
    });

    return jsonOk({
      isReferred: true,
      qualified: true,
      cashbackAwarded: cashbackResult.cashbackAwarded,
      referrerCashbackPoints: cashbackResult.pointsAwarded ?? 0,
      referrerWallet: cashbackResult.referrerWallet,
      userCashback: userGeneralCashback,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error processing referral activity.";
    return jsonError(message, 500);
  }
}
