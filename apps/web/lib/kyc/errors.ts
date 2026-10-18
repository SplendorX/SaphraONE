import { BusinessHttpError } from "@/lib/business/errors";

export const kycErrors = {
  unauthorized: () =>
    new BusinessHttpError({
      code: "UNAUTHORIZED",
      status: 401,
      userMessage: "Sign in again to continue.",
    }),
  unavailable: (message?: string) =>
    new BusinessHttpError({
      code: "KYC_UNAVAILABLE",
      status: 503,
      userMessage: message ?? "Verification is unavailable right now. Try again shortly.",
    }),
  invalid: (message: string) =>
    new BusinessHttpError({
      code: "INVALID",
      status: 400,
      userMessage: message,
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
  required: (requiredTier: number) =>
    new BusinessHttpError({
      code: "KYC_REQUIRED",
      status: 403,
      userMessage: "Verify your identity to continue.",
      details: { reason: "kyc", requiredTier },
    }),
  limitExceeded: (remaining: string, nextTier: number | null, currency: "NGN" | "USDC") =>
    new BusinessHttpError({
      code: "KYC_LIMIT",
      status: 403,
      userMessage:
        remaining === "0"
          ? "You've reached today's limit. Raise your limit with a selfie, or try again tomorrow."
          : `You have ${currency === "NGN" ? `₦${remaining}` : `${remaining} USDC`} left today.`,
      details: { reason: "kyc_limit", remaining, nextTier },
    }),
  beneficiaryNameMismatch: () =>
    new BusinessHttpError({
      code: "BENEFICIARY_NAME_MISMATCH",
      status: 403,
      userMessage: "Withdrawals can only go to an account in your verified name.",
    }),
  manualReview: () =>
    new BusinessHttpError({
      code: "KYC_MANUAL_REVIEW",
      status: 403,
      userMessage: "We'll review within 24h.",
    }),
};
