import { isValidUuid, normalizeImageUrl } from "@/lib/save/validation";
import { writeCircleActivity } from "@/lib/swift-circle/activity";
import { writeCircleAudit } from "@/lib/swift-circle/audit";
import {
  assertCircleActive,
  loadCircle,
  loadMembership,
  requireActiveMember,
} from "@/lib/swift-circle/auth";
import { circleDb, circleTables, readCircleDbError } from "@/lib/swift-circle/db";
import { circleErrors } from "@/lib/swift-circle/errors";
import { loadPlatformLimits } from "@/lib/swift-circle/limits";
import { emitCircleNotification, notifyMany } from "@/lib/swift-circle/notifications";
import {
  loadProfilesByWallets,
  parseInviteUsername,
  resolveProfileByUsername,
} from "@/lib/swift-circle/profiles";
import { assertPermission, canRemoveMember } from "@/lib/swift-circle/rbac";
import { consumeCircleRateLimit } from "@/lib/swift-circle/rate-limit";
import { canTransitionInvitation } from "@/lib/swift-circle/state";
import type {
  CircleInvitationRecord,
  CircleListItem,
  CircleMemberRecord,
  CircleRecord,
  CircleRole,
} from "@/lib/swift-circle/types";
import { arcTokenSymbols, type ArcTokenSymbol } from "@/lib/tokens";

function normalizeName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return null;
  return name;
}

function normalizeDescription(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > 280) return null;
  return text;
}

function normalizeCurrency(value: unknown): ArcTokenSymbol {
  if (typeof value === "string" && arcTokenSymbols.includes(value as ArcTokenSymbol)) {
    return value as ArcTokenSymbol;
  }
  return "USDC";
}

const defaultPolicyBands = [
  { min: "0", max: "500000000", approvals: 1 },
  { min: "500000000", max: "2000000000", approvals: 2 },
  { min: "2000000000", max: null, approvals: 3 },
] as const;

async function seedCircleDefaults(circleId: string) {
  const supabase = circleDb();
  const policyRows = ["save"].flatMap((product) =>
    defaultPolicyBands.map((band) => ({
      circle_id: circleId,
      product_type: product,
      minimum_amount_units: band.min,
      maximum_amount_units: band.max,
      required_approvals: band.approvals,
      eligible_roles: ["host", "admin"],
      initiator_counts_as_approval: false,
      version: 1,
      active: true,
    })),
  );
  await supabase.from(circleTables.policies).insert(policyRows);
  await supabase.from(circleTables.saveAccounts).insert({
    circle_id: circleId,
    status: "active",
    balance: "0",
    balance_units: "0",
  });
}

