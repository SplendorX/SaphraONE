import { type NextRequest } from "next/server";
import { adminCan } from "@/lib/admin/access";
import { getAdminDetailedAnalytics } from "@/lib/referral/service";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await adminCan(request, "rewards"))) {
    return jsonError("Unauthorized admin request.", 401);
  }

  try {
    const analytics = await getAdminDetailedAnalytics();
    return jsonOk(analytics);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate referral analytics.";
    return jsonError(message, 500);
  }
}
