/**
 * Centiiv request → `ramp_orders` columns. Pure. The status here is what
 * Centiiv reports; the caller applies `nextStatus` against the stored one.
 */
import { decimalText, pickDeliveryTx, readStatus } from "@/lib/ramp/rules";
import type { CentiivRequest, PayinInstructions, RampOrderRow, RampStatus } from "@/lib/ramp/types";

export type RampOrderPatch = Partial<
  Pick<
    RampOrderRow,
    | "provider_order_id"
    | "total_to_pay"
    | "usdc_amount"
    | "payin_instructions"
    | "deposit_address"
    | "deposit_expires_at"
    | "delivery_tx_hash"
    | "failure_reason"
  >
> & { status?: RampStatus };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function failureText(status: RampStatus, note: string | null) {
  if (note) return note.length > 200 ? `${note.slice(0, 199)}…` : note;
  switch (status) {
    case "FAILED":
      return "Centiiv could not complete this order.";
    case "EXPIRED":
      return "No payment arrived before the order expired.";
    case "REFUNDED":
      return "The USDC was returned to your wallet.";
    case "CANCELLED":
      return "The order was cancelled.";
    default:
      return null;
  }
}

export function payinFromRequest(request: Pick<CentiivRequest, "temporaryWallet">): PayinInstructions | null {
  const wallet = request.temporaryWallet;
  // The API returns accountNumber/accountName/…; the docs say virtualAccount…
  const accountNumber = text(wallet?.accountNumber) ?? text(wallet?.virtualAccountNumber);
  if (!accountNumber) return null;
  return {
    accountNumber,
    accountName: text(wallet?.accountName) ?? text(wallet?.virtualAccountName),
    bankName: text(wallet?.bankName) ?? text(wallet?.virtualBankName),
    bankCode: text(wallet?.bankCode) ?? text(wallet?.virtualBankCode),
  };
}

/**
 * The columns a Centiiv request fills. The off-ramp deposit address is left
 * out: it is only stored after `validateDepositWallet` passes, at creation.
 */
export function mapRequestToPatch(request: CentiivRequest): RampOrderPatch {
  const patch: RampOrderPatch = {};
  const id = text(request.id);
  if (id) patch.provider_order_id = id;

  const status = readStatus(request.status);
  if (status) {
    patch.status = status;
    const reason = failureText(status, text(request.adminNote));
    if (reason) patch.failure_reason = reason;
  }

  const total = decimalText(request.totalToPay);
  if (total) patch.total_to_pay = total;

  const type = (request.type ?? "").toUpperCase();
  const expiresAt = text(request.temporaryWallet?.expiresAt);
  if (type === "ONRAMP") {
    const payin = payinFromRequest(request);
    if (payin) patch.payin_instructions = payin;
    if (expiresAt && !Number.isNaN(Date.parse(expiresAt))) patch.deposit_expires_at = expiresAt;
    const delivery = pickDeliveryTx(request);
    if (delivery) {
      patch.delivery_tx_hash = delivery.hash;
      if (delivery.amount) patch.usdc_amount = delivery.amount;
    }
  } else if (type === "OFFRAMP") {
    if (expiresAt && !Number.isNaN(Date.parse(expiresAt))) patch.deposit_expires_at = expiresAt;
  }

  return patch;
}