export async function createCircle(input: {
  actorWallet: string;
  name: unknown;
  description?: unknown;
  imageUrl?: unknown;
  currency?: unknown;
  inviteUsernames?: unknown;
  requestId?: string;
}) {
  await consumeCircleRateLimit({ bucket: "MEMBERSHIP", wallet: input.actorWallet });
  const name = normalizeName(input.name);
  if (!name) {
    throw circleErrors.invalid("Circle name must be 1–80 characters.");
  }
  const limits = await loadPlatformLimits();
  const supabase = circleDb();
  const { count, error: countError } = await supabase
    .from(circleTables.members)
    .select("id", { count: "exact" })
    .eq("user_wallet", input.actorWallet)
    .eq("status", "active")
    .limit(0);
  if (countError) {
    throw new Error(readCircleDbError(countError, "Could not count Circles."));
  }
  if ((count ?? 0) >= limits.max_circles_per_user) {
    throw circleErrors.invalid("You have reached the Circle limit for this account.");
  }

  const { data, error } = await supabase
    .from(circleTables.circles)
    .insert({
      name,
      description: normalizeDescription(input.description),
      image_url: normalizeImageUrl(input.imageUrl),
      creator_user_wallet: input.actorWallet,
      host_user_wallet: input.actorWallet,
      currency: normalizeCurrency(input.currency),
      visibility: "private",
      status: "active",
      financial_frozen: false,
    })
    .select("*")
    .single();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not create Circle."));
  }
  const circle = data as CircleRecord;

  const { error: memberError } = await supabase.from(circleTables.members).insert({
    circle_id: circle.id,
    user_wallet: input.actorWallet,
    role: "host",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  if (memberError) {
    throw new Error(readCircleDbError(memberError, "Could not add host membership."));
  }

  await seedCircleDefaults(circle.id);
  await writeCircleAudit({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    action: "CIRCLE_CREATED",
    entityType: "circle",
    entityId: circle.id,
    requestId: input.requestId,
    metadata: { name },
  });
  await writeCircleActivity({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    activityType: "circle.created",
    entityType: "circle",
    entityId: circle.id,
    summary: `${name} was created`,
  });

  const usernames = Array.isArray(input.inviteUsernames)
    ? input.inviteUsernames
    : [];
  const invitations = [];
  for (const raw of usernames) {
    try {
      invitations.push(
        await inviteMember({
          actorWallet: input.actorWallet,
          circleId: circle.id,
          username: raw,
          requestId: input.requestId,
        }),
      );
    } catch {
      // skip invalid initial invites; Circle still exists
    }
  }

  return { circle, invitations };
}

export async function listCirclesForUser(actorWallet: string) {
  const supabase = circleDb();
  const { data: memberships, error } = await supabase
    .from(circleTables.members)
    .select("*")
    .eq("user_wallet", actorWallet)
    .eq("status", "active");
  if (error) {
    throw new Error(readCircleDbError(error, "Could not list Circles."));
  }
  const rows = (memberships ?? []) as CircleMemberRecord[];
  if (rows.length === 0) return [] as CircleListItem[];

  const ids = rows.map((row) => row.circle_id);
  const { data: circles, error: circleError } = await supabase
    .from(circleTables.circles)
    .select("*")
    .in("id", ids)
    .order("updated_at", { ascending: false });
  if (circleError) {
    throw new Error(readCircleDbError(circleError, "Could not list Circles."));
  }

  const { data: saves } = await supabase
    .from(circleTables.saveAccounts)
    .select("circle_id,balance")
    .in("circle_id", ids);
  const { data: memberCounts } = await supabase
    .from(circleTables.members)
    .select("circle_id")
    .in("circle_id", ids)
    .eq("status", "active");
  const { data: pendingRequests } = await supabase
    .from(circleTables.requests)
    .select("circle_id")
    .in("circle_id", ids)
    .eq("status", "pending")
    .eq("target_user_wallet", actorWallet);
  const { data: pendingApprovals } = await supabase
    .from(circleTables.withdrawals)
    .select("circle_id")
    .in("circle_id", ids)
    .eq("status", "pending_approval");
  const { data: reads } = await supabase
    .from(circleTables.messageReads)
    .select("circle_id,last_read_at")
    .in("circle_id", ids)
    .eq("user_wallet", actorWallet);

  const saveMap = new Map((saves ?? []).map((row) => [row.circle_id, row.balance]));
  const countMap = new Map<string, number>();
  for (const row of memberCounts ?? []) {
    countMap.set(row.circle_id, (countMap.get(row.circle_id) ?? 0) + 1);
  }
  const requestMap = new Map<string, number>();
  for (const row of pendingRequests ?? []) {
    requestMap.set(row.circle_id, (requestMap.get(row.circle_id) ?? 0) + 1);
  }
  const approvalMap = new Map<string, number>();
  for (const row of pendingApprovals ?? []) {
    approvalMap.set(row.circle_id, (approvalMap.get(row.circle_id) ?? 0) + 1);
  }
  const readMap = new Map(
    (reads ?? []).map((row) => [row.circle_id, row.last_read_at as string]),
  );
  const roleMap = new Map(rows.map((row) => [row.circle_id, row.role]));

  const { data: recentMessages } = await supabase
    .from(circleTables.messages)
    .select("circle_id,created_at")
    .in("circle_id", ids)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  const unreadMap = new Map<string, number>();
  for (const row of recentMessages ?? []) {
    const circleId = String(row.circle_id);
    const since = readMap.get(circleId);
    if (since && String(row.created_at) <= since) continue;
    unreadMap.set(circleId, (unreadMap.get(circleId) ?? 0) + 1);
  }

  return ((circles ?? []) as CircleRecord[]).map((circle) => ({
    ...circle,
    member_count: countMap.get(circle.id) ?? 0,
    unread_count: unreadMap.get(circle.id) ?? 0,
    pending_requests: requestMap.get(circle.id) ?? 0,
    pending_approvals: approvalMap.get(circle.id) ?? 0,
    save_balance: String(saveMap.get(circle.id) ?? "0"),
    earn_value: "0",
    role: roleMap.get(circle.id) ?? "member",
  })) satisfies CircleListItem[];
}

export async function getCircleDetail(circleId: string, actorWallet: string) {
  const circle = await loadCircle(circleId);
  const member = await requireActiveMember(circleId, actorWallet);
  const members = await listMembers(circleId);
  const supabase = circleDb();
  const { data: save } = await supabase
    .from(circleTables.saveAccounts)
    .select("*")
    .eq("circle_id", circleId)
    .maybeSingle();
  const limits = await loadPlatformLimits();
  const activeCount = members.filter((row) => row.status === "active").length;
  return { circle, member, members, save, earn: null, limits, activeCount };
}

export async function updateCircle(input: {
  actorWallet: string;
  circleId: string;
  name?: unknown;
  description?: unknown;
  imageUrl?: unknown;
  requestId?: string;
}) {
  const circle = await loadCircle(input.circleId);
  assertCircleActive(circle);
  const member = await requireActiveMember(input.circleId, input.actorWallet);
  assertPermission(member, "edit_circle");

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    version: circle.version + 1,
  };
  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    if (!name) throw circleErrors.invalid("Circle name must be 1–80 characters.");
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description = normalizeDescription(input.description);
  }
  if (input.imageUrl !== undefined) {
    patch.image_url = normalizeImageUrl(input.imageUrl);
  }

  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.circles)
    .update(patch)
    .eq("id", circle.id)
    .eq("version", circle.version)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not update Circle."));
  }
  if (!data) {
    throw circleErrors.conflict("Circle was updated by someone else. Refresh and try again.");
  }
  await writeCircleAudit({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    action: "CIRCLE_UPDATED",
    entityType: "circle",
    entityId: circle.id,
    requestId: input.requestId,
    metadata: patch,
  });
  return data as CircleRecord;
}

