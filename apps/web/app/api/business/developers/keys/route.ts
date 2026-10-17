import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readActor, readJsonBody } from "@/lib/business/http";
import { requireRateLimit } from "@/lib/checkout/http";
import { requireDeveloperAccess } from "@/lib/merchant-api/dashboard";
import { createApiKey, deploymentMode, listApiKeys } from "@/lib/merchant-api/keys";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request);
    const { wallet } = await requireDeveloperAccess({
      circleSocialUuid,
      ownerWallet: actorWallet,
      workspaceId,
    });
    const response = jsonOk({ keys: await listApiKeys(wallet), mode: deploymentMode() });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}

/** The full key is in this response only; it is never shown again. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw new Error("A valid JSON body is required.");
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request, body);
    const access = await requireDeveloperAccess({
      circleSocialUuid,
      ownerWallet: actorWallet,
      workspaceId,
    });
    await requireRateLimit(`api-key-create:${access.wallet}`, 10, 3_600);
    const created = await createApiKey({ ...access, name: body.name });
    const response = jsonOk(created, 201);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}
