// Server-only. Attaches one verified transfer to one charge. The unique
// tx_hash on business_charge_payments makes every claim race-safe: whichever
// path (receipt, scan, reconcile) inserts first owns the transfer.
import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { moneyNumber, roundMoney } from "@/lib/account/money";
import { checkoutErrors } from "@/lib/checkout/errors";
import { applyPaymentToCharge } from "@/lib/checkout/money-rules";
import type {
  ChargeMatchedBy,
  ChargePaymentSource,
  ChargeRecord,
} from "@/lib/checkout/types";
import { createSavingsNotificationResult } from "@/lib/save/notifications";

function nowIso() {
  return new Date().toISOString();
}

export type ClaimResult = {
  /** False when this transfer was already on this charge (a retried confirm). */
  claimed: boolean;
  charge: ChargeRecord;
};

export async function claimTransferForCharge(input: {
  charge: ChargeRecord;
  txHash: string;
  amount: number;
  from: string | null;
  blockNumber: bigint | number | null;
  source: ChargePaymentSource;
  matchedBy: ChargeMatchedBy;
}): Promise<ClaimResult> {
  const { charge } = input;
  const txHash = input.txHash.toLowerCase();
  const supabase = accountDb();

  if (charge.status === "CANCELLED") {
    throw checkoutErrors.chargeNotOpen("This charge was cancelled.");
  }

  // A transfer that paid an invoice can't also pay a charge.
  const invoiceClaim = await supabase
    .from(accountTables.invoicePayments)
    .select("id")
    .eq("tx_hash", txHash)
    .maybeSingle();
  if (invoiceClaim.error) {
    throw new Error(readAccountDbError(invoiceClaim.error, "Could not check the payment."));
  }
  if (invoiceClaim.data) {
    throw checkoutErrors.invalidPayment("This transaction was already applied to an invoice.");
  }

  const amount = roundMoney(input.amount);
  const insert = await supabase.from(accountTables.chargePayments).insert({
    amount,
    asset: charge.currency,
    block_number: input.blockNumber === null ? null : Number(input.blockNumber),
    charge_id: charge.id,
    created_at: nowIso(),
    matched_by: input.matchedBy,
    paid_at: nowIso(),
    payer_wallet: input.from?.toLowerCase() ?? null,
    source: input.source,
    status: "CONFIRMED",
    tx_hash: txHash,
  });
  if (insert.error) {
    if (insert.error.code !== "23505") {
      throw new Error(readAccountDbError(insert.error, "Could not record the payment."));
    }
    const existing = await supabase
      .from(accountTables.chargePayments)
      .select("charge_id")
      .eq("tx_hash", txHash)
      .maybeSingle();
    if ((existing.data as { charge_id: string } | null)?.charge_id === charge.id) {
      return { charge: await reloadCharge(charge.id), claimed: false };
    }
    throw checkoutErrors.invalidPayment("This transaction was already applied to another payment.");
  }

  const recorded = await supabase
    .from(accountTables.chargePayments)
    .select("amount")
    .eq("charge_id", charge.id);
  if (recorded.error) {
    throw new Error(readAccountDbError(recorded.error, "Could not load the charge payments."));
  }
  const received = ((recorded.data ?? []) as Array<{ amount: string }>).reduce(
    (sum, row) => sum + moneyNumber(row.amount),
    0,
  );
  const next = applyPaymentToCharge({ charge, received });

  const totals = await supabase
    .from(accountTables.charges)
    .update({
      amount_received: next.amountReceived,
      overpayment: next.overpayment,
      updated_at: nowIso(),
      ...(next.status === "PAID" ? { tip_amount: next.tipAmount } : {}),
      ...(input.from && !charge.payer_wallet ? { payer_wallet: input.from.toLowerCase() } : {}),
    })
    .eq("id", charge.id)
    .neq("status", "CANCELLED");
  if (totals.error) {
    throw new Error(readAccountDbError(totals.error, "Could not update the charge."));
  }

  let becamePaid = false;
  if (next.status === "PAID") {
    // Guarded: only an OPEN (or late, EXPIRED) charge flips, exactly once.
    const paid = await supabase
      .from(accountTables.charges)
      .update({ paid_at: nowIso(), status: "PAID", updated_at: nowIso() })
      .eq("id", charge.id)
      .in("status", ["OPEN", "EXPIRED"])
      .select("id");
    if (paid.error) {
      throw new Error(readAccountDbError(paid.error, "Could not mark the charge paid."));
    }
    becamePaid = (paid.data ?? []).length > 0;
  }

  if (becamePaid) {
    // "Take Checkout payments" quests for the merchant.
    void import("@/lib/rewards/quests").then(({ checkQuestsSoon }) => checkQuestsSoon(charge.wallet_address));
  }

  const tip = moneyNumber(next.tipAmount);
  const extra = !becamePaid && next.status === "PAID";
  void createSavingsNotificationResult({
    body: becamePaid
      ? `Received ${next.amountReceived} ${charge.currency}${tip > 0 ? ` including a ${next.tipAmount} tip` : ""}.`
      : extra
        ? `Received another ${amount} ${charge.currency} after it was paid.`
        : `Received ${amount} ${charge.currency}. ${roundMoney(Math.max(0, moneyNumber(charge.amount) - received))} remaining.`,
    fallbackKind: "payment_received",
    kind: "payment_received",
    metadata: {
      amount: next.amountReceived,
      chargeId: charge.id,
      code: charge.public_id,
      source: input.source,
      tip: next.tipAmount,
      txHash,
      type: becamePaid ? "charge_paid" : extra ? "charge_extra" : "charge_partial",
    },
    ownerWallet: charge.wallet_address,
    relatedTxHash: txHash,
    title: becamePaid
      ? `Charge ${charge.public_id} paid`
      : extra
        ? `Extra payment on charge ${charge.public_id}`
        : `Partial payment on charge ${charge.public_id}`,
  });

  return { charge: await reloadCharge(charge.id), claimed: true };
}

async function reloadCharge(id: string) {
  const { data, error } = await accountDb()
    .from(accountTables.charges)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the charge."));
  if (!data) throw checkoutErrors.chargeNotFound();
  return data as ChargeRecord;
}
