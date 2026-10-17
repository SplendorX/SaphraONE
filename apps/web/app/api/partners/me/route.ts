import { type NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import { claimPerkRebates } from "@/lib/partners/claims";
import { creatorPartnersEnabled } from "@/lib/partners/config";
import { loadWelcomePerks } from "@/lib/partners/member-view";
import { PartnerError } from "@/lib/partners/rules";
import { consumeRateLimit } from "@/lib/rate-limit";
import { ReferralAuthError, requireReferralActorWallet } from "@/lib/referral/auth";

export const runtime = "nodejs";

/** The signed-in account's welcome package from a creator's link, or `{ perks: null }`. */
export async function GET(request: NextRequest) {
  if (!creatorPartnersEnabled()) return jsonOk({ perks: null });
  try {
    const wallet = await requireReferralActorWallet({
      circleSocialUuid: request.nextUrl.searchParams.get("circleSocialUuid"),
      ownerWallet: request.nextUrl.searchParams.get("ownerWallet"),
    });
    return jsonOk({ perks: await loadWelcomePerks(wallet) });
  } catch (error) {
    if (error instanceof ReferralAuthError) return jsonError(error.message, error.status);
    return jsonError(error instanceof Error ? error.message : "Could not load your welcome perks.", 500);
  }
}

/** Claim the USDC rebates that are ready (at least the minimum) to the member's wallet. */
export async function POST(request: NextRequest) {
  if (!creatorPartnersEnabled()) return jsonError("Not available.", 404);
  const body = await readJsonRecord(request);
  if (!body) return jsonError("A valid JSON body is required.", 400);
  try {
    const wallet = await requireReferralActorWallet({
      circleSocialUuid: body.circleSocialUuid,
      ownerWallet: body.ownerWallet,
    });
    if (!(await consumeRateLimit(`partner-claim:${wallet}`, 3, 60))) {
      return jsonError("Too many claims. Try again in a minute.", 429);
    }
    return jsonOk(await claimPerkRebates(wallet));
  } catch (error) {
    if (error instanceof ReferralAuthError) return jsonError(error.message, error.status);
    if (error instanceof PartnerError) return jsonError(error.message, error.status);
    return jsonError(error instanceof Error ? error.message : "The claim could not be paid.", 500);
  }
}
