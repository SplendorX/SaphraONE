import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readJsonBody } from "@/lib/business/http";
import { requireRateLimit } from "@/lib/checkout/http";
import { requireDeveloperRequest } from "@/lib/merchant-api/dashboard";
import { createEndpoint, listEndpoints } from "@/lib/webhooks/endpoints";
import { MAX_WEBHOOK_ENDPOINTS, WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/rules";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { wallet } = await requireDeveloperRequest(request);
    const response = jsonOk({
      endpoints: await listEndpoints(wallet),
      eventTypes: WEBHOOK_EVENT_TYPES,
      maxEndpoints: MAX_WEBHOOK_ENDPOINTS,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}

/** `{url, events}`. The response carries the endpoint's signing secret. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw new Error("A valid JSON body is required.");
    const { wallet } = await requireDeveloperRequest(request, body);
    await requireRateLimit(`webhook-endpoint-create:${wallet}`, 10, 3_600);
    const response = jsonOk(await createEndpoint({ events: body.events, url: body.url, wallet }), 201);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}
