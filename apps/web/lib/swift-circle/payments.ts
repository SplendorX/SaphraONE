
import { isValidTxHash, isValidUuid } from "@/lib/save/validation";
import { writeCircleActivity } from "@/lib/swift-circle/activity";
import { circleTreasuryAddress } from "@/lib/swift-circle/adapter";
import { writeCircleAudit } from "@/lib/swift-circle/audit";
import {
  buildCirclePayExecution,
  everyonePaidCopy,
  reconcileBatchStatus,
  selectCirclePayRail,
  type CirclePayExecution,
} from "@/lib/swift-circle/batch";
import {
  assertCircleActive,
  assertNotFrozen,
  loadCircle,
  requireActiveMember,
} from "@/lib/swift-circle/auth";
import { postFinancialCard } from "@/lib/swift-circle/chat";
import { circleDb, circleTables, isDuplicateError, readCircleDbError } from "@/lib/swift-circle/db";
import { circleErrors } from "@/lib/swift-circle/errors";
import { writeLedgerEntry, confirmLedgerEntry } from "@/lib/swift-circle/ledger";
import { loadPlatformLimits, assertUnderLimit } from "@/lib/swift-circle/limits";
import { logCircleEvent } from "@/lib/swift-circle/logging";
import {
  assertCustomSplit,
  equalSplitUnits,
  parseAmountUnits,
  parseUnits,
  sumUnits,
  unitsToAmount,
} from "@/lib/swift-circle/money";
import { emitCircleNotification } from "@/lib/swift-circle/notifications";
import { consumeCircleRateLimit } from "@/lib/swift-circle/rate-limit";
import { assertPermission } from "@/lib/swift-circle/rbac";
import { evaluateCircleRisk } from "@/lib/swift-circle/risk";
import { listActiveMembers } from "@/lib/swift-circle/service";
import { canTransitionPayment } from "@/lib/swift-circle/state";
import type {
  CirclePaymentIntentRecord,
  CirclePaymentMode,
  CirclePaymentRecipientRecord,
} from "@/lib/swift-circle/types";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";
import { processTransactionCashback } from "@/lib/referral/cashback-service";
import { recordLedgerTransaction } from "@/lib/ledger/transactions";

function isPaymentMode(value: unknown): value is CirclePaymentMode {
  return (
    value === "individual" ||
    value === "multiple" ||
    value === "everyone" ||
    value === "equal_split" ||
    value === "custom_split"
  );
}

function normalizeIdempotencyKey(value: unknown) {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (key.length < 8 || key.length > 128) return null;
  return key;
}

async function loadExistingPayment(sender: string, idempotencyKey: string) {
  const supabase = circleDb();
  const { data } = await supabase
    .from(circleTables.payments)
    .select("*")
    .eq("sender_user_wallet", sender)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  return (data as CirclePaymentIntentRecord | null) ?? null;
}

