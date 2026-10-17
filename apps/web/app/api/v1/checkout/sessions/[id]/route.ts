import { type NextRequest } from "next/server";

import { requireApiKey } from "@/lib/merchant-api/auth";
import { jsonApi, jsonApiError, publicOrigin, requireApiRateLimit } from "@/lib/merchant-api/http";
import { getSession } from "@/lib/merchant-api/sessions";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** The session as it stands; fulfil orders from this (or the webhook), never the redirect. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const caller = await requireApiKey(request);
    await requireApiRateLimit(`api-key:${caller.keyId}`, 100, 60);
    const { id } = await context.params;
    return jsonApi(await getSession({ caller, id, origin: publicOrigin(request) }));
  } catch (error) {
    return jsonApiError(error);
  }
}
