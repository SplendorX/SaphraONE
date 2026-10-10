import { referralDb, referralTables } from "@/lib/referral/db";
import { recordLedgerEntry } from "@/lib/referral/ledger-service";
import type { ReferralFraudStatus } from "@/lib/referral/types";

/**
 * Assess risk for a referral connection.
 * Detects self-referrals, sybil accounts, circular referral attempts.
 */
export async function assessReferralRisk(input: {
  referrerWallet: string;
  referredWallet: string;
  ipHash?: string | null;
  userAgent?: string | null;
}): Promise<{
  riskLevel: ReferralFraudStatus;
  reasons: string[];
  isBlocked: boolean;
}> {
  const referrer = input.referrerWallet.toLowerCase();
  const referred = input.referredWallet.toLowerCase();
  const reasons: string[] = [];

  // 1. Definite self-referral
  if (referrer === referred) {
    return {
      riskLevel: "BLOCKED",
      reasons: ["Self-referral is prohibited."],
      isBlocked: true,
    };
  }

  const supabase = referralDb();

  // 2. Circular referral detection (Referred user had previously referred the Referrer)
  const circularCheck = await supabase
    .from(referralTables.referrals)
    .select("id")
    .eq("referrer_wallet", referred)
    .eq("referred_wallet", referrer)
    .maybeSingle();

  if (circularCheck.data) {
    reasons.push("Circular referral relationship detected.");
    return {
      riskLevel: "REVIEW_REQUIRED",
      reasons,
      isBlocked: false, // Flag for review, don't automatically block
    };
  }

  // 3. Sybil velocity check: More than 20 signups from same IP hash in 1 hour
  if (input.ipHash) {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabase
      .from(referralTables.attributions)
      .select("id", { count: "exact" })
      .eq("ip_hash", input.ipHash)
      .gte("created_at", oneHourAgo);

    if ((count ?? 0) > 20) {
      reasons.push("Elevated signup velocity from the same IP network.");
      return {
        riskLevel: "HIGH_RISK",
        reasons,
        isBlocked: false,
      };
    }
  }

  return {
    riskLevel: "LOW_RISK",
    reasons: [],
    isBlocked: false,
  };
}

/**
 * Reverse a previously credited referral reward (e.g. if transaction was refunded or flagged fraudulent).
 * Strictly preserves the immutable audit trail by creating an explicit compensating reversal ledger entry.
 */
export async function reverseReferralReward(input: {
  originalLedgerEntryId: string;
  reason: string;
  adminId: string;
}) {
  const supabase = referralDb();

  const { data: originalEntry, error } = await supabase
    .from(referralTables.ledger)
    .select("*")
    .eq("id", input.originalLedgerEntryId)
    .single();

  if (error || !originalEntry) {
    throw new Error("Original ledger entry not found.");
  }

  if (originalEntry.status === "REVERSED") {
    throw new Error("This ledger entry has already been reversed.");
  }

  const pointsToReverse = originalEntry.display_amount; // positive number
  const reversalIdempotency = `reversal:${originalEntry.id}`;

  // 1. Create compensating negative ledger entry
  const reversalResult = await recordLedgerEntry({
    walletAddress: originalEntry.wallet_address,
    entryType: "REVERSAL",
    points: -pointsToReverse,
    idempotencyKey: reversalIdempotency,
    description: `Reversal of reward: ${input.reason}`,
    originalLedgerEntryId: originalEntry.id,
    referralId: originalEntry.referral_id,
    createdBy: input.adminId,
    metadata: {
      reason: input.reason,
      reversedEntryId: originalEntry.id,
      reversedAmount: pointsToReverse,
    },
  });

  // 2. Mark original entry as reversed
  await supabase
    .from(referralTables.ledger)
    .update({ status: "REVERSED" })
    .eq("id", originalEntry.id);

  // 3. Log to admin audit log
  await supabase.from(referralTables.auditLogs).insert({
    admin_id: input.adminId,
    action: "REVERSE_REWARD",
    target_type: "LEDGER_ENTRY",
    target_id: originalEntry.id,
    reason: input.reason,
    changes: {
      reversedEntry: originalEntry,
      reversalEntry: reversalResult.entry,
    },
  });

  return reversalResult;
}
