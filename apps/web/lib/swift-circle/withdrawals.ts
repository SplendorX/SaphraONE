import { getAddress, isAddress } from "viem";

import { assertPocketUnlocked } from "@/lib/save/lock";
import { swiftSaveVaultAddress } from "@/lib/save/config";
import { isValidUuid } from "@/lib/save/validation";
import {
  deleteCircleActivityForEntities,
  writeCircleActivity,
} from "@/lib/swift-circle/activity";
import { writeCircleAudit } from "@/lib/swift-circle/audit";
import {
  assertCircleActive,
  assertNotFrozen,
  loadCircle,
  requireActiveMember,
} from "@/lib/swift-circle/auth";
import { postFinancialCard } from "@/lib/swift-circle/chat";
import { circleDb, circleTables, isDuplicateError, readCircleDbError } from "@/lib/swift-circle/db";
import { circleErrors } from "@/lib/swift-circle/errors";
import { confirmLedgerEntry, writeLedgerEntry } from "@/lib/swift-circle/ledger";
import { loadPlatformLimits, assertUnderLimit } from "@/lib/swift-circle/limits";
import { logCircleEvent } from "@/lib/swift-circle/logging";
import { parseAmountUnits, parseUnits } from "@/lib/swift-circle/money";
import { emitCircleNotification, notifyMany } from "@/lib/swift-circle/notifications";
import {
  canInitiateWithdrawal,
  matchWithdrawalPolicy,
} from "@/lib/swift-circle/policy";
import { consumeCircleRateLimit } from "@/lib/swift-circle/rate-limit";
import { assertPermission } from "@/lib/swift-circle/rbac";
import { evaluateCircleRisk } from "@/lib/swift-circle/risk";
import { listActiveMembers, listActiveMemberWallets } from "@/lib/swift-circle/service";

import {
  getSavePocket,
  listSavePockets,
  reconcilePocketBalance,
} from "@/lib/swift-circle/pockets";
import { getSaveAccount, reconcileSaveBalance } from "@/lib/swift-circle/save";
import { arcTokens } from "@/lib/tokens";
import {
  assertCircleSaveVaultCanWithdraw,
  pickCircleSaveVaultOwner,
  readCircleSaveVaultHoldings,
  requireCircleSaveVault,
  type CircleSaveVaultCall,
  verifyCircleSaveWithdrawal,
} from "@/lib/swift-circle/vault";
import { normalizeTxHash } from "@/lib/swift-circle/deposits";
import {
  assertWithdrawalTransition,
  canTransitionWithdrawal,
  isOpenWithdrawal,
} from "@/lib/swift-circle/state";
import type {
  CircleProductType,
  CircleRole,
  CircleWithdrawalApprovalRecord,
  CircleWithdrawalPolicyRecord,
  CircleWithdrawalProposalRecord,
} from "@/lib/swift-circle/types";

function normalizeIdempotencyKey(value: unknown) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (key.length < 8 || key.length > 128) return null;
  return key;
}

function isProduct(value: unknown): value is CircleProductType {
  return value === "save";
}

export async function listPolicies(circleId: string) {
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.policies)
    .select("*")
    .eq("circle_id", circleId)
    .order("product_type")
    .order("minimum_amount_units");
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load policies."));
  }
  return (data ?? []) as CircleWithdrawalPolicyRecord[];
}

