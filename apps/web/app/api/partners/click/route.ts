import crypto from "node:crypto";
import { type NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import { creatorPartnersEnabled } from "@/lib/partners/config";
import { loadOfferByCode } from "@/lib/partners/db";
import { normalizeOfferCode } from "@/lib/partners/rules";
import { getOrCreateReferralProfile, trackReferralClick } from "@/lib/referral/attribution-service";
import { referralDb, referralTables } from "@/lib/referral/db";

export const runtime = "nodejs";

/**
 * A visit to /join/<code>: counts the click for the offer and returns the
 * referral code sign-up should carry (the partner's ONE ID, or their token).
 */
export async function POST(request: NextRequest) {
  if (!creatorPartnersEnabled()) return jsonError("Not available.", 404);
  const body = await readJsonRecord(request);
  const code = normalizeOfferCode(body?.code);
  if (!code) return jsonError("A valid offer code is required.", 400);

  try {
    const loaded = await loadOfferByCode(code);
    if (!loaded || loaded.offer.status === "DRAFT") return jsonError("This link isn't valid.", 404);
    const wallet = loaded.partner.wallet_address.toLowerCase();
    const [profile, user] = await Promise.all([
      getOrCreateReferralProfile(wallet),
      referralDb().from(referralTables.userProfiles).select("username").eq("wallet_address", wallet).maybeSingle(),
    ]);

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
    await trackReferralClick({
      ipHash: crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16),
      metadata: { offer_code: code, offer_id: loaded.offer.id, source: "partner_link" },
      referer: request.headers.get("referer"),
      referralToken: profile.referral_token,
      referrerWallet: wallet,
      userAgent: request.headers.get("user-agent"),
      visitorId: typeof body?.visitorId === "string" ? body.visitorId.slice(0, 64) : null,
    }).catch(() => undefined);

    const username = (user.data as { username?: string } | null)?.username;
    return jsonOk({ code, referralCode: username || profile.referral_token });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not open this link.", 500);
  }
}
