import { type NextRequest } from "next/server";
import { getOrCreateReferralProfile } from "@/lib/referral/attribution-service";
import { getOnePointsSummary } from "@/lib/referral/ledger-service";
import { getTierProgress } from "@/lib/referral/tier-service";
import { ReferralAuthError, requireReferralActorWallet } from "@/lib/referral/auth";
import { referralDb, referralTables } from "@/lib/referral/db";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const ownerWalletParam =
      request.nextUrl.searchParams.get("ownerWallet") ||
      request.nextUrl.searchParams.get("wallet");
    const circleSocialUuid = request.nextUrl.searchParams.get("circleSocialUuid");

    const actorWallet = await requireReferralActorWallet({
      ownerWallet: ownerWalletParam,
      circleSocialUuid,
    });

    const profile = await getOrCreateReferralProfile(actorWallet);
    const onePoints = await getOnePointsSummary(actorWallet);
    const tierProgress = getTierProgress(profile.total_successful_referrals);

    const supabase = referralDb();
    const userProfile = await supabase
      .from(referralTables.userProfiles)
      .select("username")
      .eq("wallet_address", actorWallet)
      .maybeSingle();

    const origin = request.nextUrl.origin;
    const handle = userProfile.data?.username || profile.referral_token;
    const referralLink = `${origin}/r/${handle}`;

    return jsonOk({
      walletAddress: actorWallet,
      username: userProfile.data?.username ?? null,
      referralToken: profile.referral_token,
      referralLink,
      currentTier: profile.current_tier,
      totalSuccessfulReferrals: profile.total_successful_referrals,
      successfulPersonalReferrals: profile.successful_personal_referrals,
      successfulBusinessReferrals: profile.successful_business_referrals,
      tierProgress,
      onePoints,
    });
  } catch (error) {
    if (error instanceof ReferralAuthError) {
      return jsonError(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Could not load referral profile.";
    const status = message.includes("Unauthorized") || message.includes("required") ? 401 : 500;
    return jsonError(message, status);
  }
}
