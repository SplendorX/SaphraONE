// What the browser sees of ramp rows. Pure.
import type { BeneficiaryRow } from "@/lib/ramp/db";
import { maskAccount } from "@/lib/ramp/rules";
import type { RampBeneficiary, RampOrderRow, RampOrderView } from "@/lib/ramp/types";

export function orderView(row: RampOrderRow): RampOrderView {
  return {
    id: row.id,
    direction: row.direction,
    status: row.status,
    fiatCurrency: row.fiat_currency,
    fiatAmount: row.fiat_amount,
    usdcAmount: row.usdc_amount,
    totalToPay: row.total_to_pay,
    rate: row.quoted_rate,
    fee: row.quoted_fee,
    receive: row.quoted_receivable,
    payin: row.payin_instructions,
    depositAddress: row.deposit_address,
    expiresAt: row.deposit_expires_at,
    beneficiary: row.beneficiary_snapshot,
    userTxHash: row.user_tx_hash,
    deliveryTxHash: row.delivery_tx_hash,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

export function beneficiaryView(row: BeneficiaryRow): RampBeneficiary {
  return {
    id: row.id,
    currency: row.currency,
    bankCode: row.bank_code,
    bankName: row.bank_name,
    accountMasked: maskAccount(row.account_number),
    accountName: row.account_name,
    createdAt: row.created_at,
  };
}
