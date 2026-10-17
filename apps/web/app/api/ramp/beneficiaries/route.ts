import { type NextRequest } from "next/server";

import { readJsonBody } from "@/lib/business/http";
import { rampErrors } from "@/lib/ramp/errors";
import { rampError, rampJson, requireRampRateLimit, requireRampWallet } from "@/lib/ramp/http";
import { addBeneficiary, deleteBeneficiary, listBeneficiaries } from "@/lib/ramp/service";

export const runtime = "nodejs";

/** The signed-in wallet's saved Naira bank accounts. */
export async function GET(request: NextRequest) {
  try {
    const wallet = await requireRampWallet(request);
    return rampJson({ beneficiaries: await listBeneficiaries(wallet) });
  } catch (error) {
    return rampError(error);
  }
}

/** Save `{ bankCode, accountNumber }`; the name comes from the bank. */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body) throw rampErrors.invalid("A valid JSON body is required.");
    const wallet = await requireRampWallet(request, body);
    await requireRampRateLimit(`beneficiary:${wallet}`, 20, 3600);
    const beneficiary = await addBeneficiary({
      wallet,
      bankCode: body.bankCode,
      accountNumber: body.accountNumber,
    });
    return rampJson({ beneficiary }, 201);
  } catch (error) {
    return rampError(error);
  }
}

/** Remove a saved account: `?id=…`. */
export async function DELETE(request: NextRequest) {
  try {
    const wallet = await requireRampWallet(request);
    return rampJson(await deleteBeneficiary({ wallet, id: request.nextUrl.searchParams.get("id") }));
  } catch (error) {
    return rampError(error);
  }
}
