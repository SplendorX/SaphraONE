import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  advanceNextRunAt,
  buildOccurrenceIdempotencyKey,
  isOpenAutopayExecutionStatus,
  RECURRING_MAX_ATTEMPTS,
  retryDelayMsForAttempt,
  withExecutionDefaults,
  withScheduleDefaults,
  type RecurringExecutionRecord,
  type RecurringExecutionStatus,
  type RecurringScheduleRecord,
} from "@/lib/recurring-utils";

const schedulesTable =
  process.env.SUPABASE_RECURRING_SCHEDULES_TABLE ?? "recurring_schedules";
const executionsTable =
  process.env.SUPABASE_RECURRING_EXECUTIONS_TABLE ?? "recurring_executions";

export function readRecurringSupabaseError(
  error: { message?: string } | null,
  fallback = "Supabase could not process this recurring payment.",
) {
  const message = error?.message ?? "";

  if (message.toLowerCase().includes("permission denied")) {
    return "Supabase rejected access to recurring tables. Run packages/database/supabase/recurring-schedules.sql.";
  }

  if (message.toLowerCase().includes("does not exist")) {
    return "Create recurring tables with packages/database/supabase/recurring-schedules.sql.";
  }

  return message || fallback;
}

function isDuplicateError(error: { message?: string; code?: string } | null) {
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "23505" ||
    message.includes("duplicate") ||
    message.includes("unique")
  );
}

/**
 * The payer's allowance to the configured executor is gone (for example the
 * executor was redeployed, or the approval went to a previous one). Stop
 * treating the schedule as authorized so its owner sees "Authorize Autopay"
 * again, instead of the worker retrying a payment that cannot succeed.
 */
/**
 * A fresh authorization fixes whatever the waiting retries were backing off
 * from (usually a missing allowance), so make them due now instead of making
 * the owner wait out the backoff after authorizing.
 */
export async function expediteScheduleRetries(scheduleId: string) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from(executionsTable)
    .update({ next_retry_at: new Date().toISOString() })
    .eq("schedule_id", scheduleId)
    .eq("status", "RETRYING");
  if (error) {
    throw new Error(error.message);
  }
}

export async function requireScheduleReauthorization(scheduleId: string) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from(schedulesTable)
    .update({
      authorization_status: "REAUTHORIZATION_REQUIRED",
      authorization_tx_hash: null,
      authorized_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId)
    .eq("authorization_status", "AUTHORIZED");
  if (error) {
    throw new Error(error.message);
  }
}

export async function loadScheduleById(scheduleId: string) {
  const supabase = createSupabaseAdminClient();
  const loaded = await supabase
    .from(schedulesTable)
    .select("*")
    .eq("id", scheduleId)
    .maybeSingle();

  if (loaded.error) {
    throw new Error(readRecurringSupabaseError(loaded.error));
  }
  if (!loaded.data) {
    return null;
  }
  return withScheduleDefaults(loaded.data as RecurringScheduleRecord);
}

export async function loadExecutionById(executionId: string) {
  const supabase = createSupabaseAdminClient();
  const loaded = await supabase
    .from(executionsTable)
    .select("*")
    .eq("id", executionId)
    .maybeSingle();

  if (loaded.error) {
    throw new Error(readRecurringSupabaseError(loaded.error));
  }
  if (!loaded.data) {
    return null;
  }
  return withExecutionDefaults(loaded.data as RecurringExecutionRecord);
}

