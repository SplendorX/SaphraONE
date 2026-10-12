import { type NextRequest } from "next/server";

import { findScheduledDeletionSafe } from "@/lib/account-deletion/server";
import {
  completeAccountOnboarding,
  getAccountState,
} from "@/lib/account/service";
import {
  jsonBusinessError,
  jsonOk,
  readActor,
  readJsonBody,
} from "@/lib/business/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { actorWallet, circleSocialUuid } = await readActor(request);
    const [state, deletion] = await Promise.all([
      getAccountState({
        circleSocialUuid,
        ownerWallet: actorWallet,
      }),
      findScheduledDeletionSafe(actorWallet),
    ]);
    // Scheduled for deletion: every device shows "Restore account" instead.
    return jsonOk({
      ...state,
      pendingDeletion: deletion
        ? { requestedAt: deletion.requested_at, scheduledFor: deletion.scheduled_for }
        : null,
    });
  } catch (error) {
    return jsonBusinessError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw new Error("A valid JSON body is required.");
    const { actorWallet, circleSocialUuid } = await readActor(request, body);
    const state = await completeAccountOnboarding({
      accountKind: body.accountKind === "business" ? "business" : "personal",
      bio: typeof body.bio === "string" ? body.bio : null,
      fullName: typeof body.fullName === "string" ? body.fullName : null,
      businessCategory:
        typeof body.businessCategory === "string" ? body.businessCategory : null,
      businessDescription:
        typeof body.businessDescription === "string"
          ? body.businessDescription
          : null,
      businessName: typeof body.businessName === "string" ? body.businessName : "",
      circleSocialUuid,
      contactEmail: body.contactEmail,
      country: typeof body.country === "string" ? body.country : null,
      locale: typeof body.locale === "string" ? body.locale : "en",
      logoUrl: typeof body.logoUrl === "string" ? body.logoUrl : null,
      ownerWallet: actorWallet,
      username: typeof body.username === "string" ? body.username : "",
      website: typeof body.website === "string" ? body.website : null,
    });
    return jsonOk(state);
  } catch (error) {
    return jsonBusinessError(error);
  }
}
