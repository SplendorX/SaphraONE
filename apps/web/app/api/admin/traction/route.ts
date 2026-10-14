import { NextResponse } from "next/server";

import { adminCan } from "@/lib/admin/access";
import { getTractionSummary } from "@/lib/traction/service";

export const runtime = "nodejs";


export async function GET(request: Request) {
  if (!(await adminCan(request, "traction"))) {
    return NextResponse.json(
      { message: "Unauthorized traction dashboard request." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const rangeDays = Number(url.searchParams.get("rangeDays") ?? 30);

  try {
    const summary = await getTractionSummary(rangeDays);
    return NextResponse.json(summary, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Could not load traction summary.",
      },
      { status: 500 },
    );
  }
}
