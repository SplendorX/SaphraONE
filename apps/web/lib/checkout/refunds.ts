// Server-only. Refunds of Checkout charges (any kind). SaphraONE never signs
// for the merchant: a refund is requested here, the merchant sends the money
// with Send, and the transfer is verified on chain before it counts.
//
//   REQUESTED ──(verified transfer)──▶ SUCCEEDED
//       └──────(merchant cancels)────▶ CANCELLED
import { requireBusinessAccount } from "@/lib/account/auth";
import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { formatMoney, roundMoney } from "@/lib/account/money";
import type { RefundRequestView } from "@/lib/checkout/client";
import { checkoutErrors } from "@/lib/checkout/errors";
import {
  readRefundAmount,
  readRefundDestination,
  readRefundReason,
  refundableAmount,
  refundedAmount,
} from "@/lib/checkout/refund-rules";
import { loadChargeById, loadPayments, readTxHash } from "@/lib/checkout/service";
import type { ChargeRecord, ChargeRefundRecord } from "@/lib/checkout/types";
import { verifyRefundTransfer } from "@/lib/checkout/verify";
import { newRefundId } from "@/lib/merchant-api/ids";
import { deploymentMode } from "@/lib/merchant-api/keys";
import { createSavingsNotificationResult } from "@/lib/save/notifications";

/** A transfer mined this long before the refund was requested can't be its proof. */
const PROOF_CLOCK_SLACK_MS = 10 * 60_000;
const refundIdPattern = /^re_(live|test)_[0-9a-z]{24}$/;

function nowIso() {
  return new Date().toISOString();
}

type MerchantInput = {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  workspaceId?: unknown;
};

/** Owners, admins and finance refund; the records live under the business wallet. */
export async function requireRefundAccess(input: MerchantInput) {
  const context = await requireBusinessAccount(input);
  if (context.role !== "owner" && context.role !== "admin" && context.role !== "finance") {
    throw checkoutErrors.forbidden("Only the business owner, an admin or finance can refund payments.");
  }
  return {
    actorWallet: context.actorWallet.toLowerCase(),
    wallet: (context.businessWallet || context.actorWallet).toLowerCase(),
  };
}

export function readRefundId(value: unknown) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return refundIdPattern.test(id) ? id : null;
}

