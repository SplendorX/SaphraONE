"use client";

import { Loader2 } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";

import {
  circleSessionEventName,
  readCircleLogin,
  readCircleWallets,
} from "@/lib/circle-session";
import { useOptionalAccount } from "@/components/account/account-provider";
import {
  hasPlatformAccessCookie,
  platformAccessEventName,
  readActivatedExternalProfile,
} from "@/lib/platform-access";

function hasLiveSignedInAccount(input?: {
  address?: string;
  isConnected?: boolean;
}) {
  if (typeof window === "undefined") {
    return false;
  }

  if (!hasPlatformAccessCookie()) {
    return false;
  }

  if (readCircleLogin() && readCircleWallets().some((wallet) => wallet.address)) {
    return true;
  }

  const activated = readActivatedExternalProfile().toLowerCase();
  const connected = input?.address?.toLowerCase() ?? "";
  return Boolean(
    input?.isConnected && activated && connected && activated === connected,
  );
}

export function useHasSignedIn() {
  const { address, isConnected } = useAccount();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    function refresh() {
      setSignedIn(hasLiveSignedInAccount({ address, isConnected }));
    }

    refresh();
    window.addEventListener(circleSessionEventName, refresh);
    window.addEventListener(platformAccessEventName, refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener(circleSessionEventName, refresh);
      window.removeEventListener(platformAccessEventName, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [address, isConnected]);

  return signedIn;
}

/** A spinner on the button from the tap until the next page shows. */
function LaunchPending() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-hidden className="lal-spinner h-4 w-4 shrink-0 animate-spin" /> : null;
}

/**
 * "Open SaphraONE", "Claim your One ID", "Start with ALLIE"…: to sign-in, or
 * straight into the app for someone signed in. The destination is prefetched
 * in full (page and code) as soon as the button is on screen, so the tap
 * opens it at once, and the button shows it's working until it does.
 */
export function LaunchAppLink({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const signedIn = useHasSignedIn();
  const accountContext = useOptionalAccount();
  const isBusiness = accountContext?.isBusiness ?? false;
  const hasSelectedAccountType = accountContext?.account?.account_type_selected;
  const targetHref = signedIn
    ? !hasSelectedAccountType
      ? "/onboarding"
      : isBusiness
        ? "/business"
        : "/dashboard"
    : "/sign-in";

  // Warm the destination once the page is idle too, for buttons below the fold.
  useEffect(() => {
    const warm = () => router.prefetch(targetHref);
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) {
      idle(warm);
      return;
    }
    const timer = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(timer);
  }, [router, targetHref]);

  return (
    <Link className={className} href={targetHref} prefetch>
      {children ?? "Open SaphraONE"}
      <LaunchPending />
    </Link>
  );
}
