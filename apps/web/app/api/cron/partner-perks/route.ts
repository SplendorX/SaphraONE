import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { creatorPartnersEnabled } from "@/lib/partners/config";
import { runPartnerPerksCron } from "@/lib/partners/cron";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Creator Partners housekeeping: release perks past their hold, end welcome
 * periods, pay small leftover rebates.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized cron request." }, { status: 401 });
  }
  if (!creatorPartnersEnabled()) return NextResponse.json({ status: "off" });

  try {
    const result = await runPartnerPerksCron();
    return NextResponse.json({ ...result, status: "ok" });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Partner perks cron failed.",
        status: "error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
