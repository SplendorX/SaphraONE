import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readJsonBody } from "@/lib/business/http";
import { requireRateLimit } from "@/lib/checkout/http";
import { requireDeveloperRequest } from "@/lib/merchant-api/dashboard";
import { rotateSecret } from "@/lib/webhooks/endpoints";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** A new signing secret, in effect at once. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    const { wallet } = await requireDeveloperRequest(request, body);
    await requireRateLimit(`webhook-rotate:${wallet}`, 10, 3_600);
    const { id } = await context.params;
    const response = jsonOk(await rotateSecret({ id, wallet }));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}
