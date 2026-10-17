import { keccak256, parseUnits, stringToBytes } from "viem";

import { arcTokens, arcTokenSymbols, type ArcTokenSymbol } from "@/lib/tokens";

export const recurringFrequencies = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "custom",
] as const;

export type RecurringFrequency = (typeof recurringFrequencies)[number];

export const recurringScheduleStatuses = [
  "active",
  "paused",
  "cancelled",
  "completed",
] as const;

export type RecurringScheduleStatus =
  (typeof recurringScheduleStatuses)[number];

export const recurringAuthorizationStatuses = [
  "UNAUTHORIZED",
  "AUTHORIZED",
  "REVOKED",
  "EXPIRED",
  "REAUTHORIZATION_REQUIRED",
] as const;

export type RecurringAuthorizationStatus =
  (typeof recurringAuthorizationStatuses)[number];

export const recurringExecutionStatuses = [
  "SCHEDULED",
  "DUE",
  "PROCESSING",
  "SUBMITTED",
  "CONFIRMING",
  "COMPLETED",
  "FAILED",
  "RETRYING",
  "FAILED_PERMANENTLY",
  // Legacy statuses kept for rows created before autonomous Autopay.
  "awaiting_wallet",
  "submitted",
  "confirmed",
  "failed",
  "skipped",
] as const;

export type RecurringExecutionStatus =
  (typeof recurringExecutionStatuses)[number];

export type RecurringWalletMode = "circle" | "external";

export type RecurringExecutionMode = "autopay" | "manual";

export type RecurringScheduleRecord = {
  amount: string;
  amount_units: string;
  authorization_expires_at: string | null;
  /** RecurePayExecutor mandate this schedule is paid under. */
  authorization_mandate_id: string | null;
  authorization_status: RecurringAuthorizationStatus;
  authorization_tx_hash: string | null;
  authorized_at: string | null;
  authorized_recipient: string | null;
  authorized_token: string | null;
  autopay_enabled: boolean;
  beneficiary_label: string | null;
  beneficiary_username: string | null;
  beneficiary_wallet: string;
  created_at: string;
  ends_at: string | null;
  executed_amount_units: string;
  failure_count: number;
  frequency: RecurringFrequency;
  id: string;
  interval_days: number | null;
  last_executed_at: string | null;
  last_execution_id: string | null;
  last_run_at: string | null;
  max_payment_amount: string | null;
  max_payment_amount_units: string | null;
  max_retries: number;
  max_runs: number | null;
  narration: string | null;
  next_occurrence_number: number;
  next_run_at: string;
  owner_wallet: string;
  run_count: number;
  starts_at: string;
  status: RecurringScheduleStatus;
  timezone: string;
  token_symbol: ArcTokenSymbol;
  total_limit: string | null;
  total_limit_units: string | null;
  updated_at: string;
  wallet_mode: RecurringWalletMode;
};

export type RecurringExecutionRecord = {
  amount: string | null;
  amount_units: string | null;
  attempted_at: string | null;
  attempt_count: number;
  completed_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  due_at: string;
  error_message: string | null;
  execution_mode: RecurringExecutionMode;
  id: string;
  idempotency_key: string;
  lock_expires_at: string | null;
  lock_token: string | null;
  next_retry_at: string | null;
  occurrence_number: number | null;
  owner_wallet: string;
  provider_transaction_id: string | null;
  schedule_id: string;
  status: RecurringExecutionStatus;
  submitted_at: string | null;
  tx_hash: string | null;
  updated_at: string;
};

export function isRecurringFrequency(value: string): value is RecurringFrequency {
  return recurringFrequencies.includes(value as RecurringFrequency);
}

export function isRecurringScheduleStatus(
  value: string,
): value is RecurringScheduleStatus {
  return recurringScheduleStatuses.includes(value as RecurringScheduleStatus);
}