export async function updatePolicies(input: {
  actorWallet: string;
  circleId: string;
  policies: unknown;
  requestId?: string;
}) {
  const circle = await loadCircle(input.circleId);
  const member = await requireActiveMember(input.circleId, input.actorWallet);
  assertPermission(member, "manage_policy");
  if (!Array.isArray(input.policies) || input.policies.length === 0) {
    throw circleErrors.invalid("Provide at least one policy band.");
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const raw of input.policies) {
    if (!raw || typeof raw !== "object") {
      throw circleErrors.invalid("Invalid policy band.");
    }
    const row = raw as Record<string, unknown>;
    if (!isProduct(row.productType)) {
      throw circleErrors.invalid("Policy product must be Circle Save.");
    }
    const min = parseAmountUnits(row.minimumAmount ?? "0", circle.currency);
    const max =
      row.maximumAmount === null || row.maximumAmount === undefined || row.maximumAmount === ""
        ? null
        : parseAmountUnits(row.maximumAmount, circle.currency);
    const approvals = Number(row.requiredApprovals);
    if (!Number.isInteger(approvals) || approvals < 0 || approvals > 20) {
      throw circleErrors.invalid("Required approvals must be between 0 and 20.");
    }
    const roles = Array.isArray(row.eligibleRoles)
      ? row.eligibleRoles.filter(
          (role): role is CircleRole =>
            role === "host" || role === "admin" || role === "member",
        )
      : (["host", "admin"] as CircleRole[]);
    if (roles.length === 0) {
      throw circleErrors.invalid("Select at least one eligible role.");
    }
    rows.push({
      circle_id: circle.id,
      product_type: row.productType,
      minimum_amount_units: min?.amount_units ?? "0",
      maximum_amount_units: max?.amount_units ?? null,
      required_approvals: approvals,
      eligible_roles: roles,
      initiator_counts_as_approval: row.initiatorCountsAsApproval === true,
      version: 1,
      active: true,
    });
  }

  const supabase = circleDb();
  await supabase
    .from(circleTables.policies)
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("circle_id", circle.id)
    .eq("active", true);
  const { data, error } = await supabase
    .from(circleTables.policies)
    .insert(rows)
    .select("*");
  if (error) {
    throw new Error(readCircleDbError(error, "Could not update policies."));
  }

  await supabase
    .from(circleTables.withdrawals)
    .update({
      status: "expired",
      failure_reason: "Withdrawal policy changed.",
      updated_at: new Date().toISOString(),
    })
    .eq("circle_id", circle.id)
    .in("status", ["pending_policy", "pending_approval", "approved"]);

  await writeCircleAudit({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    action: "POLICY_CHANGED",
    entityType: "withdrawal_policy",
    entityId: circle.id,
    requestId: input.requestId,
  });
  await writeCircleActivity({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    activityType: "policy.changed",
    summary: "Withdrawal policy was updated",
  });
  return (data ?? []) as CircleWithdrawalPolicyRecord[];
}

async function countRecent(circleId: string, actionPrefix: string, hours: number) {
  const supabase = circleDb();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from(circleTables.audit)
    .select("id", { count: "exact" })
    .eq("circle_id", circleId)
    .gte("created_at", since)
    .like("action", actionPrefix)
    .limit(0);
  return count ?? 0;
}

