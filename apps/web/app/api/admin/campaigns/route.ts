import { NextResponse, type NextRequest } from "next/server";

import { isAdminAuthorized } from "@/lib/admin-auth";
import { CampaignError } from "@/lib/campaigns/rules";
import {
  adminLeaderboard,
  cancelCampaign,
  createCampaign,
  finalizeCampaign,
  loadAdminCampaigns,
  markWinnerPaid,
  payAllWinners,
  payWinner,
  publishCampaign,
  rejectWinner,
  updateCampaign,
} from "@/lib/campaigns/service";
import { readJsonRecord } from "@/lib/http";
import { backfillFromActivity, ledgerStatus, sweepAgentPayments } from "@/lib/ledger/sweep";

export const runtime = "nodejs";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

function error(message: string, status: number) {
  return NextResponse.json({ message }, { headers: noStore, status });
}

/** Every campaign with its winners, and how complete the ledger is. */
export async function GET(request: NextRequest) {
  if (!isAdminAuthorized(request)) return error("Unauthorized.", 401);
  try {
    const [campaigns, ledger] = await Promise.all([loadAdminCampaigns(), ledgerStatus()]);
    return NextResponse.json({ campaigns, ledger }, { headers: noStore });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Could not load.", 500);
  }
}

/** One admin action: `{ action, id?, reason?, txHash?, ...campaign fields }`. */
export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) return error("Unauthorized.", 401);
  const body = await readJsonRecord(request);
  if (!body) return error("A valid JSON body is required.", 400);
  const id = typeof body.id === "string" ? body.id : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const ok = (data: object = { ok: true }) => NextResponse.json(data, { headers: noStore });

  try {
    switch (body.action) {
      case "create":
        return ok(await createCampaign(body));
      case "update":
        await updateCampaign(id, body);
        return ok();
      case "publish":
        await publishCampaign(id);
        return ok();
      case "cancel":
        await cancelCampaign(id, body.reason);
        return ok();
      case "leaderboard":
        return ok({ leaderboard: await adminLeaderboard(id) });
      case "finalize":
        return ok(await finalizeCampaign(id));
      case "pay_winner":
        return ok(await payWinner(id, reason));
      case "pay_all":
        return ok(await payAllWinners(id, reason));
      case "reject_winner":
        await rejectWinner(id, body.reason);
        return ok();
      case "mark_winner_paid":
        await markWinnerPaid(id, body.txHash, reason);
        return ok();
      case "backfill":
        return ok(await backfillFromActivity({ budgetMs: 200_000, limit: 400 }));
      case "sweep_agent":
        return ok(await sweepAgentPayments(200_000));
      default:
        return error("Unknown action.", 400);
    }
  } catch (cause) {
    if (cause instanceof CampaignError) return error(cause.message, cause.status);
    return error(cause instanceof Error ? cause.message : "That didn't work.", 500);
  }
}
