import { type NextRequest } from "next/server";

import { adminCan } from "@/lib/admin/access";
import { jsonError, jsonOk } from "@/lib/http";
import { listKybReviews } from "@/lib/kyc/kyb-service";
import { listKycReviews } from "@/lib/kyc/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await adminCan(request, "verifications"))) return jsonError("Unauthorized.", 401);
  try {
    const status = request.nextUrl.searchParams.get("status") === "ALL" ? "ALL" : "MANUAL_REVIEW";
    if (request.nextUrl.searchParams.get("subject") === "BUSINESS") {
      return jsonOk({ businesses: await listKybReviews(status) });
    }
    return jsonOk({ profiles: await listKycReviews(status) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load reviews.", 500);
  }
}
