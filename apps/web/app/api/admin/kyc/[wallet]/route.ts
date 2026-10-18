import { type NextRequest } from "next/server";

import { adminActorFor, logAdminAction } from "@/lib/admin/access";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import { decideKyb } from "@/lib/kyc/kyb-service";
import { decideKyc } from "@/lib/kyc/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ wallet: string }> }) {
  const actor = await adminActorFor(request, "verifications");
  if (!actor) return jsonError("Unauthorized.", 401);
  const { wallet } = await context.params;
  const body = await readJsonRecord(request);
  if (!body) return jsonError("A valid JSON body is required.", 400);
  try {
    const business = body.subject === "BUSINESS";
    const decision = { decision: body.decision, reason: body.reason, reviewer: actor.label, wallet };
    const result = business ? await decideKyb(decision) : await decideKyc(decision);
    await logAdminAction(actor, "verifications", business ? "decide-kyb" : "decide-kyc", wallet, {
      decision: body.decision,
      reason: body.reason,
      outcome: result.outcome,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not save the decision.", 400);
  }
}
