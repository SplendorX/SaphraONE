import { rampJson } from "@/lib/ramp/http";
import { rampStatus } from "@/lib/ramp/service";

export const runtime = "nodejs";

/** Whether Naira deposits and withdrawals are available, for the deposit page. */
export async function GET() {
  return rampJson(rampStatus());
}
