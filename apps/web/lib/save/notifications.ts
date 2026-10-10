import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { formatUnitsToDecimal } from "@/lib/save/decimal";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";

const notificationsTable =
  process.env.SUPABASE_SAVINGS_NOTIFICATIONS_TABLE ?? "savings_notifications";
const notificationDismissalsTable =
  process.env.SUPABASE_NOTIFICATION_DISMISSALS_TABLE ??
  "savings_notification_dismissals";
const notificationsChangedEventName = "saphra:notifications-changed";

export const notificationsChangedEvent = notificationsChangedEventName;

export type SavingsNotificationKind =
  | "manual_save_success"
  | "spend_save_success"
  | "target_reached"
  | "savings_failed"
  | "spend_save_paused"
  | "spend_save_resumed"
  | "spend_save_disabled"
  | "reconciliation_alert"
  | "payment_received"
  | "payment_request"
  | "payment_request_declined"
  | "fixed_lock_started"
  | "fixed_unlock_ready"
  | "circle_invitation"
  | "circle_invitation_accepted"
  | "circle_invitation_declined"
  | "circle_message"
  | "circle_payment"
  | "circle_request"
  | "circle_request_paid"
  | "circle_request_declined"
  | "circle_save"
  | "circle_earn"
  | "circle_withdrawal"
  | "circle_approval"
  | "circle_member"
  | "circle_role"
  | "circle_frozen";

export type SavingsNotificationRecord = {
  id: string;
  owner_wallet: string;
  kind: SavingsNotificationKind;
  title: string;
  body: string;
  pocket_id: string | null;
  transaction_id: string | null;
  related_tx_hash?: string | null;
  metadata?: Record<string, unknown> | null;
  read_at: string | null;
  dismissed_at?: string | null;
  created_at: string;
};

export type CreateNotificationResult = {
  record: SavingsNotificationRecord | null;
  /** True only when a unique constraint says this event was already stored. */
  alreadyExists: boolean;
  error?: string;
};

export function copyManualSaveSuccess(
  amount: string,
  pocketName: string,
  currency: string,
) {
  return {
    title: "Money saved",
    body: `Nice! $${amount} ${currency} was added to your ${pocketName}.`,
  };
}

export function copySpendSaveSuccess(
  saveAmount: string,
  paymentAmount: string,
  pocketName: string,
  currency: string,
) {
  return {
    title: "Saved while you spent",
    body: `$${saveAmount} ${currency} saved automatically from your $${paymentAmount} payment into ${pocketName}.`,
  };
}

export function copyTargetReached(
  pocketName: string,
  target: string,
  currency: string,
) {
  return {
    title: "Goal reached!",
    body: `You did it! Your ${pocketName} reached $${target} ${currency}.`,
  };
}



export function copySpendSavePaused() {
  return {
    title: "Spend&Save paused",
    body: "Spend&Save has been paused. Existing savings stay put.",
  };
}

export function copySpendSaveResumed() {
  return {
    title: "Spend&Save resumed",
    body: "We’ll automatically set money aside on your next eligible payment.",
  };
}

export function copySpendSaveDisabled() {
  return {
    title: "Spend&Save turned off",
    body: "No future automatic savings. Your existing pockets are unchanged.",
  };
}

export function copyPaymentReceived(
  amount: string,
  currency: string,
  fromLabel: string,
) {
  return {
    title: "Money received",
    body: `You received $${amount} ${currency} from ${fromLabel}.`,
  };
}

export function copyPaymentRequest(
  amount: string,
  currency: string,
  fromLabel: string,
) {
  return {
    title: "Payment request",
    body: `${fromLabel} requested $${amount} ${currency}.`,
  };
}

export function copyPaymentRequestDeclined(
  amount: string,
  currency: string,
  declinedByLabel: string,
) {
  return {
    title: "Request declined",
    body: `${declinedByLabel} declined your $${amount} ${currency} request.`,
  };
}

export function copyFixedLockStarted(
  pocketName: string,
  unlockLabel: string,
  days: number,
) {
  return {
    title: "Fixed pocket locked",
    body: `${pocketName} is locked for ${days} day${days === 1 ? "" : "s"}. You can add money, but withdrawals wait until ${unlockLabel}.`,
  };
}

export function copyFixedUnlockReady(pocketName: string) {
  return {
    title: `${pocketName} is unlocked`,
    body: `The lock on ${pocketName} ended. Withdraw anytime, or lock it again if you want another term.`,
  };
}

function isDuplicateError(error: { message?: string; code?: string }) {
  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "23505" ||
    message.includes("duplicate") ||
    message.includes("unique")
  );
}

function isKindConstraintError(error: { message?: string; code?: string }) {
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("kind_check") ||
    message.includes("savings_notifications_kind") ||
    (message.includes("check constraint") && message.includes("kind"))
  );
}