export function isArcTokenSymbol(value: string): value is ArcTokenSymbol {
  return arcTokenSymbols.includes(value as ArcTokenSymbol);
}

export function normalizeRecurringAmount(
  amount: string,
  tokenSymbol: ArcTokenSymbol,
) {
  const trimmedAmount = amount.trim();

  if (!trimmedAmount || Number(trimmedAmount) <= 0) {
    return null;
  }

  try {
    const amountUnits = parseUnits(
      trimmedAmount,
      arcTokens[tokenSymbol].decimals,
    );

    if (amountUnits <= BigInt(0)) {
      return null;
    }

    return {
      amount: trimmedAmount,
      amount_units: amountUnits.toString(),
    };
  } catch {
    return null;
  }
}

/**
 * The on-chain mandate period for a schedule: the shortest time between two
 * payments, a little under the schedule's interval so a late cron run or a
 * short month never blocks a payment that is due.
 */
export function mandatePeriodSeconds(
  frequency: RecurringFrequency,
  intervalDays?: number | null,
) {
  const day = 24 * 60 * 60;
  switch (frequency) {
    case "daily":
      return 20 * 60 * 60;
    case "weekly":
      return 6 * day;
    case "biweekly":
      return 13 * day;
    case "monthly":
      return 27 * day;
    case "quarterly":
      return 85 * day;
    default: {
      const days = intervalDays && intervalDays > 0 ? intervalDays : 30;
      return Math.max(20 * 60 * 60, (days - 1) * day);
    }
  }
}

export function advanceNextRunAt(
  current: Date,
  frequency: RecurringFrequency,
  intervalDays?: number | null,
) {
  const next = new Date(current);

  switch (frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "biweekly":
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "quarterly":
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case "custom": {
      const days = intervalDays && intervalDays > 0 ? intervalDays : 30;
      next.setUTCDate(next.getUTCDate() + days);
      break;
    }
    default:
      next.setUTCDate(next.getUTCDate() + 30);
  }

  return next;
}

export function buildAutopayExecutionId(executionId: string) {
  return keccak256(stringToBytes(executionId));
}



export function buildOccurrenceIdempotencyKey(
  scheduleId: string,
  occurrenceNumber: number,
) {
  return `swiftpay:recurring:${scheduleId}:occurrence:${occurrenceNumber}`;
}

export const RECURRING_RETRY_BACKOFF_MS = [
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
] as const;

export const RECURRING_MAX_ATTEMPTS = 4;

export function retryDelayMsForAttempt(attemptCount: number) {
  if (attemptCount <= 1) {
    return RECURRING_RETRY_BACKOFF_MS[0];
  }
  if (attemptCount === 2) {
    return RECURRING_RETRY_BACKOFF_MS[1];
  }
  return RECURRING_RETRY_BACKOFF_MS[2];
}



export function isOpenAutopayExecutionStatus(status: RecurringExecutionStatus) {
  return (
    status === "SCHEDULED" ||
    status === "DUE" ||
    status === "PROCESSING" ||
    status === "SUBMITTED" ||
    status === "CONFIRMING" ||
    status === "RETRYING" ||
    status === "FAILED"
  );
}

export function isDueDisplayStatus(status: RecurringExecutionStatus) {
  return (
    status === "awaiting_wallet" ||
    status === "DUE" ||
    status === "SCHEDULED" ||
    status === "RETRYING" ||
    status === "FAILED"
  );
}

export function isProcessingDisplayStatus(status: RecurringExecutionStatus) {
  return (
    status === "PROCESSING" ||
    status === "SUBMITTED" ||
    status === "CONFIRMING" ||
    status === "submitted"
  );
}

export function isCompletedDisplayStatus(status: RecurringExecutionStatus) {
  return status === "COMPLETED" || status === "confirmed";
}

export function isFailedDisplayStatus(status: RecurringExecutionStatus) {
  return (
    status === "FAILED" ||
    status === "FAILED_PERMANENTLY" ||
    status === "failed" ||
    status === "skipped"
  );
}

