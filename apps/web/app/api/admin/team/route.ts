import { type NextRequest } from "next/server";

import { logAdminAction, requireAdminTool } from "@/lib/admin/access";
import {
  addAdminMember,
  listAdminMembers,
  removeAdminMember,
  updateAdminMember,
} from "@/lib/admin/team";
import { AdminUserError } from "@/lib/admin/users";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";

export const runtime = "nodejs";

function fail(error: unknown) {
  if (error instanceof AdminUserError) return jsonError(error.message, error.status);
  console.error("[admin/team]", error);
  return jsonError(error instanceof Error ? error.message : "Something went wrong.", 500);
}

export async function GET(request: NextRequest) {
  const access = await requireAdminTool(request, "team");
  if (!access.ok) return access.response;
  try {
    return jsonOk({ members: await listAdminMembers() });
  } catch (error) {
    return fail(error);
  }
}

/** Add someone: { identifier: ONE ID or wallet, role: "member" | "owner", tools: [...] } */
export async function POST(request: NextRequest) {
  const access = await requireAdminTool(request, "team");
  if (!access.ok) return access.response;
  const body = await readJsonRecord(request);
  const identifier = typeof body?.identifier === "string" ? body.identifier : "";
  if (!identifier.trim()) return jsonError("Enter their ONE ID or wallet.", 400);
  try {
    const member = await addAdminMember({
      createdBy: access.actor.id,
      identifier,
      role: body?.role,
      tools: body?.tools,
    });
    await logAdminAction(access.actor, "team", "add-member", member.wallet_address, {
      label: member.label,
      role: member.role,
      tools: member.tools,
    });
    return jsonOk({ member }, 201);
  } catch (error) {
    return fail(error);
  }
}

/** Change someone's access: { wallet, role?, tools?, disabled? } */
export async function PATCH(request: NextRequest) {
  const access = await requireAdminTool(request, "team");
  if (!access.ok) return access.response;
  const body = await readJsonRecord(request);
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  if (!wallet) return jsonError("Choose a team member.", 400);
  try {
    const member = await updateAdminMember(wallet, {
      disabled: body?.disabled,
      role: body?.role,
      tools: body?.tools,
    });
    await logAdminAction(access.actor, "team", "update-member", member.wallet_address, {
      disabled: member.disabled,
      role: member.role,
      tools: member.tools,
    });
    return jsonOk({ member });
  } catch (error) {
    return fail(error);
  }
}

/** Remove someone: { wallet } */
export async function DELETE(request: NextRequest) {
  const access = await requireAdminTool(request, "team");
  if (!access.ok) return access.response;
  const body = await readJsonRecord(request);
  const wallet = typeof body?.wallet === "string" ? body.wallet : "";
  if (!wallet) return jsonError("Choose a team member.", 400);
  try {
    await removeAdminMember(wallet);
    await logAdminAction(access.actor, "team", "remove-member", wallet.toLowerCase());
    return jsonOk({ removed: true });
  } catch (error) {
    return fail(error);
  }
}
