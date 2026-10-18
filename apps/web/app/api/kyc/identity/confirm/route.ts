import { type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/business/http";
import { kycErrors } from "@/lib/kyc/errors";
import { kycError, kycJson, requireKycRateLimit, requireKycWallet } from "@/lib/kyc/http";
import { confirmIdentity } from "@/lib/kyc/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw kycErrors.invalid("A valid JSON body is required.");
    const wallet = await requireKycWallet(request, body);
    await requireKycRateLimit(`confirm:${wallet}`, 10, 600);
    return kycJson(await confirmIdentity(wallet, body.confirm));
  } catch (error) {
    return kycError(error);
  }
}