export async function setCircleFrozen(input: {
  actorWallet: string;
  circleId: string;
  frozen: boolean;
  requestId?: string;
}) {
  const circle = await loadCircle(input.circleId);
  const member = await requireActiveMember(input.circleId, input.actorWallet);
  assertPermission(member, "freeze");
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.circles)
    .update({
      financial_frozen: input.frozen,
      updated_at: new Date().toISOString(),
      version: circle.version + 1,
    })
    .eq("id", circle.id)
    .eq("version", circle.version)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not update freeze state."));
  }
  if (!data) {
    throw circleErrors.conflict("Circle was updated by someone else. Refresh and try again.");
  }
  const action = input.frozen ? "CIRCLE_FROZEN" : "CIRCLE_UNFROZEN";
  await writeCircleAudit({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    action,
    entityType: "circle",
    entityId: circle.id,
    requestId: input.requestId,
  });
  await writeCircleActivity({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    activityType: input.frozen ? "circle.frozen" : "circle.unfrozen",
    summary: input.frozen
      ? "Financial operations were frozen"
      : "Financial operations were unfrozen",
  });
  const members = await listActiveMemberWallets(circle.id);
  await notifyMany(members, {
    eventId: `circle-freeze:${circle.id}:${circle.version + 1}:${input.frozen}`,
    circleId: circle.id,
    kind: "circle_frozen",
    title: input.frozen ? "Circle frozen" : "Circle unfrozen",
    body: input.frozen
      ? "The host froze financial operations for this Circle."
      : "The host unfroze financial operations for this Circle.",
  });
  return data as CircleRecord;
}

