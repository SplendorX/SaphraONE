"use client";

import { type RecurringScheduleDraft } from "@/components/recurring-schedule-fields";
import type { ArcTokenSymbol } from "@/lib/tokens";

export type SendSettlementQuote = {
  feeAmount: string;
  feeLabel: string;
  saveAmount?: string;
  saveLabel?: string;
  /** The Spend&Save rate in percent, when it applies (e.g. "1.00"). */
  savePercent?: string;
  totalRequired: string;
};

export type SendPaymentWizardProps = {
  address?: string;
  authWallet: string | null;
  availableBalance?: string;
  availableBalances?: Array<{ symbol: ArcTokenSymbol; amount: string }>;
  hideBalance?: boolean;
  beneficiaryError: string | null;
  beneficiaryName: string;
  beneficiaryStatus: string | null;
  canSaveBeneficiary: boolean;
  canSubmitPayment: boolean;
  isAuthenticatingWallet: boolean;
  isBeneficiarySaving: boolean;
  isCirclePaymentPending: boolean;
  isConfirming: boolean;
  isConnected: boolean;
  isEmbeddedWalletMode: boolean;
  isRecipientResolving: boolean;
  isRecipientValid: boolean;
  isSubmitting: boolean;
  isSwitchingChain: boolean;
  isTreasuryMismatch?: boolean;
  isWalletAuthenticated: boolean;
  isWritePending: boolean;
  onBeneficiaryNameChange: (value: string) => void;
  onPaymentAmountChange: (value: string) => void;
  onPaymentNarrationChange: (value: string) => void;
  onRecipientChange: (value: string) => void;
  onSaveBeneficiary: () => void;
  onSelectToken: (token: ArcTokenSymbol) => void;
  onSubmit: () => void;
  onWalletSignIn: () => void;
  paymentAmount: string;
  paymentAmountUnits: bigint | null;
  paymentError: string | null;
  onRecurringChange: (value: RecurringScheduleDraft) => void;
  onRecurringEnabledChange: (value: boolean) => void;
  paymentNarration: string;
  paymentStatus: string;
  spendSaveNotice?: string | null;
  primaryButtonText: string;
  recurring: RecurringScheduleDraft;
  recurringEnabled: boolean;
  /** Set once a schedule was created alongside this payment. */
  recurringNotice?: string | null;
  receiveHref: string;
  onSwitchToTreasury?: () => void;
  recipientAddress: string;
  recipientDisplayLabel: string;
  recipientResolveError: string | null;
  resolvedRecipientUsername: string | null;
  refreshBalances: () => void | Promise<void>;
  isRefreshingBalances?: boolean;
  selectedToken: ArcTokenSymbol;
  settlementQuote?: SendSettlementQuote | null;
  shortenAddress: (value?: string) => string;
  transactionConfirmed: boolean;
  transactionExplorerUrl?: string;
  treasuryAddress?: string;
  trimmedPaymentNarration: string;
  trimmedRecipientAddress: string;
  walletAddress: string;
};

