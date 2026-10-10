import type { CircleRecord, CircleRiskDecision } from "@/lib/swift-circle/types";

export type CircleRiskInput = {
  amountUnits: bigint;
  circle: CircleRecord;
  memberCount: number;
  recentRoleChanges: number;
  recentPolicyChanges: number;
  recentWithdrawals: number;
  operation: "payment" | "contribution" | "withdrawal";
};

export type CircleRiskResult = {
  decision: CircleRiskDecision;
  reasons: string[];
};

export function evaluateCircleRisk(input: CircleRiskInput): CircleRiskResult {
  const reasons: string[] = [];
  let decision: CircleRiskDecision = "ALLOW";

  const created = Date.parse(input.circle.created_at);
  const ageMs = Number.isFinite(created) ? Date.now() - created : 0;
  if (ageMs < 10 * 60 * 1000 && input.operation === "withdrawal") {
    reasons.push("Circle is less than 10 minutes old.");
    decision = "REVIEW";
  }

  if (input.memberCount < 2 && input.operation === "withdrawal") {
    reasons.push("Circle has fewer than two members.");
    decision = "REVIEW";
  }

  if (input.recentRoleChanges > 0 && input.operation === "withdrawal") {
    reasons.push("A role changed recently.");
    decision = "REVIEW";
  }

  if (input.recentPolicyChanges > 0 && input.operation === "withdrawal") {
    reasons.push("Withdrawal policy changed recently.");
    decision = "REVIEW";
  }

  if (input.recentWithdrawals >= 3) {
    reasons.push("Multiple withdrawals in a short period.");
    decision = "BLOCK";
  }

  if (input.amountUnits <= 0n) {
    reasons.push("Amount is invalid.");
    decision = "BLOCK";
  }

  if (input.circle.financial_frozen) {
    reasons.push("Circle financial operations are frozen.");
    decision = "BLOCK";
  }

  return { decision, reasons };
}

