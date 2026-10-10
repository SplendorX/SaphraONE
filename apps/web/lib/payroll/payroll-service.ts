import { payrollDb, payrollTables, readPayrollDbError } from "@/lib/payroll/db";
import { payrollErrors } from "@/lib/payroll/errors";
import { calculateItemAmounts, calculateRunTotals } from "@/lib/payroll/calculation-service";
import { logPayrollAudit } from "@/lib/payroll/audit-service";
import type {
  PayrollAdjustmentRecord,
  PayrollAdjustmentType,
  PayrollItemRecord,
  PayrollRunRecord,
  PayrollRunSource,
  PayrollRunStatus,
  PayrollSnapshot,
} from "@/lib/payroll/types";

export type CreatePayrollRunInput = {
  accountId: string;
  name: string;
  source?: PayrollRunSource;
  asset?: string;
  payrollGroupId?: string | null;
  payrollScheduleId?: string | null;
  items: Array<{
    teamMemberId?: string | null;
    recipientName: string;
    recipientDestination: string;
    recipientUsername?: string | null;
    baseAmount: string;
    adjustments?: Array<{
      type: PayrollAdjustmentType;
      amount: string;
      reason?: string | null;
    }>;
  }>;
};

export async function createPayrollRun(input: CreatePayrollRunInput, actorId: string): Promise<PayrollRunRecord> {
  const accountId = input.accountId.toLowerCase();
  const name = input.name.trim();
  if (!name) throw payrollErrors.invalidInput("Payroll run name is required.");
  if (!input.items || input.items.length === 0) {
    throw payrollErrors.invalidInput("At least one recipient is required for a payroll run.");
  }

  const asset = input.asset || "USDC";
  const supabase = payrollDb();

  // 1. Calculate each item's totals
  const calculatedItems = input.items.map((raw) => {
    const calc = calculateItemAmounts(raw.baseAmount, raw.adjustments ?? [], asset);
    return {
      raw,
      calc,
    };
  });

  // 2. Calculate run totals server-side
  const runCalc = calculateRunTotals(
    calculatedItems.map((ci) => ({ totalAmount: ci.calc.totalAmount })),
    asset,
  );

  // 3. Insert PayrollRun
  const { data: run, error: runError } = await supabase
    .from(payrollTables.runs)
    .insert({
      account_id: accountId,
      name,
      source: input.source || "MANUAL",
      status: "READY" as PayrollRunStatus,
      asset,
      total_amount: runCalc.totalAmount,
      total_fees: runCalc.totalFees,
      total_required: runCalc.totalRequired,
      recipient_count: runCalc.recipientCount,
      payroll_group_id: input.payrollGroupId ?? null,
      payroll_schedule_id: input.payrollScheduleId ?? null,
    })
    .select("*")
    .single();

  if (runError) throw new Error(readPayrollDbError(runError, "Could not create payroll run."));

  // 4. Insert Items and Adjustments
  for (const ci of calculatedItems) {
    const { data: item, error: itemError } = await supabase
      .from(payrollTables.items)
      .insert({
        payroll_run_id: run.id,
        team_member_id: ci.raw.teamMemberId ?? null,
        recipient_name_snapshot: ci.raw.recipientName,
        recipient_destination_snapshot: ci.raw.recipientDestination.toLowerCase(),
        recipient_username_snapshot: ci.raw.recipientUsername || null,
        base_amount: ci.calc.baseAmount,
        adjustment_amount: ci.calc.adjustmentAmount,
        total_amount: ci.calc.totalAmount,
        asset,
        status: "PENDING",
      })
      .select("*")
      .single();

    if (itemError) throw new Error(readPayrollDbError(itemError, "Could not insert payroll items."));

    if (ci.raw.adjustments && ci.raw.adjustments.length > 0) {
      const adjRows = ci.raw.adjustments.map((adj) => ({
        payroll_item_id: item.id,
        type: adj.type,
        amount: adj.amount,
        reason: adj.reason?.trim() || null,
      }));
      await supabase.from(payrollTables.adjustments).insert(adjRows);
    }
  }

  await logPayrollAudit({
    accountId,
    payrollRunId: run.id,
    action: "PAYROLL_CREATED",
    actorId,
    metadata: {
      name,
      recipients: runCalc.recipientCount,
      totalAmount: runCalc.totalAmount,
      totalRequired: runCalc.totalRequired,
    },
  });

  return run as PayrollRunRecord;
}

