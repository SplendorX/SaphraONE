import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readActor, readJsonBody } from "@/lib/business/http";
import { cancelRefund, requireRefundAccess } from "@/lib/checkout/refunds";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Drops a refund that was not sent; the amount can be refunded again. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request, body);
    const { wallet } = await requireRefundAccess({ circleSocialUuid, ownerWallet: actorWallet, workspaceId });
    const { id } = await context.params;
    return jsonOk({ refund: await cancelRefund({ refundId: id, wallet }) });
  } catch (error) {
    return jsonBusinessError(error);
  }
}
