import { getAddress, isAddress } from "viem";

import { requireWorkspaceContext } from "@/lib/business/auth";
import { businessDb, businessTables, readBusinessDbError } from "@/lib/business/db";
import { businessErrors } from "@/lib/business/errors";
import { displayToUnits, parseDisplayAmount } from "@/lib/business/money";
import { parseApprovalPolicy, requiredApprovalsForAmount } from "@/lib/business/policy";
import { resolvePaymentIdentity } from "@/lib/business/service";
import type {
  BusinessAsset,
  BusinessPaymentRecord,
  BusinessPaymentRequestRecord,
  PaymentApprovalRecord,
  PaymentDirection,
} from "@/lib/business/types";
import { normalizeHandle } from "@/lib/business/usernames";

function nowIso() {
  return new Date().toISOString();
}

function isAsset(value: unknown): value is BusinessAsset {
  return value === "USDC" || value === "EURC";
}

export async function listPayments(input: {
  circleSocialUuid?: unknown;
  direction?: PaymentDirection | "all";
  ownerWallet: unknown;
  query?: string;
  status?: string;
  tab?: "all" | "incoming" | "outgoing" | "pending" | "needs_approval";
  workspaceId: string;
}) {
  const { actorWallet, member, workspace } = await requireWorkspaceContext({
    ...input,
    permission: "transactions.view",
  });
  const supabase = businessDb();
  let query = supabase
    .from(businessTables.payments)
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (input.tab === "incoming" || input.direction === "incoming") {
    query = query.eq("direction", "incoming");
  }
  if (input.tab === "outgoing" || input.direction === "outgoing") {
    query = query.eq("direction", "outgoing");
  }
  if (input.tab === "pending") {
    query = query.in("transaction_status", [
      "AUTHORIZATION_REQUIRED",
      "SUBMITTED",
      "PROCESSING",
    ]);
  }
  if (input.tab === "needs_approval") {
    query = query.in("approval_status", [
      "PENDING_APPROVAL",
      "PARTIALLY_APPROVED",
    ]);
  }
  if (member.role === "member") {
    query = query.eq("created_by_wallet", actorWallet);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(readBusinessDbError(error, "Could not load payments."));
  }

  let rows = (data ?? []) as BusinessPaymentRecord[];
  const q = input.query?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((row) =>
      [
        row.counterparty_name,
        row.counterparty_username,
        row.amount_display,
        row.memo,
        row.asset,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }

  return rows;
}

export async function getPayment(input: {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  paymentId: string;
  workspaceId: string;
}) {
  await requireWorkspaceContext({
    ...input,
    permission: "transactions.view",
  });
  const supabase = businessDb();
  const payment = await supabase
    .from(businessTables.payments)
    .select("*")
    .eq("id", input.paymentId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (payment.error) {
    throw new Error(readBusinessDbError(payment.error, "Could not load payment."));
  }
  if (!payment.data) throw businessErrors.notFound("Payment");

  const approvals = await supabase
    .from(businessTables.paymentApprovals)
    .select("*")
    .eq("payment_id", input.paymentId)
    .order("created_at", { ascending: true });

  return {
    approvals: (approvals.data ?? []) as PaymentApprovalRecord[],
    payment: payment.data as BusinessPaymentRecord,
  };
}

export async function createOutgoingPayment(input: {
  amount: string;
  asset: unknown;
  circleSocialUuid?: unknown;
  idempotencyKey?: string | null;
  memo?: string;
  ownerWallet: unknown;
  recipient: string;
  workspaceId: string;
}) {
  const { actorWallet, workspace } = await requireWorkspaceContext({
    ...input,
    permission: "payments.create",
  });

  if (!isAsset(input.asset)) {
    throw businessErrors.invalid("Choose USDC or EURC.");
  }

  let amountDisplay: string;
  try {
    amountDisplay = parseDisplayAmount(input.amount);
  } catch (error) {
    throw businessErrors.invalid(
      error instanceof Error ? error.message : "Enter a valid amount.",
    );
  }
  const amountUnits = displayToUnits(amountDisplay);

  let counterpartyWallet: string | null = null;
  let counterpartyUsername: string | null = null;
  let counterpartyName: string | null = null;

  const trimmed = input.recipient.trim();
  if (isAddress(trimmed)) {
    counterpartyWallet = getAddress(trimmed).toLowerCase();
  } else {
    const identity = await resolvePaymentIdentity(normalizeHandle(trimmed));
    if (!identity) {
      throw businessErrors.notFound("Recipient");
    }
    counterpartyWallet = identity.destination_wallet.toLowerCase();
    counterpartyUsername = identity.username;
    counterpartyName = identity.display_name;
  }

  const supabase = businessDb();

  if (input.idempotencyKey) {
    const existing = await supabase
      .from(businessTables.payments)
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing.data) {
      const payment = existing.data as BusinessPaymentRecord;
      return { payment, requiredApprovals: 0 };
    }
  }

  const settings = await supabase
    .from(businessTables.settings)
    .select("*")
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  const policy = parseApprovalPolicy(
    (settings.data as { approval_policy?: unknown } | null)?.approval_policy,
  );
  const required = requiredApprovalsForAmount(policy, amountDisplay);

  const approvalStatus =
    required <= 0 ? "NOT_REQUIRED" : "PENDING_APPROVAL";
  const transactionStatus =
    required <= 0 ? "AUTHORIZATION_REQUIRED" : "DRAFT";

  const created = await supabase
    .from(businessTables.payments)
    .insert({
      amount_display: amountDisplay,
      amount_units: amountUnits,
      approval_status: approvalStatus,
      asset: input.asset,
      counterparty_name: counterpartyName,
      counterparty_username: counterpartyUsername,
      counterparty_wallet: counterpartyWallet,
      created_by_wallet: actorWallet,
      direction: "outgoing",
      idempotency_key: input.idempotencyKey ?? null,
      memo: input.memo?.trim().slice(0, 160) || null,
      network: "arc",
      transaction_status: transactionStatus,
      updated_at: nowIso(),
      workspace_id: workspace.id,
    })
    .select("*")
    .single();

  if (created.error) {
    throw new Error(readBusinessDbError(created.error, "Could not create the payment."));
  }

  return {
    payment: created.data as BusinessPaymentRecord,
    requiredApprovals: required,
  };
}

export async function decidePayment(input: {
  circleSocialUuid?: unknown;
  comment?: string;
  decision: "approved" | "rejected";
  ownerWallet: unknown;
  paymentId: string;
  workspaceId: string;
}) {
  const { actorWallet, workspace } = await requireWorkspaceContext({
    ...input,
    permission: "payments.approve",
  });

  const supabase = businessDb();
  const loaded = await supabase
    .from(businessTables.payments)
    .select("*")
    .eq("id", input.paymentId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  const payment = loaded.data as BusinessPaymentRecord | null;
  if (!payment) throw businessErrors.notFound("Payment");
  if (
    payment.approval_status !== "PENDING_APPROVAL" &&
    payment.approval_status !== "PARTIALLY_APPROVED"
  ) {
    throw businessErrors.conflict("This payment is not waiting for approval.");
  }

  if (payment.created_by_wallet === actorWallet) {
    throw businessErrors.forbidden("You cannot approve your own payment.");
  }

  const existing = await supabase
    .from(businessTables.paymentApprovals)
    .select("id")
    .eq("payment_id", payment.id)
    .eq("approver_wallet", actorWallet)
    .maybeSingle();
  if (existing.data) {
    throw businessErrors.conflict("You already reviewed this payment.");
  }

  const insert = await supabase.from(businessTables.paymentApprovals).insert({
    approver_wallet: actorWallet,
    comment: input.comment?.trim().slice(0, 280) || null,
    decision: input.decision,
    payment_id: payment.id,
  });
  if (insert.error) {
    throw new Error(readBusinessDbError(insert.error, "Could not record the decision."));
  }

  if (input.decision === "rejected") {
    const update = await supabase
      .from(businessTables.payments)
      .update({
        approval_status: "REJECTED",
        transaction_status: "CANCELLED",
        updated_at: nowIso(),
      })
      .eq("id", payment.id)
      .select("*")
      .single();
    return update.data as BusinessPaymentRecord;
  }

  const settings = await supabase
    .from(businessTables.settings)
    .select("approval_policy")
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  const required = requiredApprovalsForAmount(
    parseApprovalPolicy(
      (settings.data as { approval_policy?: unknown } | null)?.approval_policy,
    ),
    payment.amount_display,
  );

  const approvals = await supabase
    .from(businessTables.paymentApprovals)
    .select("*")
    .eq("payment_id", payment.id)
    .eq("decision", "approved");

  const count = (approvals.data ?? []).length;
  const nextStatus =
    count >= required ? "APPROVED" : "PARTIALLY_APPROVED";
  const nextTx =
    count >= required ? "AUTHORIZATION_REQUIRED" : payment.transaction_status;

  const update = await supabase
    .from(businessTables.payments)
    .update({
      approval_status: nextStatus,
      transaction_status: nextTx,
      updated_at: nowIso(),
    })
    .eq("id", payment.id)
    .select("*")
    .single();

  if (update.error) {
    throw new Error(readBusinessDbError(update.error, "Could not update approval state."));
  }

  return update.data as BusinessPaymentRecord;
}

export async function submitPayment(input: {
  circleSocialUuid?: unknown;
  circleTransactionId?: string;
  ownerWallet: unknown;
  paymentId: string;
  txHash?: string;
  workspaceId: string;
}) {
  const { workspace } = await requireWorkspaceContext({
    ...input,
    permission: "wallet.send",
  });
  const supabase = businessDb();
  const loaded = await supabase
    .from(businessTables.payments)
    .select("*")
    .eq("id", input.paymentId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  const payment = loaded.data as BusinessPaymentRecord | null;
  if (!payment) throw businessErrors.notFound("Payment");

  if (
    payment.approval_status !== "APPROVED" &&
    payment.approval_status !== "NOT_REQUIRED"
  ) {
    throw businessErrors.conflict("This payment still needs approval.");
  }

  if (payment.transaction_status === "COMPLETED") {
    return payment;
  }

  const txHash = input.txHash?.trim() || null;
  const update = await supabase
    .from(businessTables.payments)
    .update({
      circle_transaction_id: input.circleTransactionId?.trim() || null,
      submitted_at: nowIso(),
      transaction_status: "SUBMITTED",
      tx_hash: txHash,
      updated_at: nowIso(),
    })
    .eq("id", payment.id)
    .select("*")
    .single();

  if (update.error) {
    throw new Error(readBusinessDbError(update.error, "Could not submit the payment."));
  }

  return update.data as BusinessPaymentRecord;
}


export async function paymentAnalytics(input: {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  rangeDays: number;
  workspaceId: string;
}) {
  const payments = await listPayments({
    ...input,
    tab: "all",
  });
  const since = Date.now() - input.rangeDays * 24 * 60 * 60 * 1000;
  const inRange = payments.filter(
    (row) => new Date(row.created_at).getTime() >= since,
  );
  const completed = inRange.filter((row) => row.transaction_status === "COMPLETED");

  const received = completed
    .filter((row) => row.direction === "incoming")
    .reduce((sum, row) => sum + Number(row.amount_display), 0);
  const sent = completed
    .filter((row) => row.direction === "outgoing")
    .reduce((sum, row) => sum + Number(row.amount_display), 0);

  const buckets = new Map<string, { received: number; sent: number }>();
  for (const row of completed) {
    const day = row.created_at.slice(0, 10);
    const current = buckets.get(day) ?? { received: 0, sent: 0 };
    if (row.direction === "incoming") current.received += Number(row.amount_display);
    else current.sent += Number(row.amount_display);
    buckets.set(day, current);
  }

  const points = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, ...value }));

  return {
    moneyReceived: received,
    moneySent: sent,
    netFlow: received - sent,
    points,
    transactionCount: completed.length,
  };
}

