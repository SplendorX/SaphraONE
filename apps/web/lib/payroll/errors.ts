export type PayrollErrorCode =
  | "BUSINESS_ACCOUNT_REQUIRED"
  | "TEAM_MEMBER_NOT_FOUND"
  | "TEAM_MEMBER_NOT_OWNED"
  | "PAYROLL_RUN_NOT_FOUND"
  | "PAYROLL_INVALID_STATE"
  | "PAYROLL_ALREADY_APPROVED"
  | "PAYROLL_ALREADY_EXECUTING"
  | "PAYROLL_ALREADY_COMPLETED"
  | "INSUFFICIENT_PAYROLL_BALANCE"
  | "INVALID_PAYMENT_DESTINATION"
  | "PAYROLL_ITEM_ALREADY_PAID"
  | "PAYROLL_ITEM_NOT_RETRYABLE"
  | "DUPLICATE_PAYROLL_EXECUTION"
  | "PAYROLL_INVALID_INPUT";

export class PayrollError extends Error {
  readonly code: PayrollErrorCode;
  readonly status: number;
  readonly userMessage: string;

  constructor(code: PayrollErrorCode, userMessage: string, status = 400) {
    super(userMessage);
    this.name = "PayrollError";
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
  }
}

export function isPayrollError(error: unknown): error is PayrollError {
  return error instanceof PayrollError;
}

export const payrollErrors = {
  businessAccountRequired(msg = "Only SaphraONE Business accounts can access Payroll.") {
    return new PayrollError("BUSINESS_ACCOUNT_REQUIRED", msg, 403);
  },
  teamMemberNotFound(msg = "Team member was not found.") {
    return new PayrollError("TEAM_MEMBER_NOT_FOUND", msg, 404);
  },
  teamMemberNotOwned(msg = "You do not have permission to access this team member.") {
    return new PayrollError("TEAM_MEMBER_NOT_OWNED", msg, 403);
  },
  runNotFound(msg = "Payroll run was not found.") {
    return new PayrollError("PAYROLL_RUN_NOT_FOUND", msg, 404);
  },
  invalidState(msg = "Invalid payroll state transition.") {
    return new PayrollError("PAYROLL_INVALID_STATE", msg, 400);
  },
  alreadyApproved(msg = "This payroll run has already been approved.") {
    return new PayrollError("PAYROLL_ALREADY_APPROVED", msg, 400);
  },
  alreadyExecuting(msg = "This payroll run is already processing.") {
    return new PayrollError("PAYROLL_ALREADY_EXECUTING", msg, 409);
  },
  alreadyCompleted(msg = "This payroll run is already completed.") {
    return new PayrollError("PAYROLL_ALREADY_COMPLETED", msg, 400);
  },
  insufficientBalance(required: string, available: string, shortfall: string, asset = "USDC") {
    return new PayrollError(
      "INSUFFICIENT_PAYROLL_BALANCE",
      `Payroll cannot be executed. Required: ${required} ${asset}, Available: ${available} ${asset}, Shortfall: ${shortfall} ${asset}.`,
      400,
    );
  },
  invalidDestination(msg = "Invalid payment destination. Enter a valid ONE ID or 0x… wallet address.") {
    return new PayrollError("INVALID_PAYMENT_DESTINATION", msg, 400);
  },
  itemAlreadyPaid(msg = "This recipient payment has already settled.") {
    return new PayrollError("PAYROLL_ITEM_ALREADY_PAID", msg, 400);
  },
  itemNotRetryable(msg = "This payment item cannot be retried.") {
    return new PayrollError("PAYROLL_ITEM_NOT_RETRYABLE", msg, 400);
  },
  duplicateExecution(msg = "Duplicate payroll execution detected.") {
    return new PayrollError("DUPLICATE_PAYROLL_EXECUTION", msg, 409);
  },
  invalidInput(msg = "Invalid payroll input.") {
    return new PayrollError("PAYROLL_INVALID_INPUT", msg, 400);
  },
};
