import { type NextRequest } from "next/server";

import { requireApiKey } from "@/lib/merchant-api/auth";
import { jsonApi, jsonApiError, requireApiRateLimit } from "@/lib/merchant-api/http";
import { getApiRefund } from "@/lib/merchant-api/refunds";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const caller = await requireApiKey(request);
    await requireApiRateLimit(`api-key:${caller.keyId}`, 100, 60);
    const { id } = await context.params;
    return jsonApi(await getApiRefund({ caller, id }));
  } catch (error) {
    return jsonApiError(error);
  }
}