export async function listPayrollRuns(accountId: string): Promise<PayrollRunRecord[]> {
  const supabase = payrollDb();
  const { data, error } = await supabase
    .from(payrollTables.runs)
    .select("*")
    .eq("account_id", accountId.toLowerCase())
    .order("created_at", { ascending: false });

  if (error) throw new Error(readPayrollDbError(error, "Could not list payroll runs."));
  return (data ?? []) as PayrollRunRecord[];
}

export async function getPayrollRun(
  accountId: string,
  id: string,
): Promise<PayrollRunRecord & { items: PayrollItemRecord[] }> {
  const supabase = payrollDb();
  const { data: run, error } = await supabase
    .from(payrollTables.runs)
    .select("*")
    .eq("account_id", accountId.toLowerCase())
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(readPayrollDbError(error, "Could not load payroll run."));
  if (!run) throw payrollErrors.runNotFound();

  const { data: items, error: itemsError } = await supabase
    .from(payrollTables.items)
    .select("*")
    .eq("payroll_run_id", id)
    .order("created_at", { ascending: true });

  if (itemsError) throw new Error(readPayrollDbError(itemsError, "Could not load payroll items."));

  // Fetch adjustments for items
  const itemIds = (items ?? []).map((it) => it.id);
  let allAdjustments: PayrollAdjustmentRecord[] = [];
  if (itemIds.length > 0) {
    const { data: adjData } = await supabase
      .from(payrollTables.adjustments)
      .select("*")
      .in("payroll_item_id", itemIds);
    allAdjustments = (adjData ?? []) as PayrollAdjustmentRecord[];
  }

  const adjMap = new Map<string, PayrollAdjustmentRecord[]>();
  for (const adj of allAdjustments) {
    const list = adjMap.get(adj.payroll_item_id) ?? [];
    list.push(adj);
    adjMap.set(adj.payroll_item_id, list);
  }

  const itemsWithAdj = (items ?? []).map((it) => ({
    ...it,
    adjustments: adjMap.get(it.id) ?? [],
  }));

  return {
    ...run,
    items: itemsWithAdj,
  };
}