export async function listMembers(circleId: string) {
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.members)
    .select("*")
    .eq("circle_id", circleId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(readCircleDbError(error, "Could not list members."));
  }
  const rows = (data ?? []) as CircleMemberRecord[];
  const profiles = await loadProfilesByWallets(rows.map((row) => row.user_wallet));
  return rows.map((row) => {
    const profile = profiles.get(row.user_wallet.toLowerCase());
    return {
      ...row,
      username: profile?.username ?? null,
      display_name: profile?.display_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
    };
  });
}

export async function listActiveMembers(circleId: string) {
  const members = await listMembers(circleId);
  return members.filter((member) => member.status === "active");
}

export async function listActiveMemberWallets(circleId: string) {
  const members = await listActiveMembers(circleId);
  return members.map((member) => member.user_wallet.toLowerCase());
}

type JoinRpcResult = {
  ok?: boolean;
  already_member?: boolean;
  member_count?: number;
  code?: string;
};

export async function joinCircleAtomically(input: {
  circleId: string;
  userWallet: string;
}) {
  const limits = await loadPlatformLimits();
  const maxMembers = limits.max_members;
  const supabase = circleDb();
  const { data, error } = await supabase.rpc("swift_circle_try_join", {
    p_circle_id: input.circleId,
    p_user_wallet: input.userWallet,
    p_max_members: maxMembers,
  });

  if (!error && data) {
    const result = (
      typeof data === "string" ? JSON.parse(data) : data
    ) as JoinRpcResult;
    if (result.ok) return result;
    if (result.code === "MEMBER_LIMIT") {
      throw circleErrors.memberLimit(maxMembers);
    }
    if (result.code === "NOT_FOUND") {
      throw circleErrors.notFound("Circle");
    }
  }

  return joinCircleWithVersionLock({
    circleId: input.circleId,
    userWallet: input.userWallet,
    maxMembers,
  });
}