/** Extract missing column name from PostgREST / Postgres errors. */
function missingColumnFromError(message: string): string | null {
  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column [\"']?([\w]+)[\"']? of relation/i,
    /column [\"']?[\w.]*\.?([\w]+)[\"']? does not exist/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

type InsertRow = {
  owner_wallet: string;
  kind: string;
  title: string;
  body: string;
  pocket_id?: string | null;
  transaction_id?: string | null;
  related_tx_hash?: string | null;
  metadata?: Record<string, unknown> | null;
};

async function insertNotificationRow(
  row: InsertRow,
): Promise<CreateNotificationResult> {
  try {
    const supabase = createSupabaseAdminClient();
    let current: InsertRow = { ...row };
    // Retry a few times stripping unknown optional columns (live DB may lag migrations).
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error } = await supabase
        .from(notificationsTable)
        .insert(current)
        .select("*")
        .single();

      if (!error) {
        return {
          record: data as SavingsNotificationRecord,
          alreadyExists: false,
        };
      }

      if (isDuplicateError(error)) {
        return { record: null, alreadyExists: true };
      }

      const missing = missingColumnFromError(error.message ?? "");
      if (missing && missing in current) {
        console.warn(
          `[swift-save-notify] stripping missing column "${missing}" and retrying`,
        );
        const next = { ...current };
        delete (next as Record<string, unknown>)[missing];
        current = next;
        continue;
      }

      console.warn("[swift-save-notify]", error.message);
      return {
        record: null,
        alreadyExists: false,
        error: error.message,
      };
    }

    return {
      record: null,
      alreadyExists: false,
      error: "Notification insert failed after retries.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "notify failed";
    console.warn("[swift-save-notify]", message);
    return { record: null, alreadyExists: false, error: message };
  }
}

/**
 * Create a notification. Returns structured result so callers can distinguish
 * "already exists" from real insert failures.
 */
export async function createSavingsNotificationResult(input: {
  ownerWallet: string;
  kind: SavingsNotificationKind;
  title: string;
  body: string;
  pocketId?: string | null;
  transactionId?: string | null;
  relatedTxHash?: string | null;
  metadata?: Record<string, unknown> | null;
  /** If kind is rejected by DB check constraint, retry with this kind. */
  fallbackKind?: SavingsNotificationKind;
}): Promise<CreateNotificationResult> {
  // Claim codes are long — do not truncate hard at 500.
  const title = input.title.slice(0, 200);
  const body = input.body.slice(0, 12_000);

  const primary = await insertNotificationRow({
    owner_wallet: input.ownerWallet.toLowerCase(),
    kind: input.kind,
    title,
    body,
    pocket_id: input.pocketId ?? null,
    transaction_id: input.transactionId ?? null,
    related_tx_hash: input.relatedTxHash?.toLowerCase() ?? null,
    metadata: input.metadata ?? {},
  });

  if (primary.record || primary.alreadyExists) {
    return primary;
  }

  if (
    input.fallbackKind &&
    input.fallbackKind !== input.kind &&
    primary.error &&
    isKindConstraintError({ message: primary.error })
  ) {
    console.warn(
      `[swift-save-notify] kind ${input.kind} rejected; falling back to ${input.fallbackKind}`,
    );
    return insertNotificationRow({
      owner_wallet: input.ownerWallet.toLowerCase(),
      kind: input.fallbackKind,
      title,
      body,
      pocket_id: input.pocketId ?? null,
      transaction_id: input.transactionId ?? null,
      related_tx_hash: input.relatedTxHash?.toLowerCase() ?? null,
      metadata: input.metadata ?? {},
    });
  }

  return primary;
}

/** Back-compat: returns the row or null (including already-exists / errors). */
export async function createSavingsNotification(input: {
  ownerWallet: string;
  kind: SavingsNotificationKind;
  title: string;
  body: string;
  pocketId?: string | null;
  transactionId?: string | null;
  relatedTxHash?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const result = await createSavingsNotificationResult(input);
  return result.record;
}

function isRecordDismissed(
  item: Pick<SavingsNotificationRecord, "dismissed_at" | "metadata">,
) {
  if (item.dismissed_at) {
    return true;
  }
  const meta = item.metadata;
  return Boolean(
    meta &&
      typeof meta === "object" &&
      (meta as Record<string, unknown>).dismissed === true,
  );
}

async function isTxHashDismissed(ownerWallet: string, relatedTxHash: string) {
  const hash = relatedTxHash.toLowerCase();
  if (!hash) {
    return false;
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from(notificationDismissalsTable)
      .select("related_tx_hash")
      .eq("owner_wallet", ownerWallet.toLowerCase())
      .eq("related_tx_hash", hash)
      .maybeSingle();

    if (error) {
      return false;
    }
    return Boolean(data);
  } catch {
    return false;
  }
}

async function recordDismissedHashes(
  ownerWallet: string,
  hashes: Array<string | null | undefined>,
) {
  const rows = Array.from(
    new Set(
      hashes
        .map((hash) => hash?.trim().toLowerCase())
        .filter((hash): hash is string => Boolean(hash)),
    ),
  ).map((related_tx_hash) => ({
    dismissed_at: new Date().toISOString(),
    owner_wallet: ownerWallet.toLowerCase(),
    related_tx_hash,
  }));

  if (rows.length === 0) {
    return;
  }

  try {
    const supabase = createSupabaseAdminClient();
    await supabase
      .from(notificationDismissalsTable)
      .upsert(rows, { onConflict: "owner_wallet,related_tx_hash" });
  } catch {
    // Table may not exist yet; unique dismissed rows still hide the inbox.
  }
}

/** Create a payment_received notification if we have not already notified this tx. */
export async function createIncomingPaymentNotification(input: {
  ownerWallet: string;
  title: string;
  body: string;
  relatedTxHash: string;
  metadata?: Record<string, unknown>;
}) {
  if (await isTxHashDismissed(input.ownerWallet, input.relatedTxHash)) {
    return null;
  }

  return createSavingsNotification({
    ownerWallet: input.ownerWallet,
    kind: "payment_received",
    title: input.title,
    body: input.body,
    relatedTxHash: input.relatedTxHash,
    metadata: input.metadata ?? null,
  });
}

export async function createPaymentRequestNotification(input: {
  amount: string;
  expiresInHours?: number | null;
  fromLabel: string;
  fromUsername?: string | null;
  fromWallet: string;
  metadata?: Record<string, unknown>;
  note?: string | null;
  ownerWallet: string;
  requestId: string;
  requestLink: string;
  token: ArcTokenSymbol;
}) {
  const copy = copyPaymentRequest(input.amount, input.token, input.fromLabel);
  const body = [
    copy.body,
    input.note ? `Note: ${input.note}` : null,
    `PAYMENT_REQUEST_ID:${input.requestId}`,
    `PAYMENT_REQUEST_LINK:${input.requestLink}`,
    `FROM_WALLET:${input.fromWallet.toLowerCase()}`,
    input.fromUsername ? `FROM_USERNAME:${input.fromUsername}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return createSavingsNotificationResult({
    body,
    fallbackKind: "payment_received",
    kind: "payment_request",
    metadata: {
      ...(input.metadata ?? {}),
      amount: input.amount,
      expiresInHours: input.expiresInHours ?? null,
      fromLabel: input.fromLabel,
      fromUsername: input.fromUsername ?? null,
      fromWallet: input.fromWallet.toLowerCase(),
      note: input.note ?? null,
      requestId: input.requestId,
      requestLink: input.requestLink,
      status: "pending",
      token: input.token,
      type: "payment_request",
    },
    ownerWallet: input.ownerWallet,
    relatedTxHash: input.requestId,
    title: copy.title,
  });
}

export async function createPaymentRequestDeclinedNotification(input: {
  amount: string;
  declinedByLabel: string;
  declinedByUsername?: string | null;
  declinedByWallet: string;
  ownerWallet: string;
  requestId: string;
  token: ArcTokenSymbol;
}) {
  const copy = copyPaymentRequestDeclined(
    input.amount,
    input.token,
    input.declinedByLabel,
  );
  const body = [
    copy.body,
    `DECLINED_REQUEST_ID:${input.requestId}`,
    `DECLINED_BY:${input.declinedByWallet.toLowerCase()}`,
    input.declinedByUsername
      ? `DECLINED_BY_USERNAME:${input.declinedByUsername}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return createSavingsNotificationResult({
    body,
    fallbackKind: "payment_received",
    kind: "payment_request_declined",
    metadata: {
      amount: input.amount,
      declinedByLabel: input.declinedByLabel,
      declinedByUsername: input.declinedByUsername ?? null,
      declinedByWallet: input.declinedByWallet.toLowerCase(),
      requestId: input.requestId,
      token: input.token,
      type: "payment_request_declined",
    },
    ownerWallet: input.ownerWallet,
    title: copy.title,
  });
}

export async function getSavingsNotificationById(
  ownerWallet: string,
  id: string,
) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(notificationsTable)
    .select("*")
    .eq("id", id)
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .maybeSingle();

  if (error) {
    if (
      error.message.toLowerCase().includes("does not exist") ||
      error.message.toLowerCase().includes("permission denied")
    ) {
      return null;
    }
    throw new Error(error.message);
  }

  return (data as SavingsNotificationRecord | null) ?? null;
}

export async function markPaymentRequestNotificationDeclined(input: {
  id: string;
  ownerWallet: string;
}) {
  const existing = await getSavingsNotificationById(input.ownerWallet, input.id);
  if (!existing) {
    return { record: null, error: "Payment request was not found." };
  }

  const metadata = {
    ...((existing.metadata && typeof existing.metadata === "object"
      ? existing.metadata
      : {}) as Record<string, unknown>),
    declinedAt: new Date().toISOString(),
    status: "declined",
  };
  const body = existing.body.includes("DECLINED:1")
    ? existing.body
    : `${existing.body}\nDECLINED:1`;

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from(notificationsTable)
      .update({
        body,
        metadata,
        read_at: existing.read_at ?? new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("owner_wallet", input.ownerWallet.toLowerCase())
      .select("*")
      .maybeSingle();

    if (!error) {
      return { record: data as SavingsNotificationRecord, error: undefined };
    }

    if (missingColumnFromError(error.message ?? "") === "metadata") {
      const fallback = await supabase
        .from(notificationsTable)
        .update({
          body,
          read_at: existing.read_at ?? new Date().toISOString(),
        })
        .eq("id", input.id)
        .eq("owner_wallet", input.ownerWallet.toLowerCase())
        .select("*")
        .maybeSingle();

      if (!fallback.error) {
        return {
          record: fallback.data as SavingsNotificationRecord,
          error: undefined,
        };
      }

      return { record: null, error: fallback.error.message };
    }

    return { record: null, error: error.message };
  } catch (error) {
    return {
      record: null,
      error: error instanceof Error ? error.message : "Decline failed.",
    };
  }
}

/**
 * "Your invoice was viewed": news for the business that sent the invoice,
 * with nothing to pay or decline. Older rows predate the metadata type, so
 * the title identifies them too.
 */
export function isInvoiceViewedNotification(
  item: Pick<SavingsNotificationRecord, "metadata"> & { title?: string },
) {
  const meta = item.metadata;
  if (meta && typeof meta === "object" && (meta as Record<string, unknown>).type === "invoice_viewed") {
    return true;
  }
  return item.title === "Your invoice was viewed";
}

export function isPaymentRequestNotification(
  item: Pick<SavingsNotificationRecord, "kind" | "body" | "metadata"> & {
    title?: string;
    related_tx_hash?: string | null;
  },
): boolean {
  if (isWorkspaceInvitationNotification(item)) {
    return false;
  }
  if (isInvoiceViewedNotification(item)) {
    return false;
  }
  if (item.kind === "payment_request_declined") {
    return false;
  }
  if (item.kind === "payment_request") {
    return true;
  }
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    if ((meta as Record<string, unknown>).type === "payment_request_declined") {
      return false;
    }
    if ((meta as Record<string, unknown>).type === "payment_request") {
      return true;
    }
    if ((meta as Record<string, unknown>).requestLink) {
      return true;
    }
  }
  return /PAYMENT_REQUEST_ID:/i.test(item.body ?? "");
}

export function isPaymentRequestDeclinedNotification(
  item: Pick<SavingsNotificationRecord, "kind" | "body" | "metadata">,
): boolean {
  if (item.kind === "payment_request_declined") {
    return true;
  }
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    if ((meta as Record<string, unknown>).type === "payment_request_declined") {
      return true;
    }
  }
  return /DECLINED_REQUEST_ID:/i.test(item.body ?? "");
}

export function isPaymentRequestMarkedDeclined(
  item: Pick<SavingsNotificationRecord, "body" | "metadata">,
): boolean {
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    if ((meta as Record<string, unknown>).status === "declined") {
      return true;
    }
  }
  return /(?:^|\n)DECLINED:1(?:\n|$)/i.test(item.body ?? "");
}

export function isPaymentRequestMarkedPaid(
  item: Pick<SavingsNotificationRecord, "body" | "metadata">,
): boolean {
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    if ((meta as Record<string, unknown>).status === "paid") {
      return true;
    }
  }
  return /(?:^|\n)PAID:1(?:\n|$)/i.test(item.body ?? "");
}

