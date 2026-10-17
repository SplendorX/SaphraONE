import { type NextRequest } from "next/server";

import {
  jsonBusinessError,
  jsonOk,
  readActor,
  readJsonBody,
} from "@/lib/business/http";
import { requireRateLimit } from "@/lib/checkout/http";
import { createCharge, listCharges } from "@/lib/checkout/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request);
    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const payload = await listCharges({
      circleSocialUuid,
      kind: request.nextUrl.searchParams.get("kind") ?? undefined,
      ownerWallet: actorWallet,
      page,
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      workspaceId,
    });
    return jsonOk(payload);
  } catch (error) {
    return jsonBusinessError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw new Error("A valid JSON body is required.");
    const { actorWallet, circleSocialUuid, idempotencyKey, workspaceId } = await readActor(
      request,
      body,
    );
    await requireRateLimit(`checkout-create:${actorWallet}`, 120, 3600);
    const charge = await createCharge({
      amount: body.amount,
      circleSocialUuid,
      currency: body.currency,
      idempotencyKey,
      note: body.note,
      ownerWallet: actorWallet,
      workspaceId,
    });
    return jsonOk({ charge }, 201);
  } catch (error) {
    return jsonBusinessError(error);
  }
}
