import { NextResponse, type NextRequest } from "next/server";

import { catchUpChargeScans, expireStaleCharges } from "@/lib/checkout/sweep";
import { isCronAuthorized } from "@/lib/cron-auth";
import { deliverDue } from "@/lib/webhooks/deliver";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Checkout housekeeping: expire stale charges, match card/bank and bridge payments. */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized cron request." }, { status: 401 });
  }

  try {
    // Scan first: a payment that arrived just before expiry still lands.
    const scans = await catchUpChargeScans({ budgetMs: 30_000 });
    const expired = await expireStaleCharges();
    // Last catch-up for webhook retries, in case the per-minute job isn't set up.
    const webhooks = await deliverDue({ budgetMs: 15_000, limit: 100 }).catch((error) => ({
      error: error instanceof Error ? error.message : "Webhook catch-up failed.",
    }));
    return NextResponse.json({ expired, scans, status: "ok", webhooks });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Checkout cron failed.",
        status: "error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
