import { NextResponse, type NextRequest } from "next/server";

import { sendDeletionCompleted } from "@/lib/account-deletion/email";
import { dueDeletions, purgeAccount } from "@/lib/account-deletion/server";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Erases accounts whose deletion grace period is over (see
 * lib/account-deletion). Vercel Cron runs it daily; a request that fails
 * part-way keeps its place and is tried again on the next run.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized cron request." }, { status: 401 });
  }

  const deadline = Date.now() + 240_000;
  let completed = 0;
  const failed: Array<{ id: string; failures: string[] }> = [];

  try {
    for (const due of await dueDeletions(100)) {
      if (Date.now() > deadline) break;
      const result = await purgeAccount(due);
      if (!result.ok) {
        failed.push({ failures: result.failures, id: due.id });
        continue;
      }
      completed += 1;
      if (due.notify_email) {
        await sendDeletionCompleted(due.notify_email, `account-deletion-completed-${due.id}`);
      }
    }
    if (failed.length > 0) console.error("[cron/account-deletion] failed", failed);
    return NextResponse.json({ completed, failed, status: "ok" });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Account deletion cron failed.", status: "error" },
      { status: 500 },
    );
  }
}
