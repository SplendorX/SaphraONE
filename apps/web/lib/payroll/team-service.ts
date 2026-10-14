import { getAddress, isAddress } from "viem";
import { normalizeUsername, validateUsername } from "@/lib/profile-utils";
import { payrollDb, payrollTables, readPayrollDbError } from "@/lib/payroll/db";
import { payrollErrors } from "@/lib/payroll/errors";
import type {
  MemberType,
  PaymentDestinationType,
  PaymentFrequency,
  TeamMemberRecord,
  TeamMemberStatus,
} from "@/lib/payroll/types";

const profilesTable = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";

async function findProfileByUsernameServer(
  username: string,
): Promise<{ username: string; wallet_address: string } | null> {
  const normalized = normalizeUsername(username);
  if (validateUsername(normalized)) {
    return null;
  }
  const supabase = payrollDb();
  const { data, error } = await supabase
    .from(profilesTable)
    .select("username, wallet_address")
    .ilike("username", normalized)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return data as { username: string; wallet_address: string };
}

export type CreateTeamMemberInput = {
  accountId: string;
  memberType: MemberType;
  fullName: string;
  email?: string | null;
  role?: string | null;
  paymentDestinationType: PaymentDestinationType;
  saphraUsername?: string | null;
  walletAddress?: string | null;
  preferredAsset?: string;
  defaultPaymentAmount?: string;
  paymentFrequency?: PaymentFrequency;
};

export type UpdateTeamMemberInput = Partial<{
  memberType: MemberType;
  fullName: string;
  email: string | null;
  role: string | null;
  paymentDestinationType: PaymentDestinationType;
  saphraUsername: string | null;
  walletAddress: string;
  preferredAsset: string;
  defaultPaymentAmount: string;
  paymentFrequency: PaymentFrequency;
}>;

export async function resolveDestination(input: {
  paymentDestinationType: PaymentDestinationType;
  saphraUsername?: string | null;
  walletAddress?: string | null;
}): Promise<{ saphraUsername: string | null; walletAddress: string }> {
  if (input.paymentDestinationType === "SWIFTPAY_USER") {
    const raw = (input.saphraUsername ?? "").trim().replace(/^@+/, "");
    if (!raw) {
      throw payrollErrors.invalidDestination("Enter a ONE ID.");
    }
    const profile = await findProfileByUsernameServer(raw);
    if (!profile || !isAddress(profile.wallet_address)) {
      throw payrollErrors.invalidDestination(`SaphraONE user @${raw} was not found.`);
    }
    return {
      saphraUsername: profile.username,
      walletAddress: getAddress(profile.wallet_address).toLowerCase(),
    };
  }

  const rawAddr = (input.walletAddress ?? "").trim();
  if (!rawAddr || !isAddress(rawAddr)) {
    throw payrollErrors.invalidDestination("Enter a valid EVM wallet address (0x…).");
  }
  return {
    saphraUsername: null,
    walletAddress: getAddress(rawAddr).toLowerCase(),
  };
}

export async function createTeamMember(input: CreateTeamMemberInput): Promise<TeamMemberRecord> {
  const name = input.fullName.trim();
  if (!name) {
    throw payrollErrors.invalidInput("Full name is required.");
  }

  const resolved = await resolveDestination({
    paymentDestinationType: input.paymentDestinationType,
    saphraUsername: input.saphraUsername,
    walletAddress: input.walletAddress,
  });

  const supabase = payrollDb();
  const payload = {
    account_id: input.accountId.toLowerCase(),
    member_type: input.memberType,
    full_name: name,
    email: input.email?.trim() || null,
    role: input.role?.trim() || null,
    payment_destination_type: input.paymentDestinationType,
    swiftpay_username: resolved.saphraUsername,
    wallet_address: resolved.walletAddress,
    preferred_asset: input.preferredAsset || "USDC",
    default_payment_amount: input.defaultPaymentAmount || "0",
    payment_frequency: input.paymentFrequency || "MONTHLY",
    status: "ACTIVE" as TeamMemberStatus,
  };

  const { data, error } = await supabase
    .from(payrollTables.teamMembers)
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(readPayrollDbError(error, "Could not create team member."));
  }

  return data as TeamMemberRecord;
}

export async function listTeamMembers(
  accountId: string,
  options?: {
    status?: TeamMemberStatus;
    includeArchived?: boolean;
    groupId?: string;
  },
): Promise<TeamMemberRecord[]> {
  const supabase = payrollDb();
  let query = supabase
    .from(payrollTables.teamMembers)
    .select("*")
    .eq("account_id", accountId.toLowerCase())
    .order("created_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  } else if (!options?.includeArchived) {
    query = query.neq("status", "ARCHIVED");
  }

  if (options?.groupId) {
    const { data: memberRows } = await supabase
      .from(payrollTables.groupMembers)
      .select("team_member_id")
      .eq("payroll_group_id", options.groupId);

    const ids = (memberRows ?? []).map((row) => row.team_member_id);
    if (ids.length === 0) return [];
    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(readPayrollDbError(error, "Could not list team members."));
  }

  return (data ?? []) as TeamMemberRecord[];
}

