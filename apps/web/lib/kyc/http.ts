// Server-only. Shared bits of the KYC API routes.
import type { NextRequest, NextResponse } from "next/server";

import { isBusinessHttpError } from "@/lib/business/errors";
import { jsonBusinessError, jsonOk } from "@/lib/business/http";
import { kycErrors } from "@/lib/kyc/errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { resolveSessionActorWallet, sessionControlsWallet } from "@/lib/recurring-auth";

export async function requireKycWallet(request: NextRequest, body?: Record<string, unknown> | null) {
  const requested = body?.wallet ?? request.nextUrl.searchParams.get("wallet");
  const wallet = await resolveSessionActorWallet(requested);
  if (!wallet || !(await sessionControlsWallet(wallet))) throw kycErrors.unauthorized();
  return wallet;
}

export async function requireKycRateLimit(key: string, max: number, windowSeconds: number) {
  if (!(await consumeRateLimit(`kyc-${key}`, max, windowSeconds))) throw kycErrors.rateLimited();
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function kycJson(body: unknown, status = 200) {
  return noStore(jsonOk(body, status));
}

export function kycError(error: unknown) {
  if (isBusinessHttpError(error)) return noStore(jsonBusinessError(error));
  console.error("[kyc]", error);
  return kycJson({ message: "Something went wrong. Try again in a moment." }, 500);
}
