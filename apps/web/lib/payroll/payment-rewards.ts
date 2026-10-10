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
 * OnePoints for a settled payroll transaction, matching what every other
 * payment flow earns through /api/referrals/activity:
 * - the paying business's transaction cashback,
 * - its referral qualification volume, if it was referred,
 * - its referrer's ongoing activity cashback, once that referral is qualified.
 *
 * Runs on the server for manual and scheduled runs alike. Every amount is read
 * from the transaction receipt, not the run, so fees and failed items never
 * earn, and everything is keyed on the hash so a repeated report pays once.
 * Never throws: rewards must not fail a payroll run.
 */
export async function awardPayrollPaymentRewards(
  payerWallet: string,
  txHash: string | null | undefined,
) {
  const hash = txHash?.trim().toLowerCase();
  if (!hash || !/^0x[0-9a-f]{64}$/.test(hash)) return;
  const wallet = payerWallet.toLowerCase();

  try {
    const outflow = await verifyWalletOutflow(hash as Hash, wallet);
    if (!outflow) return;
    const amountUsd = await stablecoinUsdValue(outflow.amount, outflow.token);

    await Promise.allSettled([
      recordLedgerTransaction({ source: "payroll", txHash: hash, verified: outflow, wallet }),
      processTransactionCashback({
        amount: outflow.amount,
        feePaid: outflow.feePaid,
        token: outflow.token,
        transactionId: hash,
        txHash: hash,
        walletAddress: wallet,
      }),
      (async () => {
        const progress = await evaluateReferralProgressAndQualify({
          referredWallet: wallet,
          contributions: [await referralContribution(hash, outflow)],
          source: "payroll",
          metadata: { activityType: "PAYROLL_DISBURSEMENT", txHash: hash },
        });
        // The payment that qualifies earns the qualification reward, not
        // activity cashback — the same split as the activity route.
        if (progress.qualified && !progress.qualificationResult) {
          await processReferralActivityCashback({
            amountUsdc: amountUsd,
            feePaidUsd: await stablecoinUsdValue(outflow.feePaid, outflow.token),
            transactionId: hash,
            userWallet: wallet,
          });
        }
      })(),
    ]);
  } catch (error) {
    console.warn(
      "[payroll] payment rewards skipped:",
      error instanceof Error ? error.message : error,
    );
  }
}
