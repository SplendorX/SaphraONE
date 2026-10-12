// Server-only. Account deletion: what's still open, scheduling and restoring
// a request, and the purge the cron runs once the grace period is over.
// See lib/account-deletion/rules.ts for the overview and
// packages/database/supabase/account-deletion.sql for what is kept.
import { retireUsername } from "@/lib/account-deletion/retired-usernames";
import {
  deletedUsername,
  isDeletedUsername,
  scheduledDeletionDate,
  type DeletionCheck,
  type DeletionReason,
} from "@/lib/account-deletion/rules";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const profilesTable = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";
const requestsTable = "account_deletion_requests";

export type DeletionRequestRow = {
  id: string;
  owner_wallet: string;
  status: "scheduled" | "cancelled" | "completed";
  reason: string | null;
  feedback: string | null;
  notify_email: string | null;
  requested_at: string;
  scheduled_for: string;
  purge_attempts: number;
};

const requestColumns =
  "id, owner_wallet, status, reason, feedback, notify_email, requested_at, scheduled_for, purge_attempts";

type DbError = { code?: string; message?: string } | null;

/** A table or column this deployment hasn't created yet. */
function isMissingSchema(error: DbError) {
  const code = error?.code ?? "";
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /does not exist|could not find/i.test(error?.message ?? "")
  );
}

function db() {
  return createSupabaseAdminClient();
}

/** The live request for any of `wallets`, or null. Throws when the table is missing. */
export async function findScheduledDeletion(wallets: string[]) {
  const lower = [...new Set(wallets.map((wallet) => wallet.toLowerCase()))];
  if (lower.length === 0) return null;
  const { data, error } = await db()
    .from(requestsTable)
    .select(requestColumns)
    .in("owner_wallet", lower)
    .eq("status", "scheduled")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DeletionRequestRow | null) ?? null;
}

/** Like findScheduledDeletion, but null when the feature's table isn't there. */
export async function findScheduledDeletionSafe(wallet: string) {
  try {
    return await findScheduledDeletion([wallet]);
  } catch {
    return null;
  }
}

/** The name to greet in emails. */
export async function greetingNameFor(ownerWallet: string) {
  try {
    const { data } = await db()
      .from(profilesTable)
      .select("display_name, username")
      .eq("wallet_address", ownerWallet.toLowerCase())
      .maybeSingle();
    const row = data as { display_name?: string | null; username?: string | null } | null;
    return row?.display_name?.trim().split(/\s+/)[0] || row?.username || null;
  } catch {
    return null;
  }
}

