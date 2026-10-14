import { type NextRequest } from "next/server";
import { adminCan } from "@/lib/admin/access";
import { referralDb, referralTables, readReferralDbError } from "@/lib/referral/db";
import { getAdminReferralOverview } from "@/lib/referral/service";
import { jsonError, jsonOk } from "@/lib/http";
import type { ReferralRecord } from "@/lib/referral/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await adminCan(request, "rewards"))) {
    return jsonError("Unauthorized admin request.", 401);
  }

  try {
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
    const pageSize = 25;
    const from = (page - 1) * pageSize;
    const status = request.nextUrl.searchParams.get("status");

    const supabase = referralDb();
    let query = supabase
      .from(referralTables.referrals)
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const [overview, queryResult] = await Promise.all([
      getAdminReferralOverview(),
      query,
    ]);

    if (queryResult.error) {
      throw new Error(readReferralDbError(queryResult.error, "Could not load referrals."));
    }

    return jsonOk({
      overview,
      referrals: (queryResult.data ?? []) as ReferralRecord[],
      pagination: {
        page,
        pageSize,
        total: queryResult.count ?? 0,
        totalPages: Math.ceil((queryResult.count ?? 0) / pageSize),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load admin referrals.";
    return jsonError(message, 500);
  }
}
