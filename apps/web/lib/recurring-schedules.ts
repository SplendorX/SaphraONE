"use client";

import type {
  RecurringExecutionRecord,
  RecurringFrequency,
  RecurringScheduleRecord,
  RecurringScheduleStatus,
  RecurringWalletMode,
} from "@/lib/recurring-utils";
import type { ArcTokenSymbol } from "@/lib/tokens";

type RecurringRequestContext = {
  circleSocialUuid?: string;
  ownerWallet: string;
};

type CreateRecurringScheduleInput = RecurringRequestContext & {
  amount: string;
  autopayEnabled?: boolean;
  beneficiaryLabel?: string;
  beneficiaryUsername?: string;
  beneficiaryWallet: string;
  endsAt?: string;
  frequency: RecurringFrequency;
  intervalDays?: number;
  maxRuns?: number;
  narration?: string;
  startsAt?: string;
  tokenSymbol: ArcTokenSymbol;
  walletMode: RecurringWalletMode;
  deferFirstOccurrence?: boolean;
};

type UpdateRecurringScheduleInput = RecurringRequestContext & {
  amount?: string;
  autopayEnabled?: boolean;
  frequency?: RecurringFrequency;
  intervalDays?: number;
  narration?: string;
  status?: RecurringScheduleStatus;
  tokenSymbol?: ArcTokenSymbol;
};

type UpdateExecutionInput = RecurringRequestContext & {
  errorMessage?: string;
  status: "confirmed" | "failed" | "submitted";
  txHash?: string;
};

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? "RecurePay request failed.");
  }

  return payload as T;
}

export async function fetchRecurringSchedules(context: RecurringRequestContext) {
  const params = new URLSearchParams({
    ownerWallet: context.ownerWallet,
  });

  if (context.circleSocialUuid) {
    params.set("circleSocialUuid", context.circleSocialUuid);
  }

  const response = await fetch(`/api/recurring/schedules?${params.toString()}`, {
    cache: "no-store",
  });

  const payload = await parseResponse<{ schedules: RecurringScheduleRecord[] }>(
    response,
  );

  return payload.schedules;
}

export async function createRecurringSchedule(
  input: CreateRecurringScheduleInput,
) {
  const response = await fetch("/api/recurring/schedules", {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = await parseResponse<{ schedule: RecurringScheduleRecord }>(
    response,
  );

  return payload.schedule;
}

export async function updateRecurringSchedule(
  scheduleId: string,
  input: UpdateRecurringScheduleInput,
) {
  const response = await fetch(`/api/recurring/schedules/${scheduleId}`, {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

  const payload = await parseResponse<{ schedule: RecurringScheduleRecord }>(
    response,
  );

  return payload.schedule;
}

export async function deleteRecurringSchedule(
  scheduleId: string,
  context: RecurringRequestContext,
) {
  const params = new URLSearchParams({
    ownerWallet: context.ownerWallet,
  });

  if (context.circleSocialUuid) {
    params.set("circleSocialUuid", context.circleSocialUuid);
  }

  const response = await fetch(
    `/api/recurring/schedules/${scheduleId}?${params.toString()}`,
    { method: "DELETE" },
  );

  await parseResponse<{ deleted: boolean }>(response);
}

export async function fetchRecurringExecutions(context: RecurringRequestContext) {
  const params = new URLSearchParams({
    ownerWallet: context.ownerWallet,
  });

  if (context.circleSocialUuid) {
    params.set("circleSocialUuid", context.circleSocialUuid);
  }

  const response = await fetch(
    `/api/recurring/executions?${params.toString()}`,
    { cache: "no-store" },
  );

  const payload = await parseResponse<{
    executions: RecurringExecutionRecord[];
  }>(response);

  return payload.executions;
}

export async function updateRecurringExecution(
  executionId: string,
  input: UpdateExecutionInput,
) {
  const response = await fetch(`/api/recurring/executions/${executionId}`, {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

  const payload = await parseResponse<{ execution: RecurringExecutionRecord }>(
    response,
  );

  return payload.execution;
}

export async function authorizeRecurringSchedule(
  scheduleId: string,
  input: RecurringRequestContext & {
    action?: "revoke";
    authorizationTxHash?: string;
    expiresAt?: string;
    maxPaymentAmountUnits?: string;
    totalLimitUnits?: string;
  },
) {
  const response = await fetch(
    `/api/recurring/schedules/${scheduleId}/authorize`,
    {
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  const payload = await parseResponse<{ schedule: RecurringScheduleRecord }>(
    response,
  );

  return payload.schedule;
}

export async function runRecurringScheduleNow(
  scheduleId: string,
  context: RecurringRequestContext,
) {
  const response = await fetch(`/api/recurring/schedules/${scheduleId}/run`, {
    body: JSON.stringify(context),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = await parseResponse<{
    execution: RecurringExecutionRecord;
  }>(response);

  return payload.execution;
}

