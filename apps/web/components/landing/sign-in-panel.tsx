"use client";

import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Mail,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { CircleGoogleLogin } from "@/components/circle-google-login";
import { EmailSignIn } from "@/components/email-sign-in";
import { ReferralCodeField } from "@/components/landing/referral-code-field";
import { useOptionalAccount } from "@/components/account/account-provider";
import { useT } from "@/components/locale-provider";
import { WalletConnectButton } from "@/components/wallet-connect-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { fetchAccountState } from "@/lib/account/client";
import {
  readCircleReverify,
  writeCircleReverify,
  type CircleReverify,
} from "@/lib/circle-device";
import {
  circleStorageKeys,
  clearCircleSession,
  readCircleLogin,
  readCircleSessionStorage,
} from "@/lib/circle-session";
import { writeActivatedExternalProfile } from "@/lib/platform-access";
import { ensureProfile } from "@/lib/profile";
import {
  consumeNextPath,
  peekNextPath,
  resolveSignInDestination,
} from "@/lib/sign-in-destination";
import { writePreferredWalletMode } from "@/lib/wallet-mode";
import {
  fetchWalletSessionForAddress,
  signInWalletSession,
  walletSessionChangedEventName,
} from "@/lib/wallet-auth-client";

type SignInMethod = "choose" | "email" | "google" | "wallet";


