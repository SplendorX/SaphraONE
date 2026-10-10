import { circleErrors } from "@/lib/swift-circle/errors";
import type {
  CircleMemberRecord,
  CirclePermission,
  CircleRole,
} from "@/lib/swift-circle/types";

const rolePermissions: Record<CircleRole, readonly CirclePermission[]> = {
  host: [
    "view",
    "chat",
    "pay",
    "request",
    "contribute_save",
    "contribute_earn",
    "invite",
    "remove_member",
    "promote",
    "demote",
    "edit_circle",
    "manage_policy",
    "freeze",
    "initiate_withdrawal",
    "approve_withdrawal",
    "manage_save",
    "manage_earn",
    "view_audit",
    "transfer_host",
  ],
  admin: [
    "view",
    "chat",
    "pay",
    "request",
    "contribute_save",
    "contribute_earn",
    "invite",
    "remove_member",
    "initiate_withdrawal",
    "approve_withdrawal",
    "manage_save",
    "manage_earn",
  ],
  member: [
    "view",
    "chat",
    "pay",
    "request",
    "contribute_save",
    "contribute_earn",
  ],
};

export function permissionsForRole(role: CircleRole): readonly CirclePermission[] {
  return rolePermissions[role];
}

export function hasPermission(role: CircleRole, permission: CirclePermission) {
  return rolePermissions[role].includes(permission);
}

export function assertPermission(
  member: Pick<CircleMemberRecord, "role" | "status"> | null,
  permission: CirclePermission,
) {
  if (!member || member.status !== "active") {
    throw circleErrors.forbidden("You must be an active Circle member.");
  }
  if (!hasPermission(member.role, permission)) {
    throw circleErrors.forbidden();
  }
}

export function canRemoveMember(actor: CircleRole, target: CircleRole) {
  if (target === "host") return false;
  if (actor === "host") return true;
  if (actor === "admin" && target === "member") return true;
  return false;
}

