import { type NextRequest } from "next/server";

import { requireApiKey } from "@/lib/merchant-api/auth";
import { jsonApi, jsonApiError, readApiBody, requireApiRateLimit } from "@/lib/merchant-api/http";
import { createApiRefund, listApiRefunds } from "@/lib/merchant-api/refunds";

export const runtime = "nodejs";

/**
 * Request a refund: `{session, amount?, destination_wallet?, reason?}`. It
 * starts `requested`; the merchant approves and sends it in SaphraONE.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireApiKey(request);
    await requireApiRateLimit(`api-key:${caller.keyId}`, 100, 60);
    await requireApiRateLimit(`api-refunds:${caller.wallet}`, 200, 3_600);
    return jsonApi(await createApiRefund({ body: await readApiBody(request), caller }), 201);
  } catch (error) {
    return jsonApiError(error);
  }
}

/** A session's refunds: ?session=cs_… */
export async function GET(request: NextRequest) {
  try {
    const caller = await requireApiKey(request);
    await requireApiRateLimit(`api-key:${caller.keyId}`, 100, 60);
    return jsonApi(await listApiRefunds({ caller, session: request.nextUrl.searchParams.get("session") }));
  } catch (error) {
    return jsonApiError(error);
  }
}
