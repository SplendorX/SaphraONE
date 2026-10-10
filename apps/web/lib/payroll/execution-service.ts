import { payrollDb, payrollTables, readPayrollDbError } from "@/lib/payroll/db";
import { payrollErrors } from "@/lib/payroll/errors";
import { logPayrollAudit } from "@/lib/payroll/audit-service";
import { getPayrollRun } from "@/lib/payroll/payroll-service";
import { awardPayrollPaymentRewards } from "@/lib/payroll/payment-rewards";
import type { PayrollItemRecord, PayrollRunRecord, PayrollRunStatus } from "@/lib/payroll/types";

export type ExecutePayrollInput = {
  accountId: string;
  payrollRunId: string;
  actorId: string;
  txHash?: string | null;
  transactionId?: string | null;
  availableBalance?: string;
  failedItemIds?: string[];
  itemErrors?: Record<string, string>;
};

export async function executePayrollRun(input: ExecutePayrollInput): Promise<PayrollRunRecord> {
  const accountId = input.accountId.toLowerCase();
  const run = await getPayrollRun(accountId, input.payrollRunId);

  // 1. Validate status is APPROVED
  if (run.status !== "APPROVED") {
    if (run.status === "COMPLETED" || run.status === "PARTIALLY_COMPLETED") {
      throw payrollErrors.alreadyCompleted();
    }
    if (run.status === "PROCESSING") {
      throw payrollErrors.alreadyExecuting();
    }
    throw payrollErrors.invalidState(`Payroll run must be APPROVED before execution (current: ${run.status}).`);
  }

  // 2. Validate immutable snapshot exists
  if (!run.snapshot || !run.snapshot.recipients || run.snapshot.recipients.length === 0) {
    throw payrollErrors.invalidState("Approved immutable payroll snapshot is missing or corrupted.");
  }

  // 3. Optional balance validation
  if (input.availableBalance !== undefined) {
    const available = Number(input.availableBalance);
    const required = Number(run.total_required);
    if (available < required) {
      const shortfall = (required - available).toFixed(2);
      throw payrollErrors.insufficientBalance(run.total_required, input.availableBalance, shortfall, run.asset);
    }
  }

  const supabase = payrollDb();

  // 4. Mark PayrollRun PROCESSING
  await supabase
    .from(payrollTables.runs)
    .update({
      status: "PROCESSING" as PayrollRunStatus,
      execution_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  await logPayrollAudit({
    accountId,
    payrollRunId: run.id,
    action: "PAYROLL_EXECUTION_STARTED",
    actorId: input.actorId,
    metadata: {
      txHash: input.txHash,
      recipientCount: run.items.length,
      totalRequired: run.total_required,
    },
  });

  // 5. Update items & record execution entries with idempotency
  const failedSet = new Set(input.failedItemIds ?? []);
  let successCount = 0;
  let failureCount = 0;
  const now = new Date().toISOString();

  for (const item of run.items) {
    const isFailed = failedSet.has(item.id);
    const itemStatus = isFailed ? "FAILED" : "COMPLETED";
    const failureReason = isFailed
      ? input.itemErrors?.[item.id] || "Payment execution failed."
      : null;

    if (isFailed) {
      failureCount += 1;
    } else {
      successCount += 1;
    }

    const idempotencyKey = `exec:${run.id}:${item.id}:${item.attempt_count + 1}`;

    // Record execution attempt
    await supabase.from(payrollTables.executions).insert({
      payroll_run_id: run.id,
      payroll_item_id: item.id,
      batch_payment_id: input.txHash || null,
      transaction_id: input.transactionId || null,
      blockchain_transaction_hash: input.txHash || null,
      idempotency_key: idempotencyKey,
      status: itemStatus,
      attempt_number: item.attempt_count + 1,
      failure_reason: failureReason,
      started_at: now,
      completed_at: now,
    });

    // Update item
    await supabase
      .from(payrollTables.items)
      .update({
        status: itemStatus,
        failure_reason: failureReason,
        attempt_count: item.attempt_count + 1,
        transaction_id: input.transactionId || null,
        blockchain_tx_hash: input.txHash || null,
        settled_at: isFailed ? null : now,
        completed_at: isFailed ? null : now,
        updated_at: now,
      })
      .eq("id", item.id);
  }

  // 6. Determine final run status (Section 45)
  let finalStatus: PayrollRunStatus;
  if (failureCount === 0) {
    finalStatus = "COMPLETED";
  } else if (successCount > 0) {
    finalStatus = "PARTIALLY_COMPLETED";
  } else {
    finalStatus = "FAILED";
  }

  const { data: updatedRun, error } = await supabase
    .from(payrollTables.runs)
    .update({
      status: finalStatus,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", run.id)
    .select("*")
    .single();

  if (error) throw new Error(readPayrollDbError(error, "Could not finalize payroll run status."));

  await logPayrollAudit({
    accountId,
    payrollRunId: run.id,
    action: "PAYROLL_EXECUTION_COMPLETED",
    actorId: input.actorId,
    metadata: {
      finalStatus,
      successCount,
      failureCount,
      txHash: input.txHash,
    },
  });

  if (successCount > 0) {
    await awardPayrollPaymentRewards(accountId, input.txHash);
  }

  return updatedRun as PayrollRunRecord;
}

export async function retryPayrollItem(input: {
  accountId: string;
  itemId: string;
  actorId: string;
  txHash?: string | null;
  transactionId?: string | null;
  success?: boolean;
  failureReason?: string | null;
}): Promise<PayrollItemRecord> {
  const supabase = payrollDb();

  // Load item and verify run ownership
  const { data: item, error: itemError } = await supabase
    .from(payrollTables.items)
    .select("*, payroll_runs!inner(id, account_id, status, asset)")
    .eq("id", input.itemId)
    .single();

  if (itemError || !item) throw payrollErrors.teamMemberNotFound("Payroll item was not found.");
  const run = (item as any).payroll_runs;

  if (run.account_id.toLowerCase() !== input.accountId.toLowerCase()) {
    throw payrollErrors.teamMemberNotOwned();
  }

  // 1. Verify item has not already settled (Section 43)
  if (item.status === "COMPLETED") {
    throw payrollErrors.itemAlreadyPaid();
  }

  const isSuccess = input.success !== false;
  const now = new Date().toISOString();
  const nextAttempt = item.attempt_count + 1;
  const idempotencyKey = `retry:${run.id}:${item.id}:${nextAttempt}`;

  // Check duplicate execution
  const { data: existingExec } = await supabase
    .from(payrollTables.executions)
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingExec) {
    throw payrollErrors.duplicateExecution();
  }

  // Record retry execution
  await supabase.from(payrollTables.executions).insert({
    payroll_run_id: run.id,
    payroll_item_id: item.id,
    batch_payment_id: input.txHash || null,
    transaction_id: input.transactionId || null,
    blockchain_transaction_hash: input.txHash || null,
    idempotency_key: idempotencyKey,
    status: isSuccess ? "COMPLETED" : "FAILED",
    attempt_number: nextAttempt,
    failure_reason: isSuccess ? null : input.failureReason || "Retry failed.",
    started_at: now,
    completed_at: now,
  });

  // Update item
  const { data: updatedItem, error: updateError } = await supabase
    .from(payrollTables.items)
    .update({
      status: isSuccess ? "COMPLETED" : "FAILED",
      failure_reason: isSuccess ? null : input.failureReason || "Retry failed.",
      attempt_count: nextAttempt,
      transaction_id: input.transactionId || null,
      blockchain_tx_hash: input.txHash || null,
      settled_at: isSuccess ? now : null,
      completed_at: isSuccess ? now : null,
      updated_at: now,
    })
    .eq("id", item.id)
    .select("*")
    .single();

  if (updateError) throw new Error(readPayrollDbError(updateError, "Could not update retried item."));

  await logPayrollAudit({
    accountId: input.accountId,
    payrollRunId: run.id,
    action: "PAYROLL_ITEM_RETRIED",
    actorId: input.actorId,
    metadata: {
      itemId: item.id,
      attemptNumber: nextAttempt,
      success: isSuccess,
      txHash: input.txHash,
    },
  });

  // Recalculate parent run final status
  const { data: allItems } = await supabase
    .from(payrollTables.items)
    .select("status")
    .eq("payroll_run_id", run.id);

  const statuses = (allItems ?? []).map((i) => i.status);
  let nextRunStatus: PayrollRunStatus;
  if (statuses.every((s) => s === "COMPLETED")) {
    nextRunStatus = "COMPLETED";
  } else if (statuses.some((s) => s === "COMPLETED")) {
    nextRunStatus = "PARTIALLY_COMPLETED";
  } else {
    nextRunStatus = "FAILED";
  }

  await supabase
    .from(payrollTables.runs)
    .update({
      status: nextRunStatus,
      updated_at: now,
    })
    .eq("id", run.id);

  if (isSuccess) {
    await awardPayrollPaymentRewards(run.account_id, input.txHash);
  }

  return updatedItem as PayrollItemRecord;
}
