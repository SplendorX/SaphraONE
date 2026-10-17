import { type NextRequest } from "next/server";

import { adminCan } from "@/lib/admin/access";
import { jsonError, jsonOk } from "@/lib/http";
import { listVerificationSubmissions } from "@/lib/business/verification-review";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await adminCan(request, "verifications"))) return jsonError("Unauthorized.", 401);
  try {
    const status = request.nextUrl.searchParams.get("status") === "ALL" ? "ALL" : "PENDING";
    return jsonOk({ submissions: await listVerificationSubmissions(status) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load submissions.", 500);
  }
}
