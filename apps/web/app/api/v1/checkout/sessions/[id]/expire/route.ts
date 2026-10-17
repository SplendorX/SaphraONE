import { type NextRequest } from "next/server";

import { requireApiKey } from "@/lib/merchant-api/auth";
import { jsonApi, jsonApiError, publicOrigin, requireApiRateLimit } from "@/lib/merchant-api/http";
import { expireSession } from "@/lib/merchant-api/sessions";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Ends an unpaid session, e.g. when the order was cancelled on the site. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const caller = await requireApiKey(request);
    await requireApiRateLimit(`api-key:${caller.keyId}`, 100, 60);
    const { id } = await context.params;
    return jsonApi(await expireSession({ caller, id, origin: publicOrigin(request) }));
  } catch (error) {
    return jsonApiError(error);
  }
}
