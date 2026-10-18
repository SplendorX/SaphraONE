export class BusinessHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    code: string;
    status: number;
    userMessage: string;
    cause?: string;
    details?: Record<string, unknown>;
  }) {
    super(input.cause ?? input.userMessage);
    this.name = "BusinessHttpError";
    this.code = input.code;
    this.status = input.status;
    this.userMessage = input.userMessage;
    this.details = input.details;
  }
}

export const businessErrors = {
  unauthorized: () =>
    new BusinessHttpError({
      code: "UNAUTHORIZED",
      status: 401,
      userMessage: "Connect the active wallet profile to continue.",
    }),
  forbidden: (message?: string) =>
    new BusinessHttpError({
      code: "FORBIDDEN",
      status: 403,
      userMessage: message ?? "You don’t have permission to perform this action.",
    }),
  notFound: (entity = "Workspace") =>
    new BusinessHttpError({
      code: "NOT_FOUND",
      status: 404,
      userMessage: `${entity} was not found.`,
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
};

export function isBusinessHttpError(error: unknown): error is BusinessHttpError {
  return error instanceof BusinessHttpError;
}
