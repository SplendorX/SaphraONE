import { type NextRequest } from "next/server";

import { jsonBusinessError, jsonOk, readJsonBody } from "@/lib/business/http";
import { requireDeveloperRequest } from "@/lib/merchant-api/dashboard";
import { deleteEndpoint, updateEndpoint } from "@/lib/webhooks/endpoints";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Any of `{url, events, disabled}`. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw new Error("A valid JSON body is required.");
    const { wallet } = await requireDeveloperRequest(request, body);
    const { id } = await context.params;
    return jsonOk({
      endpoint: await updateEndpoint({
        disabled: body.disabled,
        events: body.events,
        id,
        url: body.url,
        wallet,
      }),
    });
  } catch (error) {
    return jsonBusinessError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const body = await readJsonBody(request);
    const { wallet } = await requireDeveloperRequest(request, body);
    const { id } = await context.params;
    return jsonOk(await deleteEndpoint({ id, wallet }));
  } catch (error) {
    return jsonBusinessError(error);
  }
}
