// Server-only. Who is using the admin platform, and what they may open.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  actorCan,
  adminTools,
  isAdminToolId,
  type AdminActor,
  type AdminToolId,
} from "@/lib/admin/tools";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { readWalletToken, sessionWallets, walletSessionCookieName } from "@/lib/wallet-session";

export const adminMembersTable = "admin_members";
export const adminAuditTable = "admin_audit_log";

export type AdminMemberRow = {
  created_at: string;
  created_by: string | null;
  disabled: boolean;
  label: string | null;
  role: "member" | "owner";
  tools: string[] | null;
  updated_at: string;
  wallet_address: string;
};

const ownerKeyActor: AdminActor = {
  id: "owner-key",
  label: "Owner key",
  role: "owner",
  tools: adminTools.map((tool) => tool.id),
  via: "key",
};

/**
 * The person behind a request: the owner key (Authorization: Bearer
 * ADMIN_SECRET), or a signed-in SaphraONE account listed in admin_members.
 * A session still waiting for its two-factor code counts as no one.
 */
export async function getAdminActor(request: Request): Promise<AdminActor | null> {
  if (isAdminAuthorized(request)) return ownerKeyActor;

  const session = readWalletToken((await cookies()).get(walletSessionCookieName)?.value, "session");
  if (!session || session.mfaPending) return null;
  const wallets = [...new Set([session.ownerWallet, ...sessionWallets(session)].map((w) => w.toLowerCase()))];

  const { data, error } = await createSupabaseAdminClient()
    .from(adminMembersTable)
    .select("*")
    .in("wallet_address", wallets)
    .eq("disabled", false);
  if (error) return null;
  const rows = (data ?? []) as AdminMemberRow[];
  const row = rows.find((item) => item.role === "owner") ?? rows[0];
  if (!row) return null;
  return {
    id: row.wallet_address,
    label: row.label || `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`,
    role: row.role === "owner" ? "owner" : "member",
    tools: (row.tools ?? []).filter(isAdminToolId),
    via: "account",
  };
}

type AdminAccess =
  | { actor: AdminActor; ok: true }
  | { ok: false; response: NextResponse };

function refuse(message: string, status: number): AdminAccess {
  return {
    ok: false,
    response: NextResponse.json({ message }, { headers: { "Cache-Control": "no-store" }, status }),
  };
}

/** For every admin API route: the actor, if they may use `tool`; else the refusal to return. */
export async function requireAdminTool(request: Request, tool: AdminToolId): Promise<AdminAccess> {
  const actor = await getAdminActor(request);
  if (!actor) return refuse("Sign in to the admin platform.", 401);
  if (!actorCan(actor, tool)) return refuse("You don't have access to this tool.", 403);
  const entry = adminTools.find((item) => item.id === tool);
  if (entry && "ownerOnly" in entry && entry.ownerOnly && actor.role !== "owner") {
    return refuse("Only an owner can use this tool.", 403);
  }
  return { actor, ok: true };
}

/** For routes that only need a yes or no: may this request use `tool`? */
export async function adminCan(request: Request, tool: AdminToolId) {
  return (await requireAdminTool(request, tool)).ok;
}

/** The actor behind an allowed request, for the audit log (null if not allowed). */
export async function adminActorFor(request: Request, tool: AdminToolId) {
  const access = await requireAdminTool(request, tool);
  return access.ok ? access.actor : null;
}

/**
 * Records a change made from the admin platform. Never blocks the change
 * itself: a log that can't be written (table not there yet) is reported in
 * the server log instead.
 */
export async function logAdminAction(
  actor: AdminActor,
  tool: AdminToolId,
  action: string,
  target: string | null,
  details: Record<string, unknown> = {},
) {
  try {
    const { error } = await createSupabaseAdminClient().from(adminAuditTable).insert({
      action,
      actor: actor.id,
      actor_label: actor.label,
      details,
      target,
      tool,
    });
    if (error) throw error;
  } catch (error) {
    console.warn(
      "[admin-audit] not recorded:",
      JSON.stringify({ action, actor: actor.id, target, tool }),
      error instanceof Error ? error.message : error,
    );
  }
}
