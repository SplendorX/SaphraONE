import type { ArcTokenSymbol } from "@/lib/tokens";

export const circleRoles = ["host", "admin", "member"] as const;
export type CircleRole = (typeof circleRoles)[number];

export const circleMemberStatuses = ["active", "removed", "left"] as const;
export type CircleMemberStatus = (typeof circleMemberStatuses)[number];

export const circleInvitationStatuses = [
  "pending",
  "accepted",
  "declined",
  "expired",
  "cancelled",
] as const;
export type CircleInvitationStatus = (typeof circleInvitationStatuses)[number];

export const circlePaymentModes = [
  "individual",
  "multiple",
  "everyone",
  "equal_split",
  "custom_split",
] as const;
export type CirclePaymentMode = (typeof circlePaymentModes)[number];

export const circlePaymentStatuses = [
  "proposed",
  "executing",
  "submitted",
  "confirmed",
  "partially_completed",
  "failed",
  "cancelled",
] as const;
export type CirclePaymentStatus = (typeof circlePaymentStatuses)[number];

export const circleRequestStatuses = [
  "pending",
  "paid",
  "declined",
  "cancelled",
  "expired",
] as const;
export type CircleRequestStatus = (typeof circleRequestStatuses)[number];

export const circleWithdrawalStatuses = [
  "draft",
  "pending_policy",
  "pending_approval",
  "approved",
  "executing",
  "submitted",
  "confirmed",
  "rejected",
  "cancelled",
  "expired",
  "failed",
] as const;
export type CircleWithdrawalStatus = (typeof circleWithdrawalStatuses)[number];

export const circleProductTypes = ["save", "earn"] as const;
export type CircleProductType = (typeof circleProductTypes)[number];

export const circleRiskDecisions = ["ALLOW", "REVIEW", "BLOCK"] as const;
export type CircleRiskDecision = (typeof circleRiskDecisions)[number];

export const circleAuditActions = [
  "CIRCLE_CREATED",
  "CIRCLE_UPDATED",
  "MEMBER_INVITED",
  "MEMBER_JOINED",
  "MEMBER_LEFT",
  "MEMBER_REMOVED",
  "ROLE_CHANGED",
  "HOST_TRANSFERRED",
  "POLICY_CHANGED",
  "PAYMENT_CREATED",
  "PAYMENT_SUBMITTED",
  "PAYMENT_CONFIRMED",
  "REQUEST_CREATED",
  "REQUEST_PAID",
  "REQUEST_DECLINED",
  "SAVE_CONTRIBUTION",
  "SAVE_POCKET_CREATED",
  "EARN_CONTRIBUTION",
  "WITHDRAWAL_CREATED",
  "WITHDRAWAL_APPROVED",
  "WITHDRAWAL_REJECTED",
  "WITHDRAWAL_EXECUTED",
  "CIRCLE_FROZEN",
  "CIRCLE_UNFROZEN",
  "MESSAGE_DELETED",
  "MESSAGE_REPORTED",
] as const;
export type CircleAuditAction = (typeof circleAuditActions)[number];

export type CircleRecord = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  creator_user_wallet: string;
  host_user_wallet: string;
  currency: ArcTokenSymbol;
  visibility: "private";
  status: "active" | "archived";
  financial_frozen: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type CircleMemberRecord = {
  id: string;
  circle_id: string;
  user_wallet: string;
  role: CircleRole;
  status: CircleMemberStatus;
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
  updated_at: string;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
};

export type CircleInvitationRecord = {
  id: string;
  circle_id: string;
  inviter_user_wallet: string;
  invitee_user_wallet: string;
  invitee_username: string | null;
  status: CircleInvitationStatus;
  expires_at: string;
  created_at: string;
  responded_at: string | null;
  circle_name?: string;
  inviter_username?: string | null;
};

export type CircleMessageRecord = {
  id: string;
  circle_id: string;
  sender_user_wallet: string | null;
  message_type: "text" | "system" | "financial_card";
  content: string;
  reply_to_message_id: string | null;
  delivery_state: "sent" | "delivered";
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  metadata: Record<string, unknown>;
  sender_username?: string | null;
  sender_display_name?: string | null;
  sender_avatar_url?: string | null;
};

export type CirclePaymentIntentRecord = {
  id: string;
  circle_id: string;
  sender_user_wallet: string;
  total_amount: string;
  total_amount_units: string;
  asset: ArcTokenSymbol;
  payment_mode: CirclePaymentMode;
  note: string | null;
  status: CirclePaymentStatus;
  execution_method?: "single" | "swiftbatch";
  swiftbatch_id?: string | null;
  batch_status?: string | null;
  recipient_count?: number;
  completed_at?: string | null;
  idempotency_key: string;
  risk_decision: CircleRiskDecision;
  created_at: string;
  updated_at: string;
  recipients?: CirclePaymentRecipientRecord[];
};

export type CirclePaymentRecipientRecord = {
  id: string;
  payment_intent_id: string;
  recipient_user_wallet: string;
  amount: string;
  amount_units: string;
  transaction_id: string | null;
  tx_hash: string | null;
  status: "pending" | "submitted" | "confirmed" | "failed";
  created_at: string;
  updated_at: string;
  username?: string | null;
};

