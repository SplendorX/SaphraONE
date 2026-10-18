import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readActor } from "@/lib/business/http";
import { listPendingRefunds, requireRefundAccess } from "@/lib/checkout/refunds";

export const runtime = "nodejs";

/** Refunds waiting to be sent: requested by the website, or started and not finished. */
export async function GET(request: NextRequest) {
  try {
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request);
    const { wallet } = await requireRefundAccess({ circleSocialUuid, ownerWallet: actorWallet, workspaceId });
    const response = jsonOk({ refunds: await listPendingRefunds(wallet) });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}
