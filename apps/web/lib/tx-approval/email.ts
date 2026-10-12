// Server-only: reads RESEND_API_KEY and must never reach a browser bundle.
import { brandPurple, brandedEmail, escapeHtml, wordmarkAttachments } from "@/lib/email/brand-layout";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

/**
 * Security emails for transaction approvals, sent through Resend from
 * noreply@RESEND_EMAIL_DOMAIN (or TX_SECURITY_EMAIL_FROM).
 *
 * The code email is the check injected script can't fake: it shows the
 * payment's real amount and recipient, decoded on the server, outside the
 * page. The notice email tells the owner after every approved payment.
 */

const resendEndpoint = "https://api.resend.com/emails";

function sender() {
  const explicit = process.env.TX_SECURITY_EMAIL_FROM?.trim();
  // A bare address shows up in the inbox as "noreply@…"; give it the name.
  if (explicit) return explicit.includes("<") ? explicit : `SaphraONE Security <${explicit}>`;
  const domain = process.env.RESEND_EMAIL_DOMAIN?.trim();
  return domain ? `SaphraONE Security <noreply@${domain}>` : null;
}

export function securityEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && sender());
}

export function validEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160 ? email : null;
}

/**
 * Where security email goes. Captured once from the profile's contact email
 * and kept, so a later change to the profile (from a stolen session, say)
 * can't send the codes somewhere else.
 */
export async function alertEmailFor(ownerWallet: string) {
  const owner = ownerWallet.toLowerCase();
  const supabase = createSupabaseAdminClient();
  try {
    const { data } = await supabase
      .from("tx_security")
      .select("alert_email")
      .eq("owner_wallet", owner)
      .maybeSingle();
    const saved = validEmail(data?.alert_email);
    if (saved) return saved;

    const { data: profile } = await supabase
      .from(process.env.SUPABASE_PROFILES_TABLE ?? "profiles")
      .select("contact_email")
      .eq("wallet_address", owner)
      .maybeSingle();
    const email = validEmail(profile?.contact_email);
    if (!email) return null;
    await supabase
      .from("tx_security")
      .upsert({ alert_email: email, owner_wallet: owner }, { onConflict: "owner_wallet" });
    return email;
  } catch {
    return null;
  }
}

/**
 * Save the security email the owner just proved (they typed the code sent to
 * it). Only when none is on file: a saved address is never replaced here.
 */
export async function saveAlertEmail(ownerWallet: string, email: string) {
  const owner = ownerWallet.toLowerCase();
  const { error } = await createSupabaseAdminClient()
    .from("tx_security")
    .upsert({ alert_email: email, owner_wallet: owner }, { ignoreDuplicates: true, onConflict: "owner_wallet" });
  if (error) throw new Error(error.message);
}

/** j•••e@gmail.com */
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  const shown = name.length <= 2 ? name[0] : `${name[0]}•••${name[name.length - 1]}`;
  return `${shown}@${domain}`;
}

export type ApprovalEmailDetails = {
  amount: string | null;
  destination: string | null;
  /** Part of the amount is SaphraONE's service fee (to its own fee wallet). */
  includesServiceFee?: boolean;
  title: string;
  token: string | null;
};

function detailRows(details: ApprovalEmailDetails) {
  return [
    ["What", details.title],
    ["Amount", details.amount ? `${details.amount} ${details.token ?? ""}`.trim() : "—"],
    ["To", details.destination ?? "—"],
    ...(details.includesServiceFee ? ([["Includes", "SaphraONE service fee"]] as const) : []),
  ] as const;
}

/** A detail table: label on the left, value on the right. */
function detailTable(rows: ReadonlyArray<readonly [string, string]>) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid #eeebf6;color:#6b6478;font-size:14px;vertical-align:top" class="em-muted">${escapeHtml(label)}</td><td style="padding:9px 0;border-bottom:1px solid #eeebf6;font-size:14px;font-weight:600;text-align:right;word-break:break-all">${escapeHtml(value)}</td></tr>`,
    )
    .join("")}</table>`;
}

function layout(heading: string, intro: string, details: ApprovalEmailDetails, extra = "") {
  return brandedEmail({
    body: `<p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#2a2433">${escapeHtml(intro)}</p>
