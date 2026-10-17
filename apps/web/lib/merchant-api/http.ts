// Server-only. Responses of the public Checkout API (/api/v1).
import { NextResponse, type NextRequest } from "next/server";

import { isBusinessHttpError } from "@/lib/business/errors";
import { appUrlFor, developerSurfaceFor, requestHost } from "@/lib/developers/site";
import { apiErrors, isMerchantApiError } from "@/lib/merchant-api/errors";
import { ApiParamError } from "@/lib/merchant-api/validate";
import { consumeRateLimit } from "@/lib/rate-limit";

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function jsonApi(body: unknown, status = 200) {
  return noStore(NextResponse.json(body, { status }));
}

export function jsonApiError(error: unknown) {
  if (error instanceof ApiParamError) {
    error = apiErrors.invalid(error.message, error.param);
  }
  if (isMerchantApiError(error)) {
    return noStore(
      NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.message,
            type: error.type,
            ...(error.param ? { param: error.param } : {}),
          },
        },
        { status: error.status },
      ),
    );
  }
  // The shared charge engine speaks BusinessHttpError; keep its message.
  if (isBusinessHttpError(error)) {
    return noStore(
      NextResponse.json(
        {
          error: {
            code: error.code.toLowerCase(),
            message: error.userMessage,
            type: error.status >= 500 ? "api_error" : "invalid_request_error",
          },
        },
        { status: error.status },
      ),
    );
  }
  console.error("[merchant-api]", error);
  return noStore(
    NextResponse.json(
      {
        error: {
          code: "internal_error",
          message: "Something went wrong on our side. Retry with the same Idempotency-Key.",
          type: "api_error",
        },
      },
      { status: 500 },
    ),
  );
}

export async function readApiBody(request: NextRequest) {
  try {
    const data = await request.json();
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    // Falls through to the error below.
  }
  throw apiErrors.invalidBody();
}

/** Throws a 429 once `key` passes `max` hits per `windowSeconds`. */
export async function requireApiRateLimit(key: string, max: number, windowSeconds: number) {
  if (!(await consumeRateLimit(key, max, windowSeconds))) throw apiErrors.rateLimited();
}

/** The Idempotency-Key header (8–128 characters), or null. */
export function readApiIdempotencyKey(request: NextRequest) {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) return null;
  if (key.length < 8 || key.length > 128) {
    throw apiErrors.invalid("Idempotency-Key must be 8 to 128 characters.", "Idempotency-Key");
  }
  return key;
}

function appUrlOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

/**
 * Where the hosted checkout page lives: the app's public URL, else this host.
 * A call through the API or portal host never links to that host: its pages
 * are on the app.
 */
export function publicOrigin(request: NextRequest) {
  const configured = appUrlOrigin();
  if (configured) return configured;
  if (developerSurfaceFor(requestHost(request.headers))) return appUrlFor();
  return request.nextUrl.origin;
}

/** The same outside a request (webhooks): the app's public URL, else this mode's app. */
export function configuredAppOrigin() {
  return appUrlOrigin() ?? appUrlFor();
}
