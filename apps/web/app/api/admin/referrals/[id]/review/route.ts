import { type NextRequest } from "next/server";
import { adminCan } from "@/lib/admin/access";
import { referralDb, referralTables, readReferralDbError } from "@/lib/referral/db";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";

export const runtime = "nodejs";

type ReviewBody = {
  action?: unknown; // 'APPROVE' | 'REJECT'
  reason?: unknown;
  adminId?: unknown;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await adminCan(request, "rewards"))) {
    return jsonError("Unauthorized admin request.", 401);
  }

  try {
    const { id } = await context.params;
    const body = await readJsonRecord<ReviewBody>(request);
    if (!body || (body.action !== "APPROVE" && body.action !== "REJECT")) {
      return jsonError("A valid action ('APPROVE' or 'REJECT') is required.", 400);
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "Admin manual review";
    const adminId = typeof body.adminId === "string" ? body.adminId.trim() : "admin";

    const supabase = referralDb();
    const nextStatus = body.action === "APPROVE" ? "QUALIFIED" : "REJECTED";
    const nextFraudStatus = body.action === "APPROVE" ? "LOW_RISK" : "BLOCKED";

    const updated = await supabase
      .from(referralTables.referrals)
      .update({
        status: nextStatus,
        fraud_status: nextFraudStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updated.error) {
      throw new Error(readReferralDbError(updated.error, "Could not update referral review status."));
    }

    // Log admin audit action
    await supabase.from(referralTables.auditLogs).insert({
      admin_id: adminId,
      action: `REFERRAL_${body.action}`,
      target_type: "REFERRAL",
      target_id: id,
      reason,
      changes: { newStatus: nextStatus, newFraudStatus: nextFraudStatus },
    });

    return jsonOk({ referral: updated.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not review referral.";
    return jsonError(message, 500);
  }
}
