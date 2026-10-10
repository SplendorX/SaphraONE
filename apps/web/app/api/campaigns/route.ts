import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";

import { listPublicCampaigns } from "@/lib/campaigns/service";

export const runtime = "nodejs";

/**
 * Live and recently ended USDC campaigns with their leaderboards. Public: the
 * rankings come from on-chain payments. `wallet` adds that wallet's own place.
 */
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  try {
    const campaigns = await listPublicCampaigns(isAddress(wallet) ? wallet : null);
    return NextResponse.json({ campaigns }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Before the campaign tables exist there is simply nothing to show.
    console.warn("[campaigns]", error instanceof Error ? error.message : error);
    return NextResponse.json({ campaigns: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
