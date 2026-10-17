import { type NextRequest } from "next/server";

import { requireApiKey } from "@/lib/merchant-api/auth";
import {
  jsonApi,
  jsonApiError,
  publicOrigin,
  readApiBody,
  readApiIdempotencyKey,
  requireApiRateLimit,
} from "@/lib/merchant-api/http";
import { createSession, listSessions } from "@/lib/merchant-api/sessions";

export const runtime = "nodejs";

/** Create a checkout session; redirect the buyer to its `url`. */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireApiKey(request);
    await requireApiRateLimit(`api-key:${caller.keyId}`, 100, 60);
    await requireApiRateLimit(`api-sessions:${caller.wallet}`, 1_000, 3_600);
    const body = await readApiBody(request);
    const session = await createSession({
      body,
      caller,
      idempotencyKey: readApiIdempotencyKey(request),
      origin: publicOrigin(request),
    });
    return jsonApi(session, 201);
  } catch (error) {
    return jsonApiError(error);
  }
}

/** Newest first: ?limit=&starting_after=&status=open|complete|expired|cancelled */
export async function GET(request: NextRequest) {
  try {
    const caller = await requireApiKey(request);
    await requireApiRateLimit(`api-key:${caller.keyId}`, 100, 60);
    const params = request.nextUrl.searchParams;
    return jsonApi(
      await listSessions({
        caller,
        limit: params.get("limit"),
        origin: publicOrigin(request),
        startingAfter: params.get("starting_after"),
        status: params.get("status"),
      }),
    );
  } catch (error) {
    return jsonApiError(error);
  }
}
