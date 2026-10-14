"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useDisconnect } from "wagmi";

import { fetchAppLockStatus, signOutForAppLock } from "@/lib/app-lock/client";
import {
  circleReverifiedRecently,
  circleReverifyKind,
  readCircleFrameDeviceId,
  readSignedInDeviceId,
  startCircleReverify,
} from "@/lib/circle-device";
import {
  circleSessionStaleEventName,
  circleSignedOutNoticeKey,
  clearCircleSessionStale,
  isCircleSessionStale,
  readCircleLogin,
  trackCircleDeviceCheck,
} from "@/lib/circle-session";
import { fetchTwoFactorStatus } from "@/lib/two-factor/client";
import { walletSessionChangedEventName } from "@/lib/wallet-auth-client";

/** Where the Circle login is made: nothing to check there. */
const signInPaths = new Set(["/", "/sign-in"]);
/** Back in the app after this long away, the device is checked again. */
const recheckAfterHiddenMs = 30_000;
/** Time to read why before going to confirm the device. */
const staleNoticeMs = 3_500;

/** Logged server-side, so the check can be followed in production. */
function report(message: string) {
  void fetch("/api/client-errors", {
    body: JSON.stringify({ message: `circle-device: ${message}`, path: window.location.pathname }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).catch(() => undefined);
}

/** Usable right now: not behind the app lock or a two-factor code. */
async function appIsOpen() {
  const twoFactor = await fetchTwoFactorStatus().catch(() => null);
  if (twoFactor?.pending) return false;
  const lock = await fetchAppLockStatus().catch(() => null);
  return !(lock?.enabled && lock.locked);
}

/**
 * Keeps a Google or email sign-in able to confirm payments on this device.
 *
 * On open, and on coming back after a while, it asks Circle's frame for its
 * device ID. If that is no longer the ID the login was made for (Safari lost
 * the frame's storage; see lib/circle-device.ts), the device is confirmed
 * again before any payment can fail: Google does it without showing anything,
 * email sends a code. The same happens when a payment or a token renewal
 * reports the session stale. Logins Circle doesn't tie to a device (older PIN
 * wallets) are signed out instead, as before, and sign-in says why.
 *
 * It waits for the app lock and two-factor code, so it never runs behind them.
 */
export function StaleCircleSessionGuard() {
  const { disconnect } = useDisconnect();

  useEffect(() => {
    // The notice left by the sign-out below.
    try {
      if (window.sessionStorage.getItem(circleSignedOutNoticeKey)) {
        window.sessionStorage.removeItem(circleSignedOutNoticeKey);
        toast.info("You were signed out so Circle can verify this device again. Sign in to continue.", {
          duration: 8000,
        });
      }
    } catch {}

    let running = false;
    // Asked again while running: runs once more after.
    let again = false;
    let leaving = false;
    // This page load has confirmed the device; checked again after time away.
    let deviceConfirmed = false;
    let hiddenAt: number | null = null;
    let staleTimer: number | undefined;

    async function check() {
      if (running) {
        again = true;
        return;
      }
      if (leaving || signInPaths.has(window.location.pathname)) return;
      const login = readCircleLogin();
      if (!login) {
        // Nothing to sign out of (already signed out, or an external wallet).
        clearCircleSessionStale();
        return;
      }
      const kind = circleReverifyKind(login);
      running = true;
      try {
        if (isCircleSessionStale()) {
          if (kind && !circleReverifiedRecently()) {
            if (await appIsOpen()) {
              leaving = true;
              report(`stale session, confirming again (${kind})`);
              startCircleReverify(kind, login);
            }
            return;
          }
          clearCircleSessionStale();
          leaving = true;
          try {
            window.sessionStorage.setItem(circleSignedOutNoticeKey, "1");
          } catch {}
          void signOutForAppLock(() => disconnect());
          return;
        }

        const signedInDeviceId = readSignedInDeviceId();
        // An open Circle window means a payment is under way: never disturb it.
        if (deviceConfirmed || !kind || !signedInDeviceId || document.getElementById("sdkIframe")) {
          return;
        }

        const changed = readCircleFrameDeviceId().then(async (deviceId) => {
          // Unreadable counts as checked too: asked again only after time
          // away, never in the middle of what the person is doing.
          if (!deviceId || deviceId === signedInDeviceId) {
            deviceConfirmed = true;
            return false;
          }
          if (circleReverifiedRecently()) {
            report(`device ID changed again soon after confirming (${kind}); left as is`);
            return false;
          }
          return appIsOpen();
        });
        trackCircleDeviceCheck(changed);
        if (await changed) {
          leaving = true;
          report(`device ID changed, confirming again (${kind})`);
          startCircleReverify(kind, login);
        }
      } finally {
        running = false;
        if (again) {
          again = false;
          void check();
        }
      }
    }

    void check();

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= recheckAfterHiddenMs) {
        deviceConfirmed = false;
      }
      hiddenAt = null;
      void check();
    }
    function onStale() {
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => void check(), staleNoticeMs);
    }
    // Unlocking, or a finished two-factor code, says so with this event.
    function onSessionChanged() {
      void check();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(circleSessionStaleEventName, onStale);
    window.addEventListener(walletSessionChangedEventName, onSessionChanged);
    return () => {
      window.clearTimeout(staleTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(circleSessionStaleEventName, onStale);
      window.removeEventListener(walletSessionChangedEventName, onSessionChanged);
    };
  }, [disconnect]);

  return null;
}
