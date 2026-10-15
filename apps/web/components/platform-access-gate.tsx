"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAccount } from "wagmi";

import {
  circleSessionEventName,
  readCircleLogin,
} from "@/lib/circle-session";
import {
  clearPlatformProfileConnected,
  ensurePlatformAccessCookie,
  hasPlatformAccessCookie,
  platformAccessEventName,
  readActivatedExternalProfile,
} from "@/lib/platform-access";
import {
  fetchWalletSessionForAddress,
  walletSessionChangedEventName,
} from "@/lib/wallet-auth-client";

type AccessState = "checking" | "allowed" | "locked" | "needs-auth";

const PlatformAccessContext = createContext<AccessState>("checking");

function readImmediateAccess(): AccessState | null {
  if (typeof window === "undefined") {
    return null;
  }

  if (readCircleLogin()) {
    return "allowed";
  }

  if (readActivatedExternalProfile() && hasPlatformAccessCookie()) {
    return "allowed";
  }

  return null;
}

export function PlatformAccessProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, status } = useAccount();
  const [access, setAccess] = useState<AccessState>("checking");

  useEffect(() => {
    const immediate = readImmediateAccess();
    if (immediate) {
      setAccess(immediate);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let lockTimeoutId: number | undefined;

    async function refreshAccess() {
      if (lockTimeoutId !== undefined) {
        window.clearTimeout(lockTimeoutId);
        lockTimeoutId = undefined;
      }

      // Circle / Google path: social session is enough.
      if (readCircleLogin()) {
        ensurePlatformAccessCookie();
        if (!cancelled) setAccess("allowed");
        return;
      }

      if (status === "connecting" || status === "reconnecting") {
        // Keep a previously allowed session visible while wagmi reconnects.
        return;
      }

      const activated = readActivatedExternalProfile();
      const connected = isConnected && address ? address.toLowerCase() : "";

      if (!connected || !activated || activated !== connected) {
        const delayMs = activated ? 4000 : 900;
        lockTimeoutId = window.setTimeout(() => {
          if (!cancelled) setAccess("locked");
        }, delayMs);
        return;
      }

      // External wallet must have an authorized server session for this address.
      try {
        const session = await fetchWalletSessionForAddress(address);
        if (cancelled) return;

        if (session.authenticated && session.ownerWallet) {
          ensurePlatformAccessCookie();
          setAccess("allowed");
          return;
        }
      } catch {
        // fall through to needs-auth
      }

      if (!cancelled) {
        setAccess("needs-auth");
      }
    }

    void refreshAccess();

    function onChange() {
      void refreshAccess();
    }

    window.addEventListener(circleSessionEventName, onChange);
    window.addEventListener(platformAccessEventName, onChange);
    window.addEventListener(walletSessionChangedEventName, onChange);
    window.addEventListener("storage", onChange);

    return () => {
      cancelled = true;
      if (lockTimeoutId !== undefined) {
        window.clearTimeout(lockTimeoutId);
      }
      window.removeEventListener(circleSessionEventName, onChange);
      window.removeEventListener(platformAccessEventName, onChange);
      window.removeEventListener(walletSessionChangedEventName, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [address, isConnected, status]);

  return (
    <PlatformAccessContext.Provider value={access}>
      {children}
    </PlatformAccessContext.Provider>
  );
}

export function PlatformAccessGate({ children }: { children: ReactNode }) {
  const access = useContext(PlatformAccessContext);
  const router = useRouter();

  // Nobody is signed in here, yet the server let the page through: its
  // "signed in" cookie outlived the sign-in itself (iPhone clears a site's
  // storage on its own but keeps cookies). Drop the cookie and go straight to
  // sign-in, coming back to this page afterwards. Opening the home-screen app
  // (which starts on /dashboard) used to stop on a dead-end screen here.
  useEffect(() => {
    if (access !== "locked") return;
    clearPlatformProfileConnected();
    const here = `${window.location.pathname}${window.location.search}`;
    router.replace(`/sign-in?next=${encodeURIComponent(here)}`);
  }, [access, router]);

  if (access === "checking" || access === "locked") {
    return (
      <main className="relative min-h-screen overflow-hidden px-0 py-4 text-ink sm:px-6 lg:px-8">
        <div className="dashboard-ambient pointer-events-none absolute inset-0" />
        <section className="surface-panel relative mx-auto mt-10 max-w-xl p-5 text-center sm:p-6">
          <p className="text-sm text-muted">Checking wallet access…</p>
        </section>
      </main>
    );
  }

  if (access === "needs-auth") {
    return (
      <main className="relative min-h-screen overflow-hidden px-0 py-4 text-ink sm:px-6 lg:px-8">
        <div className="dashboard-ambient pointer-events-none absolute inset-0" />
        <div className="soft-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
        <section className="surface-panel relative mx-auto mt-10 max-w-xl p-5 text-center sm:p-6">
          <p className="eyebrow">Authorization required</p>
          <h1 className="mt-3 font-heading text-2xl font-semibold tracking-normal text-ink">
            Authorize your wallet to continue
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            Connect your external wallet on Home and sign the one-time message
            before opening the dashboard or other platform pages.
          </p>
          <Link
            className="sp-bubble mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-swift-600 px-4 text-sm font-bold text-white shadow-[0_14px_34px_rgba(66,17,143,0.24)] transition hover:-translate-y-0.5 hover:bg-swift-700"
            href="/sign-in"
          >
            Go to sign in
          </Link>
        </section>
      </main>
    );
  }

  return children;
}

/** "allowed" once this browser is signed in to SaphraONE (Google, email or wallet). */
export function usePlatformAccess() {
  return useContext(PlatformAccessContext);
}
