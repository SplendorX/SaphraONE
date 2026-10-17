import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk } from "@/lib/business/http";
import { requireDeveloperRequest } from "@/lib/merchant-api/dashboard";
import { listDeliveries } from "@/lib/webhooks/endpoints";

export const runtime = "nodejs";

/** The last 50 webhook deliveries; `?endpointId=` for one endpoint. */
export async function GET(request: NextRequest) {
  try {
    const { wallet } = await requireDeveloperRequest(request);
    const endpointId = request.nextUrl.searchParams.get("endpointId");
    const response = jsonOk({ deliveries: await listDeliveries({ endpointId, wallet }) });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}
