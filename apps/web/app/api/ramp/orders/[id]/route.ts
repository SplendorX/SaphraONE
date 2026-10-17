import { type NextRequest } from "next/server";

import { rampError, rampJson, requireRampRateLimit, requireRampWallet } from "@/lib/ramp/http";
import { getOrder } from "@/lib/ramp/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** One order, refreshed from Centiiv when it is open and stale. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const wallet = await requireRampWallet(request);
    await requireRampRateLimit(`order-read:${wallet}`, 60, 60);
    return rampJson({ order: await getOrder({ wallet, id }) });
  } catch (error) {
    return rampError(error);
  }
}
