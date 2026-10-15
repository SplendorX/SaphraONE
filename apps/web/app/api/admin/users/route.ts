import { type NextRequest } from "next/server";

import { logAdminAction, requireAdminTool } from "@/lib/admin/access";
import {
  AdminUserError,
  changeAccountEmail,
  changeOneId,
  loadAdminUser,
  searchAdminUsers,
} from "@/lib/admin/users";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";

export const runtime = "nodejs";

function fail(error: unknown, fallback: string) {
  if (error instanceof AdminUserError) return jsonError(error.message, error.status);
  console.error("[admin/users]", error);
  return jsonError(error instanceof Error ? error.message : fallback, 500);
}

/** ?wallet=0x… for one account; ?q= to search by ONE ID, name, email or wallet. */
export async function GET(request: NextRequest) {
  const access = await requireAdminTool(request, "users");
  if (!access.ok) return access.response;
  const wallet = request.nextUrl.searchParams.get("wallet");
  try {
    if (wallet) return jsonOk({ user: await loadAdminUser(wallet) });
    return jsonOk({ users: await searchAdminUsers(request.nextUrl.searchParams.get("q") ?? "") });
  } catch (error) {
    return fail(error, "Couldn't load accounts.");
  }
}

/**
 * The changes only the team makes, each with the reason it was asked for:
 * { action: "change-one-id", wallet, oneId, reason }
 * { action: "change-email", wallet, email, reason }
 */
export async function POST(request: NextRequest) {
  const access = await requireAdminTool(request, "users");
  if (!access.ok) return access.response;
  const body = await readJsonRecord(request);
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!wallet) return jsonError("Choose an account.", 400);
  if (reason.length < 4) return jsonError("Say why (for example, the support request it came from).", 400);

  try {
    if (body?.action === "change-one-id") {
      const result = await changeOneId(wallet, typeof body.oneId === "string" ? body.oneId : "");
      await logAdminAction(access.actor, "users", "change-one-id", wallet.toLowerCase(), { ...result, reason });
      return jsonOk({ result, user: await loadAdminUser(wallet) });
    }
    if (body?.action === "change-email") {
      const result = await changeAccountEmail(wallet, typeof body.email === "string" ? body.email : "");
      await logAdminAction(access.actor, "users", "change-email", wallet.toLowerCase(), { ...result, reason });
      return jsonOk({ result, user: await loadAdminUser(wallet) });
    }
    return jsonError("Unknown action.", 400);
  } catch (error) {
    return fail(error, "The change couldn't be made.");
  }
}
