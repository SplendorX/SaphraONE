import { type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/business/http";
import { rampErrors } from "@/lib/ramp/errors";
import { rampError, rampJson, requireRampRateLimit, requireRampWallet } from "@/lib/ramp/http";
import { quote } from "@/lib/ramp/service";

export const runtime = "nodejs";

/** An indicative Centiiv rate for `{ direction, amount }`. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw rampErrors.invalid("A valid JSON body is required.");
    const wallet = await requireRampWallet(request, body);
    await requireRampRateLimit(`quote:${wallet}`, 30, 60);
    return rampJson(await quote({ direction: body.direction, amount: body.amount }));
  } catch (error) {
    return rampError(error);
  }
}
