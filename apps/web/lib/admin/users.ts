// Server-only. The admin platform's Users tool: find any account, see it whole,
// and make the two changes only the team may make (ONE ID, account email).
import { isAddress } from "viem";

import { retireUsername } from "@/lib/account-deletion/retired-usernames";
import { checkUsernameAvailability } from "@/lib/account/username-availability";
import { findAppLock } from "@/lib/app-lock/server";
import { businessTables } from "@/lib/business/db";
import { formatUsernameLabel, normalizeUsername } from "@/lib/profile-utils";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { findTwoFactor } from "@/lib/two-factor/server";

const profilesTable = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";
const businessProfilesTable = "business_account_profiles";
const ledgerTable = process.env.SUPABASE_TRANSACTION_LEDGER_TABLE ?? "transaction_ledger";

export class AdminUserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export type AdminUserRow = {
  accountType: string | null;
  contactEmail: string | null;
  createdAt: string | null;
  displayName: string | null;
  oneId: string | null;
  onboarded: boolean;
  wallet: string;
};

type ProfileRecord = Record<string, unknown> & { wallet_address: string };

const baseColumns =
  "wallet_address, username, display_name, avatar_url, account_type, account_type_selected, auth_provider, created_at, updated_at, country, locale";

/** Profiles, with the private contact columns when that migration has been run. */
async function selectProfiles(apply: (query: ReturnType<typeof profileQuery>) => ReturnType<typeof profileQuery>) {
  const withContact = await apply(profileQuery(`${baseColumns}, contact_email, phone`));
  if (!withContact.error) return (withContact.data ?? []) as unknown as ProfileRecord[];
  const plain = await apply(profileQuery(baseColumns));
  if (plain.error) throw new Error(plain.error.message);
  return (plain.data ?? []) as unknown as ProfileRecord[];
}