export async function createWithdrawalProposal(input: {
  actorWallet: string;
  circleId: string;
  productType: unknown;
  amount: unknown;
  pocketId?: unknown;
  destinationWallet?: unknown;
  destinationAddress?: unknown;
  reason?: unknown;
  confirm?: unknown;
  idempotencyKey?: unknown;
  requestId?: string;
}) {
  await consumeCircleRateLimit({ bucket: "WITHDRAWAL", wallet: input.actorWallet });
  if (input.confirm !== true && input.confirm !== "confirm") {
    throw circleErrors.invalid("Withdrawals require explicit confirmation.");
  }
  const circle = await loadCircle(input.circleId);
  assertCircleActive(circle);
  assertNotFrozen(circle);
  const member = await requireActiveMember(input.circleId, input.actorWallet);
  assertPermission(member, "initiate_withdrawal");
  if (input.productType === "earn") {
    throw circleErrors.invalid("Circle Earn is no longer available in Circle.");
  }
  if (!isProduct(input.productType)) {
    throw circleErrors.invalid("Withdrawals can only come from Circle Save.");
  }
  const parsed = parseAmountUnits(input.amount, circle.currency);
  if (!parsed) throw circleErrors.invalid("Enter a valid withdrawal amount.");
  const limits = await loadPlatformLimits();
  assertUnderLimit(parsed.units, limits.max_withdrawal_amount_units, "Withdrawal");

  const destWallet =
    typeof input.destinationWallet === "string"
      ? input.destinationWallet.toLowerCase()
      : input.actorWallet;
  const destAddressRaw =
    typeof input.destinationAddress === "string"
      ? input.destinationAddress
      : destWallet;
  if (!isAddress(destAddressRaw)) {
    throw circleErrors.invalid("Enter a valid destination address.");
  }
  const destinationAddress = getAddress(destAddressRaw).toLowerCase();

  let pocketId =
    typeof input.pocketId === "string" && input.pocketId.trim()
      ? input.pocketId.trim()
      : "";
  if (!isValidUuid(pocketId)) {
    const active = (await listSavePockets(circle.id)).filter(
      (pocket) => pocket.status === "active",
    );
    if (active.length === 1 && active[0]) {
      pocketId = active[0].id;
    }
  }
  if (!isValidUuid(pocketId)) {
    throw circleErrors.invalid("Choose a Circle Save pocket to withdraw from.");
  }
  const pocket = await getSavePocket(circle.id, pocketId);
  assertPocketUnlocked(pocket);
  const vaultAddress = swiftSaveVaultAddress();
  const token = arcTokens[circle.currency];
  if (vaultAddress && token?.address) {
    const owners = await listActiveMemberWallets(circle.id);
    const holdings = await readCircleSaveVaultHoldings({
      owners: [circle.host_user_wallet, input.actorWallet, ...owners],
      pocketId: pocket.id,
      token: token.address,
      vault: vaultAddress,
    });
    if (parsed.units > holdings.total) {
      throw circleErrors.invalid(
        holdings.total <= 0n
          ? "This Circle Save pocket has no on-chain vault balance. Deposit into the pocket first."
          : "Amount exceeds this pocket’s on-chain vault balance.",
      );
    }
  } else {
    const available = await reconcilePocketBalance(pocket.id);
    if (parsed.units > available) {
      throw circleErrors.invalid("Amount exceeds this pocket’s balance.");
    }
  }
  await getSaveAccount(circle.id);

  const supabase = circleDb();
  const { count: pendingCount } = await supabase
    .from(circleTables.withdrawals)
    .select("id", { count: "exact" })
    .eq("circle_id", circle.id)
    .limit(0)
    .in("status", [
      "draft",
      "pending_policy",
      "pending_approval",
      "approved",
      "executing",
      "submitted",
    ]);
  if ((pendingCount ?? 0) >= limits.max_pending_withdrawals) {
    throw circleErrors.invalid("Too many pending withdrawals for this Circle.");
  }

  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) {
    throw circleErrors.invalid("An idempotency key is required.");
  }
  const { data: existing } = await supabase
    .from(circleTables.withdrawals)
    .select("*")
    .eq("circle_id", circle.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) {
    return { proposal: existing as CircleWithdrawalProposalRecord, reused: true };
  }

  const policies = await listPolicies(circle.id);
  const policy = matchWithdrawalPolicy({
    amountUnits: parsed.units,
    policies,
    productType: input.productType,
  });
  if (!canInitiateWithdrawal({ policy, role: member.role })) {
    throw circleErrors.forbidden("Your role cannot initiate this withdrawal.");
  }

  const members = await listActiveMembers(circle.id);
  const eligibleApprovers = members.filter((row) =>
    policy.eligible_roles.includes(row.role),
  );
  const recentWithdrawals = await countRecent(circle.id, "WITHDRAWAL_%", 1);
  const recentRoleChanges = await countRecent(circle.id, "ROLE_CHANGED", 24);
  const recentPolicyChanges = await countRecent(circle.id, "POLICY_CHANGED", 24);
  const risk = evaluateCircleRisk({
    amountUnits: parsed.units,
    circle,
    memberCount: members.length,
    recentPolicyChanges,
    recentRoleChanges,
    recentWithdrawals,
    operation: "withdrawal",
  });
  if (risk.decision === "BLOCK") {
    throw circleErrors.riskBlocked(risk.reasons[0]);
  }

  let required = policy.required_approvals;
  if (risk.decision === "REVIEW") {
    required = Math.max(required, 2);
  }
  required = Math.min(required, eligibleApprovers.length);
  const status = required === 0 ? "approved" : "pending_approval";

  const { data, error } = await supabase
    .from(circleTables.withdrawals)
    .insert({
      circle_id: circle.id,
      product_type: input.productType,
      initiator_user_wallet: input.actorWallet,
      amount: parsed.amount,
      amount_units: parsed.amount_units,
      asset: circle.currency,
      destination_user_wallet: destWallet,
      destination_address: destinationAddress,
      pocket_id: pocket.id,
      reason:
        typeof input.reason === "string" ? input.reason.trim().slice(0, 140) : null,
      policy_id: policy.id,
      policy_version: policy.version,
      required_approvals: required,
      approval_epoch: 1,
      status,
      risk_decision: risk.decision,
      idempotency_key: idempotencyKey,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("*")
    .single();
  if (error && isDuplicateError(error)) {
    const reused = await supabase
      .from(circleTables.withdrawals)
      .select("*")
      .eq("circle_id", circle.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    return {
      proposal: reused.data as CircleWithdrawalProposalRecord,
      reused: true,
    };
  }
  if (error) {
    throw new Error(readCircleDbError(error, "Could not create withdrawal."));
  }
  const proposal = data as CircleWithdrawalProposalRecord;

  if (policy.initiator_counts_as_approval && required > 0) {
    await supabase.from(circleTables.approvals).insert({
      withdrawal_proposal_id: proposal.id,
      circle_id: circle.id,
      approver_user_wallet: input.actorWallet,
      decision: "approved",
      approval_epoch: 1,
    });
  }

  await writeLedgerEntry({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    entryType: "withdrawal",
    productType: input.productType,
    source: `circle_${input.productType}:${circle.id}`,
    destination: destinationAddress,
    amountUnits: parsed.amount_units,
    asset: circle.currency,
    purpose: `circle_${input.productType}_withdrawal`,
    relatedEntityType: "withdrawal_proposal",
    relatedEntityId: proposal.id,
    status: "pending",
    idempotencyKey: `wd:${idempotencyKey}`,
  });
  await writeCircleAudit({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    action: "WITHDRAWAL_CREATED",
    entityType: "withdrawal_proposal",
    entityId: proposal.id,
    requestId: input.requestId,
  });
  await writeCircleActivity({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    activityType: "withdrawal.created",
    entityType: "withdrawal_proposal",
    entityId: proposal.id,
    summary: `Withdrawal of ${parsed.amount} ${circle.currency} from Circle ${input.productType === "save" ? "Save" : "Earn"}`,
  });
  await postFinancialCard({
    circleId: circle.id,
    content: `Withdrawal initiated: ${parsed.amount} ${circle.currency}`,
    metadata: { type: "withdrawal", proposalId: proposal.id, required },
  });
  const approverWallets = eligibleApprovers
    .map((row) => row.user_wallet)
    .filter((wallet) => wallet !== input.actorWallet);
  await notifyMany(approverWallets, {
    eventId: `circle-wd-required:${proposal.id}`,
    circleId: circle.id,
    kind: "circle_approval",
    title: "Approval required",
    body: `A ${parsed.amount} ${circle.currency} Circle ${input.productType} withdrawal needs your review.`,
    metadata: { proposalId: proposal.id },
  });
  logCircleEvent({
    requestId: input.requestId,
    userWallet: input.actorWallet,
    circleId: circle.id,
    operation: "withdrawal.created",
    idempotencyKey,
    status,
  });
  return { proposal, reused: false, policy, required };
}

export async function getWithdrawal(proposalId: string, actorWallet: string) {
  if (!isValidUuid(proposalId)) throw circleErrors.invalid("Invalid withdrawal id.");
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.withdrawals)
    .select("*")
    .eq("id", proposalId)
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load withdrawal."));
  }
  if (!data) throw circleErrors.notFound("Withdrawal");
  const proposal = data as CircleWithdrawalProposalRecord;
  await requireActiveMember(proposal.circle_id, actorWallet);
  const { data: approvals } = await supabase
    .from(circleTables.approvals)
    .select("*")
    .eq("withdrawal_proposal_id", proposal.id)
    .eq("approval_epoch", proposal.approval_epoch);
  return {
    ...proposal,
    approvals: (approvals ?? []) as CircleWithdrawalApprovalRecord[],
  };
}

