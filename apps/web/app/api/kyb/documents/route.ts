import { type NextRequest } from "next/server";

import { kycErrors } from "@/lib/kyc/errors";
import { kycError, kycJson, requireKycRateLimit, requireKycWallet } from "@/lib/kyc/http";
import { KYB_DOC_MAX_BYTES, uploadKybDocument } from "@/lib/kyc/kyb-documents";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > KYB_DOC_MAX_BYTES + 64 * 1024) throw kycErrors.invalid("Send a PDF, JPEG or PNG under 3 MB.");
    const form = await request.formData().catch(() => null);
    if (!form) throw kycErrors.invalid("Attach a document.");
    const wallet = await requireKycWallet(request, { wallet: form.get("wallet") });
    await requireKycRateLimit(`kyb-doc:${wallet}`, 10, 86_400);
    const file = form.get("file");
    if (!(file instanceof File)) throw kycErrors.invalid("Attach a document.");
    return kycJson(await uploadKybDocument(wallet, file));
  } catch (error) {
    return kycError(error);
  }
}