export async function resolvePaymentRecipients(input: {
  actorWallet: string;
  circleId: string;
  mode: CirclePaymentMode;
  total?: unknown;
  recipients?: unknown;
  everyoneAmount?: unknown;
  asset: ArcTokenSymbol;
}) {
  const members = await listActiveMembers(input.circleId);
  const eligible = members.filter(
    (member) => member.user_wallet !== input.actorWallet,
  );
  if (eligible.length === 0) {
    throw circleErrors.invalid("There are no other members to pay.");
  }
  const memberSet = new Set(eligible.map((member) => member.user_wallet));

  if (input.mode === "everyone") {
    const parsed = parseAmountUnits(input.everyoneAmount ?? input.total, input.asset);
    if (!parsed) throw circleErrors.invalid("Enter a valid amount per member.");
    return eligible.map((member) => ({
      wallet: member.user_wallet,
      username: member.username ?? null,
      amount: parsed.amount,
      units: parsed.units,
    }));
  }

  if (input.mode === "equal_split") {
    const parsed = parseAmountUnits(input.total, input.asset);
    if (!parsed) throw circleErrors.invalid("Enter a valid total amount.");
    let selected = eligible;
    if (Array.isArray(input.recipients) && input.recipients.length > 0) {
      const wallets = input.recipients
        .map((item) => {
          if (typeof item === "string") return item.toLowerCase();
          if (item && typeof item === "object" && "wallet" in item) {
            return String((item as { wallet: unknown }).wallet).toLowerCase();
          }
          return "";
        })
        .filter((wallet) => memberSet.has(wallet));
      if (wallets.length === 0) {
        throw circleErrors.invalid("Select at least one Circle member.");
      }
      selected = eligible.filter((member) => wallets.includes(member.user_wallet));
    }
    const parts = equalSplitUnits(parsed.units, selected.length);
    return selected.map((member, index) => ({
      wallet: member.user_wallet,
      username: member.username ?? null,
      amount: unitsToAmount(parts[index], input.asset),
      units: parts[index],
    }));
  }

  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    throw circleErrors.invalid("Select at least one recipient.");
  }

  const resolved = [];
  for (const item of input.recipients) {
    if (!item || typeof item !== "object") {
      throw circleErrors.invalid("Each recipient must include a wallet and amount.");
    }
    const row = item as { wallet?: unknown; amount?: unknown };
    const wallet =
      typeof row.wallet === "string" ? row.wallet.toLowerCase() : "";
    if (!memberSet.has(wallet)) {
      throw circleErrors.invalid("Recipients must be active Circle members.");
    }
    const parsed = parseAmountUnits(row.amount, input.asset);
    if (!parsed) {
      throw circleErrors.invalid("Each recipient amount must be greater than zero.");
    }
    const member = eligible.find((entry) => entry.user_wallet === wallet);
    resolved.push({
      wallet,
      username: member?.username ?? null,
      amount: parsed.amount,
      units: parsed.units,
    });
  }

  if (input.mode === "custom_split") {
    const parsedTotal = parseAmountUnits(input.total, input.asset);
    if (!parsedTotal) throw circleErrors.invalid("Enter a valid total amount.");
    assertCustomSplit(
      parsedTotal.units,
      resolved.map((row) => row.units),
    );
  } else if (input.mode === "individual" && resolved.length !== 1) {
    throw circleErrors.invalid("Individual payments must have exactly one recipient.");
  }

  return resolved;
}