export async function listWithdrawals(circleId: string) {
  await pruneStaleSaveWithdrawals(circleId);
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.withdrawals)
    .select("*")
    .eq("circle_id", circleId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load withdrawals."));
  }
  return ((data ?? []) as CircleWithdrawalProposalRecord[]).filter((row) => {
    if (
      row.status === "cancelled" ||
      row.status === "expired" ||
      row.status === "rejected"
    ) {
      return false;
    }
    if (row.status === "failed" && !row.tx_hash) {
      return false;
    }
    return true;
  });
}

export async function decideWithdrawal(input: {
  actorWallet: string;
  proposalId: string;
  decision: "approved" | "rejected";
  requestId?: string;
}) {
  await consumeCircleRateLimit({ bucket: "APPROVAL", wallet: input.actorWallet });
  const proposal = await getWithdrawal(input.proposalId, input.actorWallet);
  const member = await requireActiveMember(proposal.circle_id, input.actorWallet);
  assertPermission(member, "approve_withdrawal");
  if (proposal.status !== "pending_approval") {
    throw circleErrors.conflict("This withdrawal is not awaiting approval.");
  }
  if (
    proposal.expires_at &&
    Date.parse(proposal.expires_at) <= Date.now()
  ) {
    await expireProposal(proposal);
    throw circleErrors.conflict("This withdrawal has expired.");
  }

  const policies = await listPolicies(proposal.circle_id);
  const policy = policies.find((row) => row.id === proposal.policy_id);
  if (policy && !policy.eligible_roles.includes(member.role)) {
    throw circleErrors.forbidden("You are not an eligible approver for this policy.");
  }

  const supabase = circleDb();
  const { data: approval, error } = await supabase
    .from(circleTables.approvals)
    .insert({
      withdrawal_proposal_id: proposal.id,
      circle_id: proposal.circle_id,
      approver_user_wallet: input.actorWallet,
      decision: input.decision,
      approval_epoch: proposal.approval_epoch,
    })
    .select("*")
    .single();
  if (error && isDuplicateError(error)) {
    throw circleErrors.conflict("You already recorded a decision on this withdrawal.");
  }
  if (error) {
    throw new Error(readCircleDbError(error, "Could not record approval."));
  }

  if (input.decision === "rejected") {
    assertWithdrawalTransition(proposal.status, "rejected");
    await supabase
      .from(circleTables.withdrawals)
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", proposal.id)
      .eq("status", "pending_approval");
    await writeCircleAudit({
      circleId: proposal.circle_id,
      actorWallet: input.actorWallet,
      action: "WITHDRAWAL_REJECTED",
      entityType: "withdrawal_proposal",
      entityId: proposal.id,
      requestId: input.requestId,
    });
    await writeCircleActivity({
      circleId: proposal.circle_id,
      actorWallet: input.actorWallet,
      activityType: "withdrawal.rejected",
      entityType: "withdrawal_proposal",
      entityId: proposal.id,
      summary: "Withdrawal was rejected",
    });
    await emitCircleNotification({
      eventId: `circle-wd-rejected:${proposal.id}`,
      circleId: proposal.circle_id,
      ownerWallet: proposal.initiator_user_wallet,
      kind: "circle_withdrawal",
      title: "Withdrawal rejected",
      body: `The ${proposal.amount} ${proposal.asset} withdrawal was rejected.`,
    });
    return getWithdrawal(proposal.id, input.actorWallet);
  }

  const current = await getWithdrawal(proposal.id, input.actorWallet);
  const approvedCount = (current.approvals ?? []).filter(
    (row) => row.decision === "approved",
  ).length;
  if (approvedCount >= current.required_approvals) {
    assertWithdrawalTransition(current.status, "approved");
    await supabase
      .from(circleTables.withdrawals)
      .update({ status: "approved", updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("status", "pending_approval");
    await writeCircleAudit({
      circleId: current.circle_id,
      actorWallet: input.actorWallet,
      action: "WITHDRAWAL_APPROVED",
      entityType: "withdrawal_proposal",
      entityId: current.id,
      requestId: input.requestId,
    });
    await writeCircleActivity({
      circleId: current.circle_id,
      actorWallet: input.actorWallet,
      activityType: "withdrawal.approved",
      entityType: "withdrawal_proposal",
      entityId: current.id,
      summary: "Withdrawal reached the approval threshold",
    });
    await emitCircleNotification({
      eventId: `circle-wd-approved:${current.id}`,
      circleId: current.circle_id,
      ownerWallet: current.initiator_user_wallet,
      kind: "circle_withdrawal",
      title: "Withdrawal approved",
      body: `The ${current.amount} ${current.asset} withdrawal is approved and ready to execute.`,
    });
  } else {
    await writeCircleActivity({
      circleId: current.circle_id,
      actorWallet: input.actorWallet,
      activityType: "withdrawal.approval",
      entityType: "withdrawal_approval",
      entityId: approval.id,
      summary: `Approval ${approvedCount}/${current.required_approvals}`,
    });
  }
  return getWithdrawal(proposal.id, input.actorWallet);
}

export async function cancelWithdrawal(input: {
  actorWallet: string;
  proposalId: string;
}) {
  const proposal = await getWithdrawal(input.proposalId, input.actorWallet);
  const member = await requireActiveMember(proposal.circle_id, input.actorWallet);
  const canCancel =
    proposal.initiator_user_wallet === input.actorWallet ||
    member.role === "host";
  if (!canCancel) throw circleErrors.forbidden();
  if (!canTransitionWithdrawal(proposal.status, "cancelled")) {
    throw circleErrors.conflict("This withdrawal can no longer be cancelled.");
  }
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.withdrawals)
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", proposal.id)
    .in("status", ["draft", "pending_policy", "pending_approval", "approved"])
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not cancel withdrawal."));
  }
  if (!data) throw circleErrors.conflict("This withdrawal can no longer be cancelled.");
  return data as CircleWithdrawalProposalRecord;
}

