"use client";

import { Fingerprint, KeyRound, Loader2, Mail, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PinPad } from "@/components/app-lock/pin-pad";
import { biometricLabel, postAppLock, signOutForAppLock } from "@/lib/app-lock/client";
import { readSignInEmail } from "@/lib/circle-session";
import {
  registerTxApprovalSheet,
  TxApprovalCancelled,
  type TxApprovalRequest,
} from "@/lib/tx-approval/client";
import type { TxApprovalMethod, TxApprovalStart } from "@/lib/tx-approval/shared";

import "./tx-approval.css";

type Pending = {
  reject: (error: Error) => void;
  request: TxApprovalRequest;
  resolve: (id: string) => void;
};

type Step =
  | "loading"
  | "passkey"
  | "pin"
  | "totp"
  | "email"
  | "email-setup"
  | "setup-pin"
  | "setup-confirm"
  | "done";

class ApprovalApiError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function postApproval<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/tx-approval", {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApprovalApiError(
      typeof payload.message === "string" ? payload.message : "Something went wrong. Try again.",
      payload,
    );
  }
  return payload as T;
}

function shortAddress(value: string | null) {
  if (!value) return null;
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/**
 * SaphraONE's transaction confirmation, in place of Circle's popup. One
 * Face ID / fingerprint prompt where it's set up; the PIN or a two-factor
 * code otherwise; plus a code from email for large or unusual payments.
 * Mounted once, app-wide; flows reach it through lib/tx-approval/client.
 */
export function TxApprovalSheet() {
  const queue = useRef<Pending[]>([]);
  const [current, setCurrent] = useState<Pending | null>(null);
  const [start, setStart] = useState<TxApprovalStart | null>(null);
  const [step, setStep] = useState<Step>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [code, setCode] = useState("");
  // Adding a security email during a PIN confirmation: the address, and
  // whether its code has been sent.
  const [setupEmail, setSetupEmail] = useState("");
  const [setupSent, setSetupSent] = useState(false);
  const autoPasskeyTried = useRef(false);

  useEffect(
    () =>
      registerTxApprovalSheet(
        (request) =>
          new Promise<string>((resolve, reject) => {
            queue.current.push({ reject, request, resolve });
            setCurrent((active) => active ?? queue.current.shift() ?? null);
          }),
      ),
    [],
  );

  // Start each approval: describe it and run the risk checks on the server.
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setStart(null);
    setStep("loading");
    setError(null);
    setPin("");
    setNewPin("");
    setCode("");
    setSetupEmail("");
    setSetupSent(false);
    autoPasskeyTried.current = false;
    postApproval<TxApprovalStart>({ action: "begin", ...current.request })
      .then((started) => {
        if (cancelled) return;
        setStart(started);
        setStep(
          started.needsSetup
            ? "setup-pin"
            : started.methods.includes("passkey")
              ? "passkey"
              : started.methods.includes("pin")
                ? "pin"
                : "totp",
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) finish(cause instanceof Error ? cause : new Error(String(cause)));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Face ID straight away: the tap that started the payment is the consent.
  useEffect(() => {
    if (step === "passkey" && start && !autoPasskeyTried.current) {
      autoPasskeyTried.current = true;
      void confirmWithPasskey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, start]);

  function finish(result: string | Error) {
    const active = current;
    if (!active) return;
    if (typeof result === "string") active.resolve(result);
    else active.reject(result);
    setStep("done");
    setCurrent(queue.current.shift() ?? null);
  }

  function cancel() {
    finish(new TxApprovalCancelled());
  }

  async function afterMethod(result: {
    approved: boolean;
    emailHint?: string;
    needsEmailCode?: boolean;
    needsEmailSetup?: boolean;
  }) {
    if (!start) return;
    if (result.approved) {
      finish(start.id);
      return;
    }
    if (result.needsEmailSetup) {
      setSetupEmail(readSignInEmail() ?? "");
      setSetupSent(false);
      setCode("");
      setError(null);
      setStep("email-setup");
      return;
    }
    if (result.needsEmailCode) {
      // A PIN confirmation asks for the code only now, so the address shown
      // comes with this answer.
      if (result.emailHint) setStart({ ...start, emailHint: result.emailHint });
      setCode("");
      setError(null);
      setStep("email");
    }
  }

  function fail(cause: unknown) {
    if (cause instanceof ApprovalApiError && cause.details.signedOut === true) {
      void signOutForAppLock();
      return;
    }
    if (cause instanceof ApprovalApiError && typeof cause.details.attemptsLeft === "number") {
      setError(`${cause.message} ${cause.details.attemptsLeft} tries left.`);
      return;
    }
    setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
  }

  async function confirmWithPasskey() {
    if (!start?.passkeyOptions) return;
    setBusy(true);
    setError(null);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const response = await startAuthentication({
        optionsJSON: start.passkeyOptions as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      });
      await afterMethod(
        await postApproval({ action: "verify", id: start.id, method: "passkey", response }),
      );
    } catch (cause) {
      // Dismissing the prompt (or a browser that needs a tap first) isn't an error.
      if (!(cause instanceof Error && cause.name === "NotAllowedError")) fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithPin(value: string) {
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      await afterMethod(await postApproval({ action: "verify", id: start.id, method: "pin", pin: value }));
    } catch (cause) {
      setPin("");
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (!start) return;
    setBusy(true);
    setError(null);
    const trimmed = code.trim();
    try {
      await afterMethod(
        await postApproval({
          action: "verify",
          id: start.id,
          method: "totp",
          ...(/^\d{6}$/.test(trimmed) ? { code: trimmed } : { backupCode: trimmed }),
        }),
      );
      setCode("");
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  /** Send the code to the security email being added. */
  async function sendSetupCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await postApproval<{ emailHint: string }>({
        action: "email-setup",
        email: setupEmail.trim(),
        id: start.id,
      });
      setStart({ ...start, emailHint: sent.emailHint });
      setSetupSent(true);
      setCode("");
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetupCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      await afterMethod(
        await postApproval({ action: "verify-email", code: code.trim(), email: setupEmail.trim(), id: start.id }),
      );
    } catch (cause) {
      setCode("");
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmailCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (!start) return;
    setBusy(true);
    setError(null);
    try {
      await afterMethod(await postApproval({ action: "verify-email", code: code.trim(), id: start.id }));
    } catch (cause) {
      setCode("");
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  /** First payment with no PIN, passkey or 2FA: create the SaphraONE PIN, then use it. */
  async function createPinAndConfirm(confirmation: string) {
    if (confirmation !== newPin) {
      setError("Those PINs don't match. Try again.");
      setNewPin("");
      setPin("");
      setStep("setup-pin");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postAppLock("setup", { pin: newPin });
      await afterMethod(await postApproval({ action: "verify", id: start?.id, method: "pin", pin: newPin }));
    } catch (cause) {
      setPin("");
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;

  const methods: TxApprovalMethod[] = start?.methods ?? [];
  const others = methods.filter((method) => method !== step);
  const amountLine = start?.amount ? `${start.amount} ${start.token ?? ""}`.trim() : null;

  return (
    <div className="txa-backdrop" role="presentation">
      <div aria-labelledby="txa-title" aria-modal="true" className="txa-sheet" role="dialog">
        <div className="txa-head">
          <span className="txa-badge">
            <ShieldCheck className="h-4 w-4" />
            SaphraONE confirmation
          </span>
          <button aria-label="Cancel" className="txa-close" disabled={busy} onClick={cancel} type="button">
            <X className="h-5 w-5" />
          </button>
        </div>

        {start ? (
          <div className="txa-summary">
            <h2 className="txa-title" id="txa-title">
              {start.title}
            </h2>
            {amountLine ? <p className="txa-amount">{amountLine}</p> : null}
            {start.destination ? (
              <p className="txa-to">
                To <span className="font-mono">{shortAddress(start.destination)}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="txa-loading">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span id="txa-title">Preparing confirmation</span>
          </div>
        )}

        {step === "passkey" ? (
          <button className="txa-primary" disabled={busy} onClick={() => void confirmWithPasskey()} type="button">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5" />}
            Confirm with {biometricLabel()}
          </button>
        ) : null}

        {step === "pin" ? (
          <div className="txa-pin">
            <p className="txa-hint">Enter your SaphraONE PIN</p>
            <PinPad disabled={busy} error={Boolean(error)} onChange={setPin} onComplete={confirmWithPin} value={pin} />
          </div>
        ) : null}

        {step === "setup-pin" || step === "setup-confirm" ? (
          <div className="txa-pin">
            <p className="txa-hint">
              {step === "setup-pin"
                ? "Create a 6-digit PIN. You'll use it to confirm payments and unlock SaphraONE."
                : "Enter the PIN again to confirm it."}
            </p>
            <PinPad
              disabled={busy}
              error={Boolean(error)}
              onChange={setPin}
              onComplete={(value) => {
                if (step === "setup-pin") {
                  setNewPin(value);
                  setPin("");
                  setError(null);
                  setStep("setup-confirm");
                } else {
                  void createPinAndConfirm(value);
                }
              }}
              value={pin}
            />
          </div>
        ) : null}

        {step === "totp" ? (
          <form className="txa-code" onSubmit={confirmWithCode}>
            <label className="txa-hint" htmlFor="txa-totp">
              Enter the 6-digit code from your authenticator app, or a backup code
            </label>
            <input
              autoComplete="one-time-code"
              autoFocus
              className="txa-input"
              id="txa-totp"
              inputMode="text"
              maxLength={11}
              onChange={(event) => setCode(event.target.value)}
              value={code}
            />
            <button className="txa-primary" disabled={busy || code.trim().length < 6} type="submit">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
              Confirm
            </button>
          </form>
        ) : null}

        {step === "email" ? (
          <form className="txa-code" onSubmit={confirmEmailCode}>
            <p className="txa-email-note">
              <Mail className="h-4 w-4 shrink-0" />
              <span>
                For your safety, this payment also needs the code we emailed to{" "}
                <strong>{start?.emailHint ?? "your email"}</strong>. Check that the details in the email match.
              </span>
            </p>
            <input
              aria-label="Code from email"
              autoComplete="one-time-code"
              autoFocus
              className="txa-input"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              value={code}
            />
            <button className="txa-primary" disabled={busy || code.length !== 6} type="submit">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
              Confirm payment
            </button>
          </form>
        ) : null}

        {step === "email-setup" ? (
          <form className="txa-code" onSubmit={setupSent ? confirmSetupCode : sendSetupCode}>
            <p className="txa-email-note">
              <Mail className="h-4 w-4 shrink-0" />
              <span>
                {setupSent ? (
                  <>
                    Enter the code we emailed to <strong>{start?.emailHint ?? setupEmail}</strong>. It confirms this
                    payment, and we&apos;ll send future codes there.
                  </>
                ) : (
                  "Payments confirmed with your PIN also need a code from your email. Where should we send it?"
                )}
              </span>
            </p>
            {setupSent ? (
              <input
                aria-label="Code from email"
                autoComplete="one-time-code"
                autoFocus
                className="txa-input"
                inputMode="numeric"
                key="code"
                maxLength={6}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                value={code}
              />
            ) : (
              <input
                aria-label="Email address"
                autoComplete="email"
                autoFocus
                className="txa-input"
                inputMode="email"
                key="email"
                onChange={(event) => setSetupEmail(event.target.value)}
                placeholder="you@example.com"
                type="email"
                value={setupEmail}
              />
            )}
            <button
              className="txa-primary"
              disabled={busy || (setupSent ? code.length !== 6 : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setupEmail.trim()))}
              type="submit"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : setupSent ? (
                <ShieldCheck className="h-5 w-5" />
              ) : (
                <Mail className="h-5 w-5" />
              )}
              {setupSent ? "Confirm payment" : "Send code"}
            </button>
            {setupSent ? (
              <button
                className="txa-link"
                disabled={busy}
                onClick={() => {
                  setSetupSent(false);
                  setCode("");
                  setError(null);
                }}
                type="button"
              >
                Use a different email
              </button>
            ) : null}
          </form>
        ) : null}

        {error ? (
          <p className="txa-error" role="alert">
            {error}
          </p>
        ) : null}

        {start && (step === "passkey" || step === "pin" || step === "totp") && others.length > 0 ? (
          <div className="txa-others">
            {others.map((method) => (
              <button
                className="txa-link"
                disabled={busy}
                key={method}
                onClick={() => {
                  setError(null);
                  setPin("");
                  setCode("");
                  setStep(method);
                }}
                type="button"
              >
                {method === "passkey"
                  ? `Use ${biometricLabel()}`
                  : method === "pin"
                    ? "Use PIN"
                    : "Use authenticator code"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
