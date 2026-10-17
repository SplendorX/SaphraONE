import { NextResponse, type NextRequest } from "next/server";

import { logAdminAction, requireAdminTool } from "@/lib/admin/access";
import {
  createOffer,
  createPartner,
  loadAdminPartners,
  loadAdminReport,
  loadHeldMembers,
  partnerStatement,
  releaseMember,
  revokeMember,
  setOfferStatus,
  setPartnerStatus,
  updateOffer,
  updatePartner,
} from "@/lib/partners/admin";
import { PartnerError } from "@/lib/partners/rules";
import { readJsonRecord } from "@/lib/http";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

function error(message: string, status: number) {
  return NextResponse.json({ message }, { headers: noStore, status });
}

/** Every partner and offer, and the members waiting for review. */
export async function GET(request: NextRequest) {
  const access = await requireAdminTool(request, "partners");
  if (!access.ok) return access.response;
  try {
    const [partners, held] = await Promise.all([loadAdminPartners(), loadHeldMembers()]);
    return NextResponse.json({ held, partners }, { headers: noStore });
  } catch (cause) {
    if (cause instanceof PartnerError) return error(cause.message, cause.status);
    return error(cause instanceof Error ? cause.message : "Could not load.", 500);
  }
}

/** One admin action: `{ action, id?, wallet?, status?, ...fields }`. */
export async function POST(request: NextRequest) {
  const access = await requireAdminTool(request, "partners");
  if (!access.ok) return access.response;
  const actor = access.actor;
  const body = await readJsonRecord(request);
  if (!body) return error("A valid JSON body is required.", 400);
  const action = typeof body.action === "string" ? body.action : "";
  const target = typeof body.id === "string" ? body.id : typeof body.wallet === "string" ? body.wallet : null;
  const ok = async (data: object = { ok: true }) => {
    const { action: _action, ...details } = body;
    await logAdminAction(actor, "partners", action, target, details);
    return NextResponse.json(data, { headers: noStore });
  };

  try {
    switch (action) {
      case "create_partner":
        return ok({ partner: await createPartner(body) });
      case "update_partner":
        await updatePartner(body.id, body);
        return ok();
      case "partner_status":
        await setPartnerStatus(body.id, body.status);
        return ok();
      case "create_offer":
        return ok({ offer: await createOffer(body) });
      case "update_offer":
        await updateOffer(body.id, body);
        return ok();
      case "offer_status":
        await setOfferStatus(body.id, body.status);
        return ok();
      case "report":
        return NextResponse.json({ report: await loadAdminReport() }, { headers: noStore });
      case "statement":
        return ok({ csv: await partnerStatement(body.id) });
      case "release_member":
        await releaseMember(body.wallet, actor.label);
        return ok();
      case "revoke_member":
        return ok(await revokeMember(body.wallet, actor.label, body.reason));
      default:
        return error("Unknown action.", 400);
    }
  } catch (cause) {
    if (cause instanceof PartnerError) return error(cause.message, cause.status);
    return error(cause instanceof Error ? cause.message : "That didn't work.", 500);
  }
}