export async function createPaymentIntent(input: {
  actorWallet: string;
  circleId: string;
  mode: unknown;
  total?: unknown;
  everyoneAmount?: unknown;
  recipients?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
  requestId?: string;
}) {
  await consumeCircleRateLimit({ bucket: "PAYMENT", wallet: input.actorWallet });
  const circle = await loadCircle(input.circleId);
  assertCircleActive(circle);
  assertNotFrozen(circle);
  const member = await requireActiveMember(input.circleId, input.actorWallet);
  assertPermission(member, "pay");
  if (!isPaymentMode(input.mode)) {
    throw circleErrors.invalid("Invalid payment mode.");
  }
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) {
    throw circleErrors.invalid("An idempotency key is required.");
  }
  const existing = await loadExistingPayment(input.actorWallet, idempotencyKey);
  if (existing) {
    return assemblePaymentResponse(existing, true);
  }

  const recipients = await resolvePaymentRecipients({
    actorWallet: input.actorWallet,
    circleId: circle.id,
    mode: input.mode,
    total: input.total,
    recipients: input.recipients,
    everyoneAmount: input.everyoneAmount,
    asset: circle.currency,
  });
  const totalUnits = sumUnits(recipients.map((row) => row.units));
  const limits = await loadPlatformLimits();
  assertUnderLimit(totalUnits, limits.max_payment_amount_units, "Payment");

  const members = await listActiveMembers(circle.id);
  const risk = evaluateCircleRisk({
    amountUnits: totalUnits,
    circle,
    memberCount: members.length,
    recentPolicyChanges: 0,
    recentRoleChanges: 0,
    recentWithdrawals: 0,
    operation: "payment",
  });
  if (risk.decision === "BLOCK") {
    throw circleErrors.riskBlocked(risk.reasons[0]);
  }

  const token = arcTokens[circle.currency];
  const execution = buildCirclePayExecution({
    recipients,
    token: token.address,
  });
  const note =
    typeof input.note === "string" ? input.note.trim().slice(0, 140) : null;

  const supabase = circleDb();
  const insertRow: Record<string, unknown> = {
    circle_id: circle.id,
    sender_user_wallet: input.actorWallet,
    total_amount: unitsToAmount(totalUnits, circle.currency),
    total_amount_units: totalUnits.toString(),
    asset: circle.currency,
    payment_mode: input.mode,
    note,
    status: "proposed",
    idempotency_key: idempotencyKey,
    risk_decision: risk.decision,
    execution_method: execution.method,
    swiftbatch_id: execution.swiftbatchId,
    batch_status: execution.method === "swiftbatch" ? "created" : null,
    recipient_count: execution.recipientCount,
  };
  let { data, error } = await supabase
    .from(circleTables.payments)
    .insert(insertRow)
    .select("*")
    .single();
  if (
    error &&
    /execution_method|swiftbatch_id|batch_status|recipient_count/i.test(
      error.message ?? "",
    )
  ) {
    const fallback = { ...insertRow };
    delete fallback.execution_method;
    delete fallback.swiftbatch_id;
    delete fallback.batch_status;
    delete fallback.recipient_count;
    const retry = await supabase
      .from(circleTables.payments)
      .insert(fallback)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error && isDuplicateError(error)) {
    const reused = await loadExistingPayment(input.actorWallet, idempotencyKey);
    if (reused) return assemblePaymentResponse(reused, true);
  }
  if (error) {
    throw new Error(readCircleDbError(error, "Could not create payment."));
  }
  const intent = data as CirclePaymentIntentRecord;
  const { error: recError } = await supabase.from(circleTables.paymentRecipients).insert(
    recipients.map((row) => ({
      payment_intent_id: intent.id,
      recipient_user_wallet: row.wallet,
      amount: row.amount,
      amount_units: row.units.toString(),
      status: "pending",
    })),
  );
  if (recError) {
    throw new Error(readCircleDbError(recError, "Could not store recipients."));
  }

  await writeLedgerEntry({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    entryType: "payment",
    productType: "pay",
    source: input.actorWallet,
    destination: recipients.map((row) => row.wallet).join(","),
    amountUnits: totalUnits.toString(),
    asset: circle.currency,
    purpose: "circle_pay",
    relatedEntityType: "payment_intent",
    relatedEntityId: intent.id,
    status: "pending",
    idempotencyKey: `pay:${idempotencyKey}`,
  });
  await writeCircleAudit({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    action: "PAYMENT_CREATED",
    entityType: "payment_intent",
    entityId: intent.id,
    requestId: input.requestId,
    metadata: {
      executionMethod: execution.method,
      swiftbatchId: execution.swiftbatchId,
      recipientCount: recipients.length,
    },
  });
  logCircleEvent({
    requestId: input.requestId,
    userWallet: input.actorWallet,
    circleId: circle.id,
    operation: "payment.proposed",
    idempotencyKey,
    status: "proposed",
    extra: {
      executionMethod: execution.method,
      recipientCount: recipients.length,
    },
  });

  return assemblePaymentResponse(
    { ...intent, recipients: undefined },
    false,
    execution,
    recipients.map((row) => ({
      wallet: row.wallet,
      username: row.username ?? null,
      amount: row.amount,
      units: row.units.toString(),
    })),
  );
}

