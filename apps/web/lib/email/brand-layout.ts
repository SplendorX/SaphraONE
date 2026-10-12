// Server-only: reads the wordmark from public/ to attach it to emails.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The one look every SaphraONE email shares: a banner image (the brand's
 * purple-to-blue gradient with the white wordmark) over plain, centred text.
 * The colours live in the image, so the email looks the same wherever it's
 * read, including Gmail (which drops CSS gradients) and Circle's own code
 * email, whose editor strips every style. The Supabase and Circle sign-in
 * templates (docs/email-templates/) copy this markup by hand, so change them
 * together.
 *
 * The banner is linked from the live site whenever there is one. An inline
 * (cid) attachment looked tidy in some clients, but Gmail shows it as an
 * attachment and can drop it from the header entirely, so the attachment is
 * only the fallback for local development, where a linked image can't load.
 */

const headerContentId = "saphra-email-header";
export const brandPurple = "#5f15f4";

const headerPath = "/brand/email-header.png";

/** The public https origin emails can link images from, or null (local dev). */
function publicOrigin() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.protocol === "https:" && url.hostname !== "localhost") return url.origin;
    } catch {
      // fall through
    }
  }
  return process.env.VERCEL_ENV === "production" ? "https://app.saphra.one" : null;
}

/** Absolute URL of the banner, or null when only the attachment works. */
function hostedHeaderUrl() {
  const origin = publicOrigin();
  return origin ? `${origin}${headerPath}` : null;
}

let headerBase64: Promise<string | null> | null = null;

function loadHeader() {
  headerBase64 ??= readFile(join(process.cwd(), "public", "brand", "email-header.png"))
    .then((file) => file.toString("base64"))
    .catch(() => null);
  return headerBase64;
}

/**
 * Resend `attachments` for the inline banner: none when the banner is linked
 * from the live site, or when the file can't be read.
 */
export async function wordmarkAttachments() {
  if (hostedHeaderUrl()) return [];
  const content = await loadHeader();
  return content
    ? [{ content, content_id: headerContentId, content_type: "image/png", filename: "saphraone.png" }]
    : [];
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A button in the brand purple. */
export function emailButton(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${brandPurple};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:14px 14px 4px 14px;">${escapeHtml(label)}</a>`;
}

/**
 * Dark mode, for mail apps that follow the phone's theme and read <style>
 * (Apple Mail, Outlook, Gmail on iOS; [data-ogsc] is Outlook's dark mode).
 * The banner reads in both themes, so only the page and the text change.
 * Apps that ignore this (some Gmail builds) invert colours on their own.
 */
const darkModeStyles = `<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .em-body { background:#121016 !important; }
  .em-card h1, .em-card p, .em-card td, .em-card span, .em-card strong, .em-card li { color:#ece8f5 !important; border-color:#2c2539 !important; }
  .em-card a { color:#b794ff !important; }
  .em-card .em-muted { color:#a59db4 !important; }
  .em-card .em-code { background:#241b3a !important; border-color:#3a2d5c !important; color:#ffffff !important; }
}
[data-ogsc] .em-body { background:#121016 !important; }
[data-ogsc] .em-card h1, [data-ogsc] .em-card p, [data-ogsc] .em-card td { color:#ece8f5 !important; }
</style>`;

/**
 * Wraps a message in the SaphraONE look: the banner, the title, the body.
 * `body` is trusted HTML: escape anything user-supplied before passing it.
 */
export function brandedEmail(input: {
  /** Hidden inbox preview text. */
  preheader?: string;
  /** Centred heading under the banner. */
  title: string;
  body: string;
  /** Small print at the bottom; defaults to the security reminder. */
  footer?: string;
  /** Pass false when the banner couldn't be attached: shows the name as text. */
  hasWordmark?: boolean;
  /** Override for templates that link the banner instead of attaching it. */
  wordmarkSrc?: string;
}) {
  const hosted = hostedHeaderUrl();
  const src = input.wordmarkSrc ?? hosted ?? `cid:${headerContentId}`;
  const brand =
    input.hasWordmark === false && !input.wordmarkSrc && !hosted
      ? `<div style="padding:26px 0;border-radius:16px;background:#3b2cf6;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">SaphraONE</div>`
      : `<img src="${escapeHtml(src)}" alt="SaphraONE" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;border-radius:16px;" />`;
  const footer =
    input.footer ??
    "SaphraONE will never ask for your PIN, codes or recovery phrase by email, phone or chat.";

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(input.title)}</title>${darkModeStyles}</head>
<body class="em-body" style="margin:0;padding:0;background:#ffffff;">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>` : ""}
<table class="em-body" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr><td align="center" style="padding:24px 12px;">
    <table class="em-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td align="center">${brand}</td></tr>
      <tr><td style="padding:28px 8px 8px;font-family:Arial,Helvetica,sans-serif;color:#17111c;">
        <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;text-align:center;color:#17111c;">${escapeHtml(input.title)}</h1>
        ${input.body}
      </td></tr>
      <tr><td class="em-muted" style="padding:24px 8px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6b6478;text-align:center;">${footer}<br>SaphraONE &middot; <a href="https://app.saphra.one" style="color:${brandPurple};">app.saphra.one</a></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
