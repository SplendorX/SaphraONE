import { type NextRequest } from "next/server";

import { logAdminAction, requireAdminTool } from "@/lib/admin/access";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import { adminRevokeApiKey, loadMerchantApiOverview } from "@/lib/merchant-api/admin";

export const runtime = "nodejs";

/** Businesses with API keys, their 7-day volume and webhook health. */
export async function GET(request: NextRequest) {
  const access = await requireAdminTool(request, "merchant-api");
  if (!access.ok) return access.response;
  try {
    return jsonOk({ overview: await loadMerchantApiOverview() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not load the Checkout API.", 500);
  }
}

/** `{ action: "revoke_key", keyId, reason }`. */
export async function POST(request: NextRequest) {
  const access = await requireAdminTool(request, "merchant-api");
  if (!access.ok) return access.response;
  const body = await readJsonRecord(request);
  if (!body) return jsonError("A valid JSON body is required.", 400);
  if (body.action !== "revoke_key") return jsonError("Unknown action.", 400);
  try {
    const { key, reason } = await adminRevokeApiKey({ keyId: body.keyId, reason: body.reason });
    await logAdminAction(access.actor, "merchant-api", "revoke-api-key", key.wallet_address, {
      keyId: key.id,
      mode: key.mode,
      name: key.name,
      prefix: key.key_prefix,
      reason,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not revoke the key.", 400);
  }
}
