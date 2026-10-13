import { encodeFunctionData, type Address, type Hex } from "viem";

import {
  swiftBatchAbi,
  swiftBatchAddress,
  swiftBatchFeeBasisPoints,
  swiftBatchMaxRecipients,
} from "@/lib/contracts";
import {
  bulkFeeUnits,
  SEND_FEE_BPS,
  sendFeeUnits,
  usesLegacyBulkFee,
  usesLegacySendFee,
} from "@/lib/fees";
import { circleErrors } from "@/lib/swift-circle/errors";
import { sumUnits } from "@/lib/swift-circle/money";

export type CirclePayRail = "single" | "swiftbatch";

export type CirclePayRecipient = {
  wallet: string;
  amount: string;
  units: bigint;
  username?: string | null;
};

export type CirclePayExecution = {
  method: CirclePayRail;
  contractAddress: string | null;
  callData: Hex | null;
  token: string;
  spender: string | null;
  requiredAllowanceUnits: string;
  feeBps: number;
  feeUnits: string;
  totalUnits: string;
  recipientCount: number;
  swiftbatchId: string | null;
};

export function selectCirclePayRail(recipientCount: number): CirclePayRail {
  if (recipientCount <= 0) {
    throw new Error("At least one recipient is required.");
  }
  return recipientCount === 1 ? "single" : "swiftbatch";
}

export function requireConfiguredSwiftBatch() {
  const address = swiftBatchAddress.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw circleErrors.invalid(
      "BulkPay is not configured. Multi-recipient Circle Pay cannot run sequential payments.",
    );
  }
  return address as Address;
}

export function reconcileBatchStatus(
  recipientStatuses: readonly string[],
): "completed" | "partially_completed" | "failed" | "submitted" {
  if (recipientStatuses.length === 0) return "failed";
  const confirmed = recipientStatuses.filter((status) => status === "confirmed").length;
  const failed = recipientStatuses.filter((status) => status === "failed").length;
  if (confirmed === recipientStatuses.length) return "completed";
  if (failed === recipientStatuses.length) return "failed";
  if (confirmed > 0 && confirmed < recipientStatuses.length) {
    return "partially_completed";
  }
  return "submitted";
}

export function everyonePaidCopy(recipientStatuses: readonly string[]) {
  const status = reconcileBatchStatus(recipientStatuses);
  if (status === "completed") return "Everyone paid";
  if (status === "partially_completed") {
    const paid = recipientStatuses.filter((value) => value === "confirmed").length;
    return `${paid} of ${recipientStatuses.length} paid`;
  }
  if (status === "failed") return "Payment failed";
  return "Payment processing";
}

export function buildCirclePayExecution(input: {
  recipients: CirclePayRecipient[];
  token: Address;
  swiftbatchId?: string | null;
}): CirclePayExecution {
  const recipientCount = input.recipients.length;
  const method = selectCirclePayRail(recipientCount);
  const totalUnits = sumUnits(input.recipients.map((row) => row.units));

  if (method === "single") {
    // One recipient goes through the send router: its band fee.
    const feeUnits = sendFeeUnits(totalUnits);
    return {
      method,
      contractAddress: null,
      callData: null,
      token: input.token,
      spender: null,
      requiredAllowanceUnits: (totalUnits + feeUnits).toString(),
      feeBps: usesLegacySendFee() ? SEND_FEE_BPS : 0,
      feeUnits: feeUnits.toString(),
      totalUnits: totalUnits.toString(),
      recipientCount,
      swiftbatchId: null,
    };
  }

  if (recipientCount > swiftBatchMaxRecipients) {
    throw circleErrors.invalid(
      `BulkPay supports up to ${swiftBatchMaxRecipients} recipients.`,
    );
  }

  const batchAddress = requireConfiguredSwiftBatch();
  const feeUnits = bulkFeeUnits(totalUnits, recipientCount, batchAddress);
  const recipients = input.recipients.map((row) => row.wallet as Address);
  const amounts = input.recipients.map((row) => row.units);
  const callData = encodeFunctionData({
    abi: swiftBatchAbi,
    functionName: "sendBatch",
    args: [input.token, recipients, amounts],
  });

  return {
    method,
    contractAddress: batchAddress,
    callData,
    token: input.token,
    spender: batchAddress,
    requiredAllowanceUnits: (totalUnits + feeUnits).toString(),
    feeBps: usesLegacyBulkFee(batchAddress) ? swiftBatchFeeBasisPoints : 0,
    feeUnits: feeUnits.toString(),
    totalUnits: totalUnits.toString(),
    recipientCount,
    swiftbatchId: input.swiftbatchId ?? crypto.randomUUID(),
  };
}
