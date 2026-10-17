// Server-only. The business dashboard's side of the Checkout API: who may
// manage keys (and, later, webhooks) for a business.
import { requireBusinessAccount } from "@/lib/account/auth";
import { accountErrors } from "@/lib/account/errors";

type ActorInput = {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  workspaceId?: unknown;
};

/** Owners and admins manage API keys; the records live under the business wallet. */
export async function requireDeveloperAccess(input: ActorInput) {
  const context = await requireBusinessAccount(input);
  if (context.role !== "owner" && context.role !== "admin") {
    throw accountErrors.forbidden("Only the business owner or an admin can manage API keys.");
  }
  return {
    actorWallet: context.actorWallet.toLowerCase(),
    wallet: (context.businessWallet || context.actorWallet).toLowerCase(),
  };
}
