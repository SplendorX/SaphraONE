import { NextResponse, type NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/http";
import { creatorPartnersEnabled } from "@/lib/partners/config";
import { loadPartnerByWallet, partnersDb, partnerTables } from "@/lib/partners/db";
import { offerReports, partnerStatementCsv } from "@/lib/partners/report";
import { contractActive } from "@/lib/partners/rules";
import type { OfferRow } from "@/lib/partners/types";
import { ReferralAuthError, requireReferralActorWallet } from "@/lib/referral/auth";

export const runtime = "nodejs";

/**
 * A creator partner's own view: their offers' links and funnels, and their
 * contract. `{ partner: null }` for everyone else. `?format=csv` downloads
 * their earnings statement.
 */
export async function GET(request: NextRequest) {
  if (!creatorPartnersEnabled()) return jsonOk({ partner: null });
  try {
    const wallet = await requireReferralActorWallet({
      circleSocialUuid: request.nextUrl.searchParams.get("circleSocialUuid"),
      ownerWallet: request.nextUrl.searchParams.get("ownerWallet"),
    });
    const partner = await loadPartnerByWallet(wallet);
    if (!partner) return jsonOk({ partner: null });

    if (request.nextUrl.searchParams.get("format") === "csv") {
      const csv = await partnerStatementCsv(partner);
      return new NextResponse(csv, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="saphraone-partner-statement.csv"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    }

    const { data } = await partnersDb()
      .from(partnerTables.offers)
      .select("*")
      .eq("partner_id", partner.id)
      .neq("status", "DRAFT")
      .order("created_at", { ascending: false });
    const offers = (data ?? []) as OfferRow[];
    const reports = await offerReports(offers, [partner]);
    const origin = request.nextUrl.origin.replace(/\/$/, "");

    return jsonOk({
      offers: offers.map((offer) => {
        const report = reports.find((row) => row.offerId === offer.id);
        return {
          activated: report?.activated ?? 0,
          clicks: report?.clicks ?? 0,
          code: offer.code,
          earnedUsdc: (report?.commissionUsdc ?? 0) + (report?.bountiesUsdc ?? 0),
          endsAt: offer.ends_at,
          link: `${origin}/join/${offer.code}`,
          signups: report?.signups ?? 0,
          status: offer.status,
          title: offer.title,
          volumeUsd: report?.volumeUsd ?? 0,
        };
      }),
      partner: {
        bountyUsdc: Number(partner.bounty_usdc),
        commissionBps: contractActive(partner) ? partner.commission_bps : null,
        commissionMode: partner.commission_mode,
        contractEndsAt: partner.contract_ends_at,
        displayName: partner.display_name,
        status: partner.status,
      },
    });
  } catch (error) {
    if (error instanceof ReferralAuthError) return jsonError(error.message, error.status);
    return jsonError(error instanceof Error ? error.message : "Could not load your partner dashboard.", 500);
  }
}
