// Server-only. The admin team: who can open which tool (admin_members).
import { isAddress } from "viem";

import { adminMembersTable, type AdminMemberRow } from "@/lib/admin/access";
import { AdminUserError } from "@/lib/admin/users";
import { assignableTools, isAdminToolId } from "@/lib/admin/tools";
import { formatUsernameLabel, normalizeUsername } from "@/lib/profile-utils";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const profilesTable = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";

function db() {
  return createSupabaseAdminClient();
}

/**
 * A missing admin table (admin-platform.sql not run, or the API's schema
 * cache not reloaded since) gets that advice; any other database error is
 * shown as it is, so it isn't mistaken for a missing migration.
 */
export function adminTableError(error: { code?: string; message: string }) {
  const missing =
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table|does not exist/i.test(error.message);
  return missing
    ? new AdminUserError(
        "The admin tables aren't visible yet. Run packages/database/supabase/admin-platform.sql in Supabase (it ends by reloading the schema cache), then refresh.",
        409,
      )
    : new AdminUserError(`Database error: ${error.message}`, 500);
}

function tableError(error: { code?: string; message: string }) {
  return adminTableError(error);
}

/** Only tools a member can be given; owners get everything anyway. */
function cleanTools(value: unknown) {
  const allowed = new Set<string>(assignableTools.map((tool) => tool.id));
  return Array.isArray(value)
    ? [...new Set(value.filter((tool): tool is string => isAdminToolId(tool) && allowed.has(tool)))]
    : [];
}

export async function listAdminMembers() {
  const { data, error } = await db().from(adminMembersTable).select("*").order("created_at");
  if (error) throw tableError(error);
  return (data ?? []) as AdminMemberRow[];
}

/** A One ID (amara.one / @amara / amara) or a wallet, as the account it names. */
async function resolveAccount(identifier: string) {
  const value = identifier.trim();
  const query = db().from(profilesTable).select("wallet_address, username, display_name");
  const { data, error } = await (isAddress(value)
    ? query.eq("wallet_address", value.toLowerCase())
    : query.eq("username", normalizeUsername(value))
  ).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { display_name?: string | null; username?: string | null; wallet_address: string } | null;
  if (!row) throw new AdminUserError("No SaphraONE account has that One ID or wallet.", 404);
  return {
    label: row.username ? formatUsernameLabel(row.username) : row.display_name || row.wallet_address,
    wallet: row.wallet_address.toLowerCase(),
  };
}

export async function addAdminMember(input: {
  createdBy: string;
  identifier: string;
  role: unknown;
  tools: unknown;
}) {
  const account = await resolveAccount(input.identifier);
  const role = input.role === "owner" ? "owner" : "member";
  const { data, error } = await db()
    .from(adminMembersTable)
    .upsert(
      {
        created_by: input.createdBy,
        disabled: false,
        label: account.label,
        role,
        tools: role === "owner" ? [] : cleanTools(input.tools),
        updated_at: new Date().toISOString(),
        wallet_address: account.wallet,
      },
      { onConflict: "wallet_address" },
    )
    .select("*")
    .single();
  if (error) throw tableError(error);
  return data as AdminMemberRow;
}

/** The owners still able to sign in, other than `except`. */
async function otherActiveOwners(except: string) {
  const members = await listAdminMembers();
  return members.filter((m) => m.role === "owner" && !m.disabled && m.wallet_address !== except).length;
}

export async function updateAdminMember(
  wallet: string,
  changes: { disabled?: unknown; role?: unknown; tools?: unknown },
) {
  const lower = wallet.trim().toLowerCase();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (changes.role === "owner" || changes.role === "member") updates.role = changes.role;
  if (changes.tools !== undefined) updates.tools = cleanTools(changes.tools);
  if (typeof changes.disabled === "boolean") updates.disabled = changes.disabled;

  const losingOwner = updates.role === "member" || updates.disabled === true;
  if (losingOwner) {
    const { data } = await db().from(adminMembersTable).select("role").eq("wallet_address", lower).maybeSingle();
    if ((data as { role?: string } | null)?.role === "owner" && (await otherActiveOwners(lower)) === 0) {
      throw new AdminUserError("Keep at least one owner who can sign in (the owner key still works).");
    }
  }

  const { data, error } = await db()
    .from(adminMembersTable)
    .update(updates)
    .eq("wallet_address", lower)
    .select("*")
    .maybeSingle();
  if (error) throw tableError(error);
  if (!data) throw new AdminUserError("That person isn't on the team.", 404);
  return data as AdminMemberRow;
}

export async function removeAdminMember(wallet: string) {
  const lower = wallet.trim().toLowerCase();
  const { data } = await db().from(adminMembersTable).select("role").eq("wallet_address", lower).maybeSingle();
  if ((data as { role?: string } | null)?.role === "owner" && (await otherActiveOwners(lower)) === 0) {
    throw new AdminUserError("Keep at least one owner who can sign in (the owner key still works).");
  }
  const { error } = await db().from(adminMembersTable).delete().eq("wallet_address", lower);
  if (error) throw tableError(error);
}
