import type {
  CreatePayrollRunInput,
} from "@/lib/payroll/payroll-service";
import type { CreateTeamMemberInput } from "@/lib/payroll/team-service";
import type {
  PaymentFrequency,
  PayrollDashboardSummary,
  PayrollGroupRecord,
  PayrollItemRecord,
  PayrollRunRecord,
  PayrollScheduleRecord,
  TeamMemberRecord,
  TeamMemberStatus,
} from "@/lib/payroll/types";

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: (T & { message?: string; error?: string }) | null = null;
  try {
    payload = JSON.parse(text);
  } catch {
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("The requested payroll endpoint or resource was not found (404). Please ensure the backend route is available.");
      }
      throw new Error(`Server returned ${response.status} ${response.statusText || "error"}.`);
    }
    throw new Error(`Invalid server response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(payload?.message ?? payload?.error ?? `Request failed (${response.status}).`);
  }
  return payload as T;
}

function withWallet(path: string, ownerWallet: string, extra?: Record<string, string | undefined>) {
  const url = new URL(path, "http://local");
  url.searchParams.set("ownerWallet", ownerWallet);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}?${url.searchParams.toString()}`;
}

function authBody(
  ownerWallet: string,
  circleSocialUuid?: string,
  extra?: Record<string, unknown>,
  workspaceId?: string,
) {
  return { circleSocialUuid, ownerWallet, workspaceId, ...extra };
}

