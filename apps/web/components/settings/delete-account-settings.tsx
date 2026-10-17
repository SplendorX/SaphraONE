"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useDisconnect } from "wagmi";

import { useAccountContext } from "@/components/account/account-provider";
import { CodeInput } from "@/components/two-factor/code-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DeletionError,
  deletionErrorMessage,
  fetchDeletionStatus,
  postDeletion,
} from "@/lib/account-deletion/client";
import {
  CONFIRM_PHRASE,
  confirmPhraseMatches,
  deletionReasons,
  FEEDBACK_MAX,
  formatDeletionDate,
  type DeletionReason,
  type DeletionStatus,
} from "@/lib/account-deletion/rules";
import { signOutForAppLock } from "@/lib/app-lock/client";

import "./delete-account.css";

type Step = "review" | "reason" | "confirm" | "done";

const erased = [
  "Your profile: name, photo, bio, country, email and phone",
  "Your ONE ID: no one else can take it for 12 months, then it's released",
  "Saved contacts and payment recipients",
  "Payment PIN, Face ID, two-factor and sign-in security settings",
  "Recurring payments, automations and ALLIE's Agent Wallet access",
];

const kept = [
  "Your wallet and everything in it: it lives on the blockchain, not with us",
  "On-chain transactions, which are public and permanent by design",
  "Records of past payments and invoices we must keep by law, no longer linked to your name, email or phone",
];

/**
 * Settings → Delete account: what goes and what stays, anything to sort out
 * first, why they're leaving, then proof it's really them. The account is
 * scheduled for deletion and erased after the grace period; signing back in
 * before then restores it.
 */
