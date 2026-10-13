import type { Address, Hash, Hex } from "viem";

import {
  circleAdapterGetReceipt,
  circleAdapterReadBalanceAndAllowance,
  circleAdapterSubmitPayment,
  circleAdapterWasConsumed,
  computeRecurringFeeUnits,
  isRecurringOperatorConfigured,
} from "@/lib/recurring/circle-adapter";
import { requireScheduleReauthorization } from "@/lib/recurring-service";
import { logRecurringEvent } from "@/lib/recurring/logging";
import { evaluateAutopayPolicy } from "@/lib/recurring/policy";
import { evaluateAutopayRisk } from "@/lib/recurring/risk";
import { isPermanentFailureCode } from "@/lib/recurring/state";
import type {
  RecurringExecutionRecord,
  RecurringScheduleRecord,
} from "@/lib/recurring-utils";

export type PaymentExecutionRequest = {
  existingOccurrences: Array<
    Pick<RecurringExecutionRecord, "id" | "occurrence_number" | "status">
  >;
  occurrence: RecurringExecutionRecord;
  schedule: RecurringScheduleRecord;
};

export type PaymentExecutionSubmitResult =
  | {
      status: "submitted";
      alreadyConsumed: boolean;
      txHash?: Hash;
    }
  | {
      status: "rejected";
      code: string;
      permanent: boolean;
      reason: string;
    };

/**
 * RecurringPaymentService → PaymentExecutionService → CircleAdapter → Arc.
 * Business logic must not call Circle APIs except through this layer.
 */
export async function submitAuthorizedPayment(
  input: PaymentExecutionRequest,
): Promise<PaymentExecutionSubmitResult> {
  const { schedule, occurrence, existingOccurrences } = input;
  const amountUnits = BigInt(occurrence.amount_units ?? schedule.amount_units);
  const feeUnits = computeRecurringFeeUnits(amountUnits);
  const requiredUnits = amountUnits + feeUnits;

  const policy = evaluateAutopayPolicy({ occurrence, schedule });
  logRecurringEvent("recurring.execution.policy", {
    allowed: policy.allowed,
    code: policy.allowed ? "OK" : policy.code,
    occurrenceId: occurrence.id,
    recurringPaymentId: schedule.id,
    userId: schedule.owner_wallet,
  });
  if (!policy.allowed) {
    return {
      code: policy.code,
      permanent: isPermanentFailureCode(policy.code),
      reason: policy.reason,
      status: "rejected",
    };
  }

  if (!isRecurringOperatorConfigured()) {
    return {
      code: "NETWORK_ERROR",
      permanent: false,
      reason: "Autopay operator is not configured on the server.",
      status: "rejected",
    };
  }

  const chainState = await circleAdapterReadBalanceAndAllowance({
    payer: schedule.owner_wallet as Address,
    tokenSymbol: schedule.token_symbol,
  });

  const risk = evaluateAutopayRisk({
    allowance: chainState.allowance,
    balance: chainState.balance,
    existingOccurrences,
    feeUnits,
    occurrence,
    requiredUnits,
    schedule,
  });
  logRecurringEvent("recurring.execution.risk", {
    allowed: risk.allowed,
    code: risk.allowed ? "OK" : risk.code,
    occurrenceId: occurrence.id,
    recurringPaymentId: schedule.id,
    userId: schedule.owner_wallet,
  });
  if (!risk.allowed) {
    // No allowance at all to the current executor: the authorization cannot
    // work (e.g. it approved an older executor). Ask the owner to re-authorize
    // rather than retrying forever. A partial allowance is left to retry.
    if (risk.code === "INSUFFICIENT_ALLOWANCE" && chainState.allowance === 0n) {
      await requireScheduleReauthorization(schedule.id).catch(() => undefined);
      logRecurringEvent("recurring.schedule.reauthorization_required", {
        occurrenceId: occurrence.id,
        recurringPaymentId: schedule.id,
        userId: schedule.owner_wallet,
      });
    }
    return {
      code: risk.code,
      permanent: isPermanentFailureCode(risk.code),
      reason: risk.reason,
      status: "rejected",
    };
  }

  // Schedules authorized before mandates existed have nothing the executor
  // will accept; the owner has to authorize them again.
  if (!schedule.authorization_mandate_id) {
    await requireScheduleReauthorization(schedule.id).catch(() => undefined);
    return {
      code: "PROVIDER_PERMANENT_REJECTION",
      permanent: true,
      reason: "Autopay needs to be authorized again for the new executor.",
      status: "rejected",
    };
  }

  const submitted = await circleAdapterSubmitPayment({
    amountUnits,
    executionId: occurrence.id,
    mandateId: schedule.authorization_mandate_id as Hex,
  });

  if (!submitted.ok) {
    const permanent = submitted.permanent === true;
    return {
      code: permanent
        ? "PROVIDER_PERMANENT_REJECTION"
        : "PROVIDER_TEMPORARY",
      permanent,
      reason: submitted.error,
      status: "rejected",
    };
  }

  return {
    alreadyConsumed: submitted.alreadyConsumed,
    status: "submitted",
    txHash: submitted.txHash,
  };
}

export async function confirmSubmittedPayment(input: {
  occurrenceId: string;
  txHash?: string | null;
}) {
  if (input.txHash) {
    const receipt = await circleAdapterGetReceipt(input.txHash as Hash);
    if (receipt?.status === "success") {
      return { confirmed: true as const, failed: false as const };
    }
    if (receipt?.status === "reverted") {
      return { confirmed: false as const, failed: true as const };
    }
  }

  const consumed = await circleAdapterWasConsumed(input.occurrenceId);
  if (consumed) {
    return { confirmed: true as const, failed: false as const };
  }

  return { confirmed: false as const, failed: false as const };
}
