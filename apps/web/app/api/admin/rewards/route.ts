import { NextResponse, type NextRequest } from "next/server";

import { adminCan } from "@/lib/admin/access";
import { readJsonRecord } from "@/lib/http";
import {
  AdminRewardsError,
  awardQuestToWallet,
  createQuest,
  deleteQuest,
  endQuest,
  failDiscount,
  listQuestCompletions,
  loadAdminRewards,
  markClaimPaid,
  markDiscountPaid,
  payReviewedClaim,
  rejectClaim,
  rejectEarning,
  releaseEarning,
  returnClaim,
  setQuestActive,
  updateQuest,
} from "@/lib/rewards/admin";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

function error(message: string, status: number) {
  return NextResponse.json({ message }, { headers: noStore, status });
}

/** Review queues (held earnings, claims, discount refunds) and quests. */
export async function GET(request: NextRequest) {
  if (!(await adminCan(request, "rewards"))) return error("Unauthorized.", 401);
  try {
    return NextResponse.json(await loadAdminRewards(), { headers: noStore });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Could not load.", 500);
  }
}

/** One admin decision: `{ action, id, reason?, txHash?, ... }`. */
export async function POST(request: NextRequest) {
  if (!(await adminCan(request, "rewards"))) return error("Unauthorized.", 401);
  const body = await readJsonRecord(request);
  if (!body) return error("A valid JSON body is required.", 400);
  const id = typeof body.id === "string" ? body.id : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  try {
    switch (body.action) {
      case "release_earning":
        await releaseEarning(id, reason);
        break;
      case "reject_earning":
        await rejectEarning(id, body.reason);
        break;
      case "pay_claim":
        return NextResponse.json(await payReviewedClaim(id, reason), { headers: noStore });
      case "return_claim":
        await returnClaim(id, body.reason);
        break;
      case "reject_claim":
        await rejectClaim(id, body.reason);
        break;
      case "mark_claim_paid":
        await markClaimPaid(id, body.txHash, reason);
        break;
      case "mark_discount_paid":
        await markDiscountPaid(id, body.txHash, reason);
        break;
      case "fail_discount":
        await failDiscount(id, body.reason);
        break;
      case "create_quest":
        return NextResponse.json(await createQuest(body), { headers: noStore });
      case "update_quest":
        await updateQuest(id, body);
        break;
      case "set_quest_active":
        await setQuestActive(id, body.active === true);
        break;
      case "end_quest":
        await endQuest(id);
        break;
      case "delete_quest":
        await deleteQuest(id);
        break;
      case "quest_completions":
        return NextResponse.json({ completions: await listQuestCompletions(id) }, { headers: noStore });
      case "award_quest":
        await awardQuestToWallet(id, body.wallet, body.reason);
        break;
      default:
        return error("Unknown action.", 400);
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (cause) {
    if (cause instanceof AdminRewardsError) return error(cause.message, cause.status);
    return error(cause instanceof Error ? cause.message : "That didn't work.", 500);
  }
}
