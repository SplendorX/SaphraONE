import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { deliverDue } from "@/lib/webhooks/deliver";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sends due webhook retries. Called every minute by Supabase pg_cron
 * (packages/database/supabase/merchant-webhooks-cron.sql), and daily by
 * /api/cron/checkout as a last catch-up.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized cron request." }, { status: 401 });
  }

  try {
    const result = await deliverDue({ budgetMs: 45_000, limit: 200 });
    return NextResponse.json({ ...result, status: "ok" });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Webhook cron failed.",
        status: "error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