export type PaymentRequestLifecycle = "pending" | "paid" | "declined" | "expired";

export function isPaymentRequestExpired(
  item: Pick<SavingsNotificationRecord, "created_at" | "metadata">,
) {
  const meta =
    item.metadata && typeof item.metadata === "object"
      ? (item.metadata as Record<string, unknown>)
      : null;
  const hours = Number(meta?.expiresInHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return false;
  }
  const created = Date.parse(item.created_at);
  if (!Number.isFinite(created)) {
    return false;
  }
  return Date.now() >= created + hours * 60 * 60 * 1000;
}

export function getPaymentRequestLifecycle(
  item: Pick<SavingsNotificationRecord, "body" | "created_at" | "metadata">,
): PaymentRequestLifecycle {
  if (isPaymentRequestMarkedPaid(item)) {
    return "paid";
  }
  if (isPaymentRequestMarkedDeclined(item)) {
    return "declined";
  }
  if (isPaymentRequestExpired(item)) {
    return "expired";
  }
  return "pending";
}

export async function findPaymentRequestNotificationsByRequestId(
  requestId: string,
) {
  const id = requestId.trim();
  if (!id) {
    return [] as SavingsNotificationRecord[];
  }

  try {
    const supabase = createSupabaseAdminClient();
    const byMeta = await supabase
      .from(notificationsTable)
      .select("*")
      .eq("metadata->>requestId", id)
      .limit(20);

    if (!byMeta.error && (byMeta.data?.length ?? 0) > 0) {
      return byMeta.data as SavingsNotificationRecord[];
    }

    const byRelated = await supabase
      .from(notificationsTable)
      .select("*")
      .eq("related_tx_hash", id.toLowerCase())
      .limit(20);

    if (!byRelated.error && (byRelated.data?.length ?? 0) > 0) {
      return byRelated.data as SavingsNotificationRecord[];
    }

    const byBody = await supabase
      .from(notificationsTable)
      .select("*")
      .ilike("body", `%PAYMENT_REQUEST_ID:${id}%`)
      .limit(20);

    if (byBody.error || !byBody.data) {
      return [] as SavingsNotificationRecord[];
    }

    return byBody.data as SavingsNotificationRecord[];
  } catch {
    return [] as SavingsNotificationRecord[];
  }
}

