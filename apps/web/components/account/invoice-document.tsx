"use client";

import { PlatformBrand } from "@/components/brand/platform-brand";
import { formatMoney } from "@/lib/account/money";
import { invoiceStatusLabel } from "@/lib/account/invoice-preview";
import type {
  BusinessAsset,
  InvoiceItemRecord,
  InvoiceStatus,
} from "@/lib/account/types";

export type InvoiceDocumentModel = {
  amountReceived?: string | null;
  businessDescription?: string | null;
  businessLogoUrl?: string | null;
  businessName: string;
  businessUsername?: string | null;
  currency: BusinessAsset;
  customerEmail?: string | null;
  customerName?: string | null;
  customerUsername?: string | null;
  discount: string;
  dueDate?: string | null;
  invoiceNumber: string;
  issueDate?: string | null;
  items: Array<Pick<InvoiceItemRecord, "description" | "discount" | "id" | "quantity" | "tax" | "total" | "unit_price"> & { id?: string }>;
  notes?: string | null;
  overpayment?: string | null;
  paymentTerms?: string | null;
  status: InvoiceStatus | string;
  subtotal: string;
  tax: string;
  total: string;
};

export function InvoiceDocument({ invoice }: { invoice: InvoiceDocumentModel }) {
  return (
    <article className="overflow-hidden rounded-[1.6rem] border border-border bg-card shadow-sm">
      <div className="h-1.5 bg-primary" />
      <div className="space-y-8 p-6 sm:p-8">
        <PlatformBrand />
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {invoice.businessLogoUrl ? (
              <img
                alt=""
                className="h-14 w-14 rounded-2xl object-cover"
                src={invoice.businessLogoUrl}
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">
                {invoice.businessName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
                SaphraONE invoice
              </p>
              <h1 className="mt-1 font-heading text-2xl">{invoice.businessName}</h1>
              {invoice.businessUsername ? (
                <p className="text-sm text-muted-foreground">{invoice.businessUsername}.one</p>
              ) : null}
              {invoice.businessDescription ? (
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  {invoice.businessDescription}
                </p>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="font-heading text-xl">{invoice.invoiceNumber}</p>
            <p className="mt-1 text-sm capitalize text-muted-foreground">
              {invoiceStatusLabel(invoice.status, invoice.overpayment)}
            </p>
          </div>
        </header>

        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Issue date
            </p>
            <p className="mt-1">{invoice.issueDate || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Due date
            </p>
            <p className="mt-1">{invoice.dueDate || "—"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Customer
            </p>
            <p className="mt-1">{invoice.customerName || "—"}</p>
            {invoice.customerUsername ? (
              <p className="text-muted-foreground">{invoice.customerUsername}.one</p>
            ) : null}
            {invoice.customerEmail ? (
              <p className="text-muted-foreground">{invoice.customerEmail}</p>
            ) : null}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="pb-3">Description</th>
                <th className="pb-3">Qty</th>
                <th className="pb-3">Price</th>
                <th className="pb-3">Discount</th>
                <th className="pb-3">Tax</th>
                <th className="pb-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, index) => (
                <tr className="border-t border-border" key={item.id ?? `${item.description}-${index}`}>
                  <td className="py-3">{item.description}</td>
                  <td>{item.quantity}</td>
                  <td>{formatMoney(item.unit_price, invoice.currency)}</td>
                  <td>{formatMoney(item.discount || "0", invoice.currency)}</td>
                  <td>{formatMoney(item.tax, invoice.currency)}</td>
                  <td className="text-right">{formatMoney(item.total, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml-auto w-full max-w-xs space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatMoney(invoice.subtotal, invoice.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discount</span>
            <span>{formatMoney(invoice.discount, invoice.currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span>{formatMoney(invoice.tax, invoice.currency)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-heading text-xl">
            <span>Total</span>
            <span>{formatMoney(invoice.total, invoice.currency)}</span>
          </div>
          {moneyReceived(invoice.amountReceived) ? (
            <div className="flex justify-between text-muted-foreground">
              <span>Received</span>
              <span>{formatMoney(invoice.amountReceived ?? "0", invoice.currency)}</span>
            </div>
          ) : null}
          {moneyReceived(invoice.overpayment) ? (
            <div className="flex justify-between text-amber-700 dark:text-amber-400">
              <span>Overpayment</span>
              <span>{formatMoney(invoice.overpayment ?? "0", invoice.currency)}</span>
            </div>
          ) : null}
        </div>

        {invoice.paymentTerms || invoice.notes ? (
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            {invoice.paymentTerms ? (
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Payment terms
                </p>
                <p className="mt-1 text-muted-foreground">{invoice.paymentTerms}</p>
              </div>
            ) : null}
            {invoice.notes ? (
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Notes
                </p>
                <p className="mt-1 text-muted-foreground">{invoice.notes}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function moneyReceived(value?: string | null) {
  return Boolean(value && Number(value) > 0);
}
