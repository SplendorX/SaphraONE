import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readActor, readJsonBody } from "@/lib/business/http";
import { requireDeveloperAccess } from "@/lib/merchant-api/dashboard";
import { revokeApiKey } from "@/lib/merchant-api/keys";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Takes effect at once: the next call with the key gets a 401. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request, body);
    const { wallet } = await requireDeveloperAccess({
      circleSocialUuid,
      ownerWallet: actorWallet,
      workspaceId,
    });
    const { id } = await context.params;
    return jsonOk({ key: await revokeApiKey({ keyId: id, wallet }) });
  } catch (error) {
    return jsonBusinessError(error);
  }
}
