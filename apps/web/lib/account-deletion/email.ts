// Server-only. The emails around deleting an account, in the security-email
// frame: the confirmation code, "scheduled", "restored" and "deleted".
import { brandPurple, brandedEmail, emailButton, escapeHtml } from "@/lib/email/brand-layout";
import { formatDeletionDate, GRACE_DAYS } from "@/lib/account-deletion/rules";
import { sendSecurityEmail } from "@/lib/tx-approval/email";

const signOff = `<p style="margin:18px 0 0;font-size:14px;line-height:1.55">The SaphraONE Team</p>`;

function paragraph(html: string) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${html}</p>`;
}

function greeting(name: string | null) {
  return paragraph(escapeHtml(name ? `Hi ${name},` : "Hi,"));
}

export function sendDeletionCode(to: string, code: string, key: string) {
  const html = brandedEmail({
    body: `${paragraph("Use this code to confirm you want to delete your SaphraONE account. It expires in 10 minutes.")}
<p class="em-code" style="margin:0 0 22px;padding:16px 0;border-radius:14px;background:#f3efff;border:1px solid #e2d9fd;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;color:#120b20">${escapeHtml(code)}</p>
<p class="em-muted" style="margin:0;font-size:13px;line-height:1.55;color:#6b6478">If you didn't ask to delete your account, don't share this code. Someone may have access to your account: sign out on every device, change your Google or email password, and contact support.</p>`,
    preheader: `Your account deletion code is ${code}`,
    title: "Confirm account deletion",
  });
  const text = [
    `Your SaphraONE account deletion code is ${code}. It expires in 10 minutes.`,
    "",
    "If you didn't ask to delete your account, don't share this code. Sign out on every device, change your Google or email password, and contact support.",
  ].join("\n");
  return sendSecurityEmail(to, `Your SaphraONE deletion code: ${code}`, html, text, key);
}

export function sendDeletionScheduled(
  to: string,
  details: { name: string | null; origin: string; scheduledFor: string },
  key: string,
) {
  const date = formatDeletionDate(details.scheduledFor);
  const html = brandedEmail({
    body: `${greeting(details.name)}
${paragraph(`Your SaphraONE account is scheduled for deletion on <strong>${escapeHtml(date)}</strong>.`)}
${paragraph(`Changed your mind? Sign in any time in the next ${GRACE_DAYS} days and choose <strong>Restore account</strong>. Nothing is erased until then.`)}
<p style="margin:6px 0 20px;text-align:center">${emailButton(`${details.origin}/`, "Sign in to restore")}</p>
${paragraph("Your wallet stays on the blockchain and stays yours: SaphraONE can't delete it or move your money. Move any funds you want to keep before the deletion date.")}
<p style="margin:14px 0 0;font-size:14px;line-height:1.55">If you didn't ask for this, sign in now, restore your account, and <a href="${escapeHtml(`${details.origin}/support`)}" style="color:${brandPurple}">contact support</a>.</p>
${signOff}`,
    preheader: `Your account will be deleted on ${date}. Sign in before then to restore it.`,
    title: "Your account is scheduled for deletion",
  });
  const text = [
    `Your SaphraONE account is scheduled for deletion on ${date}.`,
    "",
    `Changed your mind? Sign in any time in the next ${GRACE_DAYS} days and choose Restore account: ${details.origin}/`,
    "",
    "Your wallet stays on the blockchain and stays yours. Move any funds you want to keep before the deletion date.",
    "",
    `If you didn't ask for this, sign in, restore your account and contact support: ${details.origin}/support`,
  ].join("\n");
  return sendSecurityEmail(to, "Your SaphraONE account is scheduled for deletion", html, text, key);
}

export function sendDeletionCancelled(to: string, details: { name: string | null; origin: string }, key: string) {
  const html = brandedEmail({
    body: `${greeting(details.name)}
${paragraph("Your SaphraONE account has been restored. It won't be deleted, and everything is as you left it.")}
<p style="margin:14px 0 0;font-size:14px;line-height:1.55">If you didn't restore it, <a href="${escapeHtml(`${details.origin}/support`)}" style="color:${brandPurple}">contact support</a>.</p>
${signOff}`,
    preheader: "Your account won't be deleted.",
    title: "Your account has been restored",
  });
  const text = [
    "Your SaphraONE account has been restored. It won't be deleted.",
    "",
    `If you didn't restore it, contact support: ${details.origin}/support`,
  ].join("\n");
  return sendSecurityEmail(to, "Your SaphraONE account has been restored", html, text, key);
}

export function sendDeletionCompleted(to: string, key: string) {
  const html = brandedEmail({
    body: `${paragraph("Your SaphraONE account has been deleted. Your profile, contacts, security settings and preferences have been erased. Your ONE ID is held for 12 months so no one else can take it, then it's released.")}
${paragraph("We keep records of past transactions where the law requires it, no longer linked to your name, email or phone. Your wallet and anything in it remain yours on the blockchain.")}
${paragraph("If you sign in again with the same Google account or email, you'll start a new, empty SaphraONE account, and you can have your old ONE ID back if it's still on hold.")}
${paragraph("Thank you for using SaphraONE.")}
${signOff}`,
    preheader: "Your account and personal data have been erased.",
    title: "Your account has been deleted",
  });
  const text = [
    "Your SaphraONE account has been deleted. Your profile, contacts, security settings and preferences have been erased.",
    "",
    "We keep records of past transactions where the law requires it, no longer linked to your name, email or phone. Your wallet remains yours on the blockchain.",
    "",
    "If you sign in again with the same Google account or email, you'll start a new, empty SaphraONE account.",
  ].join("\n");
  return sendSecurityEmail(to, "Your SaphraONE account has been deleted", html, text, key);
}
