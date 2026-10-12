import crypto from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  sendDeletionCancelled,
  sendDeletionCode,
  sendDeletionScheduled,
} from "@/lib/account-deletion/email";
import {
  confirmPhraseMatches,
  GRACE_DAYS,
  readDeletionReason,
  readFeedback,
  type DeletionStatus,
} from "@/lib/account-deletion/rules";
import {
  cancelDeletion,
  deletionChecks,
  findScheduledDeletion,
  greetingNameFor,
  scheduleDeletion,
} from "@/lib/account-deletion/server";
import { readJsonRecord } from "@/lib/http";
import { normalizeOwnerWallet } from "@/lib/recurring-auth";
import { consumeRateLimit } from "@/lib/rate-limit";
import { secureCookieFor } from "@/lib/secure-cookie";
import { checkCode, findTwoFactor, type CodeCheck } from "@/lib/two-factor/server";
import {
  alertEmailFor,
  maskEmail,
  saveAlertEmail,
  securityEmailConfigured,
  validEmail,
} from "@/lib/tx-approval/email";
import {
  createSignedToken,
  readSignedToken,
  readWalletToken,
  sessionWallets,
  walletSessionCookieName,
} from "@/lib/wallet-session";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };
/** The emailed confirmation code, until it's used or expires. */
const codeCookieName = "saphra_delete_code";
const codeCookiePath = "/api/account/deletion";
const codeTtlMs = 10 * 60_000;

type CodeToken = { codeHash: string; email: string; expiresAt: number; wallet: string };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { headers: noStore, status });
}

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return json({ message, ...extra }, status);
}

function hashCode(wallet: string, code: string) {
  return crypto.createHash("sha256").update(`account-deletion:${wallet}:${code}`).digest("base64url");
}

function sameHash(first: string, second: string) {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function originOf(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin).replace(/\/+$/, "");
}

/**
 * The account being deleted: the profile wallet the page names, which the
 * signed session must cover (the proxy already refused locked or
 * 2FA-pending sessions). Two-factor is looked up across the session's
 * wallets, like /api/two-factor.
 */
async function readContext(requestedWallet: unknown) {
  const cookieStore = await cookies();
  const session = readWalletToken(cookieStore.get(walletSessionCookieName)?.value, "session");
  if (!session) return null;
  const sessionList = [session.ownerWallet.toLowerCase(), ...sessionWallets(session)];
  const owner = normalizeOwnerWallet(requestedWallet) ?? session.ownerWallet.toLowerCase();
  if (!sessionList.includes(owner)) return null;
  return {
    codeToken: readSignedToken(cookieStore.get(codeCookieName)?.value) as CodeToken | null,
    owner,
    sessionWallets: sessionList,
  };
}

function twoFactorFailure(result: CodeCheck) {
  if (result.ok) return null;
  if (result.reason === "paused") {
    return jsonError("Too many wrong codes. Try again later.", 429, { pausedUntil: result.until });
  }
  return jsonError("That authenticator code isn't right.", 401, {
    attemptsLeft: result.attemptsLeft,
    field: "twoFactor",
  });
}

/** Where the request stands, what's still open, and what the confirm step will ask for. */
export async function GET(request: NextRequest) {
  const context = await readContext(request.nextUrl.searchParams.get("ownerWallet"));
  if (!context) return jsonError("Sign in first.", 401);

  try {
    const [scheduled, checks, email, twoFactor] = await Promise.all([
      findScheduledDeletion([context.owner]),
      deletionChecks(context.owner),
      alertEmailFor(context.owner),
      findTwoFactor(context.sessionWallets).catch(() => null),
    ]);
    const status: DeletionStatus = {
      checks,
      graceDays: GRACE_DAYS,
      scheduled: scheduled
        ? { requestedAt: scheduled.requested_at, scheduledFor: scheduled.scheduled_for }
        : null,
      verify: {
        email: email ? maskEmail(email) : null,
        emailAvailable: securityEmailConfigured(),
        twoFactor: Boolean(twoFactor),
      },
    };
    return json(status);
  } catch (error) {
    console.error("[account-deletion] status", error);
    return jsonError("Account deletion isn't available right now. Try again later.", 503);
  }
}

