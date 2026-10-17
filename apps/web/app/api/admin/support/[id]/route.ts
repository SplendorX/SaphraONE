import { type NextRequest } from "next/server";

import { adminCan } from "@/lib/admin/access";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import { agentUpdate, readThreadForAgent, SupportError } from "@/lib/support/tickets";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

function fail(error: unknown) {
  return jsonError(
    error instanceof Error ? error.message : "Something went wrong.",
    error instanceof SupportError ? error.status : 500,
  );
}

export async function GET(request: NextRequest, context: Context) {
  if (!(await adminCan(request, "support"))) return jsonError("Unauthorized.", 401);
  try {
    return jsonOk(await readThreadForAgent((await context.params).id));
  } catch (error) {
    return fail(error);
  }
}

/** Reply and/or change status or priority: { body?, status?, priority? }. */
export async function POST(request: NextRequest, context: Context) {
  if (!(await adminCan(request, "support"))) return jsonError("Unauthorized.", 401);
  const body = await readJsonRecord(request);
  if (!body) return jsonError("A valid JSON body is required.", 400);
  try {
    return jsonOk(await agentUpdate((await context.params).id, body));
  } catch (error) {
    return fail(error);
  }
}
