"use client";

import { useEffect } from "react";
import { useDisconnect } from "wagmi";

import { signOutForAppLock } from "@/lib/app-lock/client";
import {
  circleReverifiedRecently,
  circleReverifyKind,
  readCircleFrameDeviceId,
  readSignedInDeviceId,
  startCircleReverify,
} from "@/lib/circle-device";
import {
  circleSessionStaleEventName,
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
/** Long enough to read why a payment didn't go through before sign-in opens. */
const staleNoticeMs = 2_500;

/** Logged server-side, so the check can be followed in production. */
function report(message: string) {
  void fetch("/api/client-errors", {
    body: JSON.stringify({ message: `circle-device: ${message}`, path: window.location.pathname }),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).catch(() => undefined);
}

/** Still waiting for the two-factor code: that screen comes first. */
async function twoFactorPending() {
  const status = await fetchTwoFactorStatus().catch(() => null);
  return Boolean(status?.pending);
}

/**
 * Keeps a Google or email sign-in able to confirm payments on this device.
 *
 * Circle ties a login to the device ID its own frame keeps in the browser;
 * Safari drops that ID whenever iOS closes Safari (lib/circle-device.ts), and
 * then no payment can be confirmed until the person signs in again. So on
 * open, and on coming back after a while, the frame's ID is compared with the
 * one the login was made for. If it changed, or a payment or token renewal
 * reports the session stale, the person goes straight to sign-in, once, with
 * their method ready and their page remembered: no failed payments, no
 * loading back and forth. Older PIN-wallet logins, which Circle doesn't tie
 * to a device, are signed out the same way.
 */
export function StaleCircleSessionGuard() {
  const { disconnect } = useDisconnect();

  useEffect(() => {
    let running = false;
    let again = false;
    let leaving = false;
    // This page load has checked the device; checked again after time away.
    let deviceChecked = false;
    let hiddenAt: number | null = null;
    let staleTimer: number | undefined;

    /** To sign-in, for a new Circle login on this device. */
    function signInAgain(reason: string) {
      const login = readCircleLogin();
      if (!login || leaving) return;
      leaving = true;
      const kind = circleReverifyKind(login);
      report(`${reason}, signing in again (${kind ?? "pin wallet"})`);
      if (kind) {
        startCircleReverify(kind, login);
        return;
      }
      clearCircleSessionStale();
      void signOutForAppLock(() => disconnect());
    }

    async function check() {
      if (running) {
        again = true;
        return;
      }
      if (leaving || signInPaths.has(window.location.pathname)) return;
      const login = readCircleLogin();
      if (!login) {
        clearCircleSessionStale();
        return;
      }
      running = true;
      try {
        if (await twoFactorPending()) return;

        if (isCircleSessionStale()) {
          signInAgain("session stale");
          return;
        }

        const signedInDeviceId = readSignedInDeviceId();
        // An open Circle window means a payment is under way: never disturb it.
        if (
          deviceChecked ||
          !circleReverifyKind(login) ||
          !signedInDeviceId ||
          document.getElementById("sdkIframe")
        ) {
          return;
        }

        const changed = readCircleFrameDeviceId().then((deviceId) => {
          deviceChecked = true;
          if (!deviceId || deviceId === signedInDeviceId) return false;
          // A browser that keeps nothing for Circle loses the ID on every
          // load; asking again within minutes wouldn't help it.
          if (circleReverifiedRecently()) {
            report("device ID changed again soon after signing in; left as is");
            return false;
          }
          return true;
        });
        trackCircleDeviceCheck(changed);
        if (await changed) signInAgain("device ID changed");
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
        deviceChecked = false;
      }
      hiddenAt = null;
      void check();
    }
    function onStale() {
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => void check(), staleNoticeMs);
    }
    // A finished two-factor code says so with this event.
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
