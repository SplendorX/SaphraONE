export const businessRoles = [
  "owner",
  "admin",
  "finance",
  "member",
  "viewer",
] as const;

export type BusinessRole = (typeof businessRoles)[number];

export const inviteRoles = ["admin", "finance", "member", "viewer"] as const;
export type InviteRole = (typeof inviteRoles)[number];

export const businessPermissions = [
  "business.view",
  "business.edit",
  "wallet.view",
  "wallet.send",
  "transactions.view",
  "transactions.export",
  "payments.create",
  "payments.approve",
  "payments.cancel",
  "requests.create",
  "requests.manage",
  "team.view",
  "team.invite",
  "team.edit",
  "team.remove",
  "roles.view",
  "roles.manage",
  "profile.view",
  "profile.edit",
  "settings.view",
  "settings.manage",
] as const;

export type BusinessPermission = (typeof businessPermissions)[number];

export type WorkspaceKind = "individual" | "business";
export type WorkspaceStatus = "active" | "archived";
export type MemberStatus = "active" | "invited" | "removed" | "left";
export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

export type VerificationStatus =
  | "UNVERIFIED"
  | "PENDING"
  | "VERIFIED"
  | "REQUIRES_ACTION"
  | "REJECTED"
  | "SUSPENDED";

export type ApprovalStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "PARTIALLY_APPROVED"
  | "APPROVED"
  | "REJECTED"
  | "NOT_REQUIRED";

export type TransactionStatus =
  | "DRAFT"
  | "AUTHORIZATION_REQUIRED"
  | "SUBMITTED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type PaymentDirection = "incoming" | "outgoing";
export type BusinessAsset = "USDC" | "EURC";

export type ApprovalTier = {
  up_to: string | null;
  required_approvals: number;
};

export type WorkspaceRecord = {
  circle_wallet_id: string | null;
  created_at: string;
  id: string;
  kind: WorkspaceKind;
  name: string;
  owner_user_wallet: string;
  payment_wallet: string | null;
  status: WorkspaceStatus;
  updated_at: string;
  username: string | null;
};

export type WorkspaceMemberRecord = {
  created_at: string;
  id: string;
  joined_at: string | null;
  role: BusinessRole;
  status: MemberStatus;
  updated_at: string;
  user_wallet: string;
  workspace_id: string;
};

export type BusinessProfileRecord = {
  address_line: string | null;
  business_type: string | null;
  category: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  country: string | null;
  created_at: string;
  description: string | null;
  industry: string | null;
  legal_name: string | null;
  logo_url: string | null;
  registration_number: string | null;
  social_links: Record<string, string>;
  tax_identifier: string | null;
  updated_at: string;
  verification_status: VerificationStatus;
  website: string | null;
  workspace_id: string;
};

export type WorkspaceSettingsRecord = {
  approval_policy: ApprovalTier[];
  approval_required: boolean;
  approval_threshold_units: string;
  created_at: string;
  max_members: number;
  required_approvals: number;
  updated_at: string;
  workspace_id: string;
};

export type WorkspaceInvitationRecord = {
  created_at: string;
  expires_at: string;
  id: string;
  invited_by_wallet: string;
  invited_user_wallet: string | null;
  invited_username: string | null;
  role: InviteRole;
  status: InvitationStatus;
  updated_at: string;
  workspace_id: string;
};

export type PaymentIdentityRecord = {
  created_at: string;
  destination_wallet: string;
  display_name: string | null;
  kind: WorkspaceKind;
  profile_wallet: string | null;
  updated_at: string;
  username: string;
  workspace_id: string | null;
};

export type BusinessPaymentRecord = {
  amount_display: string;
  amount_units: string;
  approval_status: ApprovalStatus;
  asset: BusinessAsset;
  circle_transaction_id: string | null;
  completed_at: string | null;
  counterparty_name: string | null;
  counterparty_username: string | null;
  counterparty_wallet: string | null;
  created_at: string;
  created_by_wallet: string;
  direction: PaymentDirection;
  failed_reason: string | null;
  id: string;
  idempotency_key: string | null;
  memo: string | null;
  network: string;
  submitted_at: string | null;
  transaction_status: TransactionStatus;
  tx_hash: string | null;
  updated_at: string;
  workspace_id: string;
};

export type PaymentApprovalRecord = {
  approver_wallet: string;
  comment: string | null;
  created_at: string;
  decision: "approved" | "rejected";
  id: string;
  payment_id: string;
};

export type BusinessPaymentRequestRecord = {
  amount_display: string | null;
  amount_units: string | null;
  asset: BusinessAsset;
  created_at: string;
  created_by_wallet: string;
  id: string;
  memo: string | null;
  paid_payment_id: string | null;
  status: "open" | "paid" | "cancelled" | "expired";
  updated_at: string;
  workspace_id: string;
};

export type WorkspaceSummary = {
  circleWalletId: string | null;
  id: string;
  kind: WorkspaceKind;
  logoUrl: string | null;
  name: string;
  paymentWallet: string | null;
  role: BusinessRole;
  username: string | null;
  verificationStatus: VerificationStatus | null;
};

export type DirectoryHit = {
  avatarUrl: string | null;
  bio: string | null;
  displayName: string;
  kind: WorkspaceKind;
  /** A person's verified KYC tier (1 or 2); null when unverified or a business. */
  kycTier?: number | null;
  username: string;
  verificationStatus?: VerificationStatus | null;
  workspaceId?: string | null;
};

/**
 * A public profile page (/u/<username>). Businesses publish how to reach
 * them; a person's page shows only their country, never email or phone.
 */
export type PublicProfile = DirectoryHit & {
  category?: string | null;
  contactEmail?: string | null;
  country?: string | null;
  /** When the account joined SaphraONE (ISO timestamp). */
  memberSince?: string | null;
  phone?: string | null;
  website?: string | null;
};