export async function readPaymentRequestLifecycle(requestId: string) {
  const rows = await findPaymentRequestNotificationsByRequestId(requestId);
  if (rows.some((row) => getPaymentRequestLifecycle(row) === "paid")) {
    return "paid" as const;
  }
  if (rows.some((row) => getPaymentRequestLifecycle(row) === "declined")) {
    return "declined" as const;
  }
  if (rows.some((row) => getPaymentRequestLifecycle(row) === "expired")) {
    return "expired" as const;
  }
  if (rows.length > 0) {
    return "pending" as const;
  }
  return "unknown" as const;
}

async function updatePaymentRequestRowStatus(input: {
  bodyMarker: "PAID:1" | "DECLINED:1";
  extraMetadata?: Record<string, unknown>;
  record: SavingsNotificationRecord;
  status: "paid" | "declined";
}) {
  const metadata = {
    ...((input.record.metadata && typeof input.record.metadata === "object"
      ? input.record.metadata
      : {}) as Record<string, unknown>),
    ...(input.extraMetadata ?? {}),
    status: input.status,
  };
  const body = input.record.body.includes(input.bodyMarker)
    ? input.record.body
    : `${input.record.body}\n${input.bodyMarker}`;

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from(notificationsTable)
    .update({
      body,
      metadata,
      read_at: input.record.read_at ?? new Date().toISOString(),
    })
    .eq("id", input.record.id)
    .select("*")
    .maybeSingle();

  if (!error) {
    return data as SavingsNotificationRecord;
  }

  if (missingColumnFromError(error.message ?? "") === "metadata") {
    const fallback = await supabase
      .from(notificationsTable)
      .update({
        body,
        read_at: input.record.read_at ?? new Date().toISOString(),
      })
      .eq("id", input.record.id)
      .select("*")
      .maybeSingle();

    if (!fallback.error) {
      return fallback.data as SavingsNotificationRecord;
    }
  }

  throw new Error(error.message);
}

