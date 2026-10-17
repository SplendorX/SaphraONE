import { apiBaseUrl } from "@/lib/developers/site";

/**
 * Errors of the public Checkout API. Kept apart from the app's
 * BusinessHttpError so the JSON shape sites code against stays stable:
 *
 *   { "error": { "type": "...", "code": "...", "message": "...", "param": "..." } }
 */

export type ApiErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "rate_limit_error"
  | "api_error";

export class MerchantApiError extends Error {
  readonly type: ApiErrorType;
  readonly code: string;
  readonly status: number;
  readonly param?: string;

  constructor(input: {
    type: ApiErrorType;
    code: string;
    status: number;
    message: string;
    param?: string;
  }) {
    super(input.message);
    this.name = "MerchantApiError";
    this.type = input.type;
    this.code = input.code;
    this.status = input.status;
    this.param = input.param;
  }
}

export function isMerchantApiError(error: unknown): error is MerchantApiError {
  return error instanceof MerchantApiError;
}

export const apiErrors = {
  missingKey: () =>
    new MerchantApiError({
      code: "api_key_missing",
      message: "Send your secret key as `Authorization: Bearer sk_…`.",
      status: 401,
      type: "authentication_error",
    }),
  invalidKey: () =>
    new MerchantApiError({
      code: "api_key_invalid",
      message: "That API key is not valid, or it was revoked.",
      status: 401,
      type: "authentication_error",
    }),
  wrongMode: (mode: "live" | "test") =>
    new MerchantApiError({
      code: "api_key_wrong_mode",
      message:
        mode === "test"
          ? `This is a test key. Use it with the sandbox API (${apiBaseUrl("sandbox")}).`
          : `This is a live key. Use it with the live API (${apiBaseUrl("live")}).`,
      status: 401,
      type: "authentication_error",
    }),
  notBusiness: () =>
    new MerchantApiError({
      code: "account_not_business",
      message: "This key's account is no longer a Business account.",
      status: 403,
      type: "permission_error",
    }),
  notVerified: () =>
    new MerchantApiError({
      code: "business_not_verified",
      message: "Live payments need a verified business. Finish verification in SaphraONE.",
      status: 403,
      type: "permission_error",
    }),
  invalid: (message: string, param?: string, code = "parameter_invalid") =>
    new MerchantApiError({ code, message, param, status: 400, type: "invalid_request_error" }),
  invalidBody: () =>
    new MerchantApiError({
      code: "body_invalid",
      message: "Send a JSON object body with `Content-Type: application/json`.",
      status: 400,
      type: "invalid_request_error",
    }),
  sessionNotFound: () =>
    new MerchantApiError({
      code: "resource_missing",
      message: "No such checkout session.",
      param: "id",
      status: 404,
      type: "not_found_error",
    }),
  sessionState: (message: string) =>
    new MerchantApiError({
      code: "session_state_invalid",
      message,
      status: 409,
      type: "invalid_request_error",
    }),
  rateLimited: () =>
    new MerchantApiError({
      code: "rate_limited",
      message: "Too many requests. Slow down and retry with backoff.",
      status: 429,
      type: "rate_limit_error",
    }),
};