export function formatExecutionStatusLabel(status: RecurringExecutionStatus) {
  switch (status) {
    case "SCHEDULED":
      return "Scheduled";
    case "DUE":
    case "awaiting_wallet":
      return "Due";
    case "PROCESSING":
      return "Processing";
    case "SUBMITTED":
    case "submitted":
      return "Submitted";
    case "CONFIRMING":
      return "Confirming";
    case "COMPLETED":
    case "confirmed":
      return "Completed";
    case "FAILED":
    case "failed":
      return "Failed";
    case "RETRYING":
      return "Retrying";
    case "FAILED_PERMANENTLY":
    case "skipped":
      return "Permanently failed";
    default:
      return status;
  }
}

export function formatAuthorizationStatusLabel(
  status: RecurringAuthorizationStatus | null | undefined,
) {
  switch (status) {
    case "AUTHORIZED":
      return "Authorized";
    case "REVOKED":
      return "Revoked";
    case "EXPIRED":
      return "Expired";
    case "REAUTHORIZATION_REQUIRED":
      return "Reauthorization required";
    default:
      return "Not authorized";
  }
}

export function withScheduleDefaults(
  schedule: RecurringScheduleRecord,
): RecurringScheduleRecord {
  return {
    ...schedule,
    authorization_expires_at: schedule.authorization_expires_at ?? null,
    authorization_mandate_id: schedule.authorization_mandate_id ?? null,
    authorization_status: schedule.authorization_status ?? "UNAUTHORIZED",
    authorization_tx_hash: schedule.authorization_tx_hash ?? null,
    authorized_at: schedule.authorized_at ?? null,
    authorized_recipient: schedule.authorized_recipient ?? null,
    authorized_token: schedule.authorized_token ?? null,
    executed_amount_units: schedule.executed_amount_units ?? "0",
    failure_count: schedule.failure_count ?? 0,
    last_executed_at: schedule.last_executed_at ?? null,
    last_execution_id: schedule.last_execution_id ?? null,
    max_payment_amount: schedule.max_payment_amount ?? null,
    max_payment_amount_units: schedule.max_payment_amount_units ?? null,
    max_retries: schedule.max_retries ?? RECURRING_MAX_ATTEMPTS,
    next_occurrence_number: schedule.next_occurrence_number ?? 1,
    total_limit: schedule.total_limit ?? null,
    total_limit_units: schedule.total_limit_units ?? null,
  };
}

export function withExecutionDefaults(
  execution: RecurringExecutionRecord,
): RecurringExecutionRecord {
  return {
    ...execution,
    amount: execution.amount ?? null,
    amount_units: execution.amount_units ?? null,
    attempt_count: execution.attempt_count ?? 0,
    confirmed_at: execution.confirmed_at ?? null,
    execution_mode: execution.execution_mode ?? "manual",
    lock_expires_at: execution.lock_expires_at ?? null,
    lock_token: execution.lock_token ?? null,
    next_retry_at: execution.next_retry_at ?? null,
    occurrence_number: execution.occurrence_number ?? null,
    provider_transaction_id: execution.provider_transaction_id ?? null,
    submitted_at: execution.submitted_at ?? null,
    updated_at: execution.updated_at ?? execution.created_at,
  };
}

export function formatFrequencyLabel(
  frequency: RecurringFrequency,
  intervalDays?: number | null,
) {
  switch (frequency) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every 2 weeks";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "custom":
      return intervalDays ? `Every ${intervalDays} days` : "Custom interval";
    default:
      return frequency;
  }
}

export function formatScheduleRecipient(schedule: RecurringScheduleRecord) {
  if (schedule.beneficiary_username) {
    return `${schedule.beneficiary_username}.one`;
  }

  if (schedule.beneficiary_label) {
    return schedule.beneficiary_label;
  }

  return schedule.beneficiary_wallet;
}
