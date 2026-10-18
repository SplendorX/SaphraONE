import { type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/business/http";
import { kycErrors } from "@/lib/kyc/errors";
import { kycError, kycJson, requireKycRateLimit, requireKycWallet } from "@/lib/kyc/http";
import { submitTin } from "@/lib/kyc/kyb-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw kycErrors.invalid("A valid JSON body is required.");
    const wallet = await requireKycWallet(request, body);
    await requireKycRateLimit(`tin:${wallet}`, 5, 86_400);
    return kycJson(await submitTin(wallet, { number: body.number }));
  } catch (error) {
    return kycError(error);
  }
}
