import { type NextRequest } from "next/server";

import { requireAdminTool } from "@/lib/admin/access";
import { listLedger, type LedgerPeriod } from "@/lib/admin/transactions";
import { AdminUserError } from "@/lib/admin/users";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

const periods = new Set(["24h", "7d", "30d", "90d"]);

/** ?period=24h|7d|30d|90d &source= &account= (ONE ID or wallet) &minUsd= &flagged=1 */
export async function GET(request: NextRequest) {
  const access = await requireAdminTool(request, "transactions");
  if (!access.ok) return access.response;
  const params = request.nextUrl.searchParams;
  const period = params.get("period");
  const minUsd = Number(params.get("minUsd"));
  try {
    return jsonOk(
      await listLedger({
        account: params.get("account"),
        flaggedOnly: params.get("flagged") === "1",
        minUsd: Number.isFinite(minUsd) ? minUsd : null,
        period: period && periods.has(period) ? (period as LedgerPeriod) : "7d",
        source: params.get("source"),
      }),
    );
  } catch (error) {
    if (error instanceof AdminUserError) return jsonError(error.message, error.status);
    console.error("[admin/transactions]", error);
    return jsonError("Couldn't load transactions.", 500);
  }
}
