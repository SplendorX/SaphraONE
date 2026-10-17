import { type NextRequest } from "next/server";

import { getAdminActor } from "@/lib/admin/access";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

/** Who is signed in to the admin platform, and which tools they may open. */
export async function GET(request: NextRequest) {
  const actor = await getAdminActor(request);
  if (!actor) return jsonError("Sign in to the admin platform.", 401);
  return jsonOk({ actor });
}
