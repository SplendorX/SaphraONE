import { type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/business/http";
import { rampErrors } from "@/lib/ramp/errors";
import { rampError, rampJson, requireRampRateLimit, requireRampWallet } from "@/lib/ramp/http";
import { reportCryptoSent } from "@/lib/ramp/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * The browser reports the USDC transfer for a withdrawal. It is checked on
 * Arc before it is recorded; 202 means not mined yet, so the browser retries.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    if (!body) throw rampErrors.invalid("A valid JSON body is required.");
    const wallet = await requireRampWallet(request, body);
    await requireRampRateLimit(`crypto-sent:${wallet}`, 10, 60);
    const result = await reportCryptoSent({ wallet, id, txHash: body.txHash });
    return rampJson(result, result.pending ? 202 : 200);
  } catch (error) {
    return rampError(error);
  }
}