export async function createPaymentRequest(input: {
  amount?: string;
  asset: unknown;
  circleSocialUuid?: unknown;
  memo?: string;
  ownerWallet: unknown;
  workspaceId: string;
}) {
  const { actorWallet, workspace } = await requireWorkspaceContext({
    ...input,
    permission: "requests.create",
  });
  if (!isAsset(input.asset)) {
    throw businessErrors.invalid("Choose USDC or EURC.");
  }
  const amountDisplay = input.amount?.trim()
    ? parseDisplayAmount(input.amount)
    : null;
  const supabase = businessDb();
  const created = await supabase
    .from(businessTables.requests)
    .insert({
      amount_display: amountDisplay,
      amount_units: amountDisplay ? displayToUnits(amountDisplay) : null,
      asset: input.asset,
      created_by_wallet: actorWallet,
      memo: input.memo?.trim().slice(0, 160) || null,
      status: "open",
      updated_at: nowIso(),
      workspace_id: workspace.id,
    })
    .select("*")
    .single();

  if (created.error) {
    throw new Error(readBusinessDbError(created.error, "Could not create the request."));
  }

  return created.data as BusinessPaymentRequestRecord;
}

export async function listPaymentRequests(input: {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  workspaceId: string;
}) {
  const { workspace } = await requireWorkspaceContext({
    ...input,
    permission: "business.view",
  });
  const supabase = businessDb();
  const rows = await supabase
    .from(businessTables.requests)
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (rows.error) {
    throw new Error(readBusinessDbError(rows.error, "Could not load requests."));
  }

  return (rows.data ?? []) as BusinessPaymentRequestRecord[];
}
