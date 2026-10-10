import type { Hash } from "viem";

import { processReferralActivityCashback } from "@/lib/referral/activity-service";
import { processTransactionCashback } from "@/lib/referral/cashback-service";
import { stablecoinUsdValue } from "@/lib/referral/fx";
import {
  evaluateReferralProgressAndQualify,
  referralContribution,
} from "@/lib/referral/qualification-service";
import { verifyWalletOutflow } from "@/lib/referral/verify-activity";
import { recordLedgerTransaction } from "@/lib/ledger/transactions";

/**
 * OnePoints for a finished RecurePay payment: the payer's transaction
 * cashback, their referral progress, and their referrer's activity cashback.
 *
 * Called from every path that completes a run (Autopay worker, provider
 * webhook, delayed-confirmation reconcile). Each run reaches exactly one of
 * those paths, and the cashback is keyed on the run id, so a payment is never
 * rewarded twice. Rewards never block or fail the payment itself.
 */
export async function awardRecurringCompletionRewards(input: {
  amount: number | string | null | undefined;
  occurrenceId: string;
  ownerWallet: string | null | undefined;
  tokenSymbol: string | null | undefined;
  txHash: string | null | undefined;
}) {
  const amount = Number(input.amount ?? 0);
  if (!(amount > 0) || !input.ownerWallet) {
    return;
  }

  // Referral rewards are priced in USD: EURC counts at the live rate.
  // (processTransactionCashback converts on its own.)
  const amountUsd = await stablecoinUsdValue(amount, input.tokenSymbol);

  await Promise.allSettled([
    recordLedgerTransaction({
      metadata: { occurrenceId: input.occurrenceId },
      source: "recurepay",
      txHash: input.txHash,
      wallet: input.ownerWallet,
    }),
    processTransactionCashback({
      amount,
      token: input.tokenSymbol ?? "USDC",
      transactionId: input.occurrenceId,
      txHash: input.txHash ?? undefined,
      walletAddress: input.ownerWallet,
    }),
    countTowardReferral(input.ownerWallet, input.txHash, input.occurrenceId),
    processReferralActivityCashback({
      amountUsdc: amountUsd,
      transactionId: input.txHash || input.occurrenceId,
      userWallet: input.ownerWallet,
    }),
  ]);
}

/**
 * Referral volume counts only receipt-verified payments, so the share paid to
 * the payer's own referrer can be left out. A run without a hash is left to
 * the dashboard's chain sync, which verifies it the same way.
 */
async function countTowardReferral(
  ownerWallet: string,
  txHash: string | null | undefined,
  occurrenceId: string,
) {
  const hash = txHash?.trim().toLowerCase();
  if (!hash || !/^0x[0-9a-f]{64}$/.test(hash)) return;
  const outflow = await verifyWalletOutflow(hash as Hash, ownerWallet);
  if (!outflow) return;

  await evaluateReferralProgressAndQualify({
    metadata: { activityType: "TRANSFER", transactionId: occurrenceId, txHash: hash },
    referredWallet: ownerWallet,
    source: "recurring",
    // Keyed on the hash: the RecurePay hub reports the same payment too.
    contributions: [await referralContribution(hash, outflow)],
  });
}
