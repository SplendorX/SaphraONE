import { type NextRequest } from "next/server";

import { rampError, rampJson, requireRampWallet } from "@/lib/ramp/http";
import { rampStatus } from "@/lib/ramp/service";

export const runtime = "nodejs";

/** Whether Naira deposits and withdrawals are available, for the deposit page. */
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("wallet");
    const wallet = requested ? await requireRampWallet(request).catch(() => null) : null;
    return rampJson(await rampStatus(wallet));
  } catch (error) {
    return rampError(error);
  }
}
