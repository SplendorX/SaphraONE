"use client";

import { ArrowRight, Info, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatMoney, moneyNumber, roundMoney } from "@/lib/account/money";
import { createRefundClient, type MerchantAuth } from "@/lib/checkout/client";
import { defaultRefundDestination, MAX_REFUND_REASON_LENGTH } from "@/lib/checkout/refund-rules";
import type { ChargeWithPayments } from "@/lib/checkout/types";

/** What can still be refunded, as far as the merchant's list knows (the server re-checks). */
export function chargeRefundable(charge: Pick<ChargeWithPayments, "amount_received" | "amount_refunded">) {
  return Math.max(0, moneyNumber(charge.amount_received) - moneyNumber(charge.amount_refunded ?? "0"));
}

/**
 * Starts a refund and opens Send, prefilled, to pay it. The refund counts once
 * that send is confirmed on chain.
 */
export function RefundSheet({
  auth,
  charge,
  onClose,
}: {
  auth: MerchantAuth | null;
  charge: ChargeWithPayments;
  onClose: () => void;
}) {
  const router = useRouter();
  const refundable = chargeRefundable(charge);
  const payer = defaultRefundDestination(charge.payments);
  const [amount, setAmount] = useState(roundMoney(refundable));
  const [destination, setDestination] = useState(payer ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!auth) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createRefundClient(auth, charge.id, {
        amount: amount.trim(),
        destination: destination.trim() || undefined,
        reason: reason.trim() || undefined,
      });
      router.push(result.sendHref);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the refund.");
      setBusy(false);
    }
  }

  return (
    <div className="ck-reconcile ck-refund">
      <p className="text-sm font-semibold">
        Refund up to {formatMoney(refundable, charge.currency)} on {charge.public_id}
      </p>
      <label className="ck-field">
        <span className="ck-field-label">Amount ({charge.currency})</span>
        <input
          disabled={busy}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          value={amount}
        />
      </label>
      <label className="ck-field">
        <span className="ck-field-label">Refund to</span>
        <input
          className="font-mono text-xs"
          disabled={busy}
          onChange={(event) => setDestination(event.target.value.trim())}
          placeholder="0x… buyer's wallet"
          spellCheck={false}
          value={destination}
        />
      </label>
      {payer ? (
        <p className="ck-muted text-xs">The wallet that paid. Change it only if the buyer asks.</p>
      ) : (
        <p className="ck-refund-note">
          <Info className="h-4 w-4 shrink-0" />
          This was paid by card, bank or from another chain, so the buyer&rsquo;s wallet isn&rsquo;t known. Ask them
          for a USDC wallet on Arc and enter it here.
        </p>
      )}
      <label className="ck-field">
        <span className="ck-field-label">Reason (optional)</span>
        <input
          disabled={busy}
          maxLength={MAX_REFUND_REASON_LENGTH}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Item out of stock"
          value={reason}
        />
      </label>
      <p className="ck-muted text-xs">
        Next you send the refund from your business wallet with Send; the usual Send fee is added on top. It shows as
        refunded once the transfer is confirmed.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="ck-row">
        <Button className="flex-1" disabled={busy} onClick={onClose} variant="ghost">
          Close
        </Button>
        <Button
          className="flex-1"
          disabled={busy || !auth || !amount || moneyNumber(amount) <= 0 || !destination}
          onClick={() => void start()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Continue to Send
        </Button>
      </div>
    </div>
  );
}
