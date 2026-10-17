// Server-only. Checkout sessions of the public API. A session is the API face
// of one ONLINE charge: the charge engine (lib/checkout) verifies, matches and
// expires it exactly like an in-person charge.
import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { isBusinessHttpError } from "@/lib/account/errors";
import { syncChargeMatchesFor } from "@/lib/checkout/scan";
import {
  createOnlineCharge,
  expireIfStale,
  loadChargeById,
  loadPayments,
} from "@/lib/checkout/service";
import type {
  ChargeRecord,
  ChargeRefundRecord,
  CheckoutSessionRecord,
} from "@/lib/checkout/types";
import type { ApiCaller } from "@/lib/merchant-api/auth";
import { apiErrors } from "@/lib/merchant-api/errors";
import { emitSessionsExpired } from "@/lib/merchant-api/events";
import { newSessionId, readSessionId } from "@/lib/merchant-api/ids";
import { chargeStatusFor, toSessionObject } from "@/lib/merchant-api/serialize";
import {
  ApiParamError,
  readAmount,
  readClientReference,
  readCurrency,
  readDescription,
  readEmail,
  readExpiresInMinutes,
  readLineItems,
  readMetadata,
  readRedirectUrl,
} from "@/lib/merchant-api/validate";
import { explorerTxUrl } from "@/lib/onchain-facts";

const MAX_LIST_LIMIT = 100;

function nowIso() {
  return new Date().toISOString();
}

async function loadRefunds(chargeIds: string[]) {
  const byCharge = new Map<string, ChargeRefundRecord[]>();
  if (chargeIds.length === 0) return byCharge;
  const { data, error } = await accountDb()
    .from(accountTables.chargeRefunds)
    .select("*")
    .in("charge_id", chargeIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(readAccountDbError(error, "Could not load refunds."));
  for (const refund of (data ?? []) as ChargeRefundRecord[]) {
    const list = byCharge.get(refund.charge_id) ?? [];
    list.push(refund);
    byCharge.set(refund.charge_id, list);
  }
  return byCharge;
}

async function serialize(
  pairs: Array<{ charge: ChargeRecord; session: CheckoutSessionRecord }>,
  origin: string,
) {
  const ids = pairs.map((pair) => pair.charge.id);
  const [payments, refunds] = await Promise.all([loadPayments(ids), loadRefunds(ids)]);
  return pairs.map(({ charge, session }) =>
    toSessionObject({
      charge,
      explorerUrl: explorerTxUrl,
      origin,
      payments: payments.get(charge.id) ?? [],
      refunds: refunds.get(charge.id) ?? [],
      session,
    }),
  );
}

async function loadSessionRow(column: "public_id" | "charge_id", value: string) {
  const { data, error } = await accountDb()
    .from(accountTables.checkoutSessions)
    .select("*")
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the checkout session."));
  return (data as CheckoutSessionRecord | null) ?? null;
}

/** The session object of an ONLINE charge, as webhooks send it; null for other charges. */
export async function sessionObjectForCharge(charge: ChargeRecord, origin: string) {
  if (charge.kind !== "ONLINE") return null;
  const session = await loadSessionRow("charge_id", charge.id);
  if (!session) return null;
  return (await serialize([{ charge, session }], origin))[0];
}

/** The caller's session and its charge, or a 404 (also for another merchant's id). */
async function loadOwnedSession(caller: ApiCaller, id: unknown) {
  const sessionId = readSessionId(id);
  if (!sessionId) throw apiErrors.sessionNotFound();
  const session = await loadSessionRow("public_id", sessionId);
  if (!session || session.wallet_address !== caller.wallet) throw apiErrors.sessionNotFound();
  const charge = await loadChargeById(session.charge_id);
  if (!charge) throw apiErrors.sessionNotFound();
  return { charge: await expireIfStale(charge), session };
}

export async function createSession(input: {
  caller: ApiCaller;
  body: Record<string, unknown>;
  idempotencyKey: string | null;
  origin: string;
}) {
  const { body, caller } = input;
  const mode = caller.mode;
  const amount = readAmount(body.amount);
  const currency = readCurrency(body.currency);
  const successUrl = readRedirectUrl(body.success_url, { mode, param: "success_url", required: true })!;
  const cancelUrl = readRedirectUrl(body.cancel_url, { mode, param: "cancel_url", required: false });
  const description = readDescription(body.description);
  const lineItems = readLineItems(body.line_items, amount);
  const metadata = readMetadata(body.metadata);
  const clientReferenceId = readClientReference(body.client_reference_id);
  const customerEmail = readEmail(body.customer_email);
  const minutes = readExpiresInMinutes(body.expires_in_minutes);

  let charge: ChargeRecord;
  try {
    charge = await createOnlineCharge({
      amount,
      currency,
      description,
      expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      idempotencyKey: input.idempotencyKey,
      wallet: caller.wallet,
    });
  } catch (error) {
    // The charge engine's amount limits, as an API parameter error.
    if (isBusinessHttpError(error) && error.code === "INVALID_CHARGE") {
      throw new ApiParamError("amount", error.userMessage);
    }
    throw error;
  }

  // A retried create (same Idempotency-Key) got the first charge back.
  const replay = await loadSessionRow("charge_id", charge.id);
  if (replay) return (await serialize([{ charge, session: replay }], input.origin))[0];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await accountDb()
      .from(accountTables.checkoutSessions)
      .insert({
        api_key_id: caller.keyId,
        cancel_url: cancelUrl,
        charge_id: charge.id,
        client_reference_id: clientReferenceId,
        created_at: nowIso(),
        customer_email: customerEmail,
        idempotency_key: input.idempotencyKey,
        line_items: lineItems,
        metadata,
        mode,
        public_id: newSessionId(mode),
        success_url: successUrl,
        wallet_address: caller.wallet,
      })
      .select("*")
      .single();
    if (!error) {
      return (await serialize([{ charge, session: data as CheckoutSessionRecord }], input.origin))[0];
    }
    if (error.code !== "23505") {
      throw new Error(readAccountDbError(error, "Could not create the checkout session."));
    }
    // Two concurrent retries of one create: the other request won.
    const winner = await loadSessionRow("charge_id", charge.id);
    if (winner) return (await serialize([{ charge, session: winner }], input.origin))[0];
    // Otherwise a public id collision: draw another.
  }
  throw new Error("Could not create the checkout session. Try again.");
}

