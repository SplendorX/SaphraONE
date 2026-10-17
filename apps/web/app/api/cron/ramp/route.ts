import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/cron-auth";
import { sweepOpenOrders } from "@/lib/ramp/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ramp housekeeping: re-sync open Naira orders that no webhook or open tab
 * has refreshed lately, and fail ones Centiiv never acknowledged.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Unauthorized cron request." }, { status: 401 });
  }

  try {
    const result = await sweepOpenOrders();
    return NextResponse.json({ ...result, status: "ok" });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "Ramp cron failed.",
        status: "error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
