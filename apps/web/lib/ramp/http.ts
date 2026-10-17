// Server-only. Shared bits of the ramp API routes.
import type { NextRequest, NextResponse } from "next/server";

import { isBusinessHttpError } from "@/lib/business/errors";
import { jsonBusinessError, jsonOk } from "@/lib/business/http";
import { consumeRateLimit } from "@/lib/rate-limit";
import { rampErrors } from "@/lib/ramp/errors";
import { resolveSessionActorWallet, sessionControlsWallet } from "@/lib/recurring-auth";

/** The signed-in wallet the request acts for, or a 401. */
export async function requireRampWallet(request: NextRequest, body?: Record<string, unknown> | null) {
  const requested = body?.wallet ?? request.nextUrl.searchParams.get("wallet");
  const wallet = await resolveSessionActorWallet(requested);
  if (!wallet || !(await sessionControlsWallet(wallet))) throw rampErrors.unauthorized();
  return wallet;
}

/** Throws a 429 once `key` passes `max` hits per `windowSeconds`. */
export async function requireRampRateLimit(key: string, max: number, windowSeconds: number) {
  if (!(await consumeRateLimit(`ramp-${key}`, max, windowSeconds))) throw rampErrors.rateLimited();
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function rampJson(body: unknown, status = 200) {
  return noStore(jsonOk(body, status));
}

/** Known errors keep their message; anything else is logged, never shown. */
export function rampError(error: unknown) {
  if (isBusinessHttpError(error)) return noStore(jsonBusinessError(error));
  console.error("[ramp]", error);
  return rampJson({ message: "Something went wrong. Try again in a moment." }, 500);
}