export async function markPaymentRequestLifecycle(input: {
  ownerWallet?: string;
  paidTxHash?: string | null;
  requestId: string;
  status: "paid" | "declined";
}) {
  const existing = await findPaymentRequestNotificationsByRequestId(
    input.requestId,
  );
  const anyPaid = existing.some(
    (row) => getPaymentRequestLifecycle(row) === "paid",
  );
  if (anyPaid) {
    return { alreadyResolved: true, status: "paid" as const };
  }

  const pending = existing.filter(
    (row) => getPaymentRequestLifecycle(row) === "pending",
  );
  if (existing.length > 0 && pending.length === 0) {
    const anyExpired = existing.some(
      (row) => getPaymentRequestLifecycle(row) === "expired",
    );
    return {
      alreadyResolved: true,
      status: anyExpired ? ("expired" as const) : ("declined" as const),
    };
  }

  const extraMetadata =
    input.status === "paid"
      ? {
          paidAt: new Date().toISOString(),
          paidTxHash: input.paidTxHash ?? null,
        }
      : { declinedAt: new Date().toISOString() };

  if (pending.length > 0) {
    for (const record of pending) {
      await updatePaymentRequestRowStatus({
        bodyMarker: input.status === "paid" ? "PAID:1" : "DECLINED:1",
        extraMetadata,
        record,
        status: input.status,
      });
    }
    return { alreadyResolved: false, status: input.status };
  }

  if (input.status === "declined") {
    return { alreadyResolved: false, status: "unknown" as const };
  }

  if (!input.ownerWallet) {
    return { alreadyResolved: false, status: "unknown" as const };
  }

  const created = await createSavingsNotificationResult({
    body: [
      "This payment request has been paid.",
      `PAYMENT_REQUEST_ID:${input.requestId}`,
      "PAID:1",
    ].join("\n"),
    fallbackKind: "payment_received",
    kind: "payment_request",
    metadata: {
      paidAt: new Date().toISOString(),
      paidTxHash: input.paidTxHash ?? null,
      requestId: input.requestId,
      status: "paid",
      type: "payment_request",
    },
    ownerWallet: input.ownerWallet,
    relatedTxHash: input.requestId,
    title: "Request paid",
  });

  return {
    alreadyResolved: Boolean(created.alreadyExists),
    status: "paid" as const,
  };
}

