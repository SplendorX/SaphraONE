/**
 * The JSON objects of the public Checkout API. Pure, and the only place their
 * shape is defined: the API routes and (later) the webhook payloads both use
 * these, so a site sees the same object everywhere.
 */
import { moneyNumber, roundMoney } from "@/lib/account/money";
import type {
  ChargePaymentRecord,
  ChargePaymentSource,
  ChargeRecord,
  ChargeRefundRecord,
  ChargeStatus,
  CheckoutSessionRecord,
} from "@/lib/checkout/types";

export type SessionStatus = "open" | "complete" | "expired" | "cancelled";
export type SessionPaymentStatus = "unpaid" | "partially_paid" | "paid";
export type PaymentMethod = "wallet" | "saphraone" | "card_or_bank" | "cross_chain" | "manual";

const statusMap: Record<ChargeStatus, SessionStatus> = {
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  OPEN: "open",
  PAID: "complete",
};

const methodMap: Record<ChargePaymentSource, PaymentMethod> = {
  BRIDGE: "cross_chain",
  ONRAMP: "card_or_bank",
  RECONCILE: "manual",
  SWIFTPAY: "saphraone",
  WALLET: "wallet",
};

export function sessionStatus(status: ChargeStatus): SessionStatus {
  return statusMap[status];
}

/** The charge status a list filter names, or null when it isn't one. */
export function chargeStatusFor(status: unknown): ChargeStatus | null {
  const entry = Object.entries(statusMap).find(([, value]) => value === status);
  return entry ? (entry[0] as ChargeStatus) : null;
}

export function paymentStatus(charge: { amount: string; amount_received: string }): SessionPaymentStatus {
  const received = moneyNumber(charge.amount_received);
  if (received + 0.000001 >= moneyNumber(charge.amount)) return "paid";
  return received > 0 ? "partially_paid" : "unpaid";
}

export function toRefundObject(refund: ChargeRefundRecord, sessionId: string | null) {
  return {
    amount: refund.amount,
    created_at: refund.created_at,
    currency: refund.currency,
    destination_wallet: refund.destination_wallet,
    id: refund.public_id,
    object: "refund" as const,
    reason: refund.reason,
    session: sessionId,
    status: refund.status.toLowerCase() as "requested" | "succeeded" | "cancelled",
    succeeded_at: refund.succeeded_at,
    tx_hash: refund.tx_hash,
  };
}

export type SessionObject = ReturnType<typeof toSessionObject>;

export function toSessionObject(input: {
  charge: ChargeRecord;
  session: CheckoutSessionRecord;
  payments: ChargePaymentRecord[];
  refunds: ChargeRefundRecord[];
  /** Where the hosted page lives, e.g. https://app.saphra.one. */
  origin: string;
  explorerUrl: (txHash: string) => string;
}) {
  const { charge, session } = input;
  const refunded = input.refunds
    .filter((refund) => refund.status === "SUCCEEDED")
    .reduce((sum, refund) => sum + moneyNumber(refund.amount), 0);
  return {
    amount: charge.amount,
    amount_received: charge.amount_received,
    amount_refunded: roundMoney(Math.max(refunded, moneyNumber(charge.amount_refunded ?? "0"))),
    cancel_url: session.cancel_url,
    client_reference_id: session.client_reference_id,
    completed_at: charge.paid_at,
    created_at: session.created_at,
    currency: charge.currency,
    customer_email: session.customer_email,
    description: charge.note,
    expires_at: charge.expires_at,
    id: session.public_id,
    line_items: Array.isArray(session.line_items) ? session.line_items : [],
    livemode: session.mode === "live",
    metadata: session.metadata && typeof session.metadata === "object" ? session.metadata : {},
    object: "checkout.session" as const,
    overpayment: charge.overpayment,
    payment_status: paymentStatus(charge),
    payments: input.payments.map((payment) => ({
      amount: payment.amount,
      explorer_url: input.explorerUrl(payment.tx_hash),
      method: methodMap[payment.source],
      paid_at: payment.paid_at,
      tx_hash: payment.tx_hash,
    })),
    refunds: input.refunds.map((refund) => toRefundObject(refund, session.public_id)),
    status: sessionStatus(charge.status),
    success_url: session.success_url,
    url: `${input.origin.replace(/\/$/, "")}/checkout/${session.public_id}`,
  };
}