export async function loadRefunds(chargeIds: string[]) {
  const byCharge = new Map<string, ChargeRefundRecord[]>();
  if (chargeIds.length === 0) return byCharge;
  const { data, error } = await accountDb()
    .from(accountTables.chargeRefunds)
    .select("*")
    .in("charge_id", chargeIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(readAccountDbError(error, "Could not load refunds."));
  for (const refund of (data ?? []) as ChargeRefundRecord[]) {
    const list = byCharge.get(refund.charge_id) ?? [];
    list.push(refund);
    byCharge.set(refund.charge_id, list);
  }
  return byCharge;
}

/** The business's refund by its public id (re_…), or a 404. */
export async function loadOwnedRefund(wallet: string, refundId: unknown) {
  const id = readRefundId(refundId);
  if (!id) throw checkoutErrors.notFound("Refund");
  const { data, error } = await accountDb()
    .from(accountTables.chargeRefunds)
    .select("*")
    .eq("public_id", id)
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(readAccountDbError(error, "Could not load the refund."));
  if (!data) throw checkoutErrors.notFound("Refund");
  return data as ChargeRefundRecord;
}

export async function loadOwnedCharge(wallet: string, chargeId: string) {
  const charge = await loadChargeById(chargeId);
  if (!charge) throw checkoutErrors.chargeNotFound();
  if (charge.wallet_address !== wallet.toLowerCase()) throw checkoutErrors.chargeNotOwned();
  return charge;
}

/** Recomputes the charge's refunded total from its succeeded refunds. */
async function syncAmountRefunded(chargeId: string) {
  const refunds = (await loadRefunds([chargeId])).get(chargeId) ?? [];
  const { error } = await accountDb()
    .from(accountTables.charges)
    .update({ amount_refunded: roundMoney(refundedAmount(refunds)), updated_at: nowIso() })
    .eq("id", chargeId);
  if (error) console.error("[checkout] could not update amount_refunded", chargeId, error.message);
}

/**
 * A REQUESTED refund of `charge`. The amount is reserved at once, so two
 * refunds can never add up to more than was received.
 */
export async function createRefund(input: {
  charge: ChargeRecord;
  wallet: string;
  actorWallet: string | null;
  amount: unknown;
  destination: unknown;
  reason: unknown;
  source: "DASHBOARD" | "API";
}) {
  const { charge } = input;
  if (charge.wallet_address !== input.wallet.toLowerCase()) throw checkoutErrors.chargeNotOwned();
  const [paymentsByCharge, refundsByCharge] = await Promise.all([
    loadPayments([charge.id]),
    loadRefunds([charge.id]),
  ]);
  const payments = paymentsByCharge.get(charge.id) ?? [];
  const refunds = refundsByCharge.get(charge.id) ?? [];

  const amount = readRefundAmount(input.amount, refundableAmount({ amountReceived: charge.amount_received, refunds }));
  if (!amount.ok) throw checkoutErrors.invalid(amount.message);
  const destination = readRefundDestination({
    merchantWallet: charge.wallet_address,
    payments,
    value: input.destination,
  });
  if (!destination.ok) throw checkoutErrors.invalid(destination.message);
  const reason = readRefundReason(input.reason);
  if (!reason.ok) throw checkoutErrors.invalid(reason.message);

  let refund: ChargeRefundRecord | null = null;
  for (let attempt = 0; attempt < 5 && !refund; attempt += 1) {
    const { data, error } = await accountDb()
      .from(accountTables.chargeRefunds)
      .insert({
        amount: amount.value,
        charge_id: charge.id,
        created_at: nowIso(),
        created_by_wallet: input.actorWallet,
        currency: charge.currency,
        destination_wallet: destination.value,
        public_id: newRefundId(deploymentMode()),
        reason: reason.value,
        source: input.source,
        status: "REQUESTED",
        wallet_address: charge.wallet_address,
      })
      .select("*")
      .single();
    if (!error) refund = data as ChargeRefundRecord;
    else if (error.code !== "23505") throw new Error(readAccountDbError(error, "Could not create the refund."));
    // 23505: a public id collision; draw another.
  }
  if (!refund) throw new Error("Could not create the refund. Try again.");

  // Two refunds created at the same moment could each have passed the check:
  // re-check with both in place and step back if this one went over.
  const after = (await loadRefunds([charge.id])).get(charge.id) ?? [];
  if (refundableAmount({ amountReceived: charge.amount_received, refunds: after }) < -0.000001) {
    await accountDb()
      .from(accountTables.chargeRefunds)
      .update({ status: "CANCELLED" })
      .eq("id", refund.id)
      .eq("status", "REQUESTED");
    throw checkoutErrors.invalid("Another refund on this payment was created at the same time. Check the amount and try again.");
  }

  if (input.source === "API") {
    void createSavingsNotificationResult({
      body: `Your website asked to refund ${formatMoney(refund.amount, refund.currency)} on charge ${charge.public_id}. Approve it in Checkout → Online.`,
      fallbackKind: "reconciliation_alert",
      kind: "reconciliation_alert",
      metadata: { chargeId: charge.id, refundId: refund.public_id, type: "refund_requested" },
      ownerWallet: charge.wallet_address,
      title: "Refund requested",
    });
  }
  return refund;
}

/** Where the merchant sends the refund: Send, prefilled, carrying the refund id. */
export function refundSendHref(refund: ChargeRefundRecord, charge: Pick<ChargeRecord, "public_id">) {
  const params = new URLSearchParams({
    amount: refund.amount,
    memo: `Refund ${charge.public_id}`,
    refund: refund.public_id,
    to: refund.destination_wallet ?? "",
    token: refund.currency,
  });
  return `/send?${params.toString()}`;
}

/**
 * Marks a refund sent once its transfer is verified: from the merchant
 * wallet, at least the amount to the destination, in the charge currency,
 * mined after the refund was requested, and not already used for anything.
 * A retry with the same hash returns the same refund.
 */
export async function confirmRefund(input: { wallet: string; refundId: unknown; txHash: unknown }) {
  const refund = await loadOwnedRefund(input.wallet, input.refundId);
  const txHash = readTxHash(input.txHash);
  if (refund.status === "SUCCEEDED") {
    if (refund.tx_hash === txHash) return refund;
    throw checkoutErrors.conflict("This refund was already sent with another transaction.");
  }
  if (refund.status === "CANCELLED") throw checkoutErrors.conflict("This refund was cancelled.");
  if (!refund.destination_wallet) throw checkoutErrors.invalid("This refund has no destination wallet.");

  const [chargePayment, invoicePayment] = await Promise.all([
    accountDb().from(accountTables.chargePayments).select("id").eq("tx_hash", txHash).maybeSingle(),
    accountDb().from(accountTables.invoicePayments).select("id").eq("tx_hash", txHash).maybeSingle(),
  ]);
  if (chargePayment.error || invoicePayment.error) {
    throw new Error(readAccountDbError(chargePayment.error ?? invoicePayment.error!, "Could not check the transaction."));
  }
  if (chargePayment.data || invoicePayment.data) {
    throw checkoutErrors.invalidPayment("That transaction is a payment you received, not a refund.");
  }

  const verified = await verifyRefundTransfer({
    amount: refund.amount,
    currency: refund.currency,
    destination: refund.destination_wallet,
    merchantWallet: refund.wallet_address,
    txHash: txHash as `0x${string}`,
  });
  if (!verified) {
    throw checkoutErrors.chargeNotOpen("The refund transaction isn't confirmed yet. Try again in a moment.");
  }
  if (!verified.proven) {
    throw checkoutErrors.invalidPayment(
      `That transaction doesn't send ${formatMoney(refund.amount, refund.currency)} from your business wallet to ${refund.destination_wallet}.`,
    );
  }
  if (verified.blockTime.getTime() < new Date(refund.created_at).getTime() - PROOF_CLOCK_SLACK_MS) {
    throw checkoutErrors.invalidPayment("That transaction is older than the refund. Send the refund, then confirm it.");
  }

  const { data, error } = await accountDb()
    .from(accountTables.chargeRefunds)
    .update({ status: "SUCCEEDED", succeeded_at: nowIso(), tx_hash: txHash })
    .eq("id", refund.id)
    .eq("status", "REQUESTED")
    .select("*");
  if (error) {
    if (error.code === "23505") throw checkoutErrors.invalidPayment("That transaction was already used for another refund.");
    throw new Error(readAccountDbError(error, "Could not record the refund."));
  }
  const updated = ((data ?? []) as ChargeRefundRecord[])[0];
  if (!updated) {
    // A concurrent confirm got there first.
    const current = await loadOwnedRefund(input.wallet, refund.public_id);
    if (current.status === "SUCCEEDED" && current.tx_hash === txHash) return current;
    throw checkoutErrors.conflict("This refund changed while it was being confirmed. Refresh and try again.");
  }

  await syncAmountRefunded(updated.charge_id);
  const charge = await loadChargeById(updated.charge_id);
  void createSavingsNotificationResult({
    body: `Refunded ${formatMoney(updated.amount, updated.currency)} on charge ${charge?.public_id ?? ""} to ${updated.destination_wallet}.`,
    fallbackKind: "reconciliation_alert",
    kind: "reconciliation_alert",
    metadata: { chargeId: updated.charge_id, refundId: updated.public_id, txHash, type: "refund_sent" },
    ownerWallet: updated.wallet_address,
    relatedTxHash: txHash,
    title: "Refund sent",
  });
  if (charge?.kind === "ONLINE") {
    await import("@/lib/merchant-api/events")
      .then(({ emitRefundSucceeded }) => emitRefundSucceeded(updated))
      .catch((cause) => console.error("[checkout] could not emit refund.succeeded", cause));
  }
  return updated;
}

/** Cancels a refund that hasn't been sent; the amount becomes refundable again. */
export async function cancelRefund(input: { wallet: string; refundId: unknown }) {
  const refund = await loadOwnedRefund(input.wallet, input.refundId);
  if (refund.status === "CANCELLED") return refund;
  if (refund.status === "SUCCEEDED") throw checkoutErrors.conflict("This refund was already sent.");
  const { data, error } = await accountDb()
    .from(accountTables.chargeRefunds)
    .update({ status: "CANCELLED" })
    .eq("id", refund.id)
    .eq("status", "REQUESTED")
    .select("*");
  if (error) throw new Error(readAccountDbError(error, "Could not cancel the refund."));
  const updated = ((data ?? []) as ChargeRefundRecord[])[0];
  if (!updated) throw checkoutErrors.conflict("This refund was sent while you were cancelling it.");
  return updated;
}

/** Refunds waiting for the merchant to send them, newest first. */
export async function listPendingRefunds(wallet: string): Promise<RefundRequestView[]> {
  const { data, error } = await accountDb()
    .from(accountTables.chargeRefunds)
    .select("*")
    .eq("wallet_address", wallet.toLowerCase())
    .eq("status", "REQUESTED")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(readAccountDbError(error, "Could not load refund requests."));
  const refunds = (data ?? []) as ChargeRefundRecord[];
  if (refunds.length === 0) return [];
  const chargeIds = [...new Set(refunds.map((refund) => refund.charge_id))];
  const [charges, sessions] = await Promise.all([
    accountDb().from(accountTables.charges).select("id, public_id").in("id", chargeIds),
    accountDb()
      .from(accountTables.checkoutSessions)
      .select("charge_id, public_id, client_reference_id")
      .in("charge_id", chargeIds),
  ]);
  if (charges.error) throw new Error(readAccountDbError(charges.error, "Could not load refund requests."));
  if (sessions.error) throw new Error(readAccountDbError(sessions.error, "Could not load refund requests."));
  const codes = new Map(((charges.data ?? []) as Array<{ id: string; public_id: string }>).map((row) => [row.id, row.public_id]));
  const refs = new Map(
    ((sessions.data ?? []) as Array<{ charge_id: string; public_id: string; client_reference_id: string | null }>).map(
      (row) => [row.charge_id, row],
    ),
  );
  return refunds.map((refund) => {
    const code = codes.get(refund.charge_id) ?? "";
    const ref = refs.get(refund.charge_id);
    return {
      ...refund,
      charge_code: code,
      client_reference_id: ref?.client_reference_id ?? null,
      send_href: refundSendHref(refund, { public_id: code }),
      session_id: ref?.public_id ?? null,
    };
  });
}