export function extractPaymentRequestSenderWallet(
  item: Pick<SavingsNotificationRecord, "body" | "metadata">,
): string | null {
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    const fromWallet = (meta as Record<string, unknown>).fromWallet;
    if (typeof fromWallet === "string" && fromWallet.trim()) {
      return fromWallet.trim().toLowerCase();
    }
  }

  const match = item.body?.match(/FROM_WALLET:(0x[a-fA-F0-9]{40})/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function extractPaymentRequestId(
  item: Pick<SavingsNotificationRecord, "body" | "metadata">,
): string | null {
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    const requestId = (meta as Record<string, unknown>).requestId;
    if (typeof requestId === "string" && requestId.trim()) {
      return requestId.trim();
    }
  }

  return item.body?.match(/PAYMENT_REQUEST_ID:(\S+)/i)?.[1] ?? null;
}

/** Dedupe helper when related_tx_hash column is missing. */
export async function hasNotificationForPaymentId(
  ownerWallet: string,
  paymentId: string,
): Promise<boolean> {
  try {
    const supabase = createSupabaseAdminClient();
    const needle = paymentId.toLowerCase();
    const { data, error } = await supabase
      .from(notificationsTable)
      .select("id,body,title")
      .eq("owner_wallet", ownerWallet.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(40);

    if (error || !data) {
      return false;
    }

    return data.some((row) => {
      const text = `${row.title ?? ""}\n${row.body ?? ""}`.toLowerCase();
      return text.includes(needle) || text.includes(`payment_id:${needle}`);
    });
  } catch {
    return false;
  }
}

export async function notifyMaturedFixedPockets(
  ownerWallet: string,
  pockets: Array<{
    id: string;
    name: string;
    lock_kind?: string | null;
    lock_until?: string | null;
  }>,
) {
  const now = Date.now();
  for (const pocket of pockets) {
    if (pocket.lock_kind !== "fixed" || !pocket.lock_until) continue;
    const until = new Date(pocket.lock_until);
    if (Number.isNaN(until.getTime()) || until.getTime() > now) continue;

    const copy = copyFixedUnlockReady(pocket.name);
    await createSavingsNotificationResult({
      ownerWallet,
      kind: "fixed_unlock_ready",
      fallbackKind: "manual_save_success",
      title: copy.title,
      body: copy.body,
      pocketId: pocket.id,
      relatedTxHash: `unlock:${pocket.id}:${pocket.lock_until}`,
      metadata: {
        type: "fixed_unlock_ready",
        pocketId: pocket.id,
        lockUntil: pocket.lock_until,
      },
    });
  }
}

export async function listSavingsNotifications(
  ownerWallet: string,
  limit = 20,
) {
  const supabase = createSupabaseAdminClient();
  const owner = ownerWallet.toLowerCase();
  const capped = Math.min(limit, 100);

  const visible = await supabase
    .from(notificationsTable)
    .select("*")
    .eq("owner_wallet", owner)
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(capped);

  if (!visible.error) {
    return ((visible.data ?? []) as SavingsNotificationRecord[]).filter(
      (item) => !isRecordDismissed(item),
    );
  }

  if (missingColumnFromError(visible.error.message ?? "") === "dismissed_at") {
    const fallback = await supabase
      .from(notificationsTable)
      .select("*")
      .eq("owner_wallet", owner)
      .order("created_at", { ascending: false })
      .limit(Math.min(capped * 2, 100));

    if (fallback.error) {
      if (
        fallback.error.message.toLowerCase().includes("does not exist") ||
        fallback.error.message.toLowerCase().includes("permission denied")
      ) {
        return [] as SavingsNotificationRecord[];
      }
      throw new Error(fallback.error.message);
    }

    return ((fallback.data ?? []) as SavingsNotificationRecord[])
      .filter((item) => !isRecordDismissed(item))
      .slice(0, capped);
  }

  if (
    visible.error.message.toLowerCase().includes("does not exist") ||
    visible.error.message.toLowerCase().includes("permission denied")
  ) {
    return [] as SavingsNotificationRecord[];
  }
  throw new Error(visible.error.message);
}

export async function deleteSavingsNotifications(
  ownerWallet: string,
  options: {
    ids?: string[];
    all?: boolean;
    olderThanDays?: number;
    keepImportant?: boolean;
    onlyRead?: boolean;
  } = {},
) {
  const supabase = createSupabaseAdminClient();
  const owner = ownerWallet.toLowerCase();

  if (
    (!options.ids || options.ids.length === 0) &&
    !options.all &&
    options.olderThanDays == null &&
    !options.onlyRead
  ) {
    throw new Error("Choose notifications to delete, or clear the inbox.");
  }

  let selectQuery = supabase
    .from(notificationsTable)
    .select("id, related_tx_hash, metadata, read_at, body, kind")
    .eq("owner_wallet", owner);

  if (options.ids && options.ids.length > 0) {
    selectQuery = selectQuery.in("id", options.ids);
  }
  if (options.onlyRead) {
    selectQuery = selectQuery.not("read_at", "is", null);
  }
  if (options.olderThanDays != null && Number.isFinite(options.olderThanDays)) {
    const cutoff = new Date(
      Date.now() - Math.max(1, options.olderThanDays) * 24 * 60 * 60 * 1000,
    ).toISOString();
    selectQuery = selectQuery.lt("created_at", cutoff);
  }
  if (options.keepImportant) {
    selectQuery = selectQuery
      .not("kind", "eq", "payment_request")
      .not("body", "ilike", "%PAYMENT_REQUEST_ID:%");
  }

  const selected = await selectQuery;
  if (selected.error) {
    if (
      selected.error.message.toLowerCase().includes("does not exist") ||
      selected.error.message.toLowerCase().includes("permission denied")
    ) {
      return { deleted: 0 };
    }
    throw new Error(selected.error.message);
  }

  const rows = ((selected.data ?? []) as Array<
    Pick<
      SavingsNotificationRecord,
      "id" | "related_tx_hash" | "metadata" | "read_at" | "body" | "kind"
    >
  >).filter((item) => !isRecordDismissed(item));

  if (rows.length === 0) {
    return { deleted: 0 };
  }

  const ids = rows.map((row) => row.id);
  const dismissedAt = new Date().toISOString();
  const dismissed = await supabase
    .from(notificationsTable)
    .update({ dismissed_at: dismissedAt })
    .eq("owner_wallet", owner)
    .in("id", ids);

  if (dismissed.error) {
    if (missingColumnFromError(dismissed.error.message ?? "") === "dismissed_at") {
      for (const row of rows) {
        const metadata = {
          ...((row.metadata && typeof row.metadata === "object"
            ? row.metadata
            : {}) as Record<string, unknown>),
          dismissed: true,
          dismissedAt,
        };
        const { error } = await supabase
          .from(notificationsTable)
          .update({ metadata })
          .eq("id", row.id)
          .eq("owner_wallet", owner);
        if (error && missingColumnFromError(error.message ?? "") === "metadata") {
          await supabase
            .from(notificationsTable)
            .delete()
            .eq("id", row.id)
            .eq("owner_wallet", owner);
        }
      }
    } else if (
      dismissed.error.message.toLowerCase().includes("does not exist") ||
      dismissed.error.message.toLowerCase().includes("permission denied")
    ) {
      return { deleted: 0 };
    } else {
      throw new Error(dismissed.error.message);
    }
  }

  await recordDismissedHashes(
    owner,
    rows.map((row) => row.related_tx_hash),
  );

  return { deleted: ids.length };
}

export async function markSavingsNotificationsRead(
  ownerWallet: string,
  ids?: string[],
) {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  let query = supabase
    .from(notificationsTable)
    .update({ read_at: now })
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .is("read_at", null);

  if (ids && ids.length > 0) {
    query = query.in("id", ids);
  }

  const { error } = await query;
  if (error) {
    if (
      error.message.toLowerCase().includes("does not exist") ||
      error.message.toLowerCase().includes("permission denied")
    ) {
      return { updated: 0 };
    }
    throw new Error(error.message);
  }
  return { updated: 1 };
}

export async function countUnreadSavingsNotifications(ownerWallet: string) {
  const supabase = createSupabaseAdminClient();
  const owner = ownerWallet.toLowerCase();
  const counted = await supabase
    .from(notificationsTable)
    .select("id", { count: "exact", head: true })
    .eq("owner_wallet", owner)
    .is("read_at", null)
    .is("dismissed_at", null);

  if (!counted.error) {
    return counted.count ?? 0;
  }

  if (missingColumnFromError(counted.error.message ?? "") === "dismissed_at") {
    const fallback = await supabase
      .from(notificationsTable)
      .select("id, metadata, dismissed_at, read_at")
      .eq("owner_wallet", owner)
      .is("read_at", null);

    if (fallback.error) {
      if (
        fallback.error.message.toLowerCase().includes("does not exist") ||
        fallback.error.message.toLowerCase().includes("permission denied")
      ) {
        return 0;
      }
      throw new Error(fallback.error.message);
    }

    return ((fallback.data ?? []) as SavingsNotificationRecord[]).filter(
      (item) => !isRecordDismissed(item),
    ).length;
  }

  if (
    counted.error.message.toLowerCase().includes("does not exist") ||
    counted.error.message.toLowerCase().includes("permission denied")
  ) {
    return 0;
  }
  throw new Error(counted.error.message);
}

export type AlertInboxCategory =
  | "payments"
  | "requests"
  | "savings";

export function isWorkspaceInvitationNotification(
  item: Pick<SavingsNotificationRecord, "kind" | "metadata"> & {
    title?: string;
    body?: string;
    related_tx_hash?: string | null;
  },
) {
  if (String(item.kind ?? "") === "workspace_invitation") {
    return true;
  }
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    const type = (meta as Record<string, unknown>).type;
    const workspaceId = (meta as Record<string, unknown>).workspaceId;
    if (type === "workspace_invitation" || typeof workspaceId === "string") {
      return true;
    }
  }
  if (item.related_tx_hash?.startsWith("workspace_invite:")) {
    return true;
  }
  const text = `${item.title ?? ""} ${item.body ?? ""}`;
  if (/workspace\s*(team\s*)?invitation/i.test(text)) {
    return true;
  }
  return false;
}



