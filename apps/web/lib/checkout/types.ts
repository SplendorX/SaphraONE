/**
 * SaphraONE Checkout: quick in-person charges. Shared by the server, the API
 * routes and the browser, so it stays free of server-only imports.
 */

export type ChargeKind = "MERCHANT" | "STOREFRONT";

export type ChargeStatus = "OPEN" | "PAID" | "EXPIRED" | "CANCELLED";

export type ChargeCurrency = "USDC" | "EURC";

/** How the payer said they would pay; drives the hash-less matcher. */
export type ChargeIntentMethod = "WALLET" | "SWIFTPAY" | "ONRAMP" | "BRIDGE";

export type ChargePaymentSource = "SWIFTPAY" | "WALLET" | "ONRAMP" | "BRIDGE" | "RECONCILE";

export type ChargeMatchedBy = "RECEIPT" | "SCAN";



export type ChargeRecord = {
  id: string;
  public_id: string;
  wallet_address: string;
  kind: ChargeKind;
  status: ChargeStatus;
  currency: ChargeCurrency;
  amount: string;
  tip_amount: string;
  amount_received: string;
  overpayment: string;
  note: string | null;
  payer_wallet: string | null;
  pending_method: ChargeIntentMethod | null;
  pending_ref: string | null;
  pending_started_at: string | null;
  reported_amount: string | null;
  created_block: number | string | null;
  idempotency_key: string | null;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChargePaymentRecord = {
  id: string;
  charge_id: string;
  tx_hash: string;
  amount: string;
  asset: ChargeCurrency;
  source: ChargePaymentSource;
  matched_by: ChargeMatchedBy;
  payer_wallet: string | null;
  block_number: number | string | null;
  status: string;
  paid_at: string;
  created_at: string;
};

/** A charge as the merchant sees it, with the payments that settled it. */
export type ChargeWithPayments = ChargeRecord & { payments: ChargePaymentRecord[] };

/** What the payer page may see: no payer wallet, no intent reference. */
export type PublicCharge = {
  code: string;
  kind: ChargeKind;
  status: ChargeStatus;
  currency: ChargeCurrency;
  amount: string;
  tipAmount: string;
  amountReceived: string;
  note: string | null;
  pendingMethod: ChargeIntentMethod | null;
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  /** Hashes of the transfers that paid it, for the receipt's explorer link. */
  txHashes: string[];
};

export type CheckoutBusiness = {
  name: string;
  username: string | null;
  logoUrl: string | null;
  description: string | null;
  website: string | null;
};

export type PublicChargePayload = {
  business: CheckoutBusiness;
  destinationWallet: string;
  charge: PublicCharge;
};

export type PublicStorefrontPayload = {
  business: CheckoutBusiness;
  destinationWallet: string;
  currency: ChargeCurrency;
};

export type ChargeSummary = {
  todayCount: number;
  todayVolume: string;
  todayTips: string;
  openCount: number;
};
