import { NextResponse, type NextRequest } from "next/server";

import {
  checkOperatorHealth,
  reportOperatorHealth,
} from "@/lib/ops/operator-health";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;


async function handle(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const report = await checkOperatorHealth();
    const { alerted } = await reportOperatorHealth(report);

    // 503 when unhealthy so an uptime monitor pointed here alerts on its own,
    // without needing to parse the body.
    return NextResponse.json(
      { ...report, alerted },
      { status: report.healthy ? 200 : 503 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Health check failed.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
