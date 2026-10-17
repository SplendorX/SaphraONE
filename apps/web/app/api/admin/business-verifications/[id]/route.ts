import { type NextRequest } from "next/server";

import { adminActorFor, logAdminAction } from "@/lib/admin/access";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import { decideSubmission } from "@/lib/business/verification-review";

export const runtime = "nodejs";

/** A reviewer's decision: { decision: "APPROVED" | "REJECTED", reason }. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await adminActorFor(request, "verifications");
  if (!actor) return jsonError("Unauthorized.", 401);
  const { id } = await context.params;
  const body = await readJsonRecord(request);
  if (!body) return jsonError("A valid JSON body is required.", 400);
  try {
    const result = await decideSubmission({ decision: body.decision, id, reason: body.reason, reviewer: actor.label });
    await logAdminAction(actor, "verifications", "decide-verification", id, {
      decision: body.decision,
      reason: body.reason,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not save the decision.", 400);
  }
}
