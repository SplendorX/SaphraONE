// Server-only. The business dashboard's side of the Checkout API: who may
// manage keys and webhooks for a business.
import type { NextRequest } from "next/server";

import { requireBusinessAccount } from "@/lib/account/auth";
import { accountErrors } from "@/lib/account/errors";
import { readActor } from "@/lib/business/http";

type ActorInput = {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  workspaceId?: unknown;
};

/** Owners and admins manage API keys and webhooks; the records live under the business wallet. */
export async function requireDeveloperAccess(input: ActorInput) {
  const context = await requireBusinessAccount(input);
  if (context.role !== "owner" && context.role !== "admin") {
    throw accountErrors.forbidden("Only the business owner or an admin can manage API keys and webhooks.");
  }
  return {
    actorWallet: context.actorWallet.toLowerCase(),
    wallet: (context.businessWallet || context.actorWallet).toLowerCase(),
  };
}

/** readActor + requireDeveloperAccess, for the Developers routes. */
export async function requireDeveloperRequest(request: NextRequest, body?: Record<string, unknown> | null) {
  const { actorWallet, circleSocialUuid, workspaceId } = await readActor(request, body);
  return requireDeveloperAccess({ circleSocialUuid, ownerWallet: actorWallet, workspaceId });
}
