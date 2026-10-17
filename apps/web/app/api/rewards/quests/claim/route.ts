import { type NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { ReferralAuthError, requireReferralActorWallet } from "@/lib/referral/auth";
import { rewardsV2Enabled } from "@/lib/rewards/config";
import { claimSocialQuest, QuestClaimError } from "@/lib/rewards/quests";

export const runtime = "nodejs";

/** Claim a "follow us" quest after opening its link: { questId }. */
export async function POST(request: NextRequest) {
  if (!rewardsV2Enabled()) return jsonError("Rewards aren't available yet.", 404);
  const body = await readJsonRecord(request);
  if (!body) return jsonError("A valid JSON body is required.", 400);
  try {
    const wallet = await requireReferralActorWallet({
      circleSocialUuid: body.circleSocialUuid,
      ownerWallet: body.ownerWallet,
    });
    if (!(await consumeRateLimit(`rewards-quest-claim:${wallet}`, 10, 60))) {
      return jsonError("Too many claims. Try again in a minute.", 429);
    }
    const questId = typeof body.questId === "string" ? body.questId : "";
    const awarded = await claimSocialQuest(wallet, questId);
    return jsonOk({ alreadyClaimed: !awarded, awarded });
  } catch (error) {
    if (error instanceof ReferralAuthError) return jsonError(error.message, error.status);
    if (error instanceof QuestClaimError) return jsonError(error.message, error.status);
    console.error("[rewards] quest claim failed", error);
    return jsonError("The quest couldn't be claimed. Try again.", 500);
  }
}
