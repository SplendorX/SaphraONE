"use client";

import { ArrowUpRight, Check, Download } from "lucide-react";
import { toast } from "sonner";

import { OneWatermark } from "@/components/brand/one-watermark";
import { Button } from "@/components/ui/button";
import { formatMoney, moneyNumber } from "@/lib/account/money";
import { downloadChargeReceipt } from "@/lib/checkout/receipt";
import type { PublicChargePayload } from "@/lib/checkout/types";
import { explorerTxUrl } from "@/lib/onchain-facts";

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        year: "numeric",
      });
}

/** What the payer sees once a charge is paid. */
export function ChargeReceiptCard({ payload }: { payload: PublicChargePayload }) {
  const { business, charge } = payload;
  const tip = moneyNumber(charge.tipAmount);
  const received = moneyNumber(charge.amountReceived);
  const paidAt = formatDateTime(charge.paidAt);
  const rows = [
    { label: "Business", value: business.name },
    { label: "Amount", value: formatMoney(charge.amount, charge.currency) },
    ...(tip > 0 ? [{ label: "Tip", value: formatMoney(charge.tipAmount, charge.currency) }] : []),
    { label: "Total paid", value: formatMoney(received, charge.currency) },
    ...(paidAt ? [{ label: "Paid", value: paidAt }] : []),
    { label: "Reference", value: charge.code },
  ];

  return (
    <div className="one-watermark-host space-y-4">
      <OneWatermark className="one-watermark-center one-watermark-behind" />
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="h-7 w-7" />
        </span>
        <p className="font-heading text-3xl">Paid</p>
        <p className="text-sm text-muted-foreground">
          {business.name} has your payment. Show this screen at the counter if they ask.
        </p>
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border text-sm">
        {rows.map((row) => (
          <div className="flex items-center justify-between gap-3 px-3 py-2.5" key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <Button
        className="h-11 w-full"
        onClick={() =>
          void downloadChargeReceipt(payload).catch(() => toast.error("Could not create the receipt."))
        }
      >
        <Download className="h-4 w-4" />
        Download receipt
      </Button>
      {charge.txHashes.map((hash) => (
        <a
          className="inline-flex w-full items-center justify-center gap-1 text-sm font-medium text-primary hover:underline"
          href={explorerTxUrl(hash)}
          key={hash}
          rel="noreferrer"
          target="_blank"
        >
          View transaction on Arc
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      ))}
    </div>
  );
}