const STALE_SAVE_WITHDRAWAL_MS = 3 * 60 * 1000;

const OPEN_SAVE_WITHDRAWAL_STATUSES = [
  "draft",
  "pending_policy",
  "pending_approval",
  "approved",
  "executing",
  "failed",
] as const;

async function closeUnsubmittedSaveWithdrawals(input: {
  circleId: string;
  ids: string[];
  reason: string;
}) {
  if (input.ids.length === 0) return;
  const supabase = circleDb();
  const { error } = await supabase
    .from(circleTables.withdrawals)
    .update({
      status: "cancelled",
      failure_reason: input.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("circle_id", input.circleId)
    .in("id", input.ids)
    .is("tx_hash", null)
    .in("status", [...OPEN_SAVE_WITHDRAWAL_STATUSES]);
  if (error) {
    console.error("[circle-save-close-wd]", error.message);
    return;
  }
  const { error: ledgerError } = await supabase
    .from(circleTables.ledger)
    .update({ status: "reversed" })
    .eq("circle_id", input.circleId)
    .eq("related_entity_type", "withdrawal_proposal")
    .in("related_entity_id", input.ids)
    .in("status", ["pending", "submitted"]);
  if (ledgerError) {
    console.error("[circle-save-close-wd-ledger]", ledgerError.message);
  }
  const { data: approvals } = await supabase
    .from(circleTables.approvals)
    .select("id")
    .in("withdrawal_proposal_id", input.ids);
  await deleteCircleActivityForEntities({
    circleId: input.circleId,
    entityIds: [
      ...input.ids,
      ...(approvals ?? []).map((row) => String(row.id)),
    ],
  });
}

export async function pruneStaleSaveWithdrawals(circleId: string) {
  const supabase = circleDb();
  const cutoff = new Date(Date.now() - STALE_SAVE_WITHDRAWAL_MS).toISOString();
  const { data, error } = await supabase
    .from(circleTables.withdrawals)
    .select("id")
    .eq("circle_id", circleId)
    .eq("product_type", "save")
    .is("tx_hash", null)
    .in("status", [...OPEN_SAVE_WITHDRAWAL_STATUSES])
    .lt("created_at", cutoff);
  if (error) {
    console.error("[circle-save-prune-wd]", error.message);
  } else {
    await closeUnsubmittedSaveWithdrawals({
      circleId,
      ids: (data ?? []).map((row) => String(row.id)),
      reason: "Stale off-chain Circle Save withdrawal with no vault transaction.",
    });
  }

  const vault = swiftSaveVaultAddress();
  if (!vault) return;
  try {
    const circle = await loadCircle(circleId);
    const token = arcTokens[circle.currency];
    if (!token?.address) return;
    const pockets = await listSavePockets(circleId);
    const owners = await listActiveMemberWallets(circleId);
    const emptyPocketIds: string[] = [];
    for (const pocket of pockets) {
      const { total } = await readCircleSaveVaultHoldings({
        owners,
        pocketId: pocket.id,
        token: token.address,
        vault,
      });
      if (total <= 0n) emptyPocketIds.push(pocket.id);
    }
    if (emptyPocketIds.length === 0) return;
    const inFlightCutoff = new Date(Date.now() - 30_000).toISOString();
    const { data: emptyRows, error: emptyError } = await supabase
      .from(circleTables.withdrawals)
      .select("id")
      .eq("circle_id", circleId)
      .eq("product_type", "save")
      .is("tx_hash", null)
      .in("pocket_id", emptyPocketIds)
      .in("status", [...OPEN_SAVE_WITHDRAWAL_STATUSES])
      .lt("created_at", inFlightCutoff);
    if (emptyError) {
      console.error("[circle-save-prune-empty-wd]", emptyError.message);
      return;
    }
    await closeUnsubmittedSaveWithdrawals({
      circleId,
      ids: (emptyRows ?? []).map((row) => String(row.id)),
      reason: "No on-chain vault balance remains for this Circle Save pocket.",
    });
  } catch (error) {
    console.error("[circle-save-prune-empty-wd]", error);
  }
}

export async function executeWithdrawal(input: {
  actorWallet: string;
  proposalId: string;
  requestId?: string;
  txHash?: unknown;
}) {
  const proposal = await getWithdrawal(input.proposalId, input.actorWallet);
  const circle = await loadCircle(proposal.circle_id);
  assertNotFrozen(circle);
  const member = await requireActiveMember(proposal.circle_id, input.actorWallet);
  assertPermission(member, "initiate_withdrawal");
  if (!isAddress(proposal.destination_address)) {
    throw circleErrors.invalid("Destination is invalid.");
  }
  if (proposal.product_type !== "save") {
    throw circleErrors.invalid("Only Circle Save pocket withdrawals can be executed.");
  }
  if (!proposal.pocket_id) {
    throw circleErrors.invalid("This withdrawal is not linked to a Circle Save pocket.");
  }

  const host = getAddress(circle.host_user_wallet);
  const actor = getAddress(input.actorWallet);
  if (actor.toLowerCase() !== host.toLowerCase()) {
    throw circleErrors.forbidden(
      "Only the Circle host can withdraw from the Circle Save pocket.",
    );
  }

  const vault = requireCircleSaveVault();
  const token = arcTokens[proposal.asset];
  if (!token?.address) {
    throw circleErrors.invalid("Unsupported withdrawal asset.");
  }
  const amountUnits = parseUnits(proposal.amount_units);
  const destination = getAddress(proposal.destination_address);
  const txHash = normalizeTxHash(input.txHash);

  if (proposal.tx_hash) {
    const existingHash = proposal.tx_hash.toLowerCase();
    if (txHash && txHash.toLowerCase() !== existingHash) {
      throw circleErrors.conflict("This withdrawal already has a transaction.");
    }
    if (proposal.status === "confirmed") {
      return { withdrawal: proposal, vaultCall: null };
    }
    try {
      const confirmed = await confirmWithdrawalFromTx(proposal.tx_hash);
      return {
        withdrawal:
          confirmed ?? (await getWithdrawal(proposal.id, input.actorWallet)),
        vaultCall: null,
      };
    } catch (error) {
      console.error("[circle-save-confirm-wd]", error);
      return { withdrawal: proposal, vaultCall: null };
    }
  }

  const canPrepare =
    proposal.status === "approved" ||
    proposal.status === "failed" ||
    proposal.status === "executing";
  if (!canPrepare) {
    throw circleErrors.approvalRequired();
  }

  if (txHash) {
    const verified = await verifyCircleSaveWithdrawal({
      amountUnits,
      asset: proposal.asset,
      destination,
      owner: actor,
      txHash,
      waitMs: 12_000,
    });
    if (!verified.ok && "pending" in verified && verified.pending) {
      throw circleErrors.pending();
    }
    if (!verified.ok) {
      throw circleErrors.invalid(
        verified.reason ??
          "This transaction did not withdraw from the Circle Save pocket.",
      );
    }

    const supabase = circleDb();
    const { data: locked, error } = await supabase
      .from(circleTables.withdrawals)
      .update({
        status: "executing",
        failure_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposal.id)
      .in("status", ["approved", "failed", "executing"])
      .is("tx_hash", null)
      .select("*")
      .maybeSingle();
    if (error) {
      throw new Error(readCircleDbError(error, "Could not execute withdrawal."));
    }
    if (!locked) {
      const existing = await getWithdrawal(proposal.id, input.actorWallet);
      return { withdrawal: existing, vaultCall: null };
    }

    await supabase
      .from(circleTables.withdrawals)
      .update({
        status: "submitted",
        tx_hash: txHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposal.id)
      .eq("status", "executing");

    logCircleEvent({
      requestId: input.requestId,
      userWallet: input.actorWallet,
      circleId: proposal.circle_id,
      transactionId: txHash,
      operation: "withdrawal.submitted",
      idempotencyKey: proposal.idempotency_key,
      status: "submitted",
    });
    try {
      const confirmed = await confirmWithdrawalFromTx(txHash);
      return {
        withdrawal:
          confirmed ?? (await getWithdrawal(proposal.id, input.actorWallet)),
        vaultCall: null,
      };
    } catch (error) {
      console.error("[circle-save-confirm-wd]", error);
      return {
        withdrawal: await getWithdrawal(proposal.id, input.actorWallet),
        vaultCall: null,
      };
    }
  }

  const owners = await listActiveMemberWallets(circle.id);
  const holdings = await readCircleSaveVaultHoldings({
    owners: [host, input.actorWallet, ...owners],
    pocketId: proposal.pocket_id,
    token: token.address,
    vault,
  });
  if (holdings.total < amountUnits) {
    await closeUnsubmittedSaveWithdrawals({
      circleId: proposal.circle_id,
      ids: [proposal.id],
      reason:
        holdings.total <= 0n
          ? "No on-chain vault balance remains for this Circle Save pocket."
          : "On-chain vault balance is below this withdrawal amount.",
    });
    throw circleErrors.invalid(
      holdings.total <= 0n
        ? "This Circle Save pocket has no on-chain vault balance. Deposit into the pocket first. Execute only withdraws from the Save vault, never from your operator wallet."
        : "This withdrawal is larger than the on-chain pocket vault balance.",
    );
  }
  const owner = pickCircleSaveVaultOwner({
    actor,
    amountUnits,
    holdings: holdings.holdings,
    host,
  });
  if (owner.toLowerCase() !== actor.toLowerCase()) {
    throw circleErrors.forbidden(
      "Connect the wallet that holds this Circle Save pocket in the vault to withdraw.",
    );
  }
  const vaultCall: CircleSaveVaultCall = {
    amountUnits: proposal.amount_units,
    destination,
    needsForward: owner.toLowerCase() !== destination.toLowerCase(),
    owner,
    pocketId: proposal.pocket_id,
    pocketIdBytes32: holdings.pocketIdBytes32,
    token: token.address,
    vault,
  };
  await assertCircleSaveVaultCanWithdraw({
    amountUnits,
    owner,
    pocketIdBytes32: vaultCall.pocketIdBytes32,
    token: token.address,
    vault,
  });
  return { withdrawal: proposal, vaultCall };
}

export async function confirmWithdrawalFromTx(txHash: string) {
  const supabase = circleDb();
  const hash = txHash.toLowerCase();
  const { data } = await supabase
    .from(circleTables.withdrawals)
    .select("*")
    .eq("tx_hash", hash)
    .maybeSingle();
  if (!data) return null;
  const proposal = data as CircleWithdrawalProposalRecord;
  if (proposal.status === "confirmed") return proposal;
  const { data: updated } = await supabase
    .from(circleTables.withdrawals)
    .update({ status: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", proposal.id)
    .in("status", ["submitted", "executing"])
    .select("*")
    .maybeSingle();
  if (!updated) return proposal;
  try {
    await confirmLedgerEntry(`wd:${proposal.idempotency_key}`, hash);
  } catch (error) {
    console.error("[circle-save-confirm-ledger]", error);
  }
  try {
    if (proposal.pocket_id) {
      await reconcilePocketBalance(proposal.pocket_id);
    }
    if (proposal.product_type === "save") {
      await reconcileSaveBalance(proposal.circle_id);
    }
  } catch (error) {
    console.error("[circle-save-confirm-balance]", error);
  }
  await writeCircleAudit({
    circleId: proposal.circle_id,
    actorWallet: proposal.initiator_user_wallet,
    action: "WITHDRAWAL_EXECUTED",
    entityType: "withdrawal_proposal",
    entityId: proposal.id,
  });
  await writeCircleActivity({
    circleId: proposal.circle_id,
    actorWallet: proposal.initiator_user_wallet,
    activityType: "withdrawal.completed",
    entityType: "withdrawal_proposal",
    entityId: proposal.id,
    summary: `Withdrawal of ${proposal.amount} ${proposal.asset} completed`,
  });
  try {
    await postFinancialCard({
      circleId: proposal.circle_id,
      content: `Withdrawal of ${proposal.amount} ${proposal.asset} completed`,
      metadata: { type: "withdrawal_completed", proposalId: proposal.id },
    });
  } catch (error) {
    console.error("[circle-save-confirm-card]", error);
  }
  try {
    const members = await listActiveMemberWallets(proposal.circle_id);
    await notifyMany(members, {
      eventId: `circle-wd-done:${proposal.id}`,
      circleId: proposal.circle_id,
      kind: "circle_withdrawal",
      title: "Withdrawal completed",
      body: `${proposal.amount} ${proposal.asset} left Circle ${proposal.product_type === "save" ? "Save" : "Earn"}.`,
    });
  } catch (error) {
    console.error("[circle-save-confirm-notify]", error);
  }
  return updated as CircleWithdrawalProposalRecord;
}

async function expireProposal(proposal: CircleWithdrawalProposalRecord) {
  if (!isOpenWithdrawal(proposal.status)) return;
  const supabase = circleDb();
  await supabase
    .from(circleTables.withdrawals)
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("id", proposal.id)
    .in("status", ["draft", "pending_policy", "pending_approval", "approved"]);
}


