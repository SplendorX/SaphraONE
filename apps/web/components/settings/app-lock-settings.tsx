"use client";

import { Fingerprint, Loader2, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PinPad } from "@/components/app-lock/pin-pad";
import { Button } from "@/components/ui/button";
import {
  AppLockError,
  biometricLabel,
  fetchAppLockStatus,
  notifyAppLockChanged,
  postAppLock,
  type AppLockStatus,
} from "@/lib/app-lock/client";

type Flow =
  | { kind: "idle" }
  | { kind: "setup"; step: "new" | "confirm"; first: string }
  | { kind: "change"; step: "current" | "new" | "confirm"; current: string; first: string }
  | { kind: "disable" };

const timeoutOptions = [
  { label: "1 minute", value: 1 },
  { label: "5 minutes", value: 5 },
  { label: "15 minutes", value: 15 },
];

function messageFrom(cause: unknown) {
  if (cause instanceof AppLockError) {
    if (cause.details.attemptsLeft != null) {
      return `Wrong PIN. ${cause.details.attemptsLeft} ${cause.details.attemptsLeft === 1 ? "try" : "tries"} left before a pause.`;
    }
    return cause.message;
  }
  return "Something went wrong. Try again.";
}

/**
 * Settings → App lock: a 6-digit PIN asked for whenever SaphraONE is opened
 * again, with Face ID / fingerprint as a shortcut where the device has it.
 *
 * `compact` is the onboarding version: turning it on and adding Face ID /
 * fingerprint only. Changing or turning it off stays in Settings.
 */
