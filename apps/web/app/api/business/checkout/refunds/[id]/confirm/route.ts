import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readActor, readJsonBody } from "@/lib/business/http";
import { confirmRefund, requireRefundAccess } from "@/lib/checkout/refunds";

export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/** `{txHash}` of the send that paid the refund; verified on chain. Safe to retry. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request, body);
    const { wallet } = await requireRefundAccess({ circleSocialUuid, ownerWallet: actorWallet, workspaceId });
    const { id } = await context.params;
    return jsonOk({ refund: await confirmRefund({ refundId: id, txHash: body?.txHash, wallet }) });
  } catch (error) {
    return jsonBusinessError(error);
  }
}
