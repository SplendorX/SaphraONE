"use client";

import Link from "next/link";
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

export function LaunchAppLink({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
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

  return (
    <Link
      className={className}
      href={targetHref}
      onClick={(event) => {
        event.preventDefault();
        if (hasLiveSignedInAccount({ address, isConnected })) {
          if (!hasSelectedAccountType) {
            router.push("/onboarding");
            return;
          }
          router.push(isBusiness ? "/business" : "/dashboard");
          return;
        }

        router.push("/sign-in");
      }}
    >
      {children ?? "Open SaphraONE"}
    </Link>
  );
}
