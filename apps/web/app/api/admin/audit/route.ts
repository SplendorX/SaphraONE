import { type NextRequest } from "next/server";

import { requireAdminTool } from "@/lib/admin/access";
import { listAuditLog } from "@/lib/admin/transactions";
import { AdminUserError } from "@/lib/admin/users";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

/** The latest changes made from the admin platform; ?target=0x… for one account. */
export async function GET(request: NextRequest) {
  const access = await requireAdminTool(request, "audit");
  if (!access.ok) return access.response;
  try {
    return jsonOk({ entries: await listAuditLog({ target: request.nextUrl.searchParams.get("target") }) });
  } catch (error) {
    if (error instanceof AdminUserError) return jsonError(error.message, error.status);
    return jsonError("Couldn't load the audit log.", 500);
  }
}
