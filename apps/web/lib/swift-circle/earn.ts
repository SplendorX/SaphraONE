import { writeCircleActivity } from "@/lib/swift-circle/activity";
import { postFinancialCard } from "@/lib/swift-circle/chat";
import { circleDb, circleTables } from "@/lib/swift-circle/db";
import { circleErrors } from "@/lib/swift-circle/errors";
import { confirmLedgerEntry, sumConfirmedUnits } from "@/lib/swift-circle/ledger";
import { unitsToAmount } from "@/lib/swift-circle/money";
import { notifyMany } from "@/lib/swift-circle/notifications";
import {
  findContributionByTxHash,
  logDeposit,
  markContributionFailed,
  normalizeTxHash,
  txHashAlreadyConfirmed,
  verifyContributionRow,
} from "@/lib/swift-circle/deposits";
import { listActiveMemberWallets } from "@/lib/swift-circle/service";
import type { CircleEarnContributionRecord } from "@/lib/swift-circle/types";

export async function confirmEarnContributionFromTx(
  txHash: string,
  options?: { waitMs?: number; strict?: boolean },
) {
  const hash = normalizeTxHash(txHash);
  if (!hash) return null;
  const row = await findContributionByTxHash<CircleEarnContributionRecord>(
    circleTables.earnContributions,
    hash,
  );
  if (!row) return null;
  if (row.status === "confirmed") return row;
  if (row.status === "failed" || row.status === "cancelled") return null;

  let verified: Awaited<ReturnType<typeof verifyContributionRow>>;
  try {
    verified = await verifyContributionRow({
      amountUnits: row.amount_units,
      asset: row.asset,
      txHash: hash,
      waitMs: options?.waitMs ?? 0,
    });
  } catch (error) {
    console.error("[circle-earn-verify]", error);
    return null;
  }
  if (!verified.ok && verified.pending) {
    logDeposit({
      product: "earn",
      status: "pending",
      circleId: row.circle_id,
      txHash: hash,
      extra: { reason: verified.reason, contributionId: row.id },
    });
    return null;
  }
  if (!verified.ok) {
    await markContributionFailed(circleTables.earnContributions, row.id);
    logDeposit({
      product: "earn",
      status: "failed",
      circleId: row.circle_id,
      txHash: hash,
      extra: { reason: verified.reason, contributionId: row.id },
    });
    if (options?.strict) throw circleErrors.invalid(verified.reason);
    return null;
  }
  if (await txHashAlreadyConfirmed({ txHash: hash, exceptId: row.id })) {
    await markContributionFailed(circleTables.earnContributions, row.id);
    if (options?.strict) {
      throw circleErrors.conflict("This transaction was already credited.");
    }
    return null;
  }

  const supabase = circleDb();
  const { data: updated } = await supabase
    .from(circleTables.earnContributions)
    .update({
      status: "confirmed",
      tx_hash: hash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .neq("status", "confirmed")
    .select("*")
    .maybeSingle();
  if (!updated) return row;
  try {
    await confirmLedgerEntry(`earn:${row.idempotency_key}`, hash);
    await reconcileEarnBalance(row.circle_id);
  } catch (error) {
    console.error("[circle-earn-reconcile]", error);
  }
  try {
    await writeCircleActivity({
      circleId: row.circle_id,
      actorWallet: row.user_wallet,
      activityType: "earn.contribution",
      entityType: "earn_contribution",
      entityId: row.id,
      summary: `Contributed ${row.amount} ${row.asset} to Circle Earn`,
    });
    await postFinancialCard({
      circleId: row.circle_id,
      content: `Circle Earn contribution of ${row.amount} ${row.asset}`,
      metadata: { type: "earn_contribution", contributionId: row.id },
    });
    const members = await listActiveMemberWallets(row.circle_id);
    await notifyMany(members, {
      eventId: `circle-earn:${row.id}`,
      circleId: row.circle_id,
      kind: "circle_earn",
      title: "Circle Earn contribution",
      body: `${row.amount} ${row.asset} was added to Circle Earn.`,
    });
  } catch (error) {
    console.error("[circle-earn-notify]", error);
  }
  logDeposit({
    product: "earn",
    status: "confirmed",
    circleId: row.circle_id,
    txHash: hash,
    extra: { contributionId: row.id },
  });
  return updated as CircleEarnContributionRecord;
}

export async function reconcileEarnBalance(circleId: string) {
  const contributions = await sumConfirmedUnits({
    circleId,
    productType: "earn",
    entryType: "contribution",
  });
  const withdrawals = await sumConfirmedUnits({
    circleId,
    productType: "earn",
    entryType: "withdrawal",
  });
  const principal = contributions - withdrawals;
  if (principal < 0n) {
    throw circleErrors.conflict("Circle Earn ledger would go negative.");
  }
  const supabase = circleDb();
  const amount = unitsToAmount(principal, "USDC");
  await supabase
    .from(circleTables.earnAccounts)
    .update({
      principal: amount,
      principal_units: principal.toString(),
      current_value: amount,
      current_value_units: principal.toString(),
      updated_at: new Date().toISOString(),
    })
    .eq("circle_id", circleId);
  return principal;
}
