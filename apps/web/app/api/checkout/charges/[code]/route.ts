import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk } from "@/lib/business/http";
import { clientIp, noStore, requireRateLimit } from "@/lib/checkout/http";
import { getPublicCharge } from "@/lib/checkout/service";
import { driveMerchantDeliveries } from "@/lib/webhooks/events";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ code: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { code } = await context.params;
    await requireRateLimit(`checkout-view:${clientIp(request)}:${code}`, 120, 60);
    const payload = await getPublicCharge(code, { scan: true });
    // Hosted-page polls also move the merchant's webhook retries along.
    if (payload.charge.online) driveMerchantDeliveries(payload.destinationWallet);
    return noStore(jsonOk(payload));
  } catch (error) {
    return noStore(jsonBusinessError(error));
  }
}