async function assemblePaymentResponse(
  intent: CirclePaymentIntentRecord,
  reused: boolean,
  execution?: CirclePayExecution,
  recipients?: Array<{
    wallet: string;
    username: string | null;
    amount: string;
    units: string;
  }>,
) {
  const loaded = await getPaymentIntent(intent.id, intent.sender_user_wallet);
  const rows =
    recipients ??
    (loaded.recipients ?? []).map((row) => ({
      wallet: row.recipient_user_wallet,
      username: row.username ?? null,
      amount: row.amount,
      units: row.amount_units,
    }));
  const token = arcTokens[loaded.asset];
  const built =
    execution ??
    buildCirclePayExecution({
      recipients: rows.map((row) => ({
        wallet: row.wallet,
        amount: row.amount,
        units: BigInt(row.units),
        username: row.username,
      })),
      token: token.address,
      swiftbatchId: loaded.swiftbatch_id,
    });
  const feeUnits = BigInt(built.feeUnits);
  const totalUnits = BigInt(built.totalUnits);
  return {
    intent: loaded,
    reused,
    recipients: rows,
    execution: built,
    feeUnits: built.feeUnits,
    feeAmount: unitsToAmount(feeUnits, loaded.asset),
    finalTotalUnits: (totalUnits + feeUnits).toString(),
    finalTotal: unitsToAmount(totalUnits + feeUnits, loaded.asset),
    treasuryAddress: circleTreasuryAddress(),
  };
}

export async function getPaymentIntent(paymentId: string, actorWallet: string) {
  if (!isValidUuid(paymentId)) throw circleErrors.invalid("Invalid payment id.");
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.payments)
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load payment."));
  }
  if (!data) throw circleErrors.notFound("Payment");
  const intent = data as CirclePaymentIntentRecord;
  await requireActiveMember(intent.circle_id, actorWallet);
  const { data: recipients } = await supabase
    .from(circleTables.paymentRecipients)
    .select("*")
    .eq("payment_intent_id", paymentId);
  return { ...intent, recipients: (recipients ?? []) as CirclePaymentRecipientRecord[] };
}

function readResultHash(results: unknown) {
  if (!Array.isArray(results)) return { txHash: null as string | null, transactionId: null as string | null };
  let foundTxHash: string | null = null;
  let foundTxId: string | null = null;
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { txHash?: unknown; transactionId?: unknown };
    if (!foundTxHash && isValidTxHash(row.txHash)) {
      foundTxHash = row.txHash;
    }
    if (!foundTxId && typeof row.transactionId === "string" && row.transactionId.trim()) {
      foundTxId = row.transactionId.trim();
    }
  }
  return { txHash: foundTxHash, transactionId: foundTxId };
}

