import { requireWorkspaceContext } from "@/lib/business/auth";
import { businessDb, businessTables, readBusinessDbError } from "@/lib/business/db";
import { businessErrors } from "@/lib/business/errors";
import { parseApprovalPolicy } from "@/lib/business/policy";
import { normalizeHandle, validateBusinessUsername } from "@/lib/business/usernames";
import { oneIdLockedMessage } from "@/lib/profile-utils";
import { businessVerificationStatus, readReviewStatus } from "@/lib/business/verification";
import type {
  ApprovalTier,
  BusinessProfileRecord,
  WorkspaceSettingsRecord,
} from "@/lib/business/types";

function nowIso() {
  return new Date().toISOString();
}

function optionalText(value: unknown, max: number) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function updateBusinessProfile(input: {
  addressLine?: unknown;
  category?: unknown;
  circleSocialUuid?: unknown;
  contactEmail?: unknown;
  contactPhone?: unknown;
  country?: unknown;
  description?: unknown;
  logoUrl?: unknown;
  name?: unknown;
  ownerWallet: unknown;
  socialLinks?: unknown;
  username?: unknown;
  website?: unknown;
  workspaceId: string;
}) {
  const { workspace } = await requireWorkspaceContext({
    ...input,
    permission: "profile.edit",
  });

  if (workspace.kind !== "business") {
    throw businessErrors.invalid("Only business workspaces have a public profile.");
  }

  const supabase = businessDb();
  const workspaceUpdates: Record<string, string> = { updated_at: nowIso() };
  const name = optionalText(input.name, 80);
  if (name) workspaceUpdates.name = name;

  if (typeof input.username === "string" && input.username.trim()) {
    const error = validateBusinessUsername(input.username);
    if (error) throw businessErrors.invalid(error);
    const username = normalizeHandle(input.username);
    // A business keeps the One ID it was given; only the team changes it.
    if (workspace.username && username !== workspace.username) {
      throw businessErrors.invalid(oneIdLockedMessage);
    }
    if (username !== workspace.username) {
      const taken = await supabase
        .from(businessTables.identities)
        .select("workspace_id")
        .eq("username", username)
        .maybeSingle();
      if (taken.data && (taken.data as { workspace_id: string }).workspace_id !== workspace.id) {
        throw businessErrors.conflict("That One ID is already taken.");
      }
      workspaceUpdates.username = username;
    }
  }

  if (Object.keys(workspaceUpdates).length > 1) {
    const update = await supabase
      .from(businessTables.workspaces)
      .update(workspaceUpdates)
      .eq("id", workspace.id);
    if (update.error) {
      throw new Error(readBusinessDbError(update.error, "Could not update the business."));
    }
  }

  if (workspaceUpdates.username || workspaceUpdates.name) {
    const identityUpdate: Record<string, string> = { updated_at: nowIso() };
    if (workspaceUpdates.name) identityUpdate.display_name = workspaceUpdates.name;
    if (workspace.username) {
      if (workspaceUpdates.username && workspaceUpdates.username !== workspace.username) {
        await supabase.from(businessTables.identities).delete().eq("username", workspace.username);
        await supabase.from(businessTables.identities).insert({
          destination_wallet: workspace.payment_wallet ?? workspace.owner_user_wallet,
          display_name: workspaceUpdates.name ?? workspace.name,
          kind: "business",
          profile_wallet: workspace.owner_user_wallet,
          username: workspaceUpdates.username,
          workspace_id: workspace.id,
        });
      } else {
        await supabase
          .from(businessTables.identities)
          .update(identityUpdate)
          .eq("username", workspace.username);
      }
    }
  }

  const profileUpdates: Record<string, unknown> = { updated_at: nowIso() };
  const description = optionalText(input.description, 280);
  if (description !== undefined) profileUpdates.description = description;
  const website = optionalText(input.website, 160);
  if (website !== undefined) profileUpdates.website = website;
  const category = optionalText(input.category, 80);
  if (category !== undefined) profileUpdates.category = category;
  const country = optionalText(input.country, 80);
  if (country !== undefined) profileUpdates.country = country;
  const contactEmail = optionalText(input.contactEmail, 160);
  if (contactEmail !== undefined) profileUpdates.contact_email = contactEmail;
  const contactPhone = optionalText(input.contactPhone, 40);
  if (contactPhone !== undefined) profileUpdates.contact_phone = contactPhone;
  const addressLine = optionalText(input.addressLine, 200);
  if (addressLine !== undefined) profileUpdates.address_line = addressLine;
  const logoUrl = optionalText(input.logoUrl, 500_000);
  if (logoUrl !== undefined) profileUpdates.logo_url = logoUrl;
  if (input.socialLinks && typeof input.socialLinks === "object") {
    profileUpdates.social_links = input.socialLinks;
  }

  const currentProfile = await supabase
    .from(businessTables.profiles)
    .select("description, logo_url, website, category, contact_email, country, contact_phone")
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  // The value after this save: the update where given, else what's stored.
  const final = (key: string) => {
    const value = key in profileUpdates ? profileUpdates[key] : (currentProfile.data as Record<string, unknown> | null)?.[key];
    return typeof value === "string" ? value : null;
  };

  // The review lives on the owner's business profile (Settings → Profile).
  const ownerProfile = await supabase
    .from("business_account_profiles")
    .select("*")
    .eq("wallet_address", workspace.owner_user_wallet.toLowerCase())
    .maybeSingle();

  // Complete profile + approved review — see verification.ts.
  profileUpdates.verification_status = businessVerificationStatus(
    {
      businessName: typeof input.name === "string" && input.name.trim() ? input.name : workspace.name,
      category: final("category"),
      contactEmail: final("contact_email"),
      country: final("country"),
      description: final("description"),
      logoUrl: final("logo_url"),
      phone: final("contact_phone"),
      website: final("website"),
    },
    readReviewStatus((ownerProfile.data as { review_status?: unknown } | null)?.review_status),
  );

  const profile = await supabase
    .from(businessTables.profiles)
    .update(profileUpdates)
    .eq("workspace_id", workspace.id)
    .select("*")
    .single();

  if (profile.error) {
    throw new Error(readBusinessDbError(profile.error, "Could not update the profile."));
  }

  const refreshed = await supabase
    .from(businessTables.workspaces)
    .select("*")
    .eq("id", workspace.id)
    .single();

  return {
    profile: profile.data as BusinessProfileRecord,
    workspace: refreshed.data,
  };
}