async function joinCircleWithVersionLock(input: {
  circleId: string;
  userWallet: string;
  maxMembers: number;
}) {
  const supabase = circleDb();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const circle = await loadCircle(input.circleId);
    const { data: locked } = await supabase
      .from(circleTables.circles)
      .update({
        version: circle.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.circleId)
      .eq("version", circle.version)
      .select("id")
      .maybeSingle();
    if (!locked) {
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      continue;
    }

    const existing = await loadMembership(input.circleId, input.userWallet);
    if (existing?.status === "active") {
      return { ok: true, already_member: true };
    }

    const { count } = await supabase
      .from(circleTables.members)
      .select("id", { count: "exact" })
      .eq("circle_id", input.circleId)
      .eq("status", "active")
      .limit(0);
    if ((count ?? 0) >= input.maxMembers) {
      throw circleErrors.memberLimit(input.maxMembers);
    }

    if (existing) {
      const { error } = await supabase
        .from(circleTables.members)
        .update({
          status: "active",
          role: existing.role === "host" ? "member" : existing.role,
          joined_at: new Date().toISOString(),
          left_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) {
        throw new Error(readCircleDbError(error, "Could not join Circle."));
      }
    } else {
      const { error } = await supabase.from(circleTables.members).insert({
        circle_id: input.circleId,
        user_wallet: input.userWallet,
        role: "member",
        status: "active",
        joined_at: new Date().toISOString(),
      });
      if (error) {
        throw new Error(readCircleDbError(error, "Could not join Circle."));
      }
    }
    return { ok: true, already_member: false };
  }

  throw circleErrors.conflict("Circle is busy. Try accepting again.");
}

export async function inviteMember(input: {
  actorWallet: string;
  circleId: string;
  username: unknown;
  requestId?: string;
}) {
  await consumeCircleRateLimit({ bucket: "MEMBERSHIP", wallet: input.actorWallet });
  const circle = await loadCircle(input.circleId);
  assertCircleActive(circle);
  const actor = await requireActiveMember(input.circleId, input.actorWallet);
  assertPermission(actor, "invite");

  const username = parseInviteUsername(input.username);
  if (!username) {
    throw circleErrors.invalid("Invite using a valid ONE ID, like @alice.");
  }
  const profile = await resolveProfileByUsername(username);
  if (profile.wallet_address === input.actorWallet) {
    throw circleErrors.invalid("You cannot invite yourself.");
  }

  const existing = await loadMembership(circle.id, profile.wallet_address);
  if (existing?.status === "active") {
    throw circleErrors.conflict("That user is already a member of this Circle.");
  }

  const limits = await loadPlatformLimits();
  const supabase = circleDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: invitedToday } = await supabase
    .from(circleTables.invitations)
    .select("id", { count: "exact" })
    .eq("inviter_user_wallet", input.actorWallet)
    .gte("created_at", since)
    .limit(0);
  if ((invitedToday ?? 0) >= limits.max_invitations_per_day) {
    throw circleErrors.invalid("Daily invitation limit reached.");
  }

  const expires = new Date(
    Date.now() + limits.invitation_ttl_hours * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from(circleTables.invitations)
    .insert({
      circle_id: circle.id,
      inviter_user_wallet: input.actorWallet,
      invitee_user_wallet: profile.wallet_address,
      invitee_username: profile.username,
      status: "pending",
      expires_at: expires,
    })
    .select("*")
    .single();

  if (error) {
    if ((error.message ?? "").toLowerCase().includes("duplicate")) {
      throw circleErrors.conflict("A pending invitation already exists for that user.");
    }
    throw new Error(readCircleDbError(error, "Could not create invitation."));
  }

  const invitation = data as CircleInvitationRecord;
  await writeCircleAudit({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    action: "MEMBER_INVITED",
    entityType: "invitation",
    entityId: invitation.id,
    requestId: input.requestId,
    metadata: { invitee: profile.username },
  });
  await writeCircleActivity({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    activityType: "member.invited",
    entityType: "invitation",
    entityId: invitation.id,
    summary: `${profile.username}.one was invited`,
  });
  await emitCircleNotification({
    eventId: `circle-invite:${invitation.id}`,
    circleId: circle.id,
    ownerWallet: profile.wallet_address,
    kind: "circle_invitation",
    title: `Join ${circle.name}`,
    body: `You were invited to the Circle “${circle.name}”. Open Circle to accept or decline.\nINVITATION_ID:${invitation.id}`,
    metadata: { invitationId: invitation.id },
  });
  return invitation;
}

export async function listCircleInvitations(circleId: string) {
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.invitations)
    .select("*")
    .eq("circle_id", circleId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(readCircleDbError(error, "Could not list invitations."));
  }
  return (data ?? []) as CircleInvitationRecord[];
}

export async function listInboxInvitations(actorWallet: string) {
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.invitations)
    .select("*")
    .eq("invitee_user_wallet", actorWallet)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load invitations."));
  }
  const rows = (data ?? []) as CircleInvitationRecord[];
  const now = Date.now();
  const live: CircleInvitationRecord[] = [];
  const profiles = await loadProfilesByWallets(
    rows.map((row) => row.inviter_user_wallet),
  );
  for (const row of rows) {
    if (Date.parse(row.expires_at) <= now) {
      await expireInvitation(row);
      continue;
    }
    const circle = await loadCircle(row.circle_id).catch(() => null);
    const inviter = profiles.get(row.inviter_user_wallet.toLowerCase());
    live.push({
      ...row,
      circle_name: circle?.name,
      inviter_username: inviter?.username ?? null,
    });
  }
  return live;
}

