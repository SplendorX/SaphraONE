import { NextResponse } from "next/server";

import { listAnnouncements } from "@/lib/announcements/service";
import { getSessionOwnerWallet } from "@/lib/recurring-auth";

export const runtime = "nodejs";

/**
 * Live campaigns and quests for Home's announcement cards. Public: the same
 * titles already show on the Rewards page and campaign leaderboards. Signed
 * in, quests the account already completed are left out.
 */
export async function GET() {
  try {
    const wallet = await getSessionOwnerWallet().catch(() => null);
    const announcements = await listAnnouncements(new Date(), wallet);
    return NextResponse.json({ announcements }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[announcements]", error instanceof Error ? error.message : error);
    return NextResponse.json({ announcements: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
