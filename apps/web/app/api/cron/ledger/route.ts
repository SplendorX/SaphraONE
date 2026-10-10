import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { backfillFromActivity, sweepAgentPayments } from "@/lib/ledger/sweep";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Keeps the transaction ledger complete: records ALLIE's confirmed Agent
 * Wallet payments, then backfills older history a batch at a time. Vercel Cron
 * runs it daily; an external scheduler can call it more often with
 * x-cron-secret.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized cron request." }, { status: 401 });
  }

  try {
    const agent = await sweepAgentPayments(90_000);
    const backfill = await backfillFromActivity({ budgetMs: 150_000, limit: 300 });
    return NextResponse.json({ agent, backfill, status: "ok" });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Ledger cron failed.", status: "error" },
      { status: 500 },
    );
  }
}