export async function getTeamMember(
  accountId: string,
  id: string,
): Promise<TeamMemberRecord> {
  const supabase = payrollDb();
  const { data, error } = await supabase
    .from(payrollTables.teamMembers)
    .select("*")
    .eq("account_id", accountId.toLowerCase())
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(readPayrollDbError(error, "Could not load team member."));
  }
  if (!data) {
    throw payrollErrors.teamMemberNotFound();
  }

  return data as TeamMemberRecord;
}

export async function updateTeamMember(
  accountId: string,
  id: string,
  patch: UpdateTeamMemberInput,
): Promise<TeamMemberRecord> {
  // Verify ownership first
  const existing = await getTeamMember(accountId, id);

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.fullName !== undefined) {
    const name = patch.fullName.trim();
    if (!name) throw payrollErrors.invalidInput("Full name cannot be blank.");
    updates.full_name = name;
  }
  if (patch.email !== undefined) updates.email = patch.email?.trim() || null;
  if (patch.role !== undefined) updates.role = patch.role?.trim() || null;
  if (patch.memberType !== undefined) updates.member_type = patch.memberType;
  if (patch.preferredAsset !== undefined) updates.preferred_asset = patch.preferredAsset;
  if (patch.defaultPaymentAmount !== undefined) updates.default_payment_amount = patch.defaultPaymentAmount;
  if (patch.paymentFrequency !== undefined) updates.payment_frequency = patch.paymentFrequency;

  if (
    patch.paymentDestinationType !== undefined ||
    patch.saphraUsername !== undefined ||
    patch.walletAddress !== undefined
  ) {
    const resolved = await resolveDestination({
      paymentDestinationType: patch.paymentDestinationType ?? existing.payment_destination_type,
      saphraUsername: patch.saphraUsername !== undefined ? patch.saphraUsername : existing.swiftpay_username,
      walletAddress: patch.walletAddress !== undefined ? patch.walletAddress : existing.wallet_address,
    });
    updates.payment_destination_type = patch.paymentDestinationType ?? existing.payment_destination_type;
    updates.swiftpay_username = resolved.saphraUsername;
    updates.wallet_address = resolved.walletAddress;
  }

  const supabase = payrollDb();
  const { data, error } = await supabase
    .from(payrollTables.teamMembers)
    .update(updates)
    .eq("account_id", accountId.toLowerCase())
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(readPayrollDbError(error, "Could not update team member."));
  }

  return data as TeamMemberRecord;
}

export async function pauseTeamMember(accountId: string, id: string): Promise<TeamMemberRecord> {
  const existing = await getTeamMember(accountId, id);
  if (existing.status === "ARCHIVED") {
    throw payrollErrors.invalidInput("Archived team member cannot be paused.");
  }

  const supabase = payrollDb();
  const { data, error } = await supabase
    .from(payrollTables.teamMembers)
    .update({ status: "PAUSED", updated_at: new Date().toISOString() })
    .eq("account_id", accountId.toLowerCase())
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(readPayrollDbError(error, "Could not pause team member."));
  return data as TeamMemberRecord;
}

export async function reactivateTeamMember(accountId: string, id: string): Promise<TeamMemberRecord> {
  const existing = await getTeamMember(accountId, id);
  if (existing.status === "ARCHIVED") {
    throw payrollErrors.invalidInput("Archived team member cannot be reactivated directly.");
  }

  const supabase = payrollDb();
  const { data, error } = await supabase
    .from(payrollTables.teamMembers)
    .update({ status: "ACTIVE", updated_at: new Date().toISOString() })
    .eq("account_id", accountId.toLowerCase())
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(readPayrollDbError(error, "Could not reactivate team member."));
  return data as TeamMemberRecord;
}

export async function archiveTeamMember(accountId: string, id: string): Promise<TeamMemberRecord> {
  await getTeamMember(accountId, id);

  const supabase = payrollDb();
  const { data, error } = await supabase
    .from(payrollTables.teamMembers)
    .update({
      status: "ARCHIVED",
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId.toLowerCase())
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(readPayrollDbError(error, "Could not archive team member."));
  return data as TeamMemberRecord;
}

export async function getTeamMemberPaymentHistory(
  accountId: string,
  teamMemberId: string,
) {
  await getTeamMember(accountId, teamMemberId);
  const supabase = payrollDb();

  // Find all payroll items for this team member from completed/partially completed runs
  const { data, error } = await supabase
    .from(payrollTables.items)
    .select(`
      id,
      payroll_run_id,
      recipient_name_snapshot,
      base_amount,
      adjustment_amount,
      total_amount,
      asset,
      status,
      transaction_id,
      blockchain_tx_hash,
      settled_at,
      completed_at,
      created_at,
      payroll_runs!inner(id, name, status, completed_at, account_id)
    `)
    .eq("team_member_id", teamMemberId)
    .eq("payroll_runs.account_id", accountId.toLowerCase())
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(readPayrollDbError(error, "Could not load payment history."));
  }

  return data ?? [];
}
