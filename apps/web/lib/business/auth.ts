import { requireActorWallet } from "@/lib/swift-circle/auth";
import { businessErrors } from "@/lib/business/errors";
import { assertPermission } from "@/lib/business/permissions";
import { businessDb, businessTables, readBusinessDbError } from "@/lib/business/db";
import type {
  BusinessPermission,
  WorkspaceMemberRecord,
  WorkspaceRecord,
} from "@/lib/business/types";
import { isValidUuid } from "@/lib/save/validation";

export { requireActorWallet };

export async function loadWorkspace(workspaceId: string): Promise<WorkspaceRecord> {
  if (!isValidUuid(workspaceId)) {
    throw businessErrors.invalid("Invalid workspace id.");
  }

  const supabase = businessDb();
  const { data, error } = await supabase
    .from(businessTables.workspaces)
    .select("*")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(readBusinessDbError(error, "Could not load workspace."));
  }

  if (!data) {
    throw businessErrors.notFound("Workspace");
  }

  return data as WorkspaceRecord;
}

export async function loadMembership(
  workspaceId: string,
  userWallet: string,
): Promise<WorkspaceMemberRecord | null> {
  const supabase = businessDb();
  const { data, error } = await supabase
    .from(businessTables.members)
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_wallet", userWallet.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(readBusinessDbError(error, "Could not load membership."));
  }

  return (data as WorkspaceMemberRecord | null) ?? null;
}

export async function requireWorkspaceContext(input: {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  permission: BusinessPermission;
  workspaceId: string;
}) {
  const actorWallet = await requireActorWallet({
    circleSocialUuid: input.circleSocialUuid,
    ownerWallet: input.ownerWallet,
  });
  const workspace = await loadWorkspace(input.workspaceId);

  if (workspace.status !== "active") {
    throw businessErrors.forbidden("This workspace is archived.");
  }

  if (workspace.owner_user_wallet.toLowerCase() !== actorWallet.toLowerCase()) {
    throw businessErrors.forbidden("You do not have access to this workspace.");
  }

  const member = await loadMembership(workspace.id, actorWallet);
  assertPermission(member, input.permission);

  return { actorWallet, member: member!, workspace };
}