export async function approvePayrollRun(
  accountId: string,
  id: string,
  actorId: string,
  metadata?: Record<string, unknown>,
): Promise<PayrollRunRecord> {
  const fullRun = await getPayrollRun(accountId, id);

  if (fullRun.status === "APPROVED") {
    throw payrollErrors.alreadyApproved();
  }
  if (fullRun.status === "COMPLETED" || fullRun.status === "PARTIALLY_COMPLETED") {
    throw payrollErrors.alreadyCompleted();
  }
  if (fullRun.status === "PROCESSING") {
    throw payrollErrors.alreadyExecuting();
  }
  if (fullRun.status === "CANCELLED") {
    throw payrollErrors.invalidState("Cancelled payroll run cannot be approved.");
  }
  if (fullRun.items.length === 0) {
    throw payrollErrors.invalidInput("Cannot approve an empty payroll run.");
  }

  // Recalculate totals server-side
  const recalculated = calculateRunTotals(
    fullRun.items.map((it) => ({ totalAmount: it.total_amount })),
    fullRun.asset,
  );

  // Create immutable snapshot (Section 29)
  const snapshot: PayrollSnapshot = {
    account_id: accountId.toLowerCase(),
    payroll_run_id: fullRun.id,
    approved_at: new Date().toISOString(),
    approved_by: actorId.toLowerCase(),
    total_amount: recalculated.totalAmount,
    total_fees: recalculated.totalFees,
    total_required: recalculated.totalRequired,
    asset: fullRun.asset,
    recipient_count: fullRun.items.length,
    recipients: fullRun.items.map((it) => ({
      id: it.id,
      team_member_id: it.team_member_id,
      recipient_name: it.recipient_name_snapshot,
      recipient_destination: it.recipient_destination_snapshot,
      recipient_username: it.recipient_username_snapshot,
      base_amount: it.base_amount,
      adjustment_amount: it.adjustment_amount,
      total_amount: it.total_amount,
      asset: it.asset,
      adjustments: it.adjustments?.map((a) => ({
        type: a.type,
        amount: a.amount,
        reason: a.reason,
      })),
    })),
  };

  const supabase = payrollDb();
  const { data: updated, error } = await supabase
    .from(payrollTables.runs)
    .update({
      status: "APPROVED" as PayrollRunStatus,
      total_amount: recalculated.totalAmount,
      total_fees: recalculated.totalFees,
      total_required: recalculated.totalRequired,
      approved_by: actorId.toLowerCase(),
      approved_at: snapshot.approved_at,
      approval_metadata: metadata ?? {},
      snapshot,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId.toLowerCase())
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(readPayrollDbError(error, "Could not approve payroll run."));

  await logPayrollAudit({
    accountId,
    payrollRunId: id,
    action: "PAYROLL_APPROVED",
    actorId,
    metadata: {
      recipients: snapshot.recipient_count,
      totalAmount: snapshot.total_amount,
      totalRequired: snapshot.total_required,
    },
  });

  return updated as PayrollRunRecord;
}

export async function cancelPayrollRun(
  accountId: string,
  id: string,
  actorId: string,
): Promise<PayrollRunRecord> {
  const fullRun = await getPayrollRun(accountId, id);

  if (fullRun.status === "PROCESSING") {
    throw payrollErrors.alreadyExecuting("Cannot cancel a payroll run currently processing.");
  }
  if (fullRun.status === "COMPLETED" || fullRun.status === "PARTIALLY_COMPLETED") {
    throw payrollErrors.alreadyCompleted("Cannot cancel a completed payroll run.");
  }

  const supabase = payrollDb();
  const { data: updated, error } = await supabase
    .from(payrollTables.runs)
    .update({
      status: "CANCELLED" as PayrollRunStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId.toLowerCase())
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(readPayrollDbError(error, "Could not cancel payroll run."));

  await logPayrollAudit({
    accountId,
    payrollRunId: id,
    action: "PAYROLL_CANCELLED",
    actorId,
  });

  return updated as PayrollRunRecord;
}

export async function updatePayrollItemAdjustment(
  accountId: string,
  itemId: string,
  adjustments: Array<{ type: PayrollAdjustmentType; amount: string; reason?: string | null }>,
): Promise<PayrollItemRecord> {
  const supabase = payrollDb();

  // Load item and verify run ownership & status
  const { data: item, error: itemError } = await supabase
    .from(payrollTables.items)
    .select("*, payroll_runs!inner(id, account_id, status, asset)")
    .eq("id", itemId)
    .single();

  if (itemError || !item) throw payrollErrors.runNotFound("Payroll item was not found.");
  const run = (item as any).payroll_runs;

  if (run.account_id.toLowerCase() !== accountId.toLowerCase()) {
    throw payrollErrors.teamMemberNotOwned();
  }
  if (run.status === "APPROVED" || run.status === "PROCESSING" || run.status === "COMPLETED") {
    throw payrollErrors.invalidState("Cannot modify items in an approved or completed payroll run.");
  }

  // Recalculate item
  const calculated = calculateItemAmounts(item.base_amount, adjustments, run.asset);

  // Update item
  const { data: updatedItem, error: updateError } = await supabase
    .from(payrollTables.items)
    .update({
      adjustment_amount: calculated.adjustmentAmount,
      total_amount: calculated.totalAmount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .select("*")
    .single();

  if (updateError) throw new Error(readPayrollDbError(updateError, "Could not update payroll item."));

  // Delete old adjustments and re-insert
  await supabase.from(payrollTables.adjustments).delete().eq("payroll_item_id", itemId);
  if (adjustments.length > 0) {
    const adjRows = adjustments.map((adj) => ({
      payroll_item_id: itemId,
      type: adj.type,
      amount: adj.amount,
      reason: adj.reason?.trim() || null,
    }));
    await supabase.from(payrollTables.adjustments).insert(adjRows);
  }

  // Recalculate parent run
  const { data: allItems } = await supabase
    .from(payrollTables.items)
    .select("total_amount")
    .eq("payroll_run_id", run.id);

  const runCalc = calculateRunTotals(
    (allItems ?? []).map((it) => ({ totalAmount: it.total_amount })),
    run.asset,
  );
  await supabase
    .from(payrollTables.runs)
    .update({
      total_amount: runCalc.totalAmount,
      total_fees: runCalc.totalFees,
      total_required: runCalc.totalRequired,
      updated_at: new Date().toISOString(),
    })
    .eq("id", run.id);

  return updatedItem as PayrollItemRecord;
}
