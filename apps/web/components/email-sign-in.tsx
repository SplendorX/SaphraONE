"use client";

import { arcCircleBlockchain } from "@/lib/chains";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { ArrowLeft, ArrowRight, Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { fetchAccountState } from "@/lib/account/client";
import {
  callCircleWalletApi,
  CircleClientError,
  getCircleErrorMessage,
  isArcCircleWallet,
  preferArcCircleWallets,
  writeCircleLogin,
  writeCircleWallets,
  type CircleLoginResult,
  type CircleWallet,
} from "@/lib/circle-session";
import { ensureProfile } from "@/lib/profile";
import { consumeNextPath, resolveSignInDestination } from "@/lib/sign-in-destination";
import { notifyWalletSessionChanged } from "@/lib/wallet-auth-client";
import { writePreferredWalletMode } from "@/lib/wallet-mode";

type Step = "email" | "code" | "wallet";

/** An opened email-account wallet: from a verified code, or a Supabase Google sign-in. */
export type VerifyResponse = {
  circleUserId: string;
  email: string;
  encryptionKey: string;
  userToken: string;
};

/** The address already has an account that signs in with the old Google login. */
export class UseGoogleError extends Error {}

export async function postEmailAuth<T>(body: Record<string, unknown>) {
  const response = await fetch("/api/auth/email", {
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    useGoogle?: boolean;
  };
  if (!response.ok) {
    const message = payload.message ?? "Email sign-in failed.";
    throw payload.useGoogle ? new UseGoogleError(message) : new Error(message);
  }
  return payload;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Email sign-up / sign-in. Supabase verifies the email with a one-time code;
 * the account's wallet is a Circle user-controlled wallet guarded by a PIN
 * the user sets in Circle's own screen the first time.
 */
export function EmailSignIn({
  bare = false,
  onUseGoogle,
  resume,
}: {
  /** Controls only, for hosts that draw their own title (the sign-in board). */
  bare?: boolean;
  /** Shown when the address already signs in with Google. */
  onUseGoogle?: () => void;
  /**
   * An email-account wallet already opened by "Continue with Google"
   * (unified sign-in): skip the code and go straight to the wallet steps.
   */
  resume?: VerifyResponse;
} = {}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(resume ? "wallet" : "email");
  const [useGoogle, setUseGoogle] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sdkRef = useRef<W3SSdk | null>(null);
  // A code works once; keep the verified login so a failed PIN step can retry.
  const verifiedRef = useRef<VerifyResponse | null>(resume ?? null);

  async function loadSdk() {
    if (sdkRef.current) return sdkRef.current;
    const config = await callCircleWalletApi<{ appId?: string }>("getEntityConfig");
    const appId = config.appId?.trim() || process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim();
    if (!appId) {
      throw new Error("Circle wallets are not configured.");
    }
    const { W3SSdk: CircleW3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
    sdkRef.current = new CircleW3SSdk({ appSettings: { appId } });
    return sdkRef.current;
  }

  /** Open Circle's PIN screen for a challenge and wait until it closes. */
  async function runChallenge(challengeId: string, login: CircleLoginResult) {
    const sdk = await loadSdk();
    sdk.setAuthentication({
      encryptionKey: login.encryptionKey,
      userToken: login.userToken,
    });
    await new Promise<void>((resolve, reject) => {
      sdk.execute(challengeId, (challengeError) => {
        if (challengeError) {
          reject(
            new Error(getCircleErrorMessage(challengeError, "PIN setup was not completed.")),
          );
          return;
        }
        resolve();
      });
    });
  }

  async function listWallets(userToken: string) {
    const payload = await callCircleWalletApi<{ wallets?: CircleWallet[] }>(
      "listWallets",
      { userToken },
    );
    return preferArcCircleWallets(payload.wallets ?? []);
  }

  /** Wallets can take a moment to appear after the PIN challenge completes. */
  async function waitForArcWallet(userToken: string) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const wallets = await listWallets(userToken);
      if (wallets.some(isArcCircleWallet)) return wallets;
      await wait(1000);
    }
    return listWallets(userToken);
  }

  async function ensureArcWallet(login: CircleLoginResult) {
    const existing = await listWallets(login.userToken);
    if (existing.some(isArcCircleWallet)) return existing;

    if (existing.length === 0) {
      setStatus("Set your wallet PIN");
      try {
        const init = await callCircleWalletApi<{ challengeId?: string }>(
          "initializeUser",
          { userToken: login.userToken },
        );
        const challengeId = init.challengeId;
        if (challengeId) {
          await runChallenge(challengeId, login);
        }
      } catch (initError) {
        // 155106: already initialized (e.g. PIN set on an earlier attempt).
        if (!(initError instanceof CircleClientError && String(initError.code) === "155106")) {
          throw initError;
        }
      }
      const wallets = await waitForArcWallet(login.userToken);
      if (wallets.some(isArcCircleWallet)) return wallets;
    }

    setStatus("Creating your Arc wallet");
    const created = await callCircleWalletApi<{ challengeId?: string }>(
      "createWallet",
      {
        blockchain: arcCircleBlockchain,
        refId: `swiftpay-arc-${Date.now()}`,
        userToken: login.userToken,
        walletName: "SaphraONE",
      },
    );
    if (created.challengeId) {
      await runChallenge(created.challengeId, login);
    }
    return waitForArcWallet(login.userToken);
  }

  async function handleSendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await postEmailAuth({ action: "start", email });
      verifiedRef.current = null;
      setCode("");
      setStep("code");
    } catch (sendError) {
      setError(getCircleErrorMessage(sendError, "The code could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setUseGoogle(false);
    try {
      setStatus("Checking your code");
      const verified =
        verifiedRef.current ??
        (await postEmailAuth<VerifyResponse>({ action: "verify", code, email }));
      verifiedRef.current = verified;
      await finishSignIn(verified, "email");
    } catch (verifyError) {
      setUseGoogle(verifyError instanceof UseGoogleError);
      setError(getCircleErrorMessage(verifyError, "Email sign-in failed."));
      setStep((current) => (current === "wallet" ? "code" : current));
      // Past verification, the next press only retries the wallet step.
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  /** From Google: run the wallet steps once, on arrival. */
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!resume || resumedRef.current) return;
    resumedRef.current = true;
    void retryResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  async function retryResume() {
    if (!verifiedRef.current) return;
    setBusy(true);
    setError(null);
    try {
      await finishSignIn(verifiedRef.current, "google");
    } catch (resumeError) {
      setError(getCircleErrorMessage(resumeError, "Google sign-in failed."));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  /** PIN and Arc wallet if needed, the wallet session, the profile, then the app. */
  async function finishSignIn(verified: VerifyResponse, authProvider: "email" | "google") {
    const login: CircleLoginResult = {
      encryptionKey: verified.encryptionKey,
      oAuthInfo: {
        // "Email" even from Google: it's a server-issued token, which only
        // the server can renew (refreshCircleLogin).
        provider: "Email",
        socialUserInfo: { email: verified.email },
        socialUserUUID: verified.circleUserId,
      },
      userToken: verified.userToken,
    };

    setStep("wallet");
    setStatus("Opening your wallet");
    const wallets = await ensureArcWallet(login);
    const wallet = wallets.find(isArcCircleWallet) ?? wallets[0];
    if (!wallet?.address) {
      throw new Error("Your wallet is still being created. Try again in a moment.");
    }

    setStatus("Signing you in");
    await postEmailAuth({ action: "complete", walletAddress: wallet.address });
    writeCircleLogin(login);
    writeCircleWallets(wallets);
    writePreferredWalletMode("circle");
    notifyWalletSessionChanged();
    await ensureProfile({
      authProvider,
      circleSocialUuid: verified.circleUserId,
      displayName: verified.email.split("@")[0],
      walletAddress: wallet.address,
    }).catch(() => undefined);

    let destination = "/onboarding";
    try {
      const state = await fetchAccountState(wallet.address, verified.circleUserId);
      destination = resolveSignInDestination({
        accountTypeSelected: Boolean(state.account.account_type_selected),
        isBusiness: state.account.account_type === "BUSINESS",
        next: consumeNextPath(),
      });
    } catch {
      destination = "/onboarding";
    }
    router.replace(destination);
  }

  return (
    <div className={bare ? undefined : "sign-in-option"}>
      {bare ? null : (
        <>
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">Continue with email</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            New or returning, we&apos;ll email you a code. Your SaphraONE wallet is
            protected by a PIN only you know.
          </p>
        </>
      )}

      {resume ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="font-semibold text-foreground">{resume.email}</span>
          </p>
          <button
            className="sp-bubble inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            disabled={busy}
            onClick={() => void retryResume()}
            type="button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ? status ?? "Opening your wallet" : "Continue wallet setup"}
          </button>
        </div>
      ) : step === "email" ? (
        <form
          className={bare ? "grid gap-2" : "mt-3 grid gap-2"}
          onSubmit={(event) => void handleSendCode(event)}
        >
          <input
            autoComplete="email"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
          <button
            className="sp-bubble inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            disabled={busy || !email.trim()}
            type="submit"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Email me a code
            {!busy ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
        </form>
      ) : (
        <form
          className={bare ? "grid gap-2" : "mt-3 grid gap-2"}
          onSubmit={(event) => void handleVerify(event)}
        >
          <p className="text-xs text-muted-foreground">
            Code sent to <span className="font-semibold text-foreground">{email}</span>
          </p>
          {/* Codes from a new sender often land in spam; say where to look. */}
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            Not in your inbox? Check your <strong className="font-semibold text-foreground">Spam</strong> or{" "}
            <strong className="font-semibold text-foreground">Promotions</strong> folder. Marking it
            &ldquo;Not spam&rdquo; helps future codes arrive in your inbox.
          </p>
          <input
            autoComplete="one-time-code"
            className="h-12 w-full rounded-lg border border-border bg-background px-3 text-center font-mono text-lg tracking-[0.4em] outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
            disabled={step === "wallet"}
            inputMode="numeric"
            maxLength={10}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            placeholder="••••••"
            required
            value={code}
          />
          <button
            className="sp-bubble inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            disabled={busy || (!verifiedRef.current && code.length < 6)}
            type="submit"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy && status
              ? status
              : verifiedRef.current
                ? "Continue wallet setup"
                : "Verify and continue"}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button
              className="inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                verifiedRef.current = null;
                setStep("email");
                setError(null);
              }}
              type="button"
            >
              <ArrowLeft className="h-3 w-3" />
              Change email
            </button>
            <button
              className="font-semibold text-primary disabled:opacity-50"
              disabled={busy}
              onClick={() => void handleSendCode()}
              type="button"
            >
              Resend code
            </button>
          </div>
        </form>
      )}

      {error ? (
        <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      {useGoogle && onUseGoogle ? (
        <button
          className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold transition hover:bg-muted"
          onClick={onUseGoogle}
          type="button"
        >
          Continue with Google
          <ArrowRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
