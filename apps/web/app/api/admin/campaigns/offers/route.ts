import { type NextRequest } from "next/server";

import { logAdminAction, requireAdminTool } from "@/lib/admin/access";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import {
  createPremiumOffer,
  deletePremiumOffer,
  listPremiumOffers,
  PremiumOfferError,
  setPremiumOfferStatus,
  updatePremiumOffer,
} from "@/lib/premium-offers/service";

export const runtime = "nodejs";

/** Every premium offer, newest first, with how many purchases each applied to. */
export async function GET(request: NextRequest) {
  const access = await requireAdminTool(request, "campaigns");
  if (!access.ok) return access.response;
  try {
    return jsonOk({ offers: await listPremiumOffers() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Couldn't load offers.", 500);
  }
}

/**
 * `{ action: "create", ...fields, publish? }`, `{ action: "update", id, ...fields }`,
 * `{ action: "publish" | "end" | "unpublish" | "delete", id }`.
 */
export async function POST(request: NextRequest) {
  const access = await requireAdminTool(request, "campaigns");
  if (!access.ok) return access.response;
  const body = await readJsonRecord(request);
  if (!body) return jsonError("A valid JSON body is required.", 400);

  try {
    switch (body.action) {
      case "create": {
        const offer = await createPremiumOffer(body, access.actor.label);
        await logAdminAction(access.actor, "campaigns", offer.status === "live" ? "publish-offer" : "create-offer", offer.id, {
          title: offer.title,
        });
        return jsonOk({ offer });
      }
      case "update": {
        const offer = await updatePremiumOffer(body.id, body);
        await logAdminAction(access.actor, "campaigns", "update-offer", offer.id, { title: offer.title });
        return jsonOk({ offer });
      }
      case "publish":
      case "end":
      case "unpublish": {
        const status = body.action === "publish" ? "live" : body.action === "end" ? "ended" : "draft";
        const offer = await setPremiumOfferStatus(body.id, status);
        await logAdminAction(access.actor, "campaigns", `${body.action}-offer`, offer.id, { title: offer.title });
        return jsonOk({ offer });
      }
      case "delete": {
        const offer = await deletePremiumOffer(body.id);
        await logAdminAction(access.actor, "campaigns", "delete-offer", offer.id, { title: offer.title });
        return jsonOk({ ok: true });
      }
      default:
        return jsonError("Unknown action.", 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't save the offer.";
    return jsonError(message, error instanceof PremiumOfferError ? 400 : 500);
  }
}