export async function submitPaymentExecution(input: {
  actorWallet: string;
  paymentId: string;
  results: unknown;
  txHash?: unknown;
  transactionId?: unknown;
  requestId?: string;
}) {
  const intent = await getPaymentIntent(input.paymentId, input.actorWallet);
  if (intent.sender_user_wallet !== input.actorWallet) {
    throw circleErrors.forbidden();
  }
  if (intent.status !== "proposed" && intent.status !== "executing") {
    return intent;
  }
  if (!canTransitionPayment(intent.status, "executing") && intent.status !== "executing") {
    throw circleErrors.conflict("This payment cannot be submitted.");
  }
  if (
    !Array.isArray(input.results) &&
    !isValidTxHash(input.txHash) &&
    (typeof input.transactionId !== "string" || !input.transactionId.trim()) &&
    !intent.id
  ) {
    throw circleErrors.invalid("Execution results are required.");
  }

  const recipients = intent.recipients ?? [];
  const rail =
    intent.execution_method ??
    selectCirclePayRail(Math.max(recipients.length, 1));

  const supabase = circleDb();
  await supabase
    .from(circleTables.payments)
    .update({
      status: "executing",
      batch_status: rail === "swiftbatch" ? "processing" : intent.batch_status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", intent.id)
    .in("status", ["proposed", "executing"]);

  if (rail === "swiftbatch") {
    const fromResults = readResultHash(input.results);
    const txHash = isValidTxHash(input.txHash) ? input.txHash : fromResults.txHash;
    const transactionId =
      typeof input.transactionId === "string" && input.transactionId.trim()
        ? input.transactionId.trim()
        : fromResults.transactionId || (intent.id ? `circle-batch-${intent.id}` : null);
    if (!txHash && !transactionId) {
      throw circleErrors.invalid("A BulkPay transaction hash or transaction ID is required.");
    }
    await supabase
      .from(circleTables.paymentRecipients)
      .update({
        tx_hash: txHash ?? null,
        transaction_id: transactionId ?? null,
        status: "submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("payment_intent_id", intent.id);
  } else {
    if (!Array.isArray(input.results)) {
      throw circleErrors.invalid("Execution results are required.");
    }
    for (const raw of input.results) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as {
        recipientWallet?: unknown;
        txHash?: unknown;
        transactionId?: unknown;
      };
      const wallet =
        typeof row.recipientWallet === "string"
          ? row.recipientWallet.toLowerCase()
          : "";
      const txHash = isValidTxHash(row.txHash) ? row.txHash : null;
      const transactionId =
        typeof row.transactionId === "string" && row.transactionId.trim()
          ? row.transactionId.trim()
          : typeof input.transactionId === "string" && input.transactionId.trim()
            ? input.transactionId.trim()
            : (intent.id ? `circle-send-${intent.id}` : null);
      if (!wallet) continue;
      await supabase
        .from(circleTables.paymentRecipients)
        .update({
          tx_hash: txHash,
          transaction_id: transactionId,
          status: txHash || transactionId ? "submitted" : "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("payment_intent_id", intent.id)
        .eq("recipient_user_wallet", wallet);
    }
  }

  await supabase
    .from(circleTables.payments)
    .update({
      status: "submitted",
      batch_status: rail === "swiftbatch" ? "submitted" : intent.batch_status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", intent.id)
    .eq("status", "executing");

  await writeCircleAudit({
    circleId: intent.circle_id,
    actorWallet: input.actorWallet,
    action: "PAYMENT_SUBMITTED",
    entityType: "payment_intent",
    entityId: intent.id,
    requestId: input.requestId,
    metadata: { executionMethod: rail },
  });
  logCircleEvent({
    requestId: input.requestId,
    userWallet: input.actorWallet,
    circleId: intent.circle_id,
    operation: "payment.submitted",
    idempotencyKey: intent.idempotency_key,
    status: "submitted",
    extra: { executionMethod: rail, recipientCount: recipients.length },
  });

  await recordLedgerTransaction({
    metadata: { circleId: intent.circle_id, paymentIntentId: intent.id },
    source: "circle",
    txHash: typeof input.txHash === "string" ? input.txHash : null,
    wallet: input.actorWallet,
  });

  // Credit general transaction cashback server-side (>= 20 USDC/EURC earns OnePoints)
  try {
    const totalAmount = intent.total_amount ?? "0";
    await processTransactionCashback({
      walletAddress: input.actorWallet,
      amount: totalAmount,
      token: intent.asset,
      transactionId: typeof input.transactionId === "string" ? input.transactionId : undefined,
      txHash: typeof input.txHash === "string" ? input.txHash : undefined,
    });
  } catch (cashbackErr) {
    console.warn("[CirclePay] Failed to process transaction cashback:", cashbackErr);
  }

  return getPaymentIntent(intent.id, input.actorWallet);
}

export async function confirmPaymentFromWebhook(input: {
  txHash?: string | null;
  providerTransactionId?: string | null;
}) {
  const supabase = circleDb();
  const hash = input.txHash ? input.txHash.toLowerCase() : null;
  let matches: CirclePaymentRecipientRecord[] | null = null;
  if (hash) {
    const { data } = await supabase
      .from(circleTables.paymentRecipients)
      .select("*")
      .eq("tx_hash", hash);
    matches = (data as CirclePaymentRecipientRecord[] | null) ?? null;
  }
  if ((!matches || matches.length === 0) && input.providerTransactionId) {
    const { data } = await supabase
      .from(circleTables.paymentRecipients)
      .select("*")
      .eq("transaction_id", input.providerTransactionId);
    matches = (data as CirclePaymentRecipientRecord[] | null) ?? null;
  }
  if (!matches || matches.length === 0) return null;

  const updateFilter = hash
    ? supabase
        .from(circleTables.paymentRecipients)
        .update({
          status: "confirmed",
          transaction_id: input.providerTransactionId ?? matches[0].transaction_id,
          tx_hash: hash,
          updated_at: new Date().toISOString(),
        })
        .eq("tx_hash", hash)
    : supabase
        .from(circleTables.paymentRecipients)
        .update({
          status: "confirmed",
          transaction_id: input.providerTransactionId ?? matches[0].transaction_id,
          updated_at: new Date().toISOString(),
        })
        .eq("transaction_id", input.providerTransactionId!);

  const { data: newlyConfirmed } = await updateFilter
    .neq("status", "confirmed")
    .select("*");

  const paymentIntentId = String(matches[0].payment_intent_id);
  const { data: siblings } = await supabase
    .from(circleTables.paymentRecipients)
    .select("status,recipient_user_wallet,amount")
    .eq("payment_intent_id", paymentIntentId);
  const statuses = (siblings ?? []).map((row) => String(row.status));
  const batchStatus = reconcileBatchStatus(statuses);
  const paymentStatus =
    batchStatus === "completed"
      ? "confirmed"
      : batchStatus === "partially_completed"
        ? "partially_completed"
        : batchStatus === "failed"
          ? "failed"
          : "submitted";

  const { data: intent } = await supabase
    .from(circleTables.payments)
    .update({
      status: paymentStatus,
      batch_status: batchStatus,
      completed_at:
        paymentStatus === "confirmed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentIntentId)
    .select("*")
    .maybeSingle();

  if (!intent) return newlyConfirmed?.[0] ?? matches[0];

  if (paymentStatus === "confirmed" && hash) {
    await confirmLedgerEntry(`pay:${intent.idempotency_key}`, hash);
  }

  if (paymentStatus === "confirmed" && intent.sender_user_wallet && hash) {
    await recordLedgerTransaction({
      metadata: { circleId: intent.circle_id, paymentIntentId: intent.id },
      source: "circle",
      txHash: hash,
      wallet: intent.sender_user_wallet,
    });
  }

  if (paymentStatus === "confirmed" && intent.sender_user_wallet && intent.total_amount) {
    try {
      await processTransactionCashback({
        walletAddress: intent.sender_user_wallet,
        amount: intent.total_amount,
        token: intent.asset,
        txHash: hash ?? undefined,
        transactionId: input.providerTransactionId ?? undefined,
      });
    } catch (cashbackErr) {
      console.warn("[CirclePay] Webhook cashback error:", cashbackErr);
    }
  }

  if (newlyConfirmed && newlyConfirmed.length > 0) {
    await writeCircleAudit({
      circleId: intent.circle_id,
      actorWallet: intent.sender_user_wallet,
      action: "PAYMENT_CONFIRMED",
      entityType: "payment_intent",
      entityId: intent.id,
      metadata: {
        batchStatus,
        recipientCount: statuses.length,
        confirmedCount: statuses.filter((status) => status === "confirmed").length,
      },
    });
    await writeCircleActivity({
      circleId: intent.circle_id,
      actorWallet: intent.sender_user_wallet,
      activityType:
        paymentStatus === "confirmed"
          ? "payment.completed"
          : "payment.partially_completed",
      entityType: "payment_intent",
      entityId: intent.id,
      summary:
        paymentStatus === "confirmed"
          ? `Payment of ${intent.total_amount} ${intent.asset} completed`
          : `Circle Pay ${everyonePaidCopy(statuses)}`,
    });
    await postFinancialCard({
      circleId: intent.circle_id,
      actorWallet: intent.sender_user_wallet,
      content:
        paymentStatus === "confirmed"
          ? `Payment of ${intent.total_amount} ${intent.asset} was sent`
          : `Circle Pay update: ${everyonePaidCopy(statuses)}`,
      metadata: {
        type: "payment",
        paymentId: intent.id,
        batchStatus,
      },
    });
    for (const row of newlyConfirmed) {
      await emitCircleNotification({
        eventId: `circle-pay-recv:${row.id}`,
        circleId: intent.circle_id,
        ownerWallet: row.recipient_user_wallet,
        kind: "circle_payment",
        title: "Circle payment received",
        body: `You received ${row.amount} ${intent.asset} in Circle.`,
      });
    }
  }

  return newlyConfirmed?.[0] ?? matches[0];
}

export function paymentAmountUnits(value: string) {
  return parseUnits(value);
}