export function DeleteAccountSettings() {
  const { ownerWallet, refresh } = useAccountContext();
  const { disconnect } = useDisconnect();
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("review");

  const [reason, setReason] = useState<DeletionReason | null>(null);
  const [feedback, setFeedback] = useState("");

  const [email, setEmail] = useState("");
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [emailCode, setEmailCode] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [backupCode, setBackupCode] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const [busy, setBusy] = useState<"code" | "delete" | "restore" | null>(null);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerWallet) return;
    setLoadError(null);
    try {
      setStatus(await fetchDeletionStatus(ownerWallet));
    } catch (cause) {
      setLoadError(deletionErrorMessage(cause));
    }
  }, [ownerWallet]);

  useEffect(() => {
    void load();
  }, [load]);

  // After scheduling, this device signs out: the account is closed here.
  useEffect(() => {
    if (step !== "done") return;
    const timer = window.setTimeout(() => void signOutForAppLock(disconnect), 8000);
    return () => window.clearTimeout(timer);
  }, [disconnect, step]);

  function go(next: Step) {
    setError(null);
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  async function sendCode() {
    if (!ownerWallet) return;
    setBusy("code");
    setError(null);
    try {
      const result = await postDeletion<{ sentTo: string }>(ownerWallet, "send-code", {
        email: status?.verify.email ? undefined : email,
      });
      setCodeSentTo(result.sentTo);
      setEmailCode("");
    } catch (cause) {
      setError({ field: cause instanceof DeletionError ? cause.details.field ?? "code" : "code", message: deletionErrorMessage(cause) });
    } finally {
      setBusy(null);
    }
  }

  async function schedule() {
    if (!ownerWallet) return;
    setBusy("delete");
    setError(null);
    try {
      const result = await postDeletion<{ scheduledFor: string }>(ownerWallet, "schedule", {
        acknowledged,
        backupCode: useBackup ? backupCode : undefined,
        code: emailCode,
        confirm: confirmText,
        feedback: feedback.trim() || undefined,
        reason: reason ?? undefined,
        twoFactorCode: useBackup ? undefined : twoFactorCode,
      });
      setScheduledFor(result.scheduledFor);
      go("done");
    } catch (cause) {
      const field = cause instanceof DeletionError ? cause.details.field : undefined;
      if (field === "code") setEmailCode("");
      if (field === "twoFactor") {
        setTwoFactorCode("");
        setBackupCode("");
      }
      setError({ field, message: deletionErrorMessage(cause) });
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (!ownerWallet) return;
    setBusy("restore");
    setError(null);
    try {
      await postDeletion(ownerWallet, "cancel");
      await Promise.all([load(), refresh()]);
    } catch (cause) {
      setError({ message: deletionErrorMessage(cause) });
    } finally {
      setBusy(null);
    }
  }

  if (!ownerWallet) {
    return <p className="text-sm text-muted-foreground">Sign in to manage your account.</p>;
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {loadError ? (
          <>
            {loadError}
            <Button onClick={() => void load()} size="sm" type="button" variant="outline">
              Try again
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your account…
          </>
        )}
      </div>
    );
  }

  if (step === "done" && scheduledFor) {
    return (
      <div className="da-done">
        <span className="da-done-icon">
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <h3>Your account is scheduled for deletion</h3>
        <p>
          It will be deleted on <strong>{formatDeletionDate(scheduledFor)}</strong>. Until then, sign in and choose{" "}
          <strong>Restore account</strong> to keep it.
          {codeSentTo || status.verify.email ? " We've emailed you the details." : ""}
        </p>
        <p className="da-muted">Signing you out of this device…</p>
        <Button onClick={() => void signOutForAppLock(disconnect)} type="button" variant="outline">
          Sign out now
        </Button>
      </div>
    );
  }

  if (status.scheduled) {
    return (
      <div className="da-stack">
        <div className="da-callout is-warning">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="da-callout-title">
              Scheduled for deletion on {formatDeletionDate(status.scheduled.scheduledFor)}
            </p>
            <p>Restore your account to cancel the deletion and keep everything as it is.</p>
          </div>
        </div>
        <Button disabled={busy !== null} onClick={() => void restore()} type="button">
          {busy === "restore" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Restore my account
        </Button>
        {error ? <p className="da-error" role="alert">{error.message}</p> : null}
      </div>
    );
  }

  const blockers = status.checks.filter((check) => check.kind === "blocker");
  const notices = status.checks.filter((check) => check.kind === "notice");
  const needsEmailCode = status.verify.emailAvailable;
  const twoFactorReady = !status.verify.twoFactor || (useBackup ? backupCode.trim().length > 0 : twoFactorCode.length === 6);
  const canDelete =
    (!needsEmailCode || (codeSentTo !== null && emailCode.length === 6)) &&
    twoFactorReady &&
    confirmPhraseMatches(confirmText) &&
    acknowledged;

  return (
    <div className="da-stack">
      <ol aria-label="Steps" className="da-steps">
        {(["review", "reason", "confirm"] as const).map((id, index) => (
          <li data-active={step === id} data-done={["review", "reason", "confirm"].indexOf(step) > index} key={id}>
            <span>{index + 1}</span>
            {id === "review" ? "Review" : id === "reason" ? "Feedback" : "Confirm"}
          </li>
        ))}
      </ol>

      {step === "review" ? (
        <>
          <div className="da-callout is-danger">
            <Trash2 className="h-5 w-5 shrink-0" />
            <div>
              <p className="da-callout-title">Deleting your account is permanent</p>
              <p>
                You&apos;ll have {status.graceDays} days to change your mind: sign in before then and restore it.
                After that, it can&apos;t be undone.
              </p>
            </div>
          </div>

          {status.checks.length > 0 ? (
            <section className="da-section">
              <h3>{blockers.length > 0 ? "Sort these out first" : "Before you go"}</h3>
              <ul className="da-checks">
                {[...blockers, ...notices].map((check) => (
                  <li data-kind={check.kind} key={check.id}>
                    {check.kind === "blocker" ? (
                      <XCircle className="h-5 w-5 shrink-0" />
                    ) : (
                      <Info className="h-5 w-5 shrink-0" />
                    )}
                    <div>
                      <p className="da-check-title">{check.title}</p>
                      <p>{check.detail}</p>
                      {check.href ? (
                        <Link className="da-link" href={check.href}>
                          Go there <ArrowRight className="inline h-3.5 w-3.5" />
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="da-section">
            <h3>What will be erased</h3>
            <ul className="da-list is-erased">
              {erased.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="da-section">
            <h3>What stays</h3>
            <ul className="da-list is-kept">
              {kept.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="da-muted">
              Move any money you want to keep to another wallet first. If you sign in again later with the same
              Google account or email, you&apos;ll start a new, empty SaphraONE account.
            </p>
          </section>

          <div className="da-callout">
            <Info className="h-5 w-5 shrink-0" />
            <div>
              <p className="da-callout-title">Just need a break?</p>
              <p>
                You can sign out instead, or turn off emails in{" "}
                <Link className="da-link" href="/settings#alerts">
                  Alerts
                </Link>
                . Problem we can fix?{" "}
                <Link className="da-link" href="/support">
                  Talk to support
                </Link>
                .
              </p>
            </div>
          </div>

          <div className="da-actions">
            <Button disabled={blockers.length > 0} onClick={() => go("reason")} type="button" variant="destructive">
              Continue
            </Button>
          </div>
        </>
      ) : null}

      {step === "reason" ? (
        <>
          <section className="da-section">
            <h3>Why are you leaving?</h3>
            <p className="da-muted">Optional. It helps us make SaphraONE better.</p>
            <div className="da-reasons" role="radiogroup">
              {deletionReasons.map((option) => (
                <label data-checked={reason === option.id} key={option.id}>
                  <input
                    checked={reason === option.id}
                    name="deletion-reason"
                    onChange={() => setReason(option.id)}
                    type="radio"
                    value={option.id}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <textarea
              aria-label="Anything else you'd like to tell us"
              className="da-textarea"
              maxLength={FEEDBACK_MAX}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Anything else you'd like to tell us? (optional)"
              rows={3}
              value={feedback}
            />
          </section>
          <div className="da-actions">
            <Button onClick={() => go("review")} type="button" variant="ghost">
              Back
            </Button>
            <Button onClick={() => go("confirm")} type="button" variant="destructive">
              Continue
            </Button>
          </div>
        </>
      ) : null}

      {step === "confirm" ? (
        <form
          className="da-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (canDelete && busy === null) void schedule();
          }}
        >
          {needsEmailCode ? (
            <section className="da-section">
              <h3>
                <Mail className="h-4 w-4" /> Confirm by email
              </h3>
              {status.verify.email ? (
                <p className="da-muted">
                  We&apos;ll send a 6-digit code to <strong>{status.verify.email}</strong>.
                </p>
              ) : (
                <>
                  <p className="da-muted">
                    Your account has no security email yet. Enter one you can open now; we&apos;ll send the code
                    and your deletion details there.
                  </p>
                  <Input
                    aria-invalid={error?.field === "email"}
                    autoComplete="email"
                    disabled={codeSentTo !== null}
                    inputMode="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    value={email}
                  />
                </>
              )}
              {codeSentTo ? (
                <div className="da-code-row">
                  <p className="da-muted">Code sent to {codeSentTo}.</p>
                  <CodeInput disabled={busy !== null} onChange={setEmailCode} value={emailCode} />
                  <button className="da-link" disabled={busy !== null} onClick={() => void sendCode()} type="button">
                    Send a new code
                  </button>
                </div>
              ) : (
                <Button
                  disabled={busy !== null || (!status.verify.email && !email.trim())}
                  onClick={() => void sendCode()}
                  type="button"
                  variant="outline"
                >
                  {busy === "code" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Send code
                </Button>
              )}
              {error && (error.field === "code" || error.field === "email") ? (
                <p className="da-error" role="alert">{error.message}</p>
              ) : null}
            </section>
          ) : null}

          {status.verify.twoFactor ? (
            <section className="da-section">
              <h3>
                <ShieldCheck className="h-4 w-4" /> Two-factor authentication
              </h3>
              {useBackup ? (
                <Input
                  aria-label="Backup code"
                  autoCapitalize="none"
                  autoComplete="off"
                  className="w-56 font-mono"
                  disabled={busy !== null}
                  onChange={(event) => setBackupCode(event.target.value)}
                  placeholder="xxxxx-xxxxx"
                  value={backupCode}
                />
              ) : (
                <>
                  <p className="da-muted">Enter the code from your authenticator app.</p>
                  <CodeInput disabled={busy !== null} onChange={setTwoFactorCode} value={twoFactorCode} />
                </>
              )}
              <button
                className="da-link"
                onClick={() => {
                  setUseBackup(!useBackup);
                  setTwoFactorCode("");
                  setBackupCode("");
                }}
                type="button"
              >
                {useBackup ? "Use my authenticator app" : "Use a backup code"}
              </button>
              {error?.field === "twoFactor" ? <p className="da-error" role="alert">{error.message}</p> : null}
            </section>
          ) : null}

          <section className="da-section">
            <h3>Type {CONFIRM_PHRASE} to confirm</h3>
            <Input
              aria-invalid={error?.field === "confirm"}
              aria-label={`Type ${CONFIRM_PHRASE} to confirm`}
              autoCapitalize="characters"
              autoComplete="off"
              className="w-56 font-mono tracking-widest"
              disabled={busy !== null}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={CONFIRM_PHRASE}
              spellCheck={false}
              value={confirmText}
            />
            <label className="da-ack">
              <input
                checked={acknowledged}
                disabled={busy !== null}
                onChange={(event) => setAcknowledged(event.target.checked)}
                type="checkbox"
              />
              <span>
                I understand my account will be deleted after {status.graceDays} days, my personal data erased and my
                username released after a 12-month hold, and that this can&apos;t be undone after that. I&apos;ve moved any funds I want
                to keep.
              </span>
            </label>
          </section>

          {error && !["code", "email", "twoFactor"].includes(error.field ?? "") ? (
            <p className="da-error" role="alert">{error.message}</p>
          ) : null}

          <div className="da-actions">
            <Button disabled={busy !== null} onClick={() => go("reason")} type="button" variant="ghost">
              Back
            </Button>
            <Button disabled={!canDelete || busy !== null} type="submit" variant="destructive">
              {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete my account
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
