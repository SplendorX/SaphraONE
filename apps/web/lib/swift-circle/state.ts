import type {
  CircleInvitationStatus,
  CirclePaymentStatus,
  CircleRequestStatus,
  CircleWithdrawalStatus,
} from "@/lib/swift-circle/types";

function allow<T extends string>(
  current: T,
  next: T,
  map: Record<T, readonly T[]>,
) {
  return (map[current] ?? []).includes(next);
}

const invitationTransitions: Record<
  CircleInvitationStatus,
  readonly CircleInvitationStatus[]
> = {
  pending: ["accepted", "declined", "expired", "cancelled"],
  accepted: [],
  declined: [],
  expired: [],
  cancelled: [],
};

const paymentTransitions: Record<
  CirclePaymentStatus,
  readonly CirclePaymentStatus[]
> = {
  proposed: ["executing", "cancelled", "failed"],
  executing: ["submitted", "failed", "cancelled"],
  submitted: ["confirmed", "partially_completed", "failed"],
  confirmed: [],
  partially_completed: [],
  failed: [],
  cancelled: [],
};

const requestTransitions: Record<
  CircleRequestStatus,
  readonly CircleRequestStatus[]
> = {
  pending: ["paid", "declined", "cancelled", "expired"],
  paid: [],
  declined: [],
  cancelled: [],
  expired: [],
};

const withdrawalTransitions: Record<
  CircleWithdrawalStatus,
  readonly CircleWithdrawalStatus[]
> = {
  draft: ["pending_policy", "cancelled"],
  pending_policy: ["pending_approval", "approved", "rejected", "cancelled", "expired"],
  pending_approval: [
    "approved",
    "rejected",
    "cancelled",
    "expired",
    "pending_approval",
  ],
  approved: ["executing", "cancelled", "expired", "failed"],
  executing: ["submitted", "failed", "approved"],
  submitted: ["confirmed", "failed"],
  confirmed: [],
  rejected: [],
  cancelled: [],
  expired: [],
  failed: ["executing"],
};

export function canTransitionInvitation(
  current: CircleInvitationStatus,
  next: CircleInvitationStatus,
) {
  return allow(current, next, invitationTransitions);
}

export function canTransitionPayment(
  current: CirclePaymentStatus,
  next: CirclePaymentStatus,
) {
  return allow(current, next, paymentTransitions);
}

export function canTransitionRequest(
  current: CircleRequestStatus,
  next: CircleRequestStatus,
) {
  return allow(current, next, requestTransitions);
}

export function canTransitionWithdrawal(
  current: CircleWithdrawalStatus,
  next: CircleWithdrawalStatus,
) {
  return allow(current, next, withdrawalTransitions);
}

export function assertWithdrawalTransition(
  current: CircleWithdrawalStatus,
  next: CircleWithdrawalStatus,
) {
  if (!canTransitionWithdrawal(current, next)) {
    throw new Error(`Invalid withdrawal transition: ${current} → ${next}.`);
  }
}


export function isOpenWithdrawal(status: CircleWithdrawalStatus) {
  return (
    status === "draft" ||
    status === "pending_policy" ||
    status === "pending_approval" ||
    status === "approved" ||
    status === "executing" ||
    status === "submitted"
  );
}
