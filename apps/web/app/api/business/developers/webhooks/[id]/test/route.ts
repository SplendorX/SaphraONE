import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readJsonBody } from "@/lib/business/http";
import { requireRateLimit } from "@/lib/checkout/http";
import { requireDeveloperRequest } from "@/lib/merchant-api/dashboard";
import { sendTestEvent } from "@/lib/webhooks/endpoints";

export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/** Sends a `ping` to this endpoint now and returns the delivery. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    const { wallet } = await requireDeveloperRequest(request, body);
    await requireRateLimit(`webhook-test:${wallet}`, 20, 600);
    const { id } = await context.params;
    const response = jsonOk(await sendTestEvent({ id, wallet }));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}
