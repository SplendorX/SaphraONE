import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readJsonBody } from "@/lib/business/http";
import { requireRateLimit } from "@/lib/checkout/http";
import { requireDeveloperRequest } from "@/lib/merchant-api/dashboard";
import { resendDelivery } from "@/lib/webhooks/endpoints";

export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/** Sends the delivery once more, now. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    const { wallet } = await requireDeveloperRequest(request, body);
    await requireRateLimit(`webhook-resend:${wallet}`, 30, 600);
    const { id } = await context.params;
    return jsonOk(await resendDelivery({ deliveryId: id, wallet }));
  } catch (error) {
    return jsonBusinessError(error);
  }
}
