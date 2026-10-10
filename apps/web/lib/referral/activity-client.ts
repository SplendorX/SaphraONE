import { toast } from "sonner";
import {
  recordAccountActivity,
  type RecordAccountActivityClientInput,
} from "@/lib/activity/client";
import {
  getCircleLoginIdentity,
  readCircleLogin,
} from "@/lib/circle-session";
import { emitOnePointsUpdated } from "@/lib/referral/use-one-points";
import type { ReferralActivityType } from "@/lib/referral/types";

export type RecordActivityInput = {
  walletAddress?: string | null;
  amount: number | string;
  token?: string;
  txHash?: string;
  transactionId?: string;
  activityType: ReferralActivityType;
  showToast?: boolean;
  /**
   * Labels the transaction on the dashboard's Activity board with the feature
   * that made it. Omit to skip the label (cashback still runs).
   */
  activity?: Omit<
    RecordAccountActivityClientInput,
    "walletAddress" | "amount" | "token" | "txHash"
  >;
};

function circleSocialUuid() {
  try {
    return getCircleLoginIdentity(readCircleLogin()).socialUserUUID ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Universally records platform transaction activity across all modules:
 * - Send Payments (Dashboard)
 * - BulkPay
 * - RecurePay
 * - Swaps (Swap Hub)
 *
 * Atomically triggers:
 * 1. General transaction cashback (>= 20 USDC/EURC) credited directly to user
 * 2. Referral qualification progress towards activation milestones
 * 3. Ongoing activity cashback to the referrer if already qualified
 */
export async function recordPlatformTransactionActivity(
  input: RecordActivityInput,
) {
  const {
    walletAddress,
    amount,
    token = "USDC",
    txHash,
    transactionId,
    activityType,
    showToast = true,
    activity,
  } = input;

  if (!walletAddress) return null;

  if (activity) {
    void recordAccountActivity({
      amount,
      token,
      txHash,
      walletAddress,
      ...activity,
    });
  }

  const numeric =
    typeof amount === "string" ? parseFloat(amount.trim()) : amount;
  if (isNaN(numeric) || numeric <= 0) return null;

  try {
    const res = await fetch("/api/referrals/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Transitional: the server prefers the signed wallet session.
        circleSocialUuid: circleSocialUuid(),
        walletAddress,
        amount: numeric,
        amountUsdc: numeric,
        token,
        txHash,
        transactionId,
        activityType,
        // Categorizes the transaction in the ledger (checkout, recurepay…).
        source: activity?.source,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (
      data?.userCashback?.pointsAwarded > 0 &&
      !data?.userCashback?.alreadyProcessed
    ) {
      emitOnePointsUpdated();
      if (showToast) {
        toast.success(
          `🎉 Cashback Earned: +${data.userCashback.pointsAwarded} OnePoints (${data.userCashback.usdcValue} USDC) for this transaction!`,
        );
      }
    }

    if (data?.qualified) {
      emitOnePointsUpdated();
      if (showToast) {
        toast.success("🏆 Referral Milestone Reached! Welcome reward unlocked!");
      }
    }

    return data;
  } catch {
    // Non-blocking on network / background errors
    return null;
  }
}