export function SignInPanel() {
  const t = useT();
  const router = useRouter();
  const accountContext = useOptionalAccount();
  const isBusinessAccount = accountContext?.isBusiness ?? false;
  const hasSelectedAccountType = accountContext?.account?.account_type_selected;
  const [nextPath, setNextPath] = useState<string | null>(null);
  useEffect(() => {
    setNextPath(peekNextPath());
  }, []);
  const destinationHref = resolveSignInDestination({
    accountTypeSelected: Boolean(hasSelectedAccountType),
    isBusiness: isBusinessAccount,
    next: nextPath,
  });
  const { address, isConnected, connector } = useAccount();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const [externalConnectStarted, setExternalConnectStarted] = useState(false);
  const [walletAuthorized, setWalletAuthorized] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const authorizeInFlightRef = useRef(false);
  const [method, setMethod] = useState<SignInMethod>("choose");
  // Google sent this address to email sign-in: it already signs in that way.
  const [emailFromGoogle, setEmailFromGoogle] = useState("");
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  // Here to confirm this device with Circle again (lib/circle-device.ts).
  const [reverify, setReverify] = useState<CircleReverify | null>(null);
  const [autoSendCode, setAutoSendCode] = useState(false);

  const refreshSession = useCallback(async () => {
    if (!isConnected || !address) {
      setWalletAuthorized(false);
      setIsCheckingSession(false);
      return;
    }

    setIsCheckingSession(true);
    try {
      const session = await fetchWalletSessionForAddress(address);
      setWalletAuthorized(Boolean(session.authenticated && session.ownerWallet));
    } catch {
      setWalletAuthorized(false);
    } finally {
      setIsCheckingSession(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    // Connecting only picks the wallet. Its profile is created once the owner
    // signs in (handleAuthorizeWallet), never on connect alone.
    if (externalConnectStarted && isConnected && address) {
      writeActivatedExternalProfile(address);
      setExternalConnectStarted(false);
    }
  }, [address, externalConnectStarted, isConnected]);

  useEffect(() => {
    void refreshSession();

    function onSessionChange() {
      void refreshSession();
    }

    window.addEventListener(walletSessionChangedEventName, onSessionChange);
    return () => {
      window.removeEventListener(walletSessionChangedEventName, onSessionChange);
    };
  }, [refreshSession]);

  async function handleAuthorizeWallet() {
    if (!isConnected || !address) {
      return;
    }

    if (authorizeInFlightRef.current) {
      return;
    }

    authorizeInFlightRef.current = true;
    setIsAuthorizing(true);
    setAuthError(null);
    try {
      if (readCircleLogin()) {
        clearCircleSession({ clearDevice: false });
      }
      writePreferredWalletMode("external");
      writeActivatedExternalProfile(address);

      // Sign first: the server only creates a profile for a wallet whose
      // owner has proven control of it.
      await signInWalletSession({
        connectorName: connector?.name,
        ownerWallet: address,
        signMessage: (message) => signMessageAsync({ message }),
      });
      await ensureProfile({
        authProvider: "external",
        walletAddress: address,
      }).catch(() => undefined);
      setWalletAuthorized(true);

      let destination = "/onboarding";
      try {
        const state = await fetchAccountState(address);
        destination = resolveSignInDestination({
          accountTypeSelected: Boolean(state.account.account_type_selected),
          isBusiness: state.account.account_type === "BUSINESS",
          next: consumeNextPath(),
        });
      } catch {
        destination = "/onboarding";
      }
      router.replace(destination);
    } catch (error) {
      setWalletAuthorized(false);
      setAuthError(
        error instanceof Error
          ? error.message
          : "Wallet authorization was cancelled or failed.",
      );
    } finally {
      authorizeInFlightRef.current = false;
      setIsAuthorizing(false);
    }
  }

  const busy = isAuthorizing || isSigning || isCheckingSession;

  // Land on the step already in progress: confirming this device again, back
  // from Google's redirect (or a Circle wallet mid-setup), or an external
  // wallet already connected.
  useEffect(() => {
    const reverifying = readCircleReverify();
    if (reverifying) {
      setReverify(reverifying);
      if (reverifying.kind === "email") {
        // The code goes out by itself once; after that, on request.
        if (!reverifying.codeSent && reverifying.email) {
          writeCircleReverify({ ...reverifying, codeSent: true });
          setAutoSendCode(true);
        }
        setEmailFromGoogle(reverifying.email ?? "");
        setMethod("email");
        return;
      }
    }
    const googleInProgress =
      reverifying?.kind === "google" ||
      Boolean(readCircleLogin()) ||
      readCircleSessionStorage(circleStorageKeys.setupIntent) === "true" ||
      readCircleSessionStorage(circleStorageKeys.enterApp) === "true" ||
      Boolean(readCircleSessionStorage("socialLoginProvider"));
    if (googleInProgress) {
      setMethod("google");
    } else if (isConnected) {
      setMethod("wallet");
    }
    // Only on open: later changes are the user's own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const steps: Record<
    Exclude<SignInMethod, "choose">,
    { eyebrow: string; title: string; body: string }
  > = {
    email: {
      eyebrow: "Email",
      title: "Continue with email",
      body: "New or returning, we'll email you a 6-digit code to sign in.",
    },
    google: {
      eyebrow: "Google",
      title: "Continue with Google",
      body: "Sign in with Google and get a SaphraONE wallet on Arc, powered by Circle.",
    },
    wallet: {
      eyebrow: "Wallet",
      title: "Connect a wallet",
      body: t("signin.externalWalletBody"),
    },
  };
  const step = method === "choose" ? null : steps[method];

  return (
    <div className="sign-in-panel" id="sign-in">
      {step ? (
        <div className="sign-in-step-head">
          <button
            aria-label="Back to sign-in options"
            className="sign-in-back"
            onClick={() => setMethod("choose")}
            type="button"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <p className="sign-in-eyebrow">{step.eyebrow}</p>
        </div>
      ) : (
        <p className="sign-in-eyebrow sign-in-eyebrow-solo">{t("signin.getStarted")}</p>
      )}

      <h2 className="sign-in-title">
        {step ? step.title : "Great to see you"}
      </h2>
      <p className="sign-in-lede">
        {step
          ? step.body
          : "Sign in or create your SaphraONE account in under a minute, with email, Google or a wallet you already have."}
      </p>

      {method === "choose" ? (
        <div className="sign-in-methods">
          <button
            className="sign-in-method sign-in-method-primary sp-bubble"
            onClick={() => setMethod("email")}
            type="button"
          >
            <Mail className="h-4 w-4" />
            <span>Continue with email</span>
            <ArrowRight className="sign-in-method-arrow h-4 w-4" />
          </button>
          <button
            className="sign-in-method"
            onClick={() => setMethod("google")}
            type="button"
          >
            <GoogleMark />
            <span>Continue with Google</span>
            <ArrowRight className="sign-in-method-arrow h-4 w-4" />
          </button>

          <div className="sign-in-divider">
            <Separator className="flex-1" />
            <span className="text-xs font-semibold text-muted-foreground uppercase">
              {t("common.or")}
            </span>
            <Separator className="flex-1" />
          </div>

          <button
            className="sign-in-method"
            onClick={() => setMethod("wallet")}
            type="button"
          >
            <Wallet className="h-4 w-4" />
            <span>Connect a wallet</span>
            <ArrowRight className="sign-in-method-arrow h-4 w-4" />
          </button>

          <ReferralCodeField />
        </div>
      ) : null}

      {reverify && method === reverify.kind ? (
        <p className="mb-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {reverify.kind === "email"
            ? "Circle needs to confirm this device again. Enter the code we email you and you'll go straight back to where you were."
            : "Confirming this device with Circle so you can keep sending. You'll go straight back to where you were."}
        </p>
      ) : null}
      {method === "email" && emailNotice ? (
        <p className="mb-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {emailNotice}
        </p>
      ) : null}
      {method === "email" ? (
        <EmailSignIn
          autoSendCode={autoSendCode}
          bare
          initialEmail={emailFromGoogle}
          key={emailFromGoogle}
          onUseGoogle={() => {
            setEmailNotice(null);
            setMethod("google");
          }}
        />
      ) : null}

      {/* Always mounted: Google sign-in completes after a redirect back to
          this page, which only works while the component is present. */}
      <div hidden={method !== "google"}>
        <CircleGoogleLogin
          bare
          embedded
          onUseEmail={(address) => {
            setEmailFromGoogle(address);
            setEmailNotice(
              "This address already has a SaphraONE account that signs in with email. We'll email you a code to open it.",
            );
            setMethod("email");
          }}
          showRefreshWallet={false}
        />
      </div>

      {method === "wallet" ? (
        <div className="grid gap-2">
          <WalletConnectButton
            className="w-full"
            fullWidth
            onConnectIntent={() => setExternalConnectStarted(true)}
            variant={isConnected ? "outline" : "default"}
          />

          {isConnected && address ? (
            <>
              {authError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                  {authError}
                </p>
              ) : null}

              {walletAuthorized ? (
                <Button asChild className="w-full" size="lg">
                  <Link href={destinationHref}>
                    {!hasSelectedAccountType
                      ? "Complete onboarding"
                      : isBusinessAccount
                        ? t("signin.continueBusiness") || "Continue to Business Hub"
                        : t("signin.continueDashboard")}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Button
                    className="w-full"
                    disabled={busy}
                    onClick={() => void handleAuthorizeWallet()}
                    size="lg"
                    type="button"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4" />
                    )}
                    {isCheckingSession
                      ? t("signin.checkingAuth")
                      : isAuthorizing || isSigning
                        ? t("signin.confirmInWallet")
                        : t("common.authorizeWallet")}
                  </Button>
                  <p className="text-center text-[11px] text-muted-foreground">
                    {t("signin.authorizeHint")}
                  </p>
                </>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Google's "G", in its brand colours, for the sign-in option. */
function GoogleMark() {
  return (
    <svg aria-hidden className="h-4 w-4" viewBox="0 0 24 24">
      <path d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.6 4.6 0 0 1-2 3.03v2.5h3.23c1.9-1.75 2.97-4.32 2.97-7.34z" fill="#4285F4" />
      <path d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.9.6-2.04.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.07v2.58A10 10 0 0 0 12 22z" fill="#34A853" />
      <path d="M6.4 13.91a6 6 0 0 1 0-3.82V7.51H3.07a10 10 0 0 0 0 8.98l3.33-2.58z" fill="#FBBC05" />
      <path d="M12 5.97c1.47 0 2.79.5 3.83 1.5l2.86-2.86A9.6 9.6 0 0 0 12 2 10 10 0 0 0 3.07 7.51L6.4 10.1C7.2 7.73 9.4 5.97 12 5.97z" fill="#EA4335" />
    </svg>
  );
}
