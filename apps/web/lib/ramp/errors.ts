import { BusinessHttpError } from "@/lib/business/errors";

export const rampErrors = {
  unauthorized: () =>
    new BusinessHttpError({
      code: "UNAUTHORIZED",
      status: 401,
      userMessage: "Sign in again to continue.",
    }),
  unavailable: (message?: string) =>
    new BusinessHttpError({
      code: "RAMP_UNAVAILABLE",
      status: 503,
      userMessage: message ?? "Bank deposits and withdrawals are unavailable right now.",
    }),
  invalid: (message: string) =>
    new BusinessHttpError({
      code: "INVALID",
      status: 400,
      userMessage: message,
    }),
  notFound: (entity = "Order") =>
    new BusinessHttpError({
      code: "NOT_FOUND",
      status: 404,
      userMessage: `${entity} was not found.`,
    }),
  conflict: (message: string) =>
    new BusinessHttpError({
      code: "CONFLICT",
      status: 409,
      userMessage: message,
    }),
  rateLimited: () =>
    new BusinessHttpError({
      code: "RATE_LIMITED",
      status: 429,
      userMessage: "Too many attempts. Wait a moment and try again.",
    }),
  provider: (message: string) =>
    new BusinessHttpError({
      code: "RAMP_PROVIDER_ERROR",
      status: 502,
      userMessage: message,
    }),
};
