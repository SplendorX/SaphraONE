import { type NextRequest } from "next/server";
import { adminCan } from "@/lib/admin/access";
import { referralDb, referralTables, readReferralDbError } from "@/lib/referral/db";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await adminCan(request, "rewards"))) {
    return jsonError("Unauthorized admin request.", 401);
  }

  try {
    const { id } = await context.params;
    const supabase = referralDb();

    const [referralRes, qualRes, riskRes, ledgerRes] = await Promise.all([
      supabase.from(referralTables.referrals).select("*").eq("id", id).maybeSingle(),
      supabase.from(referralTables.qualifications).select("*").eq("referral_id", id).maybeSingle(),
      supabase.from(referralTables.riskAssessments).select("*").eq("referral_id", id).maybeSingle(),
      supabase.from(referralTables.ledger).select("*").eq("referral_id", id),
    ]);

    if (referralRes.error) {
      throw new Error(readReferralDbError(referralRes.error, "Could not load referral details."));
    }

    if (!referralRes.data) {
      return jsonError("Referral not found.", 404);
    }

    return jsonOk({
      referral: referralRes.data,
      qualification: qualRes.data ?? null,
      riskAssessment: riskRes.data ?? null,
      ledgerEntries: ledgerRes.data ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load referral audit.";
    return jsonError(message, 500);
  }
}
