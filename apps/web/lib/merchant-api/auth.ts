// Server-only. Authenticates a /api/v1 call by its secret key.
import type { NextRequest } from "next/server";

import { loadAccount } from "@/lib/account/auth";
import { loadBusinessProfile } from "@/lib/account/service";
import { apiErrors } from "@/lib/merchant-api/errors";
import { type ApiMode, readApiKeyMode } from "@/lib/merchant-api/ids";
import {
  deploymentMode,
  findApiKeyByHash,
  hashApiKey,
  touchApiKey,
} from "@/lib/merchant-api/keys";
import { driveMerchantDeliveries } from "@/lib/webhooks/events";

export type ApiCaller = {
  /** The business wallet that payments go to. */
  wallet: string;
  keyId: string;
  mode: ApiMode;
};

/**
 * `Authorization: Bearer sk_…`. The key must exist, be active, belong to this
 * deployment's mode, and its account must still be a Business (verified, for
 * live keys), so revoking verification also stops the API.
 */
export async function requireApiKey(request: NextRequest): Promise<ApiCaller> {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const presented = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!presented) throw apiErrors.missingKey();

  const claimedMode = readApiKeyMode(presented);
  if (!claimedMode) throw apiErrors.invalidKey();
  if (claimedMode !== deploymentMode()) throw apiErrors.wrongMode(claimedMode);

  const record = await findApiKeyByHash(hashApiKey(presented));
  if (!record || record.revoked_at || record.mode !== claimedMode) throw apiErrors.invalidKey();

  const wallet = record.wallet_address.toLowerCase();
  const account = await loadAccount(wallet);
  if (!account || account.account_type !== "BUSINESS") throw apiErrors.notBusiness();
  if (record.mode === "live") {
    const profile = await loadBusinessProfile(wallet);
    if (profile?.verification_status !== "VERIFIED") throw apiErrors.notVerified();
  }

  void touchApiKey(record);
  driveMerchantDeliveries(wallet);
  return { keyId: record.id, mode: record.mode, wallet };
}