export async function POST(request: NextRequest) {
  const body = (await readJsonRecord(request)) ?? {};
  const context = await readContext(body.ownerWallet);
  if (!context) return jsonError("Sign in first.", 401);
  const { owner } = context;

  if (!(await consumeRateLimit(`account-deletion:${owner}`, 20, 15 * 60))) {
    return jsonError("Too many attempts. Wait a few minutes and try again.", 429);
  }

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "send-code") {
    if (!securityEmailConfigured()) {
      return jsonError("Email codes aren't available right now.", 503);
    }
    if (!(await consumeRateLimit(`account-deletion-code:${owner}`, 5, 60 * 60))) {
      return jsonError("Too many codes sent. Try again in an hour.", 429);
    }
    // A security email on file always wins: a session alone can't redirect
    // the code to an inbox of its choosing.
    const email = (await alertEmailFor(owner)) ?? validEmail(body.email);
    if (!email) return jsonError("Enter a valid email address.", 400, { field: "email" });

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    const sent = await sendDeletionCode(email, code, `account-deletion-code-${owner}-${crypto.randomUUID()}`);
    if (!sent) return jsonError("The code couldn't be sent. Try again in a moment.", 502);

    const response = json({ sentTo: maskEmail(email) });
    const token: CodeToken = {
      codeHash: hashCode(owner, code),
      email,
      expiresAt: Date.now() + codeTtlMs,
      wallet: owner,
    };
    response.cookies.set(codeCookieName, createSignedToken(token), {
      httpOnly: true,
      maxAge: codeTtlMs / 1000,
      path: codeCookiePath,
      sameSite: "strict",
      secure: await secureCookieFor(),
    });
    return response;
  }

  if (action === "schedule") {
    let existing;
    try {
      existing = await findScheduledDeletion([owner]);
    } catch {
      return jsonError("Account deletion isn't available right now. Try again later.", 503);
    }
    if (existing) {
      return json({ scheduledFor: existing.scheduled_for });
    }

    const blockers = (await deletionChecks(owner)).filter((check) => check.kind === "blocker");
    if (blockers.length > 0) {
      return jsonError(blockers[0].detail, 409, { field: "checks" });
    }
    if (body.acknowledged !== true) {
      return jsonError("Confirm you understand what deleting your account does.", 400);
    }
    if (!confirmPhraseMatches(body.confirm)) {
      return jsonError('Type DELETE to confirm.', 400, { field: "confirm" });
    }

    // Prove it's the owner: the emailed code, and the authenticator when 2FA is on.
    let notifyEmail: string | null = null;
    if (securityEmailConfigured()) {
      const token = context.codeToken;
      const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
      if (!token || token.wallet !== owner || token.expiresAt < Date.now()) {
        return jsonError("Send yourself a new code and try again.", 400, { field: "code" });
      }
      if (!/^\d{6}$/.test(code) || !sameHash(hashCode(owner, code), token.codeHash)) {
        return jsonError("That email code isn't right.", 401, { field: "code" });
      }
      notifyEmail = token.email;
    }

    const twoFactor = await findTwoFactor(context.sessionWallets).catch(() => null);
    if (twoFactor) {
      const code = typeof body.twoFactorCode === "string" ? body.twoFactorCode.replace(/\s+/g, "") : "";
      const backupCode = typeof body.backupCode === "string" ? body.backupCode.trim() : "";
      if (!/^\d{6}$/.test(code) && !backupCode) {
        return jsonError("Enter the code from your authenticator app.", 400, { field: "twoFactor" });
      }
      const failure = twoFactorFailure(
        await checkCode(twoFactor, /^\d{6}$/.test(code) ? { code } : { backupCode }),
      );
      if (failure) return failure;
    }

    let scheduled;
    try {
      scheduled = await scheduleDeletion({
        feedback: readFeedback(body.feedback),
        notifyEmail,
        ownerWallet: owner,
        reason: readDeletionReason(body.reason),
      });
    } catch (error) {
      console.error("[account-deletion] schedule", error);
      return jsonError("Your account couldn't be scheduled for deletion. Try again later.", 503);
    }

    if (notifyEmail) {
      // They just proved this inbox: keep it as the security email if none was set.
      await saveAlertEmail(owner, notifyEmail).catch(() => undefined);
      await sendDeletionScheduled(
        notifyEmail,
        { name: await greetingNameFor(owner), origin: originOf(request), scheduledFor: scheduled.scheduled_for },
        `account-deletion-scheduled-${scheduled.id}`,
      );
    }

    const response = json({ scheduledFor: scheduled.scheduled_for });
    response.cookies.set(codeCookieName, "", { maxAge: 0, path: codeCookiePath });
    return response;
  }

  if (action === "cancel") {
    let existing;
    try {
      existing = await findScheduledDeletion([owner]);
    } catch {
      return jsonError("Account deletion isn't available right now. Try again later.", 503);
    }
    if (!existing) return json({ restored: true });

    try {
      await cancelDeletion(existing.id);
    } catch (error) {
      console.error("[account-deletion] cancel", error);
      return jsonError("Your account couldn't be restored. Try again in a moment.", 503);
    }
    if (existing.notify_email) {
      await sendDeletionCancelled(
        existing.notify_email,
        { name: await greetingNameFor(existing.owner_wallet), origin: originOf(request) },
        `account-deletion-cancelled-${existing.id}`,
      );
    }
    return json({ restored: true });
  }

  return jsonError("Unknown action.", 400);
}