async function expireInvitation(row: CircleInvitationRecord) {
  if (!canTransitionInvitation(row.status, "expired")) return;
  const supabase = circleDb();
  await supabase
    .from(circleTables.invitations)
    .update({ status: "expired", responded_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending");
}

export async function respondToInvitation(input: {
  actorWallet: string;
  invitationId: string;
  decision: "accepted" | "declined";
  requestId?: string;
}) {
  if (!isValidUuid(input.invitationId)) {
    throw circleErrors.invalid("Invalid invitation id.");
  }
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.invitations)
    .select("*")
    .eq("id", input.invitationId)
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load invitation."));
  }
  if (!data) throw circleErrors.notFound("Invitation");
  const invitation = data as CircleInvitationRecord;
  if (invitation.invitee_user_wallet.toLowerCase() !== input.actorWallet) {
    throw circleErrors.forbidden();
  }
  if (invitation.status !== "pending") {
    throw circleErrors.conflict("This invitation is no longer pending.");
  }
  if (Date.parse(invitation.expires_at) <= Date.now()) {
    await expireInvitation(invitation);
    throw circleErrors.conflict("This invitation has expired.");
  }
  if (!canTransitionInvitation("pending", input.decision)) {
    throw circleErrors.conflict("Invalid invitation state.");
  }

  const circle = await loadCircle(invitation.circle_id);
  assertCircleActive(circle);

  if (input.decision === "accepted") {
    await joinCircleAtomically({
      circleId: circle.id,
      userWallet: input.actorWallet,
    });
  }

  const { data: updated, error: updateError } = await supabase
    .from(circleTables.invitations)
    .update({
      status: input.decision,
      responded_at: new Date().toISOString(),
    })
    .eq("id", invitation.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (updateError) {
    throw new Error(readCircleDbError(updateError, "Could not respond to invitation."));
  }
  if (!updated) {
    throw circleErrors.conflict("This invitation was already processed.");
  }

  if (input.decision === "accepted") {
    await insertSystemMessage(circle.id, `${invitation.invitee_username ?? "A member"} joined the Circle`);
    await writeCircleAudit({
      circleId: circle.id,
      actorWallet: input.actorWallet,
      action: "MEMBER_JOINED",
      entityType: "member",
      entityId: input.actorWallet,
      requestId: input.requestId,
    });
    await writeCircleActivity({
      circleId: circle.id,
      actorWallet: input.actorWallet,
      activityType: "member.joined",
      summary: `${invitation.invitee_username ?? "A member"} joined`,
    });
    await emitCircleNotification({
      eventId: `circle-invite-accepted:${invitation.id}`,
      circleId: circle.id,
      ownerWallet: invitation.inviter_user_wallet,
      kind: "circle_invitation_accepted",
      title: "Invitation accepted",
      body: `${invitation.invitee_username ? `${invitation.invitee_username}.one` : "A new member"} joined ${circle.name}.`,
    });
  } else {
    await writeCircleAudit({
      circleId: circle.id,
      actorWallet: input.actorWallet,
      action: "MEMBER_INVITED",
      entityType: "invitation",
      entityId: invitation.id,
      requestId: input.requestId,
      metadata: { decision: "declined" },
    });
    await emitCircleNotification({
      eventId: `circle-invite-declined:${invitation.id}`,
      circleId: circle.id,
      ownerWallet: invitation.inviter_user_wallet,
      kind: "circle_invitation_declined",
      title: "Invitation declined",
      body: `${invitation.invitee_username ? `${invitation.invitee_username}.one` : "An invited member"} declined to join ${circle.name}.`,
    });
  }

  return updated as CircleInvitationRecord;
}

export async function cancelInvitation(input: {
  actorWallet: string;
  circleId: string;
  invitationId: string;
}) {
  const member = await requireActiveMember(input.circleId, input.actorWallet);
  assertPermission(member, "invite");
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.invitations)
    .update({
      status: "cancelled",
      responded_at: new Date().toISOString(),
    })
    .eq("id", input.invitationId)
    .eq("circle_id", input.circleId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not cancel invitation."));
  }
  if (!data) throw circleErrors.notFound("Invitation");
  return data as CircleInvitationRecord;
}

export async function insertSystemMessage(circleId: string, content: string) {
  const supabase = circleDb();
  await supabase.from(circleTables.messages).insert({
    circle_id: circleId,
    sender_user_wallet: null,
    message_type: "system",
    content,
    delivery_state: "delivered",
  });
}

