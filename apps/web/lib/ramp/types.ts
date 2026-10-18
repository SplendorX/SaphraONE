/**
 * Naira on-ramp and off-ramp through Centiiv Protocol, settled on Arc.
 * Shared by the server and the browser, so it stays free of server-only
 * imports. See lib/ramp/README.md for the Centiiv API facts.
 */

export const rampDirections = ["ONRAMP", "OFFRAMP"] as const;
export type RampDirection = (typeof rampDirections)[number];

export const rampStatuses = [
  "PENDING",
  "PROCESSING",
  "FULFILLED",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
  "CANCELLED",
] as const;
export type RampStatus = (typeof rampStatuses)[number];

export type RampEnvironment = "SANDBOX" | "LIVE";

export type RampCurrency = "NGN";

/** The virtual bank account an on-ramp is paid into. */
export type PayinInstructions = {
  bankName: string | null;
  bankCode: string | null;
  accountNumber: string;
  accountName: string | null;
};

/** What an order shows of its bank account, without the full number. */
export type BeneficiarySnapshot = {
  bankName: string | null;
  bankCode: string;
  accountMasked: string;
  accountName: string;
};

/** A `ramp_orders` row. */
export type RampOrderRow = {
  id: string;
  wallet_address: string;
  provider: string;
  direction: RampDirection;
  fiat_currency: RampCurrency;
  fiat_amount: string | null;
  usdc_amount: string | null;
  total_to_pay: string | null;
  quoted_rate: string | null;
  quoted_fee: string | null;
  quoted_receivable: string | null;
  status: RampStatus;
  provider_order_id: string | null;
  environment: RampEnvironment;
  payin_instructions: PayinInstructions | null;
  deposit_address: string | null;
  deposit_expires_at: string | null;
  beneficiary_id: string | null;
  beneficiary_snapshot: BeneficiarySnapshot | null;
  user_tx_hash: string | null;
  delivery_tx_hash: string | null;
  failure_reason: string | null;
  idempotency_key: string | null;
  activity_recorded_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

/** What the browser sees of an order. */
export type RampOrderView = {
  id: string;
  direction: RampDirection;
  status: RampStatus;
  fiatCurrency: RampCurrency;
  fiatAmount: string | null;
  usdcAmount: string | null;
  totalToPay: string | null;
  rate: string | null;
  fee: string | null;
  receive: string | null;
  payin: PayinInstructions | null;
  depositAddress: string | null;
  expiresAt: string | null;
  beneficiary: BeneficiarySnapshot | null;
  userTxHash: string | null;
  deliveryTxHash: string | null;
  failureReason: string | null;
  createdAt: string;
};

export type RampQuote = {
  rate: string;
  fees: string;
  /** What arrives: USDC for an on-ramp, NGN for an off-ramp. */
  receive: string;
  /** What the payer sends: NGN for an on-ramp, USDC for an off-ramp. */
  totalToPay: string;
};

export type RampKycInfo = {
  required: boolean;
  available: boolean;
  tier: number;
  status: "NONE" | "PENDING" | "VERIFIED" | "MANUAL_REVIEW" | "REJECTED";
  limits: { onrampNgn: number; offrampUsdc: number };
  remainingToday: { onrampNgn: number; offrampUsdc: number };
  nextTier: number | null;
};

export type RampStatusInfo = {
  enabled: boolean;
  currencies: RampCurrency[];
  directions: RampDirection[];
  environment: RampEnvironment | null;
  kyc?: RampKycInfo;
};

export type RampBank = { code: string; name: string };

export type RampBeneficiary = {
  id: string;
  currency: RampCurrency;
  bankCode: string;
  bankName: string | null;
  accountMasked: string;
  accountName: string;
  createdAt: string;
};

export type ResolvedBankAccount = {
  bankCode: string;
  bankName: string | null;
  accountNumber: string;
  accountName: string;
};

// ── Centiiv Protocol payloads (only the fields SwiftPay reads) ─────────────

export type CentiivTemporaryWallet = {
  /** On-ramp bank account as the API returns it (sandbox, Oct 2026). */
  accountNumber?: string | null;
  accountName?: string | null;
  bankName?: string | null;
  bankCode?: string | null;
  /** The same fields as the docs name them. */
  virtualAccountNumber?: string | null;
  virtualAccountName?: string | null;
  virtualBankName?: string | null;
  virtualBankCode?: string | null;
  publicAddress?: string | null;
  network?: string | null;
  isTestnet?: boolean | null;
  expiresAt?: string | null;
};

export type CentiivBlockchainTx = {
  txHash?: string | null;
  direction?: string | null;
  amount?: string | number | null;
  network?: string | null;
  status?: string | null;
};

export type CentiivRequest = {
  id: string;
  status?: string | null;
  type?: string | null;
  amount?: string | number | null;
  totalToPay?: string | number | null;
  createdAt?: string | null;
  adminNote?: string | null;
  temporaryWallet?: CentiivTemporaryWallet | null;
  blockchainTxs?: CentiivBlockchainTx[] | null;
  metadata?: Record<string, unknown> | null;
};

export type CentiivQuote = {
  rate?: string | number | null;
  estimatedReceivableAmount?: string | number | null;
  fees?: string | number | null;
  totalToPay?: string | number | null;
};
