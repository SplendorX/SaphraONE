import { type NextRequest } from "next/server";

import { rampError, rampJson, requireRampWallet } from "@/lib/ramp/http";
import { listBanks } from "@/lib/ramp/service";

export const runtime = "nodejs";

/** Nigerian banks Centiiv can pay out to. */
export async function GET(request: NextRequest) {
  try {
    await requireRampWallet(request);
    return rampJson({ banks: await listBanks() });
  } catch (error) {
    return rampError(error);
  }
}