export async function updateWorkspaceSettings(input: {
  approvalPolicy?: unknown;
  circleSocialUuid?: unknown;
  maxMembers?: unknown;
  ownerWallet: unknown;
  workspaceId: string;
}) {
  const { workspace } = await requireWorkspaceContext({
    ...input,
    permission: "settings.manage",
  });

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  if (input.approvalPolicy !== undefined) {
    updates.approval_policy = parseApprovalPolicy(input.approvalPolicy);
    const policy = updates.approval_policy as ApprovalTier[];
    updates.approval_required = policy.some((tier) => tier.required_approvals > 0);
  }
  if (typeof input.maxMembers === "number" && input.maxMembers >= 1 && input.maxMembers <= 500) {
    updates.max_members = input.maxMembers;
  }

  const supabase = businessDb();
  const mutation = await supabase
    .from(businessTables.settings)
    .update(updates)
    .eq("workspace_id", workspace.id)
    .select("*")
    .single();

  if (mutation.error) {
    throw new Error(readBusinessDbError(mutation.error, "Could not update settings."));
  }

  const row = mutation.data as Omit<WorkspaceSettingsRecord, "approval_policy"> & {
    approval_policy: unknown;
  };

  return {
    ...row,
    approval_policy: parseApprovalPolicy(row.approval_policy),
  } as WorkspaceSettingsRecord;
}
