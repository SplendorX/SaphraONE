import type { ArcTokenSymbol } from "@/lib/tokens";

export const savingsPocketStatuses = ["active", "archived"] as const;
export type SavingsPocketStatus = (typeof savingsPocketStatuses)[number];

export const savingsLockKinds = ["flexible", "fixed"] as const;
export type SavingsLockKind = (typeof savingsLockKinds)[number];

export const savingsTransactionTypes = [
  "DEPOSIT",
  "WITHDRAWAL",
  "SPEND_SAVE",
  "REFUND",
  "REVERSAL",
  "ADJUSTMENT",
] as const;
export type SavingsTransactionType =
  (typeof savingsTransactionTypes)[number];

export const savingsTransactionStatuses = [
  "PENDING",
  "PROCESSING",
  "PAYMENT_SUBMITTED",
  "PAYMENT_CONFIRMED",
  "SAVINGS_SUBMITTED",
  "SAVINGS_CONFIRMED",
  "COMPLETED",
  "FAILED",
  "REQUIRES_RECONCILIATION",
] as const;
export type SavingsTransactionStatus =
  (typeof savingsTransactionStatuses)[number];

export const spendSaveEligibleTypes = [
  "all_outgoing",
  "merchant",
  "transfers",
  "bills",
  "online",
  "custom",
] as const;
export type SpendSaveEligibleType =
  (typeof spendSaveEligibleTypes)[number];

export const SAVINGS_POCKET_LIMIT = 50;
export const SAVINGS_NAME_MAX = 50;
export const SPEND_SAVE_MIN_PERCENT = 1;
export const SPEND_SAVE_MAX_PERCENT = 50;

export const PRESET_SPEND_SAVE_PERCENTAGES = [1, 2, 3, 5, 10] as const;

export const POCKET_ICON_PRESETS = [
  { id: "piggy", emoji: "🐷", label: "Piggy bank" },
  { id: "emergency", emoji: "🛡️", label: "Emergency" },
  { id: "plane", emoji: "✈️", label: "Travel" },
  { id: "heart", emoji: "❤️", label: "Personal" },
  { id: "home", emoji: "🏠", label: "Home / Rent" },
  { id: "school", emoji: "🎓", label: "School" },
  { id: "laptop", emoji: "💻", label: "Tech" },
  { id: "gift", emoji: "🎁", label: "Gift" },
  { id: "business", emoji: "💼", label: "Business" },
  { id: "phone", emoji: "📱", label: "Phone" },
  { id: "future", emoji: "🚀", label: "Future" },
  { id: "star", emoji: "🎯", label: "Goal" },
] as const;

export type PocketIconId = (typeof POCKET_ICON_PRESETS)[number]["id"];

export type SavingsPocketRecord = {
  id: string;
  owner_wallet: string;
  name: string;
  image_url: string | null;
  icon: string;
  description: string | null;
  target_amount: string | null;
  target_amount_units: string | null;
  current_balance: string;
  current_balance_units: string;
  currency: ArcTokenSymbol;
  status: SavingsPocketStatus;
  /** When true, auto-save stops once the target is reached. Optional until SQL migration applied. */
  stop_at_target?: boolean;
  target_reached_at?: string | null;
  /** flexible = withdraw anytime. fixed = locked until lock_until. */
  lock_kind?: SavingsLockKind;
  lock_until?: string | null;
  lock_duration_days?: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type SavingsTransactionRecord = {
  id: string;
  owner_wallet: string;
  pocket_id: string;
  type: SavingsTransactionType;
  amount: string;
  amount_units: string;
  currency: ArcTokenSymbol;
  status: SavingsTransactionStatus;
  tx_hash: string | null;
  related_payment_id: string | null;
  related_payment_tx_hash: string | null;
  related_savings_transaction_id?: string | null;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  failure_reason: string | null;
  created_at: string;
  confirmed_at: string | null;
  failed_at: string | null;
};

export type SpendSaveConfigRecord = {
  id: string;
  owner_wallet: string;
  enabled: boolean;
  percentage: number | string;
  pocket_id: string;
  eligible_payment_type: SpendSaveEligibleType;
  created_at: string;
  updated_at: string;
  paused_at: string | null;
  disabled_at: string | null;
};

export type SpendSaveEventRecord = {
  id: string;
  owner_wallet: string;
  config_id: string | null;
  payment_id: string | null;
  payment_tx_hash: string | null;
  pocket_id: string;
  payment_amount: string;
  payment_amount_units: string;
  save_percentage: number | string;
  save_amount: string;
  save_amount_units: string;
  currency: ArcTokenSymbol;
  status: SavingsTransactionStatus;
  savings_transaction_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SavingsSummary = {
  totalSaved: string;
  totalSavedUnits: string;
  pocketCount: number;
  monthSaved: string;
  monthSavedUnits: string;
  currency: ArcTokenSymbol;
  spendSave: {
    enabled: boolean;
    percentage: number | null;
    pocketId: string | null;
    pocketName: string | null;
    paused: boolean;
  } | null;
};

export function isSavingsTransactionType(
  value: string,
): value is SavingsTransactionType {
  return savingsTransactionTypes.includes(value as SavingsTransactionType);
}



export function isSpendSaveEligibleType(
  value: string,
): value is SpendSaveEligibleType {
  return spendSaveEligibleTypes.includes(value as SpendSaveEligibleType);
}

export function getPocketEmoji(icon: string) {
  const preset = POCKET_ICON_PRESETS.find((item) => item.id === icon);
  if (preset) return preset.emoji;
  // Allow raw emoji stored as icon
  if (icon && icon.length <= 8 && !/^[a-z_]+$/i.test(icon)) {
    return icon;
  }
  return "🐷";
}
