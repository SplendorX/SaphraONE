import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readActor, readJsonBody } from "@/lib/business/http";
import { requireRateLimit } from "@/lib/checkout/http";
import {
  createRefund,
  loadOwnedCharge,
  loadRefunds,
  refundSendHref,
  requireRefundAccess,
} from "@/lib/checkout/refunds";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request);
    const { wallet } = await requireRefundAccess({ circleSocialUuid, ownerWallet: actorWallet, workspaceId });
    const { id } = await context.params;
    const charge = await loadOwnedCharge(wallet, id);
    return jsonOk({ refunds: (await loadRefunds([charge.id])).get(charge.id) ?? [] });
  } catch (error) {
    return jsonBusinessError(error);
  }
}

/**
 * `{amount?, destination?, reason?}` → a REQUESTED refund and the Send link
 * that pays it. The refund counts once that send is confirmed.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw new Error("A valid JSON body is required.");
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request, body);
    const access = await requireRefundAccess({ circleSocialUuid, ownerWallet: actorWallet, workspaceId });
    await requireRateLimit(`refund-create:${access.wallet}`, 60, 3_600);
    const { id } = await context.params;
    const charge = await loadOwnedCharge(access.wallet, id);
    const refund = await createRefund({
      actorWallet: access.actorWallet,
      amount: body.amount,
      charge,
      destination: body.destination,
      reason: body.reason,
      source: "DASHBOARD",
      wallet: access.wallet,
    });
    return jsonOk({ refund, sendHref: refundSendHref(refund, charge) }, 201);
  } catch (error) {
    return jsonBusinessError(error);
  }
}