export type CircleRequestGroupRecord = {
  id: string;
  circle_id: string;
  requester_user_wallet: string;
  per_amount: string;
  per_amount_units: string;
  asset: ArcTokenSymbol;
  reason: string | null;
  target_mode: "one" | "multiple" | "everyone";
  status: "open" | "completed" | "cancelled" | "expired";
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  paid_count?: number;
  target_count?: number;
  collected_units?: string;
  total_units?: string;
};

export type CirclePaymentRequestRecord = {
  id: string;
  circle_id: string;
  group_id: string | null;
  requester_user_wallet: string;
  target_user_wallet: string;
  amount: string;
  amount_units: string;
  asset: ArcTokenSymbol;
  reason: string | null;
  status: CircleRequestStatus;
  expires_at: string | null;
  payment_intent_id: string | null;
  transaction_id: string | null;
  tx_hash: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
  requester_username?: string | null;
  target_username?: string | null;
};

export type CircleSaveAccountRecord = {
  id: string;
  circle_id: string;
  status: "active" | "frozen" | "closed";
  balance: string;
  balance_units: string;
  goal_name: string | null;
  target_amount: string | null;
  target_amount_units: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
};

export type CircleSaveContributionRecord = {
  id: string;
  circle_save_account_id: string;
  circle_id: string;
  pocket_id?: string | null;
  user_wallet: string;
  amount: string;
  amount_units: string;
  asset: ArcTokenSymbol;
  transaction_id: string | null;
  tx_hash: string | null;
  status: "proposed" | "submitted" | "confirmed" | "failed" | "cancelled";
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  username?: string | null;
};

export type CircleSavePocketRecord = {
  id: string;
  circle_id: string;
  circle_save_account_id: string;
  created_by_wallet: string;
  name: string;
  icon: string;
  description: string | null;
  target_amount: string | null;
  target_amount_units: string | null;
  current_balance: string;
  current_balance_units: string;
  currency: ArcTokenSymbol;
  status: "active" | "archived";
  stop_at_target: boolean;
  lock_kind: "flexible" | "fixed";
  lock_until: string | null;
  lock_duration_days: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};


export type CircleEarnContributionRecord = {
  id: string;
  circle_earn_account_id: string;
  circle_id: string;
  user_wallet: string;
  amount: string;
  amount_units: string;
  asset: ArcTokenSymbol;
  transaction_id: string | null;
  tx_hash: string | null;
  status: "proposed" | "submitted" | "confirmed" | "failed" | "cancelled";
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  username?: string | null;
};

export type CircleWithdrawalPolicyRecord = {
  id: string;
  circle_id: string;
  product_type: CircleProductType;
  minimum_amount_units: string;
  maximum_amount_units: string | null;
  required_approvals: number;
  eligible_roles: CircleRole[];
  initiator_counts_as_approval: boolean;
  version: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type CircleWithdrawalProposalRecord = {
  id: string;
  circle_id: string;
  product_type: CircleProductType;
  initiator_user_wallet: string;
  amount: string;
  amount_units: string;
  asset: ArcTokenSymbol;
  destination_user_wallet: string | null;
  destination_address: string;
  pocket_id?: string | null;
  reason: string | null;
  policy_id: string | null;
  policy_version: number;
  required_approvals: number;
  approval_epoch: number;
  status: CircleWithdrawalStatus;
  risk_decision: CircleRiskDecision;
  idempotency_key: string;
  transaction_id: string | null;
  tx_hash: string | null;
  failure_reason: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  approvals?: CircleWithdrawalApprovalRecord[];
};

export type CircleWithdrawalApprovalRecord = {
  id: string;
  withdrawal_proposal_id: string;
  circle_id: string;
  approver_user_wallet: string;
  decision: "approved" | "rejected";
  approval_epoch: number;
  created_at: string;
  username?: string | null;
};

export type CircleActivityRecord = {
  id: string;
  circle_id: string;
  actor_user_wallet: string | null;
  activity_type: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
};


export type CirclePlatformLimits = {
  id: string;
  max_members: number;
  max_circles_per_user: number;
  max_invitations_per_day: number;
  max_payment_amount_units: string;
  max_request_amount_units: string;
  max_save_contribution_units: string;
  max_earn_contribution_units: string;
  max_withdrawal_amount_units: string;
  max_pending_withdrawals: number;
  invitation_ttl_hours: number;
};

export type CircleListItem = CircleRecord & {
  member_count: number;
  unread_count: number;
  pending_requests: number;
  pending_approvals: number;
  save_balance: string;
  earn_value: string;
  role: CircleRole;
};

export type CirclePermission =
  | "view"
  | "chat"
  | "pay"
  | "request"
  | "contribute_save"
  | "contribute_earn"
  | "invite"
  | "remove_member"
  | "promote"
  | "demote"
  | "edit_circle"
  | "manage_policy"
  | "freeze"
  | "initiate_withdrawal"
  | "approve_withdrawal"
  | "manage_save"
  | "manage_earn"
  | "view_audit"
  | "transfer_host";
