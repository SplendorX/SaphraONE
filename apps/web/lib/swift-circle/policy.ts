import { circleErrors } from "@/lib/swift-circle/errors";
import { parseUnits } from "@/lib/swift-circle/money";
import type {
  CircleProductType,
  CircleRole,
  CircleWithdrawalPolicyRecord,
} from "@/lib/swift-circle/types";

export function matchWithdrawalPolicy(input: {
  amountUnits: bigint;
  policies: CircleWithdrawalPolicyRecord[];
  productType: CircleProductType;
}): CircleWithdrawalPolicyRecord {
  const active = input.policies
    .filter(
      (policy) =>
        policy.active &&
        policy.product_type === input.productType,
    )
    .sort(
      (a, b) =>
        Number(parseUnits(a.minimum_amount_units) - parseUnits(b.minimum_amount_units)),
    );

  const matched = active.find((policy) => {
    const min = parseUnits(policy.minimum_amount_units);
    const max = policy.maximum_amount_units
      ? parseUnits(policy.maximum_amount_units)
      : null;
    if (input.amountUnits < min) return false;
    if (max !== null && input.amountUnits >= max) return false;
    return true;
  });

  if (!matched) {
    throw circleErrors.invalid("No withdrawal policy covers this amount.");
  }
  return matched;
}

export function canInitiateWithdrawal(input: {
  policy: CircleWithdrawalPolicyRecord;
  role: CircleRole;
}) {
  return input.policy.eligible_roles.includes(input.role);
}

