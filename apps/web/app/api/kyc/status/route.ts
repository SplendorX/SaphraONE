import { type NextRequest } from "next/server";

import { kycError, kycJson, requireKycWallet } from "@/lib/kyc/http";
import { getKycState } from "@/lib/kyc/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const wallet = await requireKycWallet(request);
    return kycJson(await getKycState(wallet));
  } catch (error) {
    return kycError(error);
  }
}