${extra}
${detailTable(detailRows(details))}
<p class="em-muted" style="margin:20px 0 0;font-size:13px;line-height:1.55;color:#6b6478">If this wasn't you, don't share any code. Open SaphraONE, sign out on every device and contact support.</p>`,
    preheader: intro,
    title: heading,
  });
}

async function send(to: string, subject: string, html: string, text: string, key: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = sender();
  if (!apiKey || !from) return false;
  try {
    const response = await fetch(resendEndpoint, {
      body: JSON.stringify({ attachments: await wordmarkAttachments(), from, html, subject, text, to: [to] }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      method: "POST",
    });
    if (!response.ok) {
      console.warn("[tx-approval] security email failed:", response.status);
    }
    return response.ok;
  } catch (error) {
    console.warn("[tx-approval] security email failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

export function sendApprovalCode(
  to: string,
  code: string,
  details: ApprovalEmailDetails,
  approvalId: string,
) {
  const codeBlock = `<p class="em-code" style="margin:0 0 22px;padding:16px 0;border-radius:14px;background:#f3efff;border:1px solid #e2d9fd;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;color:#120b20">${escapeHtml(code)}</p>`;
  const text = [
    `Your SaphraONE confirmation code is ${code}.`,
    "",
    "Only enter it if these details match what you're doing:",
    ...detailRows(details).map(([label, value]) => `${label}: ${value}`),
    "",
    "If this wasn't you, don't share the code. Sign out on every device and contact support.",
  ].join("\n");
  return send(
    to,
    `Your SaphraONE code: ${code}`,
    layout(
      "Confirm this payment",
      "Enter this code in SaphraONE only if the details below match what you're doing. It expires in 10 minutes.",
      details,
      codeBlock,
    ),
    text,
    `tx-approval-code-${approvalId}`,
  );
}

export function sendApprovalNotice(to: string, details: ApprovalEmailDetails, approvalId: string) {
  const text = [
    "A transaction was just approved on your SaphraONE account:",
    ...detailRows(details).map(([label, value]) => `${label}: ${value}`),
    "",
    "If this wasn't you, sign out on every device and contact support.",
  ].join("\n");
  return send(
    to,
    `SaphraONE: ${details.title}${details.amount ? ` · ${details.amount} ${details.token ?? ""}` : ""}`.trim(),
    layout("Transaction approved", "A transaction was just approved on your SaphraONE account.", details),
    text,
    `tx-approval-notice-${approvalId}`,
  );
}

export type SignInAlertDetails = {
  /** "Chrome 141 on Windows" */
  browser: string;
  /** Where SaphraONE is, e.g. "app.saphra.one". */
  host: string;
  /** "Lagos, Nigeria", or null when unknown. */
  location: string | null;
  /** First name or username, when known. */
  name: string | null;
  /** The account's own help page. */
  supportUrl: string;
  /** "Thursday, 08 October 2026 21:15 UTC" */
  time: string;
};

/** "You signed in to your SaphraONE account", after a Google or email sign-in. */
export function sendSignInAlert(to: string, details: SignInAlertDetails, key: string) {
  const rows: Array<[string, string]> = [
    ["Browser", details.browser],
    ["Location", details.location ?? "Unavailable"],
    ["Time", details.time],
  ];
  const greeting = details.name ? `Hi ${details.name},` : "Hi,";
  const html = brandedEmail({
    body: `<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${escapeHtml(greeting)}</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55">You signed in to your SaphraONE account at <a href="https://${escapeHtml(details.host)}" style="color:${brandPurple};font-weight:600">${escapeHtml(details.host)}</a>.</p>
${detailTable(rows)}
<p style="margin:20px 0 0;font-size:14px;line-height:1.55">If you didn't sign in, change your Google or email password straight away, then <a href="${escapeHtml(details.supportUrl)}" style="color:${brandPurple}">contact SaphraONE support</a>.</p>
<p style="margin:18px 0 0;font-size:14px;line-height:1.55">The SaphraONE Team</p>`,
    preheader: `New sign-in: ${details.browser}, ${details.time}`,
    title: "You signed in to your SaphraONE account",
  });
  const text = [
    "You signed in to your SaphraONE account",
    "",
    greeting,
    `You signed in to your SaphraONE account at ${details.host}.`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `If you didn't sign in, change your Google or email password straight away, then contact SaphraONE support: ${details.supportUrl}`,
    "",
    "The SaphraONE Team",
  ].join("\n");
  return send(to, "You signed in to your SaphraONE account", html, text, key);
}