export function isCircleNotification(
  item: Pick<SavingsNotificationRecord, "kind" | "metadata"> & {
    title?: string;
    body?: string;
    related_tx_hash?: string | null;
  },
) {
  if (isWorkspaceInvitationNotification(item)) {
    return false;
  }
  if (String(item.kind ?? "").startsWith("circle_")) {
    return true;
  }
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    const type = (meta as Record<string, unknown>).type;
    const href = (meta as Record<string, unknown>).href;
    if (typeof type === "string" && type.startsWith("circle_")) return true;
    if (typeof href === "string" && isCircleHref(href)) return true;
  }
  return false;
}

/** Circle links, including ones stored before /swiftCircle became /circle. */
function isCircleHref(href: string) {
  return href.startsWith("/circle") || href.startsWith("/swiftCircle");
}

export function isCircleInvitationNotification(
  item: Pick<SavingsNotificationRecord, "kind" | "metadata"> & {
    title?: string;
    body?: string;
    related_tx_hash?: string | null;
  },
) {
  if (isWorkspaceInvitationNotification(item)) return false;
  if (item.kind === "circle_invitation") return true;

  // Only a pending invitation may claim this. `circleId` merely says the
  // notification belongs to a circle — every circle event carries it, so
  // treating it as an invitation signal put Accept/Decline on contributions,
  // completed withdrawals, messages, role changes and the rest.
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    const type = (meta as Record<string, unknown>).type;
    const invitationId = (meta as Record<string, unknown>).invitationId;
    const workspaceId = (meta as Record<string, unknown>).workspaceId;
    if (type === "workspace_invitation" || typeof workspaceId === "string") return false;
    if (type === "circle_invitation") return true;
    if (typeof invitationId === "string" && invitationId.length > 0 && !workspaceId) {
      const text = `${item.title ?? ""} ${item.body ?? ""}`;
      return /circle/i.test(text);
    }
  }

  // Older invitations carried the id only in the body text.
  return /INVITATION_ID:[0-9a-f-]{36}/i.test(item.body ?? "");
}