export function AppLockSettings({
  compact = false,
  onEnabledChange,
}: {
  compact?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
} = {}) {
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchAppLockStatus();
      setStatus(next);
      onEnabledChange?.(next.enabled);
    } catch {
      setError("The app lock couldn't be loaded.");
    }
  }, [onEnabledChange]);

  useEffect(() => {
    void load();
    void import("@simplewebauthn/browser").then(({ platformAuthenticatorIsAvailable }) =>
      platformAuthenticatorIsAvailable().then(setBiometricsAvailable, () => undefined),
    );
  }, [load]);

  function start(next: Flow) {
    setFlow(next);
    setPin("");
    setError(null);
    setNotice(null);
  }

  async function run(task: () => Promise<void>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await task();
      start({ kind: "idle" });
      if (done) setNotice(done);
      await load();
      notifyAppLockChanged();
    } catch (cause) {
      setPin("");
      setError(messageFrom(cause));
    } finally {
      setBusy(false);
    }
  }

  function onPinComplete(value: string) {
    if (flow.kind === "setup") {
      if (flow.step === "new") {
        setFlow({ ...flow, first: value, step: "confirm" });
        setPin("");
        return;
      }
      if (value !== flow.first) {
        setError("The PINs didn't match. Choose your PIN again.");
        setFlow({ first: "", kind: "setup", step: "new" });
        setPin("");
        return;
      }
      void run(() => postAppLock("setup", { pin: value, timeoutMinutes: 1 }), "App lock is on.");
      return;
    }
    if (flow.kind === "change") {
      if (flow.step === "current") {
        setFlow({ ...flow, current: value, step: "new" });
        setPin("");
        return;
      }
      if (flow.step === "new") {
        setFlow({ ...flow, first: value, step: "confirm" });
        setPin("");
        return;
      }
      if (value !== flow.first) {
        setError("The new PINs didn't match. Enter the new PIN again.");
        setFlow({ ...flow, first: "", step: "new" });
        setPin("");
        return;
      }
      void run(
        () => postAppLock("change", { currentPin: flow.current, pin: value }),
        "Your PIN has been changed.",
      );
      return;
    }
    if (flow.kind === "disable") {
      void run(() => postAppLock("disable", { pin: value }), "App lock is off.");
    }
  }

  async function addBiometrics() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const { options } = await postAppLock<{
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
      }>("passkey-register-options");
      const response = await startRegistration({ optionsJSON: options });
      await postAppLock("passkey-register", { response });
      setNotice(`${biometricLabel()} is set up on this device.`);
      await load();
      notifyAppLockChanged();
    } catch (cause) {
      if (cause instanceof Error && cause.name === "NotAllowedError") return;
      if (cause instanceof Error && cause.name === "InvalidStateError") {
        setNotice(`${biometricLabel()} is already set up on this device.`);
        return;
      }
      setError(messageFrom(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {error ?? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </>
        )}
      </div>
    );
  }

  if (!status.signedIn) {
    return <p className="text-sm text-muted-foreground">Sign in to set up an app lock.</p>;
  }

  const pinPrompt =
    flow.kind === "setup"
      ? flow.step === "new"
        ? "Choose a 6-digit PIN"
        : "Enter the PIN again to confirm"
      : flow.kind === "change"
        ? flow.step === "current"
          ? "Enter your current PIN"
          : flow.step === "new"
            ? "Choose a new 6-digit PIN"
            : "Enter the new PIN again to confirm"
        : flow.kind === "disable"
          ? "Enter your PIN to turn the app lock off"
          : "";

  return (
    <div className="grid gap-5">
      {compact ? null : (
        <p className="text-sm text-muted-foreground">
          Ask for a PIN{biometricsAvailable ? ` or ${biometricLabel()}` : ""} whenever you come
          back to SaphraONE. If you forget your PIN, sign out and sign in again to get back in.
        </p>
      )}

      {flow.kind !== "idle" ? (
        <div className="grid justify-items-center gap-5 rounded-2xl border border-border p-6">
          <p className="text-sm font-semibold text-foreground">{pinPrompt}</p>
          <PinPad
            disabled={busy}
            error={Boolean(error)}
            onChange={(value) => {
              setPin(value);
              if (value) setError(null);
            }}
            onComplete={onPinComplete}
            value={pin}
          />
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
          <Button onClick={() => start({ kind: "idle" })} type="button" variant="ghost">
            Cancel
          </Button>
        </div>
      ) : !status.enabled ? (
        <Button
          className="w-full sm:w-auto"
          onClick={() => start({ first: "", kind: "setup", step: "new" })}
          type="button"
        >
          <Lock className="h-4 w-4" />
          Turn on app lock
        </Button>
      ) : (
        <div className="grid gap-4">
          {compact ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Lock className="h-4 w-4 text-primary" />
              App lock is on. SaphraONE locks after 1 minute away.
            </p>
          ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Lock after I leave for</p>
              <p className="text-xs text-muted-foreground">
                Closing SaphraONE or switching away for this long locks it.
              </p>
            </div>
            <select
              aria-label="Auto-lock time"
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
              disabled={busy}
              onChange={(event) =>
                void run(
                  () => postAppLock("timeout", { timeoutMinutes: Number(event.target.value) }),
                  "Auto-lock time saved.",
                )
              }
              value={status.timeoutMinutes ?? 1}
            >
              {timeoutOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{biometricsAvailable ? biometricLabel() : "Face ID or fingerprint"}</p>
              <p className="text-xs text-muted-foreground">
                {biometricsAvailable
                  ? (status.passkeys ?? 0) > 0
                    ? "Set up. Add this device too if you use SaphraONE on more than one."
                    : "Unlock without typing your PIN."
                  : "This device or browser doesn't offer it. Your PIN still works."}
              </p>
            </div>
            <div className="flex gap-2">
              {biometricsAvailable ? (
                <Button disabled={busy} onClick={() => void addBiometrics()} type="button" variant="outline">
                  <Fingerprint className="h-4 w-4" />
                  {(status.passkeys ?? 0) > 0 ? "Add this device" : "Set up"}
                </Button>
              ) : null}
              {(status.passkeys ?? 0) > 0 ? (
                <Button
                  disabled={busy}
                  onClick={() => void run(() => postAppLock("passkey-remove"), "Face ID and fingerprint removed.")}
                  type="button"
                  variant="ghost"
                >
                  Remove
                </Button>
              ) : null}
            </div>
          </div>

          {compact ? (
            <p className="text-xs text-muted-foreground">
              Change the timing, your PIN or turn it off any time in Settings → App lock.
            </p>
          ) : (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button
              disabled={busy}
              onClick={() => start({ current: "", first: "", kind: "change", step: "current" })}
              type="button"
              variant="outline"
            >
              Change PIN
            </Button>
            <Button
              disabled={busy}
              onClick={() => start({ kind: "disable" })}
              type="button"
              variant="ghost"
            >
              Turn off app lock
            </Button>
          </div>
          )}
        </div>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-foreground">{notice}</p> : null}
    </div>
  );
}