// 1. Dashboard
export async function fetchPayrollDashboard(
  ownerWallet: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollDashboardSummary> {
  return parseJson<PayrollDashboardSummary>(
    await fetch(
      withWallet("/api/business/payroll", ownerWallet, {
        circleSocialUuid,
        workspaceId,
      }),
      {
        cache: "no-store",
      },
    ),
  );
}

// 2. Team Members
export async function fetchTeamMembers(
  ownerWallet: string,
  options?: { status?: TeamMemberStatus; includeArchived?: boolean; groupId?: string },
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<TeamMemberRecord[]> {
  return parseJson<TeamMemberRecord[]>(
    await fetch(
      withWallet("/api/business/payroll/team", ownerWallet, {
        circleSocialUuid,
        status: options?.status,
        includeArchived: options?.includeArchived ? "true" : undefined,
        groupId: options?.groupId,
        workspaceId,
      }),
      { cache: "no-store" },
    ),
  );
}

export async function fetchTeamMember(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<{ member: TeamMemberRecord; history: any[] }> {
  return parseJson<{ member: TeamMemberRecord; history: any[] }>(
    await fetch(withWallet(`/api/business/payroll/team/${id}`, ownerWallet, { circleSocialUuid, workspaceId }), {
      cache: "no-store",
    }),
  );
}

export async function createTeamMemberClient(
  ownerWallet: string,
  body: Omit<CreateTeamMemberInput, "accountId">,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<TeamMemberRecord> {
  return parseJson<TeamMemberRecord>(
    await fetch("/api/business/payroll/team", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body as any, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function pauseTeamMemberClient(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<TeamMemberRecord> {
  return parseJson<TeamMemberRecord>(
    await fetch(`/api/business/payroll/team/${id}/pause`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, undefined, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function reactivateTeamMemberClient(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<TeamMemberRecord> {
  return parseJson<TeamMemberRecord>(
    await fetch(`/api/business/payroll/team/${id}/reactivate`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, undefined, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function archiveTeamMemberClient(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<TeamMemberRecord> {
  return parseJson<TeamMemberRecord>(
    await fetch(`/api/business/payroll/team/${id}/archive`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, undefined, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

// 3. Groups
export async function fetchPayrollGroups(
  ownerWallet: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollGroupRecord[]> {
  return parseJson<PayrollGroupRecord[]>(
    await fetch(withWallet("/api/business/payroll/groups", ownerWallet, { circleSocialUuid, workspaceId }), {
      cache: "no-store",
    }),
  );
}

export async function createPayrollGroupClient(
  ownerWallet: string,
  body: { name: string; description?: string | null; defaultSchedule?: string | null; memberIds?: string[] },
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollGroupRecord> {
  return parseJson<PayrollGroupRecord>(
    await fetch("/api/business/payroll/groups", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function deletePayrollGroupClient(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<{ ok: boolean }> {
  return parseJson<{ ok: boolean }>(
    await fetch(withWallet(`/api/business/payroll/groups/${id}`, ownerWallet, { circleSocialUuid, workspaceId }), {
      method: "DELETE",
    }),
  );
}

// 4. Schedules
export async function fetchPayrollSchedules(
  ownerWallet: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollScheduleRecord[]> {
  return parseJson<PayrollScheduleRecord[]>(
    await fetch(withWallet("/api/business/payroll/schedules", ownerWallet, { circleSocialUuid, workspaceId }), {
      cache: "no-store",
    }),
  );
}

export async function createPayrollScheduleClient(
  ownerWallet: string,
  body: { frequency: PaymentFrequency; payrollGroupId?: string | null; scheduleConfig?: Record<string, unknown> },
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollScheduleRecord> {
  return parseJson<PayrollScheduleRecord>(
    await fetch("/api/business/payroll/schedules", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function pausePayrollScheduleClient(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollScheduleRecord> {
  return parseJson<PayrollScheduleRecord>(
    await fetch(`/api/business/payroll/schedules/${id}/pause`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, undefined, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function resumePayrollScheduleClient(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollScheduleRecord> {
  return parseJson<PayrollScheduleRecord>(
    await fetch(`/api/business/payroll/schedules/${id}/resume`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, undefined, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function fetchPayrollRun(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollRunRecord & { items: PayrollItemRecord[] }> {
  return parseJson<PayrollRunRecord & { items: PayrollItemRecord[] }>(
    await fetch(withWallet(`/api/business/payroll/runs/${id}`, ownerWallet, { circleSocialUuid, workspaceId }), {
      cache: "no-store",
    }),
  );
}

export async function createPayrollRunClient(
  ownerWallet: string,
  body: Omit<CreatePayrollRunInput, "accountId">,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollRunRecord> {
  return parseJson<PayrollRunRecord>(
    await fetch("/api/business/payroll/runs", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body as any, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function approvePayrollRunClient(
  ownerWallet: string,
  id: string,
  metadata?: Record<string, unknown>,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollRunRecord> {
  return parseJson<PayrollRunRecord>(
    await fetch(`/api/business/payroll/runs/${id}/approve`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, { metadata }, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function executePayrollRunClient(
  ownerWallet: string,
  id: string,
  body: {
    txHash?: string | null;
    transactionId?: string | null;
    availableBalance?: string;
    failedItemIds?: string[];
    itemErrors?: Record<string, string>;
  },
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollRunRecord> {
  return parseJson<PayrollRunRecord>(
    await fetch(`/api/business/payroll/runs/${id}/execute`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function cancelPayrollRunClient(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollRunRecord> {
  return parseJson<PayrollRunRecord>(
    await fetch(`/api/business/payroll/runs/${id}/cancel`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, undefined, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function retryPayrollItemClient(
  ownerWallet: string,
  itemId: string,
  body: {
    txHash?: string | null;
    transactionId?: string | null;
    success?: boolean;
    failureReason?: string | null;
  },
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<PayrollItemRecord> {
  return parseJson<PayrollItemRecord>(
    await fetch(`/api/business/payroll/items/${itemId}/retry`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function deletePayrollScheduleClient(
  ownerWallet: string,
  id: string,
  circleSocialUuid?: string,
  workspaceId?: string,
): Promise<{ deleted: boolean }> {
  return parseJson<{ deleted: boolean }>(
    await fetch(`/api/business/payroll/schedules/${id}`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, undefined, workspaceId)),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    }),
  );
}