/** Rows matching a query, or 0 when the table isn't there. */
async function countOrZero(
  query: PromiseLike<{ count: number | null; error: DbError }>,
) {
  const { count, error } = await query;
  if (error) {
    if (!isMissingSchema(error)) console.warn("[account-deletion] check", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * What must be sorted out before the account can be deleted (blockers), and
 * what deleting will switch off (notices). Money held by SaphraONE's own
 * contracts or shared with other people blocks; the wallet's own balance
 * doesn't, because the wallet outlives the account.
 */
export async function deletionChecks(ownerWallet: string): Promise<DeletionCheck[]> {
  const owner = ownerWallet.toLowerCase();
  const supabase = db();
  const head = { count: "exact" as const, head: true };

  const activeCircleIds = async () => {
    const { data, error } = await supabase
      .from("circle_members")
      .select("circle_id")
      .eq("user_wallet", owner)
      .eq("status", "active");
    if (error) return 0;
    const ids = (data ?? []).map((row) => (row as { circle_id: string }).circle_id);
    if (ids.length === 0) return 0;
    return countOrZero(supabase.from("circles").select("id", head).in("id", ids).eq("status", "active"));
  };

  const [circles, pockets, schedules, agent, workspaces, autoDeposit] = await Promise.all([
    activeCircleIds(),
    countOrZero(
      supabase
        .from("savings_pockets")
        .select("id", head)
        .eq("owner_wallet", owner)
        .eq("status", "active")
        .neq("current_balance_units", "0"),
    ),
    countOrZero(
      supabase.from("recurring_schedules").select("id", head).eq("owner_wallet", owner).eq("status", "active"),
    ),
    countOrZero(
      supabase.from("agent_wallet_configs").select("owner_wallet", head).eq("owner_wallet", owner).neq("status", "revoked"),
    ),
    countOrZero(
      supabase.from("workspaces").select("id", head).eq("owner_user_wallet", owner).eq("status", "active"),
    ),
    countOrZero(
      supabase.from("earn_auto_deposit_rules").select("id", head).eq("wallet_address", owner).eq("enabled", true),
    ),
  ]);

  const checks: DeletionCheck[] = [];
  if (circles > 0) {
    checks.push({
      detail: `You're still a member of ${circles} savings Circle${circles === 1 ? "" : "s"}. Other members are counting on the pool, so leave or close ${circles === 1 ? "it" : "them"} first.`,
      href: "/circle",
      id: "circles",
      kind: "blocker",
      title: "Leave your savings Circles",
    });
  }
  if (pockets > 0) {
    checks.push({
      detail: `${pockets} Save pocket${pockets === 1 ? " still holds" : "s still hold"} money. Withdraw it to your wallet first.`,
      href: "/save",
      id: "save",
      kind: "blocker",
      title: "Empty your Save pockets",
    });
  }
  if (agent > 0) {
    checks.push({
      detail: "ALLIE's Agent Wallet will be revoked. Move any USDC in it back to your wallet first.",
      href: "/settings#agent-wallet",
      id: "agent-wallet",
      kind: "notice",
      title: "Agent Wallet will be revoked",
    });
  }
  if (schedules > 0) {
    checks.push({
      detail: `${schedules} recurring payment${schedules === 1 ? "" : "s"} will stop and won't run again.`,
      href: "/recurepay",
      id: "recurring",
      kind: "notice",
      title: "Recurring payments will stop",
    });
  }
  if (autoDeposit > 0) {
    checks.push({
      detail: "Automatic Earn deposits will stop. Money already in Earn stays in your wallet's vault position: withdraw it from Earn if you want it back in USDC.",
      href: "/earn",
      id: "earn",
      kind: "notice",
      title: "Earn auto-deposit will stop",
    });
  }
  if (workspaces > 0) {
    checks.push({
      detail: "Your business workspace will be archived. Team members lose access, and open invoices and checkout links stop accepting payments.",
      id: "workspace",
      kind: "notice",
      title: "Business workspace will close",
    });
  }
  return checks;
}

export async function scheduleDeletion(input: {
  feedback: string | null;
  notifyEmail: string | null;
  ownerWallet: string;
  reason: DeletionReason | null;
}) {
  const now = new Date();
  const { data, error } = await db()
    .from(requestsTable)
    .insert({
      feedback: input.feedback,
      notify_email: input.notifyEmail,
      owner_wallet: input.ownerWallet.toLowerCase(),
      reason: input.reason,
      requested_at: now.toISOString(),
      scheduled_for: scheduledDeletionDate(now).toISOString(),
      status: "scheduled",
    })
    .select(requestColumns)
    .single();
  if (error) {
    // The unique index: a request from another tab or device beat this one.
    if (error.code === "23505") {
      const existing = await findScheduledDeletion([input.ownerWallet]);
      if (existing) return existing;
    }
    throw new Error(error.message);
  }
  return data as DeletionRequestRow;
}

export async function cancelDeletion(requestId: string) {
  const at = new Date().toISOString();
  const { data, error } = await db()
    .from(requestsTable)
    .update({ cancelled_at: at, notify_email: null, status: "cancelled", updated_at: at })
    .eq("id", requestId)
    .eq("status", "scheduled")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

type Step = { name: string; run: () => PromiseLike<{ error: DbError }> };

/**
 * Erase one account's personal data. Every step is safe to repeat, so a run
 * that fails part-way is simply tried again the next day. Records other
 * people or the law rely on (payments, invoices, ledgers, KYB reviews, audit
 * logs, support history) are kept: they point at the wallet, which is public
 * on-chain anyway, and the profile they used to name is emptied here.
 */
export async function purgeAccount(request: DeletionRequestRow) {
  const owner = request.owner_wallet.toLowerCase();
  const supabase = db();
  const at = new Date().toISOString();

  const steps: Step[] = [
    // Sign-in and security.
    { name: "app_lock_passkeys", run: () => supabase.from("app_lock_passkeys").delete().eq("owner_wallet", owner) },
    { name: "app_locks", run: () => supabase.from("app_locks").delete().eq("owner_wallet", owner) },
    { name: "two_factor", run: () => supabase.from("two_factor").delete().eq("owner_wallet", owner) },
    { name: "tx_approvals", run: () => supabase.from("tx_approvals").delete().eq("owner_wallet", owner) },
    { name: "tx_security", run: () => supabase.from("tx_security").delete().eq("owner_wallet", owner) },
    // Contacts.
    { name: "beneficiaries", run: () => supabase.from("beneficiaries").delete().eq("owner_wallet", owner) },
    // Anything that would keep moving money.
    {
      name: "recurring_schedules",
      run: () =>
        supabase
          .from("recurring_schedules")
          .update({ autopay_enabled: false, status: "paused", updated_at: at })
          .eq("owner_wallet", owner)
          .eq("status", "active"),
    },
    {
      name: "agent_wallet_configs",
      run: () =>
        supabase
          .from("agent_wallet_configs")
          .update({ status: "revoked", updated_at: at })
          .eq("owner_wallet", owner)
          .neq("status", "revoked"),
    },
    { name: "earn_auto_deposit_rules", run: () => supabase.from("earn_auto_deposit_rules").delete().eq("wallet_address", owner) },
    {
      name: "earn_auto_save_rules",
      run: () =>
        supabase
          .from("earn_auto_save_rules")
          .update({ auto_sweep_enabled: false, enabled: false })
          .eq("owner_wallet", owner),
    },
    {
      name: "spend_save_configs",
      run: () => supabase.from("spend_save_configs").update({ enabled: false }).eq("owner_wallet", owner),
    },
    {
      name: "workspaces",
      run: () =>
        supabase
          .from("workspaces")
          .update({ status: "archived", updated_at: at })
          .eq("owner_user_wallet", owner)
          .eq("status", "active"),
    },
    // A new account on this wallet later starts as personal.
    {
      name: "profiles.account_type",
      run: () =>
        supabase
          .from(profilesTable)
          .update({ account_type: "PERSONAL", account_upgraded_at: null })
          .eq("wallet_address", owner),
    },
    // The business's public face. The row stays: invoices point at it.
    {
      name: "business_account_profiles",
      run: () =>
        supabase
          .from("business_account_profiles")
          .update({
            address_line: null,
            business_name: "Deleted business",
            business_size: null,
            category: null,
            contact_email: null,
            country: null,
            description: null,
            industry: null,
            logo_url: null,
            phone: null,
            registration_number: null,
            social_links: {},
            tax_identifier: null,
            updated_at: at,
            website: null,
          })
          .eq("wallet_address", owner),
    },
  ];

  const failures: string[] = [];
  for (const step of steps) {
    try {
      const { error } = await step.run();
      if (error && !isMissingSchema(error)) failures.push(`${step.name}: ${error.message}`);
    } catch (error) {
      failures.push(`${step.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Hold the @username before the profile lets go of it, so no one else can
  // claim it straight away. If this fails, the profile is left untouched.
  let usernameHeld = false;
  try {
    const { data, error } = await supabase
      .from(profilesTable)
      .select("username")
      .eq("wallet_address", owner)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const current = (data as { username?: string | null } | null)?.username;
    if (current && !isDeletedUsername(current)) await retireUsername(current, owner);
    usernameHeld = true;
  } catch (error) {
    failures.push(`retired_usernames: ${error instanceof Error ? error.message : String(error)}`);
  }

  // The profile last: until it's emptied, a failed run is easy to see and retry.
  const core = {
    account_type_selected: false,
    avatar_url: null,
    bio: null,
    circle_social_uuid: null,
    default_workspace_id: null,
    display_name: null,
    onboarding_completed_at: null,
    tour_completed_at: null,
    updated_at: at,
    username: deletedUsername(request.id),
  };
  const contact = { contact_email: null, country: null, phone: null };
  if (usernameHeld) {
    let profile = await supabase.from(profilesTable).update({ ...core, ...contact }).eq("wallet_address", owner);
    if (profile.error && isMissingSchema(profile.error)) {
      // A deployment without the personal-contact columns.
      profile = await supabase.from(profilesTable).update(core).eq("wallet_address", owner);
    }
    if (profile.error) failures.push(`profiles: ${profile.error.message}`);
  }

  if (failures.length > 0) {
    await supabase
      .from(requestsTable)
      .update({
        last_error: failures.join("; ").slice(0, 1000),
        purge_attempts: request.purge_attempts + 1,
        updated_at: at,
      })
      .eq("id", request.id);
    return { failures, ok: false as const };
  }

  const { error } = await supabase
    .from(requestsTable)
    .update({ completed_at: at, last_error: null, notify_email: null, status: "completed", updated_at: at })
    .eq("id", request.id)
    .eq("status", "scheduled");
  if (error) return { failures: [`request: ${error.message}`], ok: false as const };
  return { ok: true as const };
}

/** Requests whose grace period is over, oldest first. */
export async function dueDeletions(limit: number) {
  const { data, error } = await db()
    .from(requestsTable)
    .select(requestColumns)
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DeletionRequestRow[];
}