export async function loadExecutionsForSchedule(scheduleId: string) {
  const supabase = createSupabaseAdminClient();
  const loaded = await supabase
    .from(executionsTable)
    .select("*")
    .eq("schedule_id", scheduleId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (loaded.error) {
    throw new Error(readRecurringSupabaseError(loaded.error));
  }

  return (loaded.data ?? []).map((row) =>
    withExecutionDefaults(row as RecurringExecutionRecord),
  );
}

export async function updateExecutionRow(
  executionId: string,
  updates: Record<string, string | number | boolean | null>,
  expectedStatuses?: RecurringExecutionStatus[],
) {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from(executionsTable)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", executionId);

  if (expectedStatuses && expectedStatuses.length > 0) {
    query = query.in("status", expectedStatuses);
  }

  const mutation = await query.select("*").maybeSingle();

  if (mutation.error) {
    throw new Error(readRecurringSupabaseError(mutation.error));
  }
  if (!mutation.data) {
    return null;
  }
  return withExecutionDefaults(mutation.data as RecurringExecutionRecord);
}

export async function advanceScheduleAfterConfirmedRun(
  scheduleId: string,
  dueAt: string | Date,
) {
  const supabase = createSupabaseAdminClient();
  const dueDate =
    typeof dueAt === "string" ? new Date(dueAt) : new Date(dueAt.getTime());
  const loaded = await loadScheduleById(scheduleId);

  if (!loaded) {
    return;
  }

  const schedule = loaded;
  const scheduleNextRun = new Date(schedule.next_run_at).getTime();

  if (Math.abs(scheduleNextRun - dueDate.getTime()) > 1000) {
    return;
  }

  const nextRunAt = advanceNextRunAt(
    dueDate,
    schedule.frequency,
    schedule.interval_days,
  );
  const reachedMaxRuns =
    schedule.max_runs !== null &&
    schedule.max_runs !== undefined &&
    schedule.run_count + 1 >= schedule.max_runs;
  const reachedEndDate =
    schedule.ends_at !== null &&
    schedule.ends_at !== undefined &&
    nextRunAt.getTime() > new Date(schedule.ends_at).getTime();

  await supabase
    .from(schedulesTable)
    .update({
      last_run_at: dueDate.toISOString(),
      next_run_at: nextRunAt.toISOString(),
      run_count: schedule.run_count + 1,
      status: reachedMaxRuns || reachedEndDate ? "completed" : schedule.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduleId);
}

export async function markOccurrenceCompleted(input: {
  amountUnits: string;
  dueAt: string;
  executionId: string;
  scheduleId: string;
  txHash?: string | null;
  providerTransactionId?: string | null;
}) {
  const now = new Date().toISOString();
  const updated = await updateExecutionRow(
    input.executionId,
    {
      completed_at: now,
      confirmed_at: now,
      error_message: null,
      provider_transaction_id:
        input.providerTransactionId ?? input.txHash ?? null,
      status: "COMPLETED",
      tx_hash: input.txHash ?? null,
    },
    ["PROCESSING", "SUBMITTED", "CONFIRMING", "DUE", "submitted"],
  );

  if (!updated) {
    const current = await loadExecutionById(input.executionId);
    if (current && (current.status === "COMPLETED" || current.status === "confirmed")) {
      return current;
    }
    return null;
  }

  const schedule = await loadScheduleById(input.scheduleId);
  if (schedule) {
    const supabase = createSupabaseAdminClient();
    const executed = (() => {
      try {
        return (
          BigInt(schedule.executed_amount_units ?? "0") +
          BigInt(input.amountUnits)
        ).toString();
      } catch {
        return input.amountUnits;
      }
    })();

    await supabase
      .from(schedulesTable)
      .update({
        executed_amount_units: executed,
        failure_count: 0,
        last_executed_at: now,
        last_execution_id: input.executionId,
        updated_at: now,
      })
      .eq("id", input.scheduleId);
  }

  await advanceScheduleAfterConfirmedRun(input.scheduleId, input.dueAt);
  return updated;
}

export async function markOccurrenceFailed(input: {
  executionId: string;
  message: string;
  permanent: boolean;
  scheduleId: string;
}) {
  const current = await loadExecutionById(input.executionId);
  if (!current) {
    return null;
  }

  const attemptCount = current.attempt_count || 1;
  const schedule = await loadScheduleById(input.scheduleId);
  const maxAttempts = schedule?.max_retries ?? RECURRING_MAX_ATTEMPTS;
  const now = new Date();
  const permanent = input.permanent || attemptCount >= maxAttempts;
  const nextStatus: RecurringExecutionStatus = permanent
    ? "FAILED_PERMANENTLY"
    : attemptCount >= maxAttempts
      ? "FAILED_PERMANENTLY"
      : "RETRYING";
  const nextRetryAt =
    nextStatus === "RETRYING"
      ? new Date(now.getTime() + retryDelayMsForAttempt(attemptCount)).toISOString()
      : null;

  const updated = await updateExecutionRow(input.executionId, {
    completed_at: permanent ? now.toISOString() : null,
    error_message: input.message.slice(0, 280),
    next_retry_at: nextRetryAt,
    status: nextStatus,
  });

  if (schedule) {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from(schedulesTable)
      .update({
        failure_count: (schedule.failure_count ?? 0) + 1,
        updated_at: now.toISOString(),
      })
      .eq("id", input.scheduleId);
  }

  return { attemptCount, execution: updated, nextRetryAt, nextStatus };
}

export async function createDueOccurrenceForSchedule(
  schedule: RecurringScheduleRecord,
  dueAt = new Date(schedule.next_run_at),
  mode: "autopay" | "manual" = "autopay",
) {
  const supabase = createSupabaseAdminClient();
  const existingOpen = await supabase
    .from(executionsTable)
    .select("*")
    .eq("schedule_id", schedule.id)
    .in("status", [
      "SCHEDULED",
      "DUE",
      "PROCESSING",
      "SUBMITTED",
      "CONFIRMING",
      "RETRYING",
      "FAILED",
      "awaiting_wallet",
      "submitted",
    ])
    .limit(20);

  if (existingOpen.error) {
    throw new Error(readRecurringSupabaseError(existingOpen.error));
  }

  const openRows = (existingOpen.data ?? []).map((row) =>
    withExecutionDefaults(row as RecurringExecutionRecord),
  );
  const openAutopay = openRows.find(
    (row) =>
      (mode === "autopay" ? row.execution_mode !== "manual" : true) &&
      isOpenAutopayExecutionStatus(row.status),
  );
  if (openAutopay && mode === "autopay") {
    return openAutopay;
  }

  const occurrenceNumber = schedule.next_occurrence_number ?? 1;
  const idempotencyKey = buildOccurrenceIdempotencyKey(
    schedule.id,
    occurrenceNumber,
  );

  const existing = await supabase
    .from(executionsTable)
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error) {
    throw new Error(readRecurringSupabaseError(existing.error));
  }
  if (existing.data) {
    return withExecutionDefaults(existing.data as RecurringExecutionRecord);
  }

  const now = new Date().toISOString();
  const inserted = await supabase
    .from(executionsTable)
    .insert({
      amount: schedule.amount,
      amount_units: schedule.amount_units,
      attempt_count: 0,
      created_at: now,
      due_at: dueAt.toISOString(),
      execution_mode: mode,
      idempotency_key: idempotencyKey,
      occurrence_number: occurrenceNumber,
      owner_wallet: schedule.owner_wallet.toLowerCase(),
      schedule_id: schedule.id,
      status: mode === "autopay" ? "DUE" : "awaiting_wallet",
      updated_at: now,
    })
    .select("*")
    .single();

  if (inserted.error || !inserted.data) {
    if (isDuplicateError(inserted.error)) {
      const again = await supabase
        .from(executionsTable)
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (again.data) {
        return withExecutionDefaults(again.data as RecurringExecutionRecord);
      }
    }
    throw new Error(readRecurringSupabaseError(inserted.error));
  }

  await supabase
    .from(schedulesTable)
    .update({
      next_occurrence_number: occurrenceNumber + 1,
      updated_at: now,
    })
    .eq("id", schedule.id)
    .eq("next_occurrence_number", occurrenceNumber);

  return withExecutionDefaults(inserted.data as RecurringExecutionRecord);
}



export async function createManualExecutionForSchedule(
  schedule: RecurringScheduleRecord,
) {
  const supabase = createSupabaseAdminClient();
  const dueAt = new Date();
  const occurrenceNumber = schedule.next_occurrence_number ?? 1;
  const idempotencyKey = `${buildOccurrenceIdempotencyKey(schedule.id, occurrenceNumber)}:manual:${dueAt.getTime()}`;
  const now = dueAt.toISOString();
  const inserted = await supabase
    .from(executionsTable)
    .insert({
      amount: schedule.amount,
      amount_units: schedule.amount_units,
      attempt_count: 0,
      created_at: now,
      due_at: now,
      execution_mode: "manual",
      idempotency_key: idempotencyKey,
      occurrence_number: occurrenceNumber,
      owner_wallet: schedule.owner_wallet.toLowerCase(),
      schedule_id: schedule.id,
      status: "awaiting_wallet",
      updated_at: now,
    })
    .select("*")
    .single();

  if (inserted.error || !inserted.data) {
    throw new Error(readRecurringSupabaseError(inserted.error));
  }

  await supabase
    .from(schedulesTable)
    .update({
      next_occurrence_number: occurrenceNumber + 1,
      updated_at: now,
    })
    .eq("id", schedule.id);

  return withExecutionDefaults(inserted.data as RecurringExecutionRecord);
}

export async function claimExecutionForProcessing(executionId: string) {
  const current = await loadExecutionById(executionId);
  if (!current) {
    return null;
  }

  const claimable =
    current.status === "DUE" ||
    current.status === "SCHEDULED" ||
    current.status === "RETRYING" ||
    current.status === "FAILED" ||
    current.status === "awaiting_wallet";

  if (!claimable) {
    if (current.status === "PROCESSING") {
      const lockExpired =
        !current.lock_expires_at ||
        new Date(current.lock_expires_at).getTime() <= Date.now();
      if (!lockExpired) {
        return null;
      }
    } else {
      return null;
    }
  }

  const now = new Date();
  return updateExecutionRow(
    executionId,
    {
      attempt_count: (current.attempt_count ?? 0) + 1,
      attempted_at: now.toISOString(),
      lock_expires_at: new Date(now.getTime() + 45_000).toISOString(),
      status: "PROCESSING",
    },
    [
      current.status,
      "DUE",
      "SCHEDULED",
      "RETRYING",
      "FAILED",
      "awaiting_wallet",
      "PROCESSING",
    ],
  );
}

export async function listDueAuthorizedSchedules(limit = 25) {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const due = await supabase
    .from(schedulesTable)
    .select("*")
    .eq("status", "active")
    .eq("autopay_enabled", true)
    .eq("authorization_status", "AUTHORIZED")
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (due.error) {
    throw new Error(readRecurringSupabaseError(due.error));
  }

  return (due.data ?? []).map((row) =>
    withScheduleDefaults(row as RecurringScheduleRecord),
  );
}

export async function listWorkerOccurrences(limit = 25) {
  const supabase = createSupabaseAdminClient();
  const now = Date.now();
  const due = await supabase
    .from(executionsTable)
    .select("*")
    .eq("execution_mode", "autopay")
    .in("status", ["DUE", "SCHEDULED", "RETRYING", "FAILED"])
    .order("due_at", { ascending: true })
    .limit(limit * 2);

  if (due.error) {
    throw new Error(readRecurringSupabaseError(due.error));
  }

  return (due.data ?? [])
    .map((row) => withExecutionDefaults(row as RecurringExecutionRecord))
    .filter((row) => {
      if (row.status === "DUE" || row.status === "SCHEDULED") {
        return true;
      }
      if (!row.next_retry_at) {
        return true;
      }
      return new Date(row.next_retry_at).getTime() <= now;
    })
    .slice(0, limit);
}

export async function listConfirmingOccurrences(limit = 25) {
  const supabase = createSupabaseAdminClient();
  const confirming = await supabase
    .from(executionsTable)
    .select("*")
    .eq("execution_mode", "autopay")
    .in("status", ["SUBMITTED", "CONFIRMING", "PROCESSING"])
    .not("tx_hash", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (confirming.error) {
    throw new Error(readRecurringSupabaseError(confirming.error));
  }

  return (confirming.data ?? []).map((row) =>
    withExecutionDefaults(row as RecurringExecutionRecord),
  );
}

/**
 * Compatibility helper used by older routes. Queues a due occurrence only —
 * it never submits a payment.
 */
export async function processSingleDueSchedule(
  schedule: RecurringScheduleRecord,
) {
  if (schedule.status !== "active") {
    return null;
  }

  const now = Date.now();
  const nextRunAt = new Date(schedule.next_run_at).getTime();

  if (nextRunAt > now) {
    return null;
  }

  const execution = await createDueOccurrenceForSchedule(
    schedule,
    new Date(schedule.next_run_at),
    schedule.autopay_enabled && schedule.authorization_status === "AUTHORIZED"
      ? "autopay"
      : "manual",
  );
  return { autopay: null, execution };
}



export async function processDueRecurringSchedulesForOwner(
  ownerWallet: string,
  limit = 50,
) {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const due = await supabase
    .from(schedulesTable)
    .select("*")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .eq("status", "active")
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (due.error) {
    throw new Error(readRecurringSupabaseError(due.error));
  }

  const created = [];
  const errors: Array<{ scheduleId: string; message: string }> = [];

  for (const row of due.data ?? []) {
    const schedule = withScheduleDefaults(row as RecurringScheduleRecord);
    try {
      const result = await processSingleDueSchedule(schedule);
      if (result?.execution) {
        created.push(result.execution);
      }
    } catch (error) {
      errors.push({
        message:
          error instanceof Error
            ? error.message
            : "Could not process recurring schedule.",
        scheduleId: schedule.id,
      });
    }
  }

  return {
    createdCount: created.length,
    errors,
    executions: created,
    scannedCount: (due.data ?? []).length,
  };
}
