// Server-only: reads the wordmark from public/ to attach it to emails.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The one look every SaphraONE email shares: the white SaphraONE wordmark on
 * the brand's purple-to-blue gradient, with the message on a white card
 * inside it. The Supabase sign-in templates (docs/email-templates/) copy
 * this markup by hand, so change both together.
 *
 * The wordmark is linked from the live site whenever there is one. An inline
 * (cid) attachment looked tidy in some clients, but Gmail shows it as a
 * "saphraone.png" attachment and can drop it from the header entirely, so the
 * attachment is only the fallback for local development, where a linked
 * image can't load.
 */

export const wordmarkContentId = "saphra-wordmark";

/** Brand gradient stops, as on the app icon. Outlook shows the middle one flat. */
const gradient = "linear-gradient(135deg,#6a0ef4 0%,#3b2cf6 50%,#0078ff 100%)";
const gradientFallback = "#3b2cf6";
export const brandPurple = "#5f15f4";

const wordmarkPath = "/brand/saphra-wordmark-white.png";

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

/** Absolute URL of the white wordmark, or null when only the attachment works. */
export function hostedWordmarkUrl() {
  const origin = publicOrigin();
  return origin ? `${origin}${wordmarkPath}` : null;
}

let wordmarkBase64: Promise<string | null> | null = null;

function loadWordmark() {
  wordmarkBase64 ??= readFile(join(process.cwd(), "public", "brand", "saphra-wordmark-white.png"))
    .then((file) => file.toString("base64"))
    .catch(() => null);
  return wordmarkBase64;
}

/**
 * Resend `attachments` for the inline wordmark: none when the wordmark is
 * linked from the live site, or when the file can't be read.
 */
export async function wordmarkAttachments() {
  if (hostedWordmarkUrl()) return [];
  const content = await loadWordmark();
  return content
    ? [{ content, content_id: wordmarkContentId, content_type: "image/png", filename: "saphraone.png" }]
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

/** A full-width button in the brand purple. */
export function emailButton(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${brandPurple};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:14px 14px 4px 14px;">${escapeHtml(label)}</a>`;
}

/**
 * Dark mode, for mail apps that follow the phone's theme and read <style>
 * (Apple Mail, Outlook, Gmail on iOS; [data-ogsc] is Outlook's dark mode).
 * The gradient frame works in both themes, so only the page and the white
 * card change. Apps that ignore this (some Gmail builds) invert colours on
 * their own.
 */
const darkModeStyles = `<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .em-body { background:#0c0a12 !important; }
  .em-card { background:#17131f !important; }
  .em-card h1, .em-card p, .em-card td, .em-card span, .em-card strong, .em-card li { color:#ece8f5 !important; border-color:#2c2539 !important; }
  .em-card a { color:#b794ff !important; }
  .em-card .em-muted { color:#a59db4 !important; }
  .em-card .em-code { background:#241b3a !important; border-color:#3a2d5c !important; color:#ffffff !important; }
}
[data-ogsc] .em-body { background:#0c0a12 !important; }
[data-ogsc] .em-card { background:#17131f !important; }
[data-ogsc] .em-card h1, [data-ogsc] .em-card p, [data-ogsc] .em-card td { color:#ece8f5 !important; }
</style>`;

/**
 * Wraps a message in the SaphraONE frame.
 * `body` is trusted HTML: escape anything user-supplied before passing it.
 */
export function brandedEmail(input: {
  /** Hidden inbox preview text. */
  preheader?: string;
  /** Centred heading at the top of the card. */
  title: string;
  body: string;
  /** Small print under the card; defaults to the security reminder. */
  footer?: string;
  /** Pass false when the wordmark couldn't be attached: shows the name as text. */
  hasWordmark?: boolean;
  /** Override for templates that link the image instead of attaching it. */
  wordmarkSrc?: string;
}) {
  const hosted = hostedWordmarkUrl();
  const src = input.wordmarkSrc ?? hosted ?? `cid:${wordmarkContentId}`;
  const brand =
    input.hasWordmark === false && !input.wordmarkSrc && !hosted
      ? `<span style="font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">SaphraONE</span>`
      : `<img src="${escapeHtml(src)}" alt="SaphraONE" width="170" height="75" style="display:inline-block;width:170px;height:auto;border:0;outline:none;" />`;
  const footer =
    input.footer ??
    "SaphraONE will never ask for your PIN, codes or recovery phrase by email, phone or chat.";

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(input.title)}</title>${darkModeStyles}</head>
<body class="em-body" style="margin:0;padding:0;background:#f1effa;">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>` : ""}
<table class="em-body" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1effa;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;border-radius:24px;background-color:${gradientFallback};background-image:${gradient};">
      <tr><td align="center" style="padding:30px 20px 26px;">${brand}</td></tr>
      <tr><td style="padding:0 16px 16px;">
        <table class="em-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:18px;">
          <tr><td style="padding:30px 28px 28px;font-family:Arial,Helvetica,sans-serif;color:#17111c;">
            <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;text-align:center;color:#17111c;">${escapeHtml(input.title)}</h1>
            ${input.body}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 28px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#e6e4ff;text-align:center;">${footer}<br>SaphraONE &middot; app.saphra.one</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