function profileQuery(columns: string) {
  return createSupabaseAdminClient().from(profilesTable).select(columns);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toRow(profile: ProfileRecord): AdminUserRow {
  return {
    accountType: text(profile.account_type),
    contactEmail: text(profile.contact_email),
    createdAt: text(profile.created_at),
    displayName: text(profile.display_name),
    oneId: text(profile.username) ? formatUsernameLabel(String(profile.username)) : null,
    onboarded: Boolean(profile.account_type_selected),
    wallet: profile.wallet_address,
  };
}

/** Accounts matching a ONE ID, name, email or wallet (newest first). */
export async function searchAdminUsers(query: string) {
  const q = query.trim();
  if (!q) {
    const rows = await selectProfiles((qb) => qb.order("created_at", { ascending: false }).limit(25));
    return rows.map(toRow);
  }
  if (isAddress(q)) {
    const rows = await selectProfiles((qb) => qb.eq("wallet_address", q.toLowerCase()).limit(1));
    return rows.map(toRow);
  }
  const like = `%${q.replace(/[%,()]/g, "")}%`;
  const handle = `%${normalizeUsername(q).replace(/[%,()]/g, "")}%`;
  const byName = await selectProfiles((qb) =>
    qb.or(`username.ilike.${handle},display_name.ilike.${like}`).limit(25),
  );
  // Email only when that column exists; a failed email search adds nothing.
  let byEmail: ProfileRecord[] = [];
  if (q.includes("@") || q.includes(".")) {
    const { data, error } = await profileQuery(`${baseColumns}, contact_email, phone`)
      .ilike("contact_email", like)
      .limit(25);
    if (!error) byEmail = (data ?? []) as unknown as ProfileRecord[];
  }
  const seen = new Set<string>();
  return [...byName, ...byEmail]
    .filter((row) => (seen.has(row.wallet_address) ? false : (seen.add(row.wallet_address), true)))
    .map(toRow);
}

/** Everything the team needs to help one account. */
export async function loadAdminUser(wallet: string) {
  const lower = wallet.trim().toLowerCase();
  if (!isAddress(lower)) throw new AdminUserError("Enter a valid wallet address.");
  const [profile] = await selectProfiles((qb) => qb.eq("wallet_address", lower).limit(1));
  if (!profile) throw new AdminUserError("No account has that wallet.", 404);

  const supabase = createSupabaseAdminClient();
  const [business, appLock, twoFactor, ledger] = await Promise.all([
    supabase
      .from(businessProfilesTable)
      .select("*")
      .eq("wallet_address", lower)
      .maybeSingle()
      .then((result) => (result.error ? null : result.data)),
    findAppLock([lower]).catch(() => null),
    findTwoFactor([lower]).catch(() => null),
    supabase
      .from(ledgerTable)
      .select("tx_hash, source, token, amount, amount_usd, occurred_at, eligible, ineligible_reason")
      .eq("wallet_address", lower)
      .order("occurred_at", { ascending: false })
      .limit(10)
      .then((result) => (result.error ? null : result.data)),
  ]);

  return {
    ...toRow(profile),
    authProvider: text(profile.auth_provider),
    avatarUrl: text(profile.avatar_url),
    business: business ?? null,
    country: text(profile.country),
    locale: text(profile.locale),
    phone: text(profile.phone),
    recentTransactions: ledger,
    security: { appLock: Boolean(appLock), twoFactor: Boolean(twoFactor) },
    updatedAt: text(profile.updated_at),
  };
}

/**
 * Gives an account a new ONE ID, on its request. The old one is held for
 * 12 months for this account alone, so no one else can claim it and receive
 * payments meant for this person. A business's workspace and payment
 * identity follow.
 */
export async function changeOneId(wallet: string, requested: string) {
  const lower = wallet.trim().toLowerCase();
  const next = normalizeUsername(requested);
  const supabase = createSupabaseAdminClient();
  const current = await supabase.from(profilesTable).select("username").eq("wallet_address", lower).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new AdminUserError("No account has that wallet.", 404);
  const previous = normalizeUsername(String((current.data as { username?: string }).username ?? ""));
  if (previous === next) throw new AdminUserError(`${formatUsernameLabel(next)} is already this account's ONE ID.`);

  const availability = await checkUsernameAvailability(next, lower);
  if (!availability.available) throw new AdminUserError(availability.message, 409);

  const update = await supabase
    .from(profilesTable)
    .update({ updated_at: new Date().toISOString(), username: next })
    .eq("wallet_address", lower);
  if (update.error) {
    throw new AdminUserError(
      /duplicate|unique/i.test(update.error.message) ? "That ONE ID is taken." : update.error.message,
      409,
    );
  }

  const notes: string[] = [];
  if (previous) {
    try {
      await retireUsername(previous, lower);
    } catch {
      notes.push(
        `${formatUsernameLabel(previous)} couldn't be held (run account-deletion.sql): someone else could claim it.`,
      );
    }
    // A business pays and is paid under the same name.
    const workspace = await supabase
      .from(businessTables.workspaces)
      .update({ updated_at: new Date().toISOString(), username: next })
      .eq("owner_user_wallet", lower)
      .eq("username", previous);
    const identity = await supabase
      .from(businessTables.identities)
      .update({ updated_at: new Date().toISOString(), username: next })
      .eq("username", previous)
      .eq("profile_wallet", lower);
    if (workspace.error || identity.error) {
      notes.push("The business workspace couldn't be renamed; check it in Business settings.");
    }
  }
  return { next: formatUsernameLabel(next), notes, previous: previous ? formatUsernameLabel(previous) : null };
}

/** Sets an account's email, on its request (the account itself can't). */
export async function changeAccountEmail(wallet: string, requested: string) {
  const lower = wallet.trim().toLowerCase();
  const email = requested.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new AdminUserError("Enter a valid email address.");
  }
  const supabase = createSupabaseAdminClient();
  const current = await supabase
    .from(profilesTable)
    .select("contact_email, account_type")
    .eq("wallet_address", lower)
    .maybeSingle();
  if (current.error) {
    throw new AdminUserError(
      /contact_email|column/i.test(current.error.message)
        ? "Run profiles-personal-contact.sql in Supabase first."
        : current.error.message,
      409,
    );
  }
  if (!current.data) throw new AdminUserError("No account has that wallet.", 404);
  const previous = (current.data as { contact_email?: string | null }).contact_email ?? null;

  const update = await supabase
    .from(profilesTable)
    .update({ contact_email: email, updated_at: new Date().toISOString() })
    .eq("wallet_address", lower);
  if (update.error) throw new Error(update.error.message);
  // A business account keeps its own copy on the business profile.
  if ((current.data as { account_type?: string }).account_type === "BUSINESS") {
    await supabase.from(businessProfilesTable).update({ contact_email: email }).eq("wallet_address", lower);
  }
  return { next: email, previous };
}