export async function getSession(input: { caller: ApiCaller; id: unknown; origin: string }) {
  let { charge, session } = await loadOwnedSession(input.caller, input.id);
  // Polling drives matching for card/bank and bridge payments, as on the merchant screen.
  if (await syncChargeMatchesFor(charge)) {
    charge = (await loadChargeById(charge.id)) ?? charge;
  }
  return (await serialize([{ charge, session }], input.origin))[0];
}

/**
 * Newest first, paginated by the last id of the previous page
 * (`starting_after`). Filtered by status when asked.
 */
export async function listSessions(input: {
  caller: ApiCaller;
  limit: unknown;
  startingAfter: unknown;
  status: unknown;
  origin: string;
}) {
  const rawLimit = input.limit === null || input.limit === undefined || input.limit === "" ? 10 : Number(input.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIST_LIMIT) {
    throw new ApiParamError("limit", `limit must be a whole number from 1 to ${MAX_LIST_LIMIT}.`);
  }
  let status = null;
  if (input.status !== null && input.status !== undefined && input.status !== "") {
    status = chargeStatusFor(input.status);
    if (!status) {
      throw new ApiParamError("status", "status must be open, complete, expired or cancelled.");
    }
  }

  let query = accountDb()
    .from(accountTables.charges)
    .select("*")
    .eq("wallet_address", input.caller.wallet)
    .eq("kind", "ONLINE")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(rawLimit + 1);
  if (status) query = query.eq("status", status);
  if (input.startingAfter) {
    const { charge: cursor } = await loadOwnedSession(input.caller, input.startingAfter).catch(() => {
      throw new ApiParamError("starting_after", "starting_after is not a session of yours.");
    });
    query = query.or(
      `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(readAccountDbError(error, "Could not list checkout sessions."));
  const rows = (data ?? []) as ChargeRecord[];
  const page = rows.slice(0, rawLimit);

  const sessions = new Map<string, CheckoutSessionRecord>();
  if (page.length > 0) {
    const found = await accountDb()
      .from(accountTables.checkoutSessions)
      .select("*")
      .in(
        "charge_id",
        page.map((row) => row.id),
      );
    if (found.error) throw new Error(readAccountDbError(found.error, "Could not list checkout sessions."));
    for (const session of (found.data ?? []) as CheckoutSessionRecord[]) {
      sessions.set(session.charge_id, session);
    }
  }
  const charges = await Promise.all(page.map(expireIfStale));
  const pairs = charges.flatMap((charge) => {
    const session = sessions.get(charge.id);
    return session ? [{ charge, session }] : [];
  });
  return {
    data: await serialize(pairs, input.origin),
    has_more: rows.length > rawLimit,
    object: "list" as const,
  };
}

/** Ends an unpaid session so it can't be paid; refused once money has arrived. */
export async function expireSession(input: { caller: ApiCaller; id: unknown; origin: string }) {
  const { charge, session } = await loadOwnedSession(input.caller, input.id);
  if (charge.status === "OPEN") {
    const { data, error } = await accountDb()
      .from(accountTables.charges)
      .update({ status: "EXPIRED", updated_at: nowIso() })
      .eq("id", charge.id)
      .eq("status", "OPEN")
      .eq("amount_received", "0")
      .select("id");
    if (error) throw new Error(readAccountDbError(error, "Could not expire the session."));
    if ((data ?? []).length === 0) {
      throw apiErrors.sessionState("A payment has arrived on this session, so it can't be expired.");
    }
    await emitSessionsExpired([charge.id]);
  } else if (charge.status === "PAID") {
    throw apiErrors.sessionState("This session is already complete.");
  }
  const fresh = (await loadChargeById(charge.id)) ?? charge;
  return (await serialize([{ charge: fresh, session }], input.origin))[0];
}
