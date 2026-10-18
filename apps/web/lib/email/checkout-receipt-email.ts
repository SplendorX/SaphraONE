// Server-only: reads RESEND_API_KEY and must never reach a browser bundle.
import { moneyNumber } from "@/lib/account/money";
import { brandedEmail, emailButton, escapeHtml, wordmarkAttachments } from "@/lib/email/brand-layout";
import { money, replyAddress, sender } from "@/lib/email/invoice-email";
import type { SessionObject } from "@/lib/merchant-api/serialize";

/**
 * The buyer's receipt for an online Checkout session, sent once when the
 * session completes and the site gave a customer_email. Same Resend setup and
 * sender as invoice emails (lib/email/invoice-email.ts).
 *
 * Never includes the site's metadata or client_reference_id: those are the
 * merchant's own records, not the buyer's.
 */

export type ReceiptEmailStatus = "sent" | "failed" | "not_configured";

type ReceiptInput = {
  session: SessionObject;
  businessName: string;
  /** The business's contact email: replies go there, not to the no-reply sender. */
  replyTo?: string | null;
};

const methodLabels: Record<string, string> = {
  card_or_bank: "Card or bank",
  cross_chain: "USDC on another network",
  manual: "Transfer",
  saphraone: "SaphraONE account",
  wallet: "Arc wallet",
};

function paidOn(value: string | null) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { day: "numeric", month: "long", timeZone: "UTC", year: "numeric" });
}

/** What was bought: the line items, else the description, else one line for the amount. */
function receiptLines(session: SessionObject) {
  if (session.line_items.length > 0) {
    return session.line_items.map((item) => ({
      detail: item.quantity > 1 ? `${item.quantity} × ${money(item.unit_amount, session.currency)}` : null,
      label: item.name,
      total: money(String(moneyNumber(item.unit_amount) * item.quantity), session.currency),
    }));
  }
  return [{ detail: null, label: session.description || "Payment", total: money(session.amount, session.currency) }];
}

function overpaid(session: SessionObject) {
  return moneyNumber(session.overpayment ?? "0") > 0;
}

export function receiptSubject(input: ReceiptInput) {
  return `Your receipt from ${input.businessName}: ${money(input.session.amount_received, input.session.currency)}`;
}

export function receiptEmailHtml(input: ReceiptInput & { hasWordmark: boolean }) {
  const e = escapeHtml;
  const { session, businessName } = input;
  const replyTo = replyAddress(input.replyTo);
  const date = paidOn(session.completed_at);
  const rows = receiptLines(session)
    .map(
      (line) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #ece8f3;color:#17111c;font-size:14px;">${e(line.label)}
            ${line.detail ? `<div class="em-muted" style="color:#776e65;font-size:12px;">${e(line.detail)}</div>` : ""}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #ece8f3;color:#17111c;font-size:14px;text-align:right;white-space:nowrap;">${e(line.total)}</td>
        </tr>`,
    )
    .join("");
  const methods = [...new Set(session.payments.map((payment) => payment.method).filter(Boolean))]
    .map((method) => methodLabels[method as string] ?? method)
    .join(", ");
  const firstPayment = session.payments[0];

  return brandedEmail({
    body: `<p style="margin:0;color:#776e65;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;text-align:center;">Paid</p>
<p style="margin:8px 0 4px;color:#17111c;font-size:30px;font-weight:700;text-align:center;">${e(money(session.amount_received, session.currency))}</p>
<p style="margin:0;color:#514941;font-size:14px;text-align:center;">to <strong>${e(businessName)}</strong>${date ? ` · ${e(date)}` : ""}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">${rows}
  ${
    overpaid(session)
      ? `<tr><td style="padding:10px 0 0;color:#514941;font-size:14px;">Paid above the total</td>
    <td style="padding:10px 0 0;color:#514941;font-size:14px;text-align:right;white-space:nowrap;">${e(money(session.overpayment, session.currency))}</td></tr>`
      : ""
  }
  <tr>
    <td style="padding:12px 0 0;color:#17111c;font-size:14px;font-weight:700;">Total paid</td>
    <td style="padding:12px 0 0;color:#17111c;font-size:14px;font-weight:700;text-align:right;white-space:nowrap;">${e(money(session.amount_received, session.currency))}</td>
  </tr>
</table>
<p class="em-muted" style="margin:20px 0 0;color:#776e65;font-size:12px;text-align:center;">Reference ${e(session.id)}${methods ? ` · ${e(methods)}` : ""}</p>
${
  overpaid(session)
    ? `<p style="margin:14px 0 0;color:#514941;font-size:13px;text-align:center;">You paid more than the total. Contact ${e(businessName)} to have the difference refunded.</p>`
    : ""
}
${
  firstPayment?.explorer_url
    ? `<div style="padding-top:22px;text-align:center">${emailButton(firstPayment.explorer_url, "View the payment on Arc")}</div>`
    : ""
}`,
    footer: `${
      replyTo
        ? `Questions about your order? Reply to this email to reach ${e(businessName)}.`
        : `This mailbox isn't monitored, so please don't reply. Contact ${e(businessName)} directly about your order.`
    }<br>${e(businessName)} takes payments with SaphraONE Checkout. Keep this email as your receipt.`,
    hasWordmark: input.hasWordmark,
    preheader: `${money(session.amount_received, session.currency)} paid to ${businessName}. Reference ${session.id}.`,
    title: `Receipt from ${businessName}`,
  });
}

export function receiptEmailText(input: ReceiptInput) {
  const { session, businessName } = input;
  const replyTo = replyAddress(input.replyTo);
  return [
    `Receipt from ${businessName}`,
    `Paid: ${money(session.amount_received, session.currency)} · ${paidOn(session.completed_at)}`,
    "",
    ...receiptLines(session).map((line) => `- ${line.label}${line.detail ? ` (${line.detail})` : ""}: ${line.total}`),
    overpaid(session)
      ? `You paid ${money(session.overpayment, session.currency)} above the total. Contact ${businessName} to have it refunded.`
      : "",
    "",
    `Reference: ${session.id}`,
    ...session.payments.map((payment) => `Transaction: ${payment.explorer_url}`),
    "",
    replyTo
      ? `Questions about your order? Reply to this email to reach ${businessName}.`
      : `This mailbox isn't monitored. Contact ${businessName} directly about your order.`,
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n");
}

/** Emails the receipt to the session's customer_email. Never throws. */
export async function sendCheckoutReceiptEmail(input: ReceiptInput): Promise<ReceiptEmailStatus> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = input.session.customer_email?.trim();
  if (!to) return "failed";
  const from = sender();
  if (!apiKey || !from) return "not_configured";
  const replyTo = replyAddress(input.replyTo);
  const attachments = await wordmarkAttachments();

  try {
    const response = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({
        attachments,
        from,
        html: receiptEmailHtml({ ...input, hasWordmark: attachments.length > 0 }),
        ...(replyTo ? { reply_to: [replyTo] } : {}),
        subject: receiptSubject(input),
        text: receiptEmailText(input),
        to: [to],
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // One receipt per session, even if completion is processed twice.
        "Idempotency-Key": `checkout-receipt-${input.session.id}`,
      },
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn("[checkout-receipt-email]", response.status, (await response.text()).slice(0, 300));
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.warn("[checkout-receipt-email]", error instanceof Error ? error.message : "send failed");
    return "failed";
  }
}