export function extractCircleInvitationId(
  item: Pick<SavingsNotificationRecord, "metadata" | "body">,
) {
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    const invitationId = (meta as Record<string, unknown>).invitationId;
    if (typeof invitationId === "string" && invitationId.length > 0) {
      return invitationId;
    }
  }
  const match = (item.body ?? "").match(
    /INVITATION_ID:([0-9a-f-]{36})/i,
  );
  return match?.[1] ?? null;
}

export function circleNotificationHref(
  item: Pick<SavingsNotificationRecord, "kind" | "metadata" | "body">,
) {
  const invitationId = extractCircleInvitationId(item);
  if (invitationId) {
    return `/circle?invite=${encodeURIComponent(invitationId)}`;
  }
  const meta = item.metadata;
  if (meta && typeof meta === "object") {
    const href = (meta as Record<string, unknown>).href;
    if (typeof href === "string" && isCircleHref(href)) {
      // Notifications stored before the move still point at /swiftCircle.
      return href.replace(/^\/swiftCircle/, "/circle");
    }
    const circleId = (meta as Record<string, unknown>).circleId;
    if (typeof circleId === "string") {
      return `/circle/${circleId}`;
    }
  }
  return "/circle";
}

export function getAlertInboxCategory(
  item: Pick<SavingsNotificationRecord, "kind" | "body" | "metadata">,
): AlertInboxCategory {
  if (
    isPaymentRequestNotification(item) ||
    isPaymentRequestDeclinedNotification(item) ||
    item.kind === "circle_invitation" ||
    item.kind === "circle_request" ||
    item.kind === "circle_request_declined"
  ) {
    return "requests";
  }
  if (
    item.kind === "payment_received" ||
    item.kind === "circle_payment" ||
    item.kind === "circle_request_paid" ||
    /money received|you received/i.test(`${item.kind} ${item.body}`)
  ) {
    return "payments";
  }
  return "savings";
}

export function formatAmountForCopy(
  units: bigint,
  currency: ArcTokenSymbol,
): string {
  const decimals = arcTokens[currency].decimals;
  const text = formatUnitsToDecimal(units, decimals);
  const [w, f = ""] = text.split(".");
  return `${w}.${(f + "00").slice(0, 2)}`;
}
