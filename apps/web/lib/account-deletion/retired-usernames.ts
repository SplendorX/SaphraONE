// Server-only. Usernames of erased accounts, held for USERNAME_HOLD_DAYS
// before anyone else can claim them. See lib/account-deletion/rules.ts.
import { usernameHeldFrom, usernameReleaseDate } from "@/lib/account-deletion/rules";
import { normalizeUsername } from "@/lib/profile-utils";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const table = "retired_usernames";

type HoldRow = { available_at: string; owner_wallet: string; username: string };

/**
 * True when `username` belongs to an erased account and is still on hold for
 * anyone but that account's wallet. Fails open (false) when the table isn't
 * there yet, like the rest of the feature before its SQL is run.
 */
export async function isUsernameHeld(username: string, wallet?: string | null) {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from(table)
      .select("username, owner_wallet, available_at")
      .eq("username", normalizeUsername(username))
      .maybeSingle();
    if (error) return false;
    return usernameHeldFrom(data as HoldRow | null, wallet);
  } catch {
    return false;
  }
}

/** The name an erased account on `wallet` had, while it's still held for it. */
export async function heldUsernameFor(wallet: string) {
  try {
    const { data } = await createSupabaseAdminClient()
      .from(table)
      .select("username, owner_wallet, available_at")
      .eq("owner_wallet", wallet.toLowerCase())
      .gt("available_at", new Date().toISOString())
      .order("retired_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as HoldRow | null)?.username ?? null;
  } catch {
    return null;
  }
}

/** Hold an erased account's username. Throws, so the purge doesn't release it unprotected. */
export async function retireUsername(username: string, wallet: string) {
  const now = new Date();
  const { error } = await createSupabaseAdminClient()
    .from(table)
    .upsert(
      {
        available_at: usernameReleaseDate(now).toISOString(),
        owner_wallet: wallet.toLowerCase(),
        retired_at: now.toISOString(),
        username: normalizeUsername(username),
      },
      { onConflict: "username" },
    );
  if (error) throw new Error(error.message);
}
