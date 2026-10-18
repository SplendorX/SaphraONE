import { type NextRequest } from "next/server";

import { kycError, kycJson, requireKycWallet } from "@/lib/kyc/http";
import { getKybState } from "@/lib/kyc/kyb-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const wallet = await requireKycWallet(request);
    return kycJson(await getKybState(wallet));
  } catch (error) {
    return kycError(error);
  }
}
