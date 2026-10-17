"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { TwoFactorScreen } from "@/components/two-factor/two-factor-screen";
import { hasSignedInCookie } from "@/lib/app-lock/client";
import { fetchTwoFactorStatus } from "@/lib/two-factor/client";
import { notifyWalletSessionChanged } from "@/lib/wallet-auth-client";

type GateState = "checking" | "open" | "two-factor";

/**
 * Holds a fresh sign-in on the two-factor code screen until the authenticator
 * (or a backup) code is in. The server refuses the account's data until then
 * (proxy.ts answers 423 with reason "two-factor"); this is the screen for it.
 *
 * The app no longer locks itself when reopened: the PIN, Face ID / fingerprint
 * and authenticator code confirm payments instead (components/tx-approval).
 */
export function TwoFactorGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const refreshingRef = useRef<Promise<void> | null>(null);

  const check = useCallback(async () => {
    if (!hasSignedInCookie()) {
      setState("open");
      return;
    }
    try {
      const status = await fetchTwoFactorStatus();
      setState(status.pending ? "two-factor" : "open");
    } catch {
      // Can't tell: show the app. The server still refuses a pending session.
      setState("open");
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
  }, [refresh]);

  // Any API call refused for a missing code shows the code screen at once.
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
              },
              () => undefined,
            );
        }
      }
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  function onVerified() {
    setState("open");
    // Pages refused while the code was pending reload their data.
    notifyWalletSessionChanged();
  }

  return (
    <>
      {state !== "two-factor" ? children : null}
      {state === "two-factor" ? <TwoFactorScreen onVerified={onVerified} /> : null}
    </>
  );
}
