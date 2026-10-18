import { type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/business/http";
import { kycErrors } from "@/lib/kyc/errors";
import { kycError, kycJson, requireKycRateLimit, requireKycWallet } from "@/lib/kyc/http";
import { submitId } from "@/lib/kyc/service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw kycErrors.invalid("A valid JSON body is required.");
    const wallet = await requireKycWallet(request, body);
    await requireKycRateLimit(`identity:${wallet}`, 5, 86_400);
    return kycJson(
      await submitId(wallet, {
        dob: body.dob,
        firstName: body.firstName,
        lastName: body.lastName,
        number: body.number,
        type: body.type,
      }),
    );
  } catch (error) {
    return kycError(error);
  }
}
