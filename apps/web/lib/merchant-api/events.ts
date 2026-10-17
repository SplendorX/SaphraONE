// Server-only. Turns what happens to an ONLINE charge into checkout.session
// webhook events. In-person charges return at once. Never throws: a webhook
// problem must not fail a payment or an expiry.
import { roundMoney } from "@/lib/account/money";
import { loadChargeById } from "@/lib/checkout/service";
import type { ChargeRecord } from "@/lib/checkout/types";
import { configuredAppOrigin } from "@/lib/merchant-api/http";
import { sessionObjectForCharge } from "@/lib/merchant-api/sessions";
import { explorerTxUrl } from "@/lib/onchain-facts";
import { emitMerchantEvent } from "@/lib/webhooks/events";

/**
 * After a transfer is attached to a charge (lib/checkout/settlement):
 * `payment_received` for every new transfer, `completed` once when the charge
 * turns PAID (even after it had expired).
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
      await emitMerchantEvent({
        data: { object: session },
        dedupeKey: `completed:${input.charge.id}`,
        type: "checkout.session.completed",
        wallet: input.charge.wallet_address,
      });
    }
  } catch (error) {
    console.error("[merchant-api] could not emit charge events", input.charge.id, error);
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
