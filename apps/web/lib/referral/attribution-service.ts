import crypto from "node:crypto";
import { referralDb, referralTables, readReferralDbError } from "@/lib/referral/db";
import type {
  ReferralProfileRecord,
  ReferralRecord,
  ReferredAccountType,
} from "@/lib/referral/types";

function generateSecureToken(): string {
  return crypto.randomBytes(8).toString("hex"); // 16-char hex token
}

/**
 * Ensure a referrer profile exists for a given wallet address.
 * Generates an immutable referral_token if one doesn't exist.
 */
export async function getOrCreateReferralProfile(
  walletAddress: string,
): Promise<ReferralProfileRecord> {
  const wallet = walletAddress.toLowerCase();
  const supabase = referralDb();

  const existing = await supabase
    .from(referralTables.profiles)
    .select("*")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (existing.error) {
    throw new Error(readReferralDbError(existing.error, "Could not load referral profile."));
  }

  if (existing.data) {
    return existing.data as ReferralProfileRecord;
  }

  // Ensure row exists in public.profiles to satisfy foreign key constraint
  const userProfile = await supabase
    .from(referralTables.userProfiles)
    .select("wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (!userProfile.data) {
    const autoUsername = `user_${wallet.slice(2, 6)}${Math.floor(1000 + Math.random() * 9000)}`;
    await supabase.from(referralTables.userProfiles).upsert(
      {
        wallet_address: wallet,
        username: autoUsername,
        auth_provider: "external",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet_address" },
    );
  }

  const token = generateSecureToken();
  const created = await supabase
    .from(referralTables.profiles)
    .insert({
      wallet_address: wallet,
      referral_token: token,
      total_successful_referrals: 0,
      successful_personal_referrals: 0,
      successful_business_referrals: 0,
      current_tier: "STARTER",
    })
    .select("*")
    .single();

  if (created.error) {
    if (created.error.code === "23505") {
      const retry = await supabase
        .from(referralTables.profiles)
        .select("*")
        .eq("wallet_address", wallet)
        .single();
      if (retry.data) return retry.data as ReferralProfileRecord;
    }
    throw new Error(readReferralDbError(created.error, "Could not create referral profile."));
  }

  return created.data as ReferralProfileRecord;
}

/**
 * Resolve a referral handle or token to the referrer's profile.
 * Can be either a username (e.g. /r/benneth) or an immutable referral_token.
 */
export async function resolveReferrer(
  identifier: string,
): Promise<{
  profile: ReferralProfileRecord;
  username: string | null;
} | null> {
  const clean = identifier.trim().toLowerCase().replace(/^@/, "");
  if (!clean) return null;
  const supabase = referralDb();

  // 1. Try resolving as username
  const userRow = await supabase
    .from(referralTables.userProfiles)
    .select("wallet_address,username")
    .ilike("username", clean)
    .maybeSingle();

  if (userRow.data?.wallet_address) {
    const profile = await getOrCreateReferralProfile(userRow.data.wallet_address);
    return {
      profile,
      username: userRow.data.username ?? clean,
    };
  }

  // 2. Try resolving as immutable referral_token
  const byToken = await supabase
    .from(referralTables.profiles)
    .select("*")
    .eq("referral_token", clean)
    .maybeSingle();

  if (byToken.data) {
    const owner = await supabase
      .from(referralTables.userProfiles)
      .select("username")
      .eq("wallet_address", byToken.data.wallet_address)
      .maybeSingle();

    return {
      profile: byToken.data as ReferralProfileRecord,
      username: owner.data?.username ?? null,
    };
  }

  return null;
}

/**
 * Track a visit/click on a referral link.
 */
export async function trackReferralClick(input: {
  referralToken: string;
  referrerWallet: string;
  visitorId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = referralDb();
  await supabase.from(referralTables.attributions).insert({
    referral_token: input.referralToken,
    referrer_wallet: input.referrerWallet.toLowerCase(),
    visitor_id: input.visitorId ?? null,
    ip_hash: input.ipHash ?? null,
    user_agent: input.userAgent ?? null,
    referer: input.referer ?? null,
    metadata: input.metadata ?? {},
  });
}

/**
 * Attach a referral attribution to a newly registered user (first-valid attribution).
 * Strictly prevents self-referrals and duplicate attachments.
 */
export async function attachReferral(input: {
  referredWallet: string;
  referrerTokenOrUsername: string;
  accountType?: ReferredAccountType;
  metadata?: Record<string, unknown>;
}): Promise<ReferralRecord | null> {
  const referred = input.referredWallet.toLowerCase();
  const supabase = referralDb();

  // 1. First-valid-attribution: Check if already referred
  const existing = await supabase
    .from(referralTables.referrals)
    .select("*")
    .eq("referred_wallet", referred)
    .maybeSingle();

  if (existing.data) {
    return existing.data as ReferralRecord; // Immutable first attribution
  }

  // 2. Resolve referrer
  const resolved = await resolveReferrer(input.referrerTokenOrUsername);
  if (!resolved) return null;

  const referrerWallet = resolved.profile.wallet_address.toLowerCase();

  // 3. Block self-referral
  if (referrerWallet === referred) {
    return null;
  }

  // Fetch current usernames for snapshots
  const [referrerUser, referredUser] = await Promise.all([
    supabase.from(referralTables.userProfiles).select("username").eq("wallet_address", referrerWallet).maybeSingle(),
    supabase.from(referralTables.userProfiles).select("username").eq("wallet_address", referred).maybeSingle(),
  ]);

  const accountType: ReferredAccountType = input.accountType === "BUSINESS" ? "BUSINESS" : "PERSONAL";

  const created = await supabase
    .from(referralTables.referrals)
    .insert({
      referrer_wallet: referrerWallet,
      referred_wallet: referred,
      referral_token: resolved.profile.referral_token,
      referred_username_snapshot: referredUser.data?.username ?? null,
      referrer_username_snapshot: referrerUser.data?.username ?? null,
      referred_account_type: accountType,
      status: "SIGNED_UP",
      signed_up_at: new Date().toISOString(),
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (created.error) {
    if (created.error.code === "23505") {
      const existingRetry = await supabase
        .from(referralTables.referrals)
        .select("*")
        .eq("referred_wallet", referred)
        .single();
      return existingRetry.data as ReferralRecord;
    }
    throw new Error(readReferralDbError(created.error, "Could not attach referral."));
  }

  return created.data as ReferralRecord;
}

/**
 * Get referral record for a referred user.
 */
export async function getReferralForUser(referredWallet: string): Promise<ReferralRecord | null> {
  const supabase = referralDb();
  const { data } = await supabase
    .from(referralTables.referrals)
    .select("*")
    .eq("referred_wallet", referredWallet.toLowerCase())
    .maybeSingle();

  return (data as ReferralRecord | null) ?? null;
}



