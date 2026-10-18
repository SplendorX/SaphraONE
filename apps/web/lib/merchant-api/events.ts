// Server-only. Turns what happens to an ONLINE charge into checkout.session
// webhook events. In-person charges return at once. Never throws: a webhook
// problem must not fail a payment or an expiry.
import { accountDb, accountTables } from "@/lib/account/db";
import { roundMoney } from "@/lib/account/money";
import { loadBusinessProfile } from "@/lib/account/service";
import { loadChargeById } from "@/lib/checkout/service";
import type { ChargeRecord, ChargeRefundRecord } from "@/lib/checkout/types";
import { sendCheckoutReceiptEmail } from "@/lib/email/checkout-receipt-email";
import { configuredAppOrigin } from "@/lib/merchant-api/http";
import { toRefundObject } from "@/lib/merchant-api/serialize";
import { sessionObjectForCharge } from "@/lib/merchant-api/sessions";
import { explorerTxUrl } from "@/lib/onchain-facts";
import { emitMerchantEvent, runAfterResponse } from "@/lib/webhooks/events";

/**
 * After a transfer is attached to a charge (lib/checkout/settlement):
 * `payment_received` for every new transfer, `completed` once when the charge
 * turns PAID (even after it had expired). The buyer's receipt email goes out
 * with the first `completed`, when the site gave a customer_email.
 */
export async function emitChargeEvents(input: {
  charge: ChargeRecord;
  becamePaid: boolean;
  claimed: boolean;
  txHash: string;
  amount: number;
}) {
  if (input.charge.kind !== "ONLINE" || (!input.claimed && !input.becamePaid)) return;
  try {
    const session = await sessionObjectForCharge(input.charge, configuredAppOrigin());
    if (!session) return;
    const txHash = input.txHash.toLowerCase();
    if (input.claimed) {
      const payment = session.payments.find((item) => item.tx_hash === txHash) ?? {
        amount: roundMoney(input.amount),
        explorer_url: explorerTxUrl(txHash),
        method: null,
        paid_at: new Date().toISOString(),
        tx_hash: txHash,
      };
      await emitMerchantEvent({
        data: { object: session, payment },
        dedupeKey: `payment:${txHash}`,
        type: "checkout.session.payment_received",
        wallet: input.charge.wallet_address,
      });
    }
    if (input.becamePaid) {
      const completed = await emitMerchantEvent({
        data: { object: session },
        dedupeKey: `completed:${input.charge.id}`,
        type: "checkout.session.completed",
        wallet: input.charge.wallet_address,
      });
      if (completed && session.customer_email) {
        runAfterResponse(async () => {
          const profile = await loadBusinessProfile(input.charge.wallet_address).catch(() => null);
          await sendCheckoutReceiptEmail({
            businessName: profile?.business_name?.trim() || "A SaphraONE business",
            replyTo: profile?.contact_email,
            session,
          });
        });
      }
    }
  } catch (error) {
    console.error("[merchant-api] could not emit charge events", input.charge.id, error);
  }
}

/** After a refund of an ONLINE charge is verified (lib/checkout/refunds). */
export async function emitRefundSucceeded(refund: ChargeRefundRecord) {
  try {
    const { data, error } = await accountDb()
      .from(accountTables.checkoutSessions)
      .select("public_id")
      .eq("charge_id", refund.charge_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    await emitMerchantEvent({
      data: { object: toRefundObject(refund, (data as { public_id: string } | null)?.public_id ?? null) },
      dedupeKey: `refund:${refund.id}`,
      type: "refund.succeeded",
      wallet: refund.wallet_address,
    });
  } catch (error) {
    console.error("[merchant-api] could not emit refund.succeeded", refund.public_id, error);
  }
}

/** After ONLINE charges flip to EXPIRED (sweep, lazy expiry or the API). */
export async function emitSessionsExpired(chargeIds: string[]) {
  for (const id of chargeIds) {
    try {
      const charge = await loadChargeById(id);
      if (!charge || charge.kind !== "ONLINE" || charge.status !== "EXPIRED") continue;
      const session = await sessionObjectForCharge(charge, configuredAppOrigin());
      if (!session) continue;
      await emitMerchantEvent({
        data: { object: session },
        dedupeKey: `expired:${charge.id}`,
        type: "checkout.session.expired",
        wallet: charge.wallet_address,
      });
    } catch (error) {
      console.error("[merchant-api] could not emit checkout.session.expired", id, error);
    }
  }
}
