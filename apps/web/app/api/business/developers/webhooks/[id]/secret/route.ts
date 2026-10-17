import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readJsonBody } from "@/lib/business/http";
import { requireDeveloperRequest } from "@/lib/merchant-api/dashboard";
import { revealSecret } from "@/lib/webhooks/endpoints";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Reveals the signing secret (POST, so it is never cached or logged as a URL). */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    const { wallet } = await requireDeveloperRequest(request, body);
    const { id } = await context.params;
    const response = jsonOk(await revealSecret({ id, wallet }));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return jsonBusinessError(error);
  }
}
