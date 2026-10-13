"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { LockScreen } from "@/components/app-lock/lock-screen";
import { TwoFactorScreen } from "@/components/two-factor/two-factor-screen";
import {
  appLockChangedEvent,
  fetchAppLockStatus,
  hasSignedInCookie,
  postAppLock,
  type AppLockStatus,
} from "@/lib/app-lock/client";
import { fetchTwoFactorStatus } from "@/lib/two-factor/client";
import { notifyWalletSessionChanged } from "@/lib/wallet-auth-client";

/** How often the open, on-screen app renews its unlock pass. */
const TOUCH_INTERVAL_MS = 20_000;

type GateState = "checking" | "open" | "locked" | "two-factor";

/** Renew the pass as the app is left; keepalive lets it finish in the background. */
function touchOnLeave() {
  void fetch("/api/app-lock", {
    body: JSON.stringify({ action: "touch" }),
    cache: "no-store",
    credentials: "include",
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}

/**
 * Keeps a locked account's pages covered until the PIN or Face ID /
 * fingerprint opens them. The server enforces the lock (the API answers 423
 * without an unlock pass); this is the screen for it.
 *
 * - On open: a signed-in browser checks the lock before the page mounts.
 * - While on screen: the unlock pass is renewed, so using the app never locks.
 * - Away longer than the auto-lock time: the pass lapses and the lock returns.
 * - Any API call answering 423 shows the lock at once.
 *
 * It also holds a fresh sign-in on the two-factor code screen until the
 * authenticator (or a backup) code is in; that comes before the lock.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const [mounted, setMounted] = useState(false);
  const hiddenAtRef = useRef<number | null>(null);
  const refreshingRef = useRef<Promise<void> | null>(null);

  const check = useCallback(async () => {
    if (!hasSignedInCookie()) {
      setStatus(null);
      setState("open");
      return;
    }
    try {
      const twoFactor = await fetchTwoFactorStatus().catch(() => null);
      if (twoFactor?.pending) {
        setState("two-factor");
        return;
      }
      const next = await fetchAppLockStatus();
      setStatus(next);
      setState(next.enabled && next.locked ? "locked" : "open");
    } catch {
      // Can't tell: show the app. The server still refuses a locked session.
      setState((current) => (current === "checking" ? "open" : current));
    }
  }, []);

  /** One status check at a time; callers arriving meanwhile share it. */
  const refresh = useCallback(() => {
    refreshingRef.current ??= check().finally(() => {
      refreshingRef.current = null;
    });
    return refreshingRef.current;
  }, [check]);

  useEffect(() => {
    void refresh();
    window.addEventListener(appLockChangedEvent, refresh);
    return () => window.removeEventListener(appLockChangedEvent, refresh);
  }, [refresh]);

  // Once the app has been shown, keep it mounted under a later lock so
  // nothing the user was doing is lost.
  useEffect(() => {
    if (state === "open") setMounted(true);
  }, [state]);

  // Any API call refused as locked re-checks the lock with the server, which
  // decides whether to show it. Showing it straight from the 423 put up a
  // second, stale lock: requests sent just before an unlock come back 423
  // after it, and a session flag left over from a lock turned off elsewhere
  // refuses every call while no PIN exists to check.
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (response.status === 423) {
        const url = args[0] instanceof Request ? args[0].url : String(args[0]);
        if (url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`)) {
          void response
            .clone()
            .json()
            .then(
              (body: { reason?: string }) => {
                if (body?.reason === "two-factor") setState("two-factor");
                else void refresh();
              },
              () => void refresh(),
            );
        }
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, [refresh]);

  // Renew the pass while the unlocked app is on screen.
  useEffect(() => {
    if (state !== "open" || !status?.enabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void postAppLock("touch").catch(() => undefined);
      }
    }, TOUCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state, status?.enabled]);

  // The auto-lock time counts from leaving the app. Leaving renews the pass,
  // so it runs from now rather than from the last renewal up to 20s earlier
  // (which locked a quick trip to another app). Coming back after the time
  // drops the pass and shows the lock; sooner, the pass is renewed.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        if (status?.enabled && state === "open") touchOnLeave();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (!status?.enabled || state !== "open") return;
      const timeoutMs = (status.timeoutMinutes ?? 1) * 60_000;
      if (hiddenAt && Date.now() - hiddenAt >= timeoutMs) {
        setState("locked");
        void postAppLock("lock")
          .catch(() => undefined)
          .finally(() => void refresh());
      } else {
        void postAppLock("touch").catch(() => undefined);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh, state, status?.enabled, status?.timeoutMinutes]);

  function onUnlocked() {
    setState("open");
    void refresh();
    // Pages refused while locked reload their data.
    notifyWalletSessionChanged();
  }

  return (
    <>
      {mounted || state === "open" ? children : null}
      {state === "two-factor" ? <TwoFactorScreen onVerified={onUnlocked} /> : null}
      {state === "locked" ? (
        <LockScreen
          hasPasskey={(status?.passkeys ?? 0) > 0}
          onUnlocked={onUnlocked}
          pausedUntil={status?.pausedUntil}
          profile={status?.profile}
        />
      ) : null}
    </>
  );
}
