export type MemberType = "EMPLOYEE" | "CONTRACTOR";
export type PaymentDestinationType = "SWIFTPAY_USER" | "EXTERNAL_WALLET";
export type PaymentFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "MANUAL";
export type TeamMemberStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";

export type PayrollRunStatus =
  | "DRAFT"
  | "READY"
  | "APPROVED"
  | "PROCESSING"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type PayrollRunSource = "MANUAL" | "SCHEDULED";

export type PayrollItemStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "RETRYING";

export type PayrollAdjustmentType =
  | "BONUS"
  | "DEDUCTION"
  | "MANUAL_ADJUSTMENT";

export type PayrollAuditAction =
  | "PAYROLL_CREATED"
  | "PAYROLL_UPDATED"
  | "PAYROLL_APPROVED"
  | "PAYROLL_CANCELLED"
  | "PAYROLL_EXECUTION_STARTED"
  | "PAYROLL_EXECUTION_COMPLETED"
  | "PAYROLL_ITEM_RETRIED";

export type TeamMemberRecord = {
  id: string;
  account_id: string;
  member_type: MemberType;
  full_name: string;
  email: string | null;
  role: string | null;
  payment_destination_type: PaymentDestinationType;
  swiftpay_username: string | null;
  wallet_address: string;
  preferred_asset: string;
  default_payment_amount: string;
  payment_frequency: PaymentFrequency;
  status: TeamMemberStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type PayrollGroupRecord = {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  default_schedule: string | null;
  created_at: string;
  updated_at: string;
  members_count?: number;
  member_ids?: string[];
};


export type PayrollScheduleRecord = {
  id: string;
  account_id: string;
  payroll_group_id: string | null;
  frequency: PaymentFrequency;
  schedule_config: {
    day_of_month?: number;
    day_of_week?: number;
    description?: string;
  };
  next_run_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PayrollSnapshotItem = {
  id: string;
  team_member_id: string | null;
  recipient_name: string;
  recipient_destination: string;
  recipient_username?: string | null;
  base_amount: string;
  adjustment_amount: string;
  total_amount: string;
  asset: string;
  adjustments?: Array<{
    type: PayrollAdjustmentType;
    amount: string;
    reason?: string | null;
  }>;
};

export type PayrollSnapshot = {
  account_id: string;
  payroll_run_id: string;
  approved_at: string;
  approved_by: string;
  total_amount: string;
  total_fees: string;
  total_required: string;
  asset: string;
  recipient_count: number;
  recipients: PayrollSnapshotItem[];
};

export type PayrollRunRecord = {
  id: string;
  account_id: string;
  payroll_group_id: string | null;
  payroll_schedule_id: string | null;
  name: string;
  source: PayrollRunSource;
  status: PayrollRunStatus;
  asset: string;
  total_amount: string;
  total_fees: string;
  total_required: string;
  recipient_count: number;
  approved_by: string | null;
  approved_at: string | null;
  approval_metadata: Record<string, unknown> | null;
  snapshot: PayrollSnapshot | null;
  execution_started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PayrollItemRecord = {
  id: string;
  payroll_run_id: string;
  team_member_id: string | null;
  recipient_name_snapshot: string;
  recipient_destination_snapshot: string;
  recipient_username_snapshot: string | null;
  base_amount: string;
  adjustment_amount: string;
  total_amount: string;
  asset: string;
  status: PayrollItemStatus;
  failure_reason: string | null;
  attempt_count: number;
  transaction_id: string | null;
  blockchain_tx_hash: string | null;
  settled_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  adjustments?: PayrollAdjustmentRecord[];
};

export type PayrollAdjustmentRecord = {
  id: string;
  payroll_item_id: string;
  type: PayrollAdjustmentType;
  amount: string;
  reason: string | null;
  created_at: string;
};



export type PayrollDashboardSummary = {
  activeTeamMembersCount: number;
  nextPayrollDate: string | null;
  nextPayrollAmount: string | null;
  lastPayrollDate: string | null;
  lastPayrollAmount: string | null;
  lastPayrollStatus: PayrollRunStatus | null;
  upcomingRun: PayrollRunRecord | null;
  recentRuns: PayrollRunRecord[];
};
