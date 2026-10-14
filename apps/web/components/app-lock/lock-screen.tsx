"use client";

import { Fingerprint, KeyRound, Loader2, ScanFace } from "lucide-react";
import { useEffect, useState } from "react";
import { useDisconnect } from "wagmi";

import { PIN_LENGTH, PinPad } from "@/components/app-lock/pin-pad";
import { SupportCenter } from "@/components/support/support-center";
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import {
  AppLockError,
  biometricLabel,
  postAppLock,
  signOutForAppLock,
  type AppLockStatus,
} from "@/lib/app-lock/client";
import { bottomSheetClassName, useSheetSide } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

type LockProfile = NonNullable<AppLockStatus["profile"]>;

function pausedMessage(until: string) {
  const minutes = Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 60_000));
  return `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

function initials(profile: LockProfile | null | undefined) {
  const name = profile?.displayName?.trim() || profile?.username?.trim() || "";
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase() || "S";
}

/** Face ID on Apple devices, a fingerprint elsewhere. */
function BiometricIcon({ className }: { className?: string }) {
  const apple = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  return apple ? <ScanFace className={className} /> : <Fingerprint className={className} />;
}

/**
 * Full-screen lock: "Welcome back" with the person's name, unlock with Face ID /
 * fingerprint (when set up) or the PIN, sign out, or contact support.
 */
export function LockScreen({
  hasPasskey,
  onUnlocked,
  pausedUntil,
  profile,
}: {
  hasPasskey: boolean;
  onUnlocked: () => void;
  pausedUntil?: string | null;
  profile?: LockProfile | null;
}) {
  const { disconnect } = useDisconnect();
  const sheetSide = useSheetSide();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    pausedUntil && Date.parse(pausedUntil) > Date.now() ? pausedMessage(pausedUntil) : null,
  );
  const [shake, setShake] = useState(false);
  const [biometricsReady, setBiometricsReady] = useState(false);
  // With Face ID / fingerprint set up, the PIN pad waits behind "Use PIN".
  const [usePin, setUsePin] = useState(!hasPasskey);
  const [supportOpen, setSupportOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    if (!hasPasskey) return;
    void import("@simplewebauthn/browser").then(({ platformAuthenticatorIsAvailable }) =>
      platformAuthenticatorIsAvailable().then(
        (available) => {
          setBiometricsReady(available);
          if (!available) setUsePin(true);
        },
        () => setUsePin(true),
      ),
    );
  }, [hasPasskey]);

  const canUseBiometrics = hasPasskey && biometricsReady;
  const showPinPad = usePin || !canUseBiometrics;
  const name = profile?.displayName?.trim() || (profile?.username ? `${profile.username}.one` : null);

  function fail(cause: unknown) {
    setPin("");
    setShake(true);
    window.setTimeout(() => setShake(false), 400);
    if (cause instanceof AppLockError) {
      if (cause.details.signedOut) {
        void signOutForAppLock(disconnect);
        return;
      }
      if (cause.details.pausedUntil) {
        setError(pausedMessage(cause.details.pausedUntil));
        return;
      }
      setError(
        cause.details.attemptsLeft != null
          ? `Wrong PIN. ${cause.details.attemptsLeft} ${cause.details.attemptsLeft === 1 ? "try" : "tries"} left before a pause.`
          : cause.message,
      );
      return;
    }
    setError("Couldn't unlock. Check your connection and try again.");
  }

  async function unlockWithPin(value: string) {
    if (value.length !== PIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await postAppLock("unlock", { pin: value });
      onUnlocked();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithBiometrics() {
    setBusy(true);
    setError(null);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const { options } = await postAppLock<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>(
        "passkey-unlock-options",
      );
      const response = await startAuthentication({ optionsJSON: options });
      await postAppLock("passkey-unlock", { response });
      onUnlocked();
    } catch (cause) {
      // Cancelling the prompt isn't an error worth a message.
      if (cause instanceof Error && cause.name === "NotAllowedError") {
        setError(null);
      } else {
        fail(cause);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="app-lock-screen fixed inset-0 z-[2147482000] flex flex-col overflow-y-auto bg-background px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(3.5rem,env(safe-area-inset-top))]"
      role="dialog"
    >
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
        <div className="grid justify-items-center gap-3 text-center">
          <span className="grid h-28 w-28 place-items-center overflow-hidden rounded-full bg-[#e4dcff] ring-4 ring-primary/15 dark:bg-[#d9ccff]">
            {profile?.avatarUrl && !avatarFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="h-full w-full object-cover"
                onError={() => setAvatarFailed(true)}
                src={profile.avatarUrl}
              />
            ) : (
              <span className="font-heading text-4xl font-bold text-[#5b21b6]">{initials(profile)}</span>
            )}
          </span>
          <h1 className="mt-3 font-heading text-[1.9rem] font-bold tracking-tight text-foreground">Welcome back</h1>
          {name ? <p className="text-base text-muted-foreground">{name}</p> : null}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-8">
          {showPinPad ? (
            <div className="grid justify-items-center gap-5">
              <p className="text-sm text-muted-foreground">Enter your 6-digit PIN</p>
              <PinPad
                disabled={busy}
                error={shake}
                onChange={(value) => {
                  setPin(value);
                  if (value) setError(null);
                }}
                onComplete={(value) => void unlockWithPin(value)}
                value={pin}
              />
            </div>
          ) : null}
          <div className="mt-5 grid min-h-6 justify-items-center text-center">
            {busy ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
            {error ? <p className="max-w-xs text-sm text-destructive">{error}</p> : null}
          </div>
        </div>

        <div className="grid gap-3">
          {canUseBiometrics && !usePin ? (
            <button
              className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-[#40196d] text-base font-bold text-white shadow-sm transition hover:bg-[#4c1d95] disabled:opacity-60"
              disabled={busy}
              onClick={() => void unlockWithBiometrics()}
              type="button"
            >
              <BiometricIcon className="h-5 w-5" />
              Unlock with {biometricLabel()}
            </button>
          ) : null}

          {canUseBiometrics ? (
            <button
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-foreground transition hover:bg-muted"
              disabled={busy}
              onClick={() => {
                setUsePin((current) => !current);
                setPin("");
                setError(null);
              }}
              type="button"
            >
              {usePin ? (
                <>
                  <BiometricIcon className="h-4 w-4" />
                  Use {biometricLabel()} instead
                </>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  Use PIN instead
                </>
              )}
            </button>
          ) : null}

          <button
            className={cn(
              "h-14 w-full rounded-xl bg-muted text-base font-bold text-[#ef5b4c] transition hover:bg-muted/70",
              "dark:bg-[#1c1c1f] dark:hover:bg-[#232327]",
            )}
            onClick={() => void signOutForAppLock(disconnect)}
            type="button"
          >
            Sign out
          </button>

          <p className="pt-3 text-center text-[0.95rem] text-foreground/85">
            Having trouble signing in?{" "}
            <button
              className="font-bold text-emerald-600 hover:underline dark:text-emerald-400"
              onClick={() => setSupportOpen(true)}
              type="button"
            >
              Contact us
            </button>
          </p>
          {showPinPad ? (
            <p className="text-center text-xs text-muted-foreground">
              Forgot your PIN? Sign out, then sign back in to set a new one.
            </p>
          ) : null}
        </div>
      </div>

      {/* Support as a guest: the account stays locked while you get help. */}
      <Sheet onOpenChange={setSupportOpen} open={supportOpen}>
        <SheetContent
          className={cn(
            "z-[2147483000] w-full gap-0 overflow-hidden p-0 sm:max-w-md",
            sheetSide === "bottom" && `${bottomSheetClassName} sm:max-w-none`,
          )}
          showCloseButton={false}
          side={sheetSide}
        >
          {sheetSide === "bottom" ? <SheetGrabber className="bg-white/40" /> : null}
          <SheetTitle className="sr-only">SaphraONE Support</SheetTitle>
          <SheetDescription className="sr-only">Get help without unlocking SaphraONE.</SheetDescription>
          <SupportCenter guest onClose={() => setSupportOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