export async function changeMemberRole(input: {
  actorWallet: string;
  circleId: string;
  targetWallet: string;
  action: "promote" | "demote" | "remove";
  requestId?: string;
}) {
  await consumeCircleRateLimit({ bucket: "MEMBERSHIP", wallet: input.actorWallet });
  const circle = await loadCircle(input.circleId);
  assertCircleActive(circle);
  const actor = await requireActiveMember(input.circleId, input.actorWallet);
  const target = await loadMembership(input.circleId, input.targetWallet);
  if (!target || target.status !== "active") {
    throw circleErrors.notFound("Member");
  }
  if (target.user_wallet === input.actorWallet && input.action !== "remove") {
    throw circleErrors.invalid("Use the host transfer flow to change your own role.");
  }

  const supabase = circleDb();
  if (input.action === "remove") {
    assertPermission(actor, "remove_member");
    if (!canRemoveMember(actor.role, target.role)) {
      throw circleErrors.forbidden("You cannot remove this member.");
    }
    if (target.role === "host") {
      throw circleErrors.forbidden("Transfer host ownership before leaving as host.");
    }
    await invalidateApproverProposals(circle.id, target.user_wallet);
    const { data, error } = await supabase
      .from(circleTables.members)
      .update({
        status: actor.user_wallet === target.user_wallet ? "left" : "removed",
        left_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", target.id)
      .eq("status", "active")
      .select("*")
      .maybeSingle();
    if (error) {
      throw new Error(readCircleDbError(error, "Could not remove member."));
    }
    const verb = actor.user_wallet === target.user_wallet ? "left" : "was removed from";
    await insertSystemMessage(circle.id, `A member ${verb} the Circle`);
    await writeCircleAudit({
      circleId: circle.id,
      actorWallet: input.actorWallet,
      action: actor.user_wallet === target.user_wallet ? "MEMBER_LEFT" : "MEMBER_REMOVED",
      entityType: "member",
      entityId: target.user_wallet,
      requestId: input.requestId,
    });
    await writeCircleActivity({
      circleId: circle.id,
      actorWallet: input.actorWallet,
      activityType:
        actor.user_wallet === target.user_wallet ? "member.left" : "member.removed",
      summary:
        actor.user_wallet === target.user_wallet
          ? "A member left"
          : "A member was removed",
    });
    return data;
  }

  if (input.action === "promote") {
    assertPermission(actor, "promote");
    if (target.role !== "member") {
      throw circleErrors.invalid("Only members can be promoted to admin.");
    }
    const { data, error } = await supabase
      .from(circleTables.members)
      .update({ role: "admin", updated_at: new Date().toISOString() })
      .eq("id", target.id)
      .eq("role", "member")
      .select("*")
      .maybeSingle();
    if (error) {
      throw new Error(readCircleDbError(error, "Could not promote member."));
    }
    await afterRoleChange({
      actorWallet: input.actorWallet,
      circle,
      targetWallet: target.user_wallet,
      oldRole: "member",
      newRole: "admin",
      requestId: input.requestId,
    });
    return data;
  }

  assertPermission(actor, "demote");
  if (target.role !== "admin") {
    throw circleErrors.invalid("Only admins can be demoted to member.");
  }
  await invalidateApproverProposals(circle.id, target.user_wallet);
  const { data, error } = await supabase
    .from(circleTables.members)
    .update({ role: "member", updated_at: new Date().toISOString() })
    .eq("id", target.id)
    .eq("role", "admin")
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not demote admin."));
  }
  await afterRoleChange({
    actorWallet: input.actorWallet,
    circle,
    targetWallet: target.user_wallet,
    oldRole: "admin",
    newRole: "member",
    requestId: input.requestId,
  });
  return data;
}

async function afterRoleChange(input: {
  actorWallet: string;
  circle: CircleRecord;
  targetWallet: string;
  oldRole: CircleRole;
  newRole: CircleRole;
  requestId?: string;
}) {
  await writeCircleAudit({
    circleId: input.circle.id,
    actorWallet: input.actorWallet,
    action: "ROLE_CHANGED",
    entityType: "member",
    entityId: input.targetWallet,
    requestId: input.requestId,
    metadata: { oldRole: input.oldRole, newRole: input.newRole },
  });
  await writeCircleActivity({
    circleId: input.circle.id,
    actorWallet: input.actorWallet,
    activityType: "role.changed",
    summary: `Role changed from ${input.oldRole} to ${input.newRole}`,
    metadata: { target: input.targetWallet },
  });
  await emitCircleNotification({
    eventId: `circle-role:${input.circle.id}:${input.targetWallet}:${input.newRole}:${Date.now()}`,
    circleId: input.circle.id,
    ownerWallet: input.targetWallet,
    kind: "circle_role",
    title: "Role updated",
    body: `Your role in ${input.circle.name} is now ${input.newRole}.`,
  });
}

export async function transferHost(input: {
  actorWallet: string;
  circleId: string;
  newHostWallet: string;
  confirm: unknown;
  requestId?: string;
}) {
  if (input.confirm !== true && input.confirm !== "confirm") {
    throw circleErrors.invalid("Host transfer requires explicit confirmation.");
  }
  const circle = await loadCircle(input.circleId);
  assertCircleActive(circle);
  const actor = await requireActiveMember(input.circleId, input.actorWallet);
  assertPermission(actor, "transfer_host");
  if (actor.role !== "host" || circle.host_user_wallet !== input.actorWallet) {
    throw circleErrors.forbidden("Only the current host can transfer ownership.");
  }
  const next = await loadMembership(input.circleId, input.newHostWallet);
  if (!next || next.status !== "active") {
    throw circleErrors.invalid("The new host must be an existing Circle member.");
  }
  if (next.user_wallet === input.actorWallet) {
    throw circleErrors.invalid("Choose a different member as the new host.");
  }

  const supabase = circleDb();
  const { data: updatedCircle, error } = await supabase
    .from(circleTables.circles)
    .update({
      host_user_wallet: next.user_wallet,
      updated_at: new Date().toISOString(),
      version: circle.version + 1,
    })
    .eq("id", circle.id)
    .eq("version", circle.version)
    .eq("host_user_wallet", input.actorWallet)
    .select("*")
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not transfer host."));
  }
  if (!updatedCircle) {
    throw circleErrors.conflict("Host was already transferred.");
  }
  await supabase
    .from(circleTables.members)
    .update({ role: "admin", updated_at: new Date().toISOString() })
    .eq("id", actor.id);
  await supabase
    .from(circleTables.members)
    .update({ role: "host", updated_at: new Date().toISOString() })
    .eq("id", next.id);

  await insertSystemMessage(circle.id, "Host ownership was transferred");
  await writeCircleAudit({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    action: "HOST_TRANSFERRED",
    entityType: "circle",
    entityId: circle.id,
    requestId: input.requestId,
    metadata: { from: input.actorWallet, to: next.user_wallet },
  });
  await writeCircleActivity({
    circleId: circle.id,
    actorWallet: input.actorWallet,
    activityType: "host.transferred",
    summary: "Host ownership was transferred",
  });
  await emitCircleNotification({
    eventId: `circle-host:${circle.id}:${next.user_wallet}:${circle.version + 1}`,
    circleId: circle.id,
    ownerWallet: next.user_wallet,
    kind: "circle_role",
    title: "You are now the host",
    body: `You are the new host of ${circle.name}.`,
  });
  return updatedCircle as CircleRecord;
}

export async function invalidateApproverProposals(
  circleId: string,
  wallet: string,
) {
  const supabase = circleDb();
  const member = await loadMembership(circleId, wallet);
  const wasApprover = member?.role === "host" || member?.role === "admin";
  if (wasApprover) {
    await supabase
      .from(circleTables.withdrawals)
      .update({
        status: "expired",
        failure_reason: "Approver membership or role changed.",
        updated_at: new Date().toISOString(),
      })
      .eq("circle_id", circleId)
      .in("status", ["pending_policy", "pending_approval", "approved"]);
  }

  await supabase
    .from(circleTables.requests)
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("circle_id", circleId)
    .eq("target_user_wallet", wallet)
    .eq("status", "pending");
}

export async function leaveCircle(input: {
  actorWallet: string;
  circleId: string;
  requestId?: string;
}) {
  return changeMemberRole({
    ...input,
    targetWallet: input.actorWallet,
    action: "remove",
  });
}
