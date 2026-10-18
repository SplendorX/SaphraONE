// Server-only. Refunds through the public API. A site can only *request* a
// refund: the merchant approves and sends it in SaphraONE, and the refund
// becomes `succeeded` (with a refund.succeeded webhook) once it is verified.
import { isBusinessHttpError } from "@/lib/account/errors";
import { createRefund, loadOwnedRefund, loadRefunds } from "@/lib/checkout/refunds";
import type { ChargeRefundRecord } from "@/lib/checkout/types";
import type { ApiCaller } from "@/lib/merchant-api/auth";
import { MerchantApiError } from "@/lib/merchant-api/errors";
import { readSessionId } from "@/lib/merchant-api/ids";
import { toRefundObject } from "@/lib/merchant-api/serialize";
import { loadOwnedSession, loadSessionRow } from "@/lib/merchant-api/sessions";
import { ApiParamError } from "@/lib/merchant-api/validate";

function refundNotFound() {
  return new MerchantApiError({
    code: "resource_missing",
    message: "No such refund.",
    param: "id",
    status: 404,
    type: "not_found_error",
  });
}

/** The charge engine's 400s name a field; give the API's `param` for them. */
function asParamError(error: unknown, param: string) {
  if (isBusinessHttpError(error) && error.status === 400) return new ApiParamError(param, error.userMessage);
  return error;
}

async function sessionIdFor(refund: ChargeRefundRecord) {
  return (await loadSessionRow("charge_id", refund.charge_id))?.public_id ?? null;
}

/** `{session, amount?, destination_wallet?, reason?}` → a `requested` refund. */
export async function createApiRefund(input: { caller: ApiCaller; body: Record<string, unknown> }) {
  const { body, caller } = input;
  if (!readSessionId(body.session)) throw new ApiParamError("session", "session must be a checkout session id (cs_…).");
  const { charge, session } = await loadOwnedSession(caller, body.session);
  if (body.amount !== undefined && typeof body.amount !== "string") {
    throw new ApiParamError("amount", "amount must be a decimal string, such as \"12.50\".");
  }
  let refund: ChargeRefundRecord;
  try {
    refund = await createRefund({
      actorWallet: null,
      amount: body.amount,
      charge,
      destination: body.destination_wallet,
      reason: body.reason,
      source: "API",
      wallet: caller.wallet,
    });
  } catch (error) {
    const message = isBusinessHttpError(error) ? error.userMessage : "";
    const param = /wallet/i.test(message) ? "destination_wallet" : /reason/i.test(message) ? "reason" : "amount";
    throw asParamError(error, param);
  }
  return toRefundObject(refund, session.public_id);
}

export async function getApiRefund(input: { caller: ApiCaller; id: unknown }) {
  const refund = await loadOwnedRefund(input.caller.wallet, input.id).catch((error) => {
    throw isBusinessHttpError(error) ? refundNotFound() : error;
  });
  return toRefundObject(refund, await sessionIdFor(refund));
}

/** The refunds of one session, oldest first. */
export async function listApiRefunds(input: { caller: ApiCaller; session: unknown }) {
  if (!readSessionId(input.session)) {
    throw new ApiParamError("session", "Pass ?session=cs_… to list a session's refunds.");
  }
  const { charge, session } = await loadOwnedSession(input.caller, input.session);
  const refunds = (await loadRefunds([charge.id])).get(charge.id) ?? [];
  return {
    data: refunds.map((refund) => toRefundObject(refund, session.public_id)),
    has_more: false,
    object: "list" as const,
  };
}
