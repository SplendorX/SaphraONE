"use client";

import { arcCircleBlockchain } from "@/lib/chains";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

import { TokenIcon } from "@/components/token-icon";
import {
  CircleClientError,
  circleStorageKeys as storageKeys,
  clearCircleSession,
  getCircleErrorMessage as getClientErrorMessage,
  getCircleLoginIdentity,
  isArcCircleWallet,
  isCircleDeviceIdError,
  preferArcCircleWallets,
  readCircleLogin as readStoredLogin,
  readCircleSessionStorage as readStorage,
  readCircleWallets,
  removeCircleSessionStorage as removeStorage,
  writeCircleLogin,
  writeCircleSessionStorage as writeStorage,
  writeCircleWallets,
  type CircleClientErrorPayload,
  type CircleLoginResult,
  type CircleTokenBalance,
  type CircleWallet,
} from "@/lib/circle-session";
import { useOptionalAccount } from "@/components/account/account-provider";
import { postEmailAuth } from "@/components/email-sign-in";
import { personalCircleWallet } from "@/lib/business/provision-wallet";
import { fetchAccountState } from "@/lib/account/client";
import { ensureProfile } from "@/lib/profile";
import {
  clearCircleReverify,
  finishCircleReverify,
  readCircleReverify,
  writeCircleReverify,
} from "@/lib/circle-device";
import { consumeNextPath, resolveSignInDestination } from "@/lib/sign-in-destination";
import { endWalletSession, ensureCircleWalletSession } from "@/lib/wallet-auth-client";
import { arcTokenSymbols, type ArcTokenSymbol } from "@/lib/tokens";
import { writePreferredWalletMode } from "@/lib/wallet-mode";

type DeviceTokenResponse = {
  deviceEncryptionKey: string;
  deviceToken: string;
};

type CircleEntityConfigResponse = {
  appId?: string;
};

type LoginCompleteCallback = NonNullable<
  Parameters<W3SSdk["updateConfigs"]>[1]
>;

type GoogleOAuthDiagnostic = {
  audienceMatches?: boolean;
  hasIdToken: boolean;
  nonceMatches?: boolean;
  providerMatches?: boolean;
  stateMatches?: boolean;
};

const googleOAuthDiagnosticStorageKey =
  "saphra.circle.googleOAuthDiagnostic";

function isValidRedirectUri(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const googleProvider = "Google" as Parameters<W3SSdk["performLogin"]>[0];

function getSupportedTokenSymbol(value?: string): ArcTokenSymbol | undefined {
  const symbol = value?.toUpperCase();

  return arcTokenSymbols.includes(symbol as ArcTokenSymbol)
    ? (symbol as ArcTokenSymbol)
    : undefined;
}

function GoogleLogo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
        fill="#EA4335"
      />
    </svg>
  );
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");

  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );

    return JSON.parse(atob(padded)) as { aud?: string; exp?: number; nonce?: string };
  } catch {
    return null;
  }
}

function readGoogleOAuthDiagnostic() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(googleOAuthDiagnosticStorageKey);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as GoogleOAuthDiagnostic;
  } catch {
    return null;
  }
}

function captureGoogleOAuthDiagnostic(googleClientId: string) {
  if (typeof window === "undefined" || !window.location.hash) {
    return null;
  }

  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const idToken = hashParams.get("id_token");

  if (!idToken && !hashParams.get("error")) {
    return null;
  }

  const payload = idToken ? decodeJwtPayload(idToken) : null;
  const storedProvider = window.localStorage.getItem("socialLoginProvider");
  const storedState = window.localStorage.getItem("state");
  const storedNonce = window.localStorage.getItem("nonce");
  const diagnostic = {
    audienceMatches: payload?.aud
      ? payload.aud === googleClientId
      : undefined,
    hasIdToken: Boolean(idToken),
    nonceMatches:
      payload?.nonce && storedNonce ? payload.nonce === storedNonce : undefined,
    providerMatches: storedProvider ? storedProvider === googleProvider : false,
    stateMatches:
      hashParams.get("state") && storedState
        ? hashParams.get("state") === storedState
        : undefined,
  } satisfies GoogleOAuthDiagnostic;

  window.sessionStorage.setItem(
    googleOAuthDiagnosticStorageKey,
    JSON.stringify(diagnostic),
  );

  return diagnostic;
}

function getGoogleOAuthDiagnosticSummary(diagnostic: GoogleOAuthDiagnostic) {
  const checks = [
    ["Client", diagnostic.audienceMatches],
    ["State", diagnostic.stateMatches],
    ["Nonce", diagnostic.nonceMatches],
    ["Provider", diagnostic.providerMatches],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${label}: ${value ? "match" : "mismatch"}`);

  return checks.length > 0
    ? checks.join(" / ")
    : diagnostic.hasIdToken
      ? "Google returned an ID token."
      : "Google did not return an ID token.";
}

function isDeviceIdTimeout(error: unknown) {
  return getClientErrorMessage(error, "")
    .toLowerCase()
    .includes("failed to receive deviceid");
}

function getDeviceIdFailureMessage(hasIdToken = false) {
  if (hasIdToken) {
    return "Google approved the sign-in, but Circle could not verify this device. Tap Continue with Google to try again.";
  }
  return "Circle could not create a device ID. The Circle Web SDK requires a frame at pw-auth.circle.com to establish device security. If you are using Brave Shields, an ad blocker, or third-party cookie blocking, please allow pw-auth.circle.com, then retry Continue with Google.";
}

function getGoogleLoginErrorMessage(
  error: unknown,
  fallback: string,
  redirectUri: string,
  diagnostic: GoogleOAuthDiagnostic | null,
  appId?: string,
  googleClientId?: string,
) {
  // Nobody is signed in yet, so the generic wording ("you'll be signed out
  // next time") does not apply; checked before getClientErrorMessage, which
  // would also mark the (nonexistent) session stale.
  if (isCircleDeviceIdError(error)) {
    return "Circle could not verify this device, so the Google sign-in was not completed. Tap Continue with Google to try again.";
  }

  const message = getClientErrorMessage(error, fallback);
  const normalized = message.toLowerCase();

  if (isDeviceIdTimeout(error) || normalized.includes("device id")) {
    const code =
      error && typeof error === "object" && "code" in error
        ? ` ${String((error as { code?: unknown }).code)}`
        : "";
    return `${getDeviceIdFailureMessage(Boolean(diagnostic?.hasIdToken))} (Circle${code}: ${message})`;
  }

  if (
    message.includes("155140") ||
    normalized.includes("invalid credentials")
  ) {
    const redirectHint = redirectUri || "the app URL";

    if (
      diagnostic?.stateMatches === false ||
      diagnostic?.nonceMatches === false ||
      diagnostic?.providerMatches === false
    ) {
      return `Google returned to the app, but the stored login state did not match. Open the app at ${redirectHint}, use one browser tab, clear site data for this app, and retry Google login.`;
    }

    if (diagnostic?.audienceMatches === false) {
      return "Google returned an ID token for a different OAuth Web Client ID than NEXT_PUBLIC_GOOGLE_CLIENT_ID. Use that same Web Client ID in .env and in Circle Console.";
    }

    if (
      diagnostic?.audienceMatches === true &&
      diagnostic?.stateMatches === true &&
      diagnostic?.nonceMatches === true
    ) {
      const targetAppId = appId || "7789a0b7-98b7-5b2e-a241-d21cd429e086";
      const targetClientId =
        googleClientId ||
        "1023300772086-uee9er206u5qrb9u276kodm5fdhg0rgc.apps.googleusercontent.com";
      return `Circle rejected the token (Code: 155140). The Google ID token matches your local app config, but Circle rejected it. Please verify in Circle Console (console.circle.com > User-Controlled Wallets > Social Logins) that Google login is toggled ON for App ID ${targetAppId} with Web Client ID: ${targetClientId}.`;
    }

    return `Circle rejected the Google sign-in token. In Circle Console, set the Google Client ID (Web) to the same Web OAuth client used by NEXT_PUBLIC_GOOGLE_CLIENT_ID, use the App ID from that same Circle configuration, and add ${redirectHint} as an authorized redirect URI in Google Cloud. Restart the dev server after changing env values.`;
  }

  return message;
}

async function callCircleWalletApi<T>(
  action: string,
  params: Record<string, unknown> = {},
) {
  const response = await fetch("/api/circle/user-wallets", {
    body: JSON.stringify({
      action,
      ...params,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const text = await response.text();
  let payload: T & CircleClientErrorPayload;

  try {
    payload = text
      ? (JSON.parse(text) as T & CircleClientErrorPayload)
      : ({} as T & CircleClientErrorPayload);
  } catch {
    payload = {
      message: text || "Circle wallet request returned a non-JSON response.",
    } as T & CircleClientErrorPayload;
  }

  if (!response.ok) {
    throw new CircleClientError(
      { ...payload, code: payload.code ?? response.status },
      "Circle wallet request failed.",
    );
  }

  return payload;
}

/** The API refused the call because a locked SaphraONE session is in this browser. */
function isAppLockedError(error: unknown) {
  return String((error as { code?: unknown } | null)?.code ?? "") === "423";
}

/** Google's own error on the way back (cancelled, or no silent sign-in possible). */
function readGoogleReturnError() {
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  return hashParams.get("id_token") ? null : hashParams.get("error");
}

/** No second account for an address that signs in with email (lib/email-auth-server.ts). */
const checkEmailAccounts = process.env.NEXT_PUBLIC_CIRCLE_EMAIL_SIGN_IN?.trim() !== "false";

type CircleGoogleLoginProps = {
  /**
   * A new Google user whose address already signs in with email: no Google
   * wallet is made, and the host sends them to email sign-in instead.
   */
  onUseEmail?: (email: string) => void;
  embedded?: boolean;
  /** With `embedded`: controls only, no "Circle wallet" heading. */
  bare?: boolean;
  showRefreshWallet?: boolean;
};

export function CircleGoogleLogin({
  onUseEmail,
  embedded = false,
  bare = false,
  showRefreshWallet = true,
}: CircleGoogleLoginProps) {
  const router = useRouter();
  const accountContext = useOptionalAccount();
  const isBusinessAccount = accountContext?.isBusiness ?? false;
  const sdkRef = useRef<W3SSdk | null>(null);
  const onUseEmailRef = useRef(onUseEmail);
  onUseEmailRef.current = onUseEmail;
  // Google's ID token (and the nonce it signed) from the return URL, read
  // before the SDK clears it: the server checks the address with it.
  const googleReturnRef = useRef<{ idToken: string; nonce: string | null } | null>(null);
  const setupCompletionStartedRef = useRef(false);
  const setupChallengePendingRef = useRef(false);
  const enterAppAfterLoginRef = useRef(false);
  const deviceIdRequestRef = useRef<Promise<string> | null>(null);
  // The SDK is one shared instance for the whole page, and email sign-in
  // puts its own settings and callback on it. Ours are restored from here
  // before a Google login starts.
  const onLoginCompleteRef = useRef<LoginCompleteCallback | null>(null);
  const envAppId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim() ?? "";
  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
  const configuredRedirectUri =
    process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI?.trim() ?? "";
  const [resolvedAppId, setResolvedAppId] = useState(envAppId);
  const [appConfigChecked, setAppConfigChecked] = useState(false);
  const [, setAppConfigStatus] = useState<
    "checking" | "mismatch" | "unavailable" | "verified"
  >("checking");
  const [sdkReady, setSdkReady] = useState(false);

  const [loginResult, setLoginResult] = useState<CircleLoginResult | null>(
    null,
  );
  const [wallets, setWallets] = useState<CircleWallet[]>(() =>
    readCircleWallets(),
  );
  const [balances, setBalances] = useState<CircleTokenBalance[]>([]);
  const [, setStatus] = useState("Circle wallet ready");
  const [error, setError] = useState<string | null>(null);
  const [oauthDiagnostic, setOauthDiagnostic] =
    useState<GoogleOAuthDiagnostic | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // True from the moment the page opens on Google's return URL until the
  // sign-in is confirmed or fails. Nothing may touch the SDK iframe meanwhile.
  const [googleReturnPending, setGoogleReturnPending] = useState(false);
  // True once the SDK has been handed the Google token to verify with Circle.
  const [googleVerifying, setGoogleVerifying] = useState(false);
  const appId = resolvedAppId || envAppId;
  const primaryWallet = personalCircleWallet(wallets);
  const isConfigured = Boolean(appId && googleClientId);
  const redirectUri = useMemo(() => {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }

    return configuredRedirectUri;
  }, [configuredRedirectUri]);

  useEffect(() => {
    let cancelled = false;

    async function loadCircleEntityConfig() {
      setAppConfigStatus("checking");

      try {
        const payload =
          await callCircleWalletApi<CircleEntityConfigResponse>(
            "getEntityConfig",
          );
        const entityAppId = payload.appId?.trim() ?? "";

        if (cancelled) {
          return;
        }

        if (entityAppId) {
          setResolvedAppId(entityAppId);
          setAppConfigStatus(
            envAppId && envAppId !== entityAppId ? "mismatch" : "verified",
          );
          return;
        }

        setResolvedAppId(envAppId);
        setAppConfigStatus("unavailable");
      } catch {
        if (!cancelled) {
          setResolvedAppId(envAppId);
          setAppConfigStatus("unavailable");
        }
      } finally {
        if (!cancelled) {
          setAppConfigChecked(true);
        }
      }
    }

    void loadCircleEntityConfig();

    return () => {
      cancelled = true;
    };
  }, [envAppId]);

  useEffect(() => {
    if (!appConfigChecked) {
      setSdkReady(false);
      return;
    }

    let cancelled = false;

    async function initializeSdk() {
      try {
        const { W3SSdk: CircleW3SSdk } = await import(
          "@circle-fin/w3s-pw-web-sdk"
        );
        const nextOauthDiagnostic =
          captureGoogleOAuthDiagnostic(googleClientId) ??
          readGoogleOAuthDiagnostic();

        if (nextOauthDiagnostic && !cancelled) {
          setOauthDiagnostic(nextOauthDiagnostic);
        }

        const storedLogin = readStoredLogin();
        const onLoginComplete: LoginCompleteCallback = (loginError, result) => {
          if (cancelled) {
            return;
          }

          setGoogleVerifying(false);
          setGoogleReturnPending(false);

          if (loginError) {
            const diagnostic = readGoogleOAuthDiagnostic();
            const message = getGoogleLoginErrorMessage(
              loginError,
              "Google login failed.",
              redirectUri,
              diagnostic,
              appId,
              googleClientId,
            );
            removeStorage(storageKeys.setupIntent);
            setOauthDiagnostic(diagnostic);
            setError(message);
            setStatus("Google login failed");
            return;
          }

          const nextLogin = result as CircleLoginResult | undefined;

          if (!nextLogin?.userToken || !nextLogin.encryptionKey) {
            setError("Google login did not return Circle wallet credentials.");
            setStatus("Google login incomplete");
            return;
          }

          const acceptGoogleWallet = () => {
            // Back to where a device re-check started, once in.
            finishCircleReverify();
            setLoginResult(nextLogin);
            writeCircleLogin(nextLogin);
            removeStorage(googleOAuthDiagnosticStorageKey);
            setOauthDiagnostic(null);
            setError(null);
            setStatus("Google login connected. Completing wallet setup");
          };

          const googleReturn = googleReturnRef.current;
          googleReturnRef.current = null;
          if (!checkEmailAccounts || !googleReturn) {
            acceptGoogleWallet();
            return;
          }

          // A Google login with no wallet yet, for an address that already
          // signs in with email: send them there instead of making a second
          // account. Anyone else carries on as before.
          setIsBusy(true);
          setError(null);
          void postEmailAuth<{ email?: string; message?: string; ok?: boolean; useEmail?: boolean }>({
            action: "google",
            circleUserToken: nextLogin.userToken,
            idToken: googleReturn.idToken,
            nonce: googleReturn.nonce,
          })
            .then((checked) => {
              if (cancelled) return;
              if (!checked.useEmail) {
                acceptGoogleWallet();
                return;
              }
              removeStorage(storageKeys.setupIntent);
              removeStorage(storageKeys.enterApp);
              removeStorage(googleOAuthDiagnosticStorageKey);
              setOauthDiagnostic(null);
              setError(checked.message ?? "This email signs in with email. Continue with email.");
              onUseEmailRef.current?.(checked.email ?? "");
            })
            .catch((routeError: unknown) => {
              if (cancelled) return;
              removeStorage(storageKeys.setupIntent);
              setError(
                getClientErrorMessage(routeError, "Google sign-in couldn't be completed. Try again."),
              );
            })
            .finally(() => {
              if (!cancelled) setIsBusy(false);
            });
        };
        onLoginCompleteRef.current = onLoginComplete;

        // Google's return URL. The SDK verifies the token in it the moment it
        // is constructed, with whatever device token it has been given, so
        // the hash comes off the URL first and goes back on once this device
        // has a token minted for it (verifyGoogleReturn below).
        const returnHash = window.location.hash;
        const isGoogleReturn = returnHash.includes("id_token");
        if (isGoogleReturn) {
          const idToken = new URLSearchParams(returnHash.slice(1)).get("id_token");
          googleReturnRef.current = idToken
            ? { idToken, nonce: window.localStorage.getItem("nonce") }
            : null;
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}`,
          );
        }
        // Google came back with an error instead (cancelled, or, asked
        // silently, it needs the person to choose). Off the URL before the
        // SDK sees it, or it reports a token Circle rejected.
        const googleError = isGoogleReturn ? null : readGoogleReturnError();
        if (googleError) {
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}`,
          );
        }
        const sdk = new CircleW3SSdk(sdkConfigsFor(), onLoginComplete);

        // One shared instance: constructing it again hands back the first one
        // with its old settings, so ours are set explicitly.
        sdk.updateConfigs(sdkConfigsFor(), onLoginComplete);

        sdkRef.current = sdk;

        if (cancelled) {
          return;
        }

        setLoginResult(storedLogin);
        if (isGoogleReturn) {
          setGoogleReturnPending(true);
        }
        setSdkReady(true);

        if (!isConfigured) {
          setStatus("Add Circle and Google credentials");
        }

        if (isGoogleReturn) {
          await verifyGoogleReturn(sdk, returnHash, onLoginComplete);
          return;
        }

        const reverify = readCircleReverify();
        if (reverify?.kind === "google") {
          continueGoogleReverify(reverify.googleAttempts ?? 0, googleError);
        } else if (googleError) {
          setError(
            googleError === "access_denied"
              ? "Google sign-in was cancelled. Try again when you're ready."
              : "Google sign-in didn't finish. Please try again.",
          );
        }
      } catch (sdkError) {
        if (!cancelled) {
          setError(
            getClientErrorMessage(
              sdkError,
              "Circle SDK could not be initialized.",
            ),
          );
          setStatus("Circle SDK unavailable");
        }
      }
    }

    /**
     * Back from Google: mint a device token for the device ID Circle's frame
     * holds right now, then let the SDK verify the Google token with it.
     * Both happen on this page load, so the frame's device ID need not have
     * survived the trip to Google (phones keep it apart from the page's own
     * storage), and no token from an earlier attempt is ever reused: Circle
     * answers "device ID is not found" to either.
     */
    async function verifyGoogleReturn(
      sdk: W3SSdk,
      returnHash: string,
      onLoginComplete: LoginCompleteCallback,
    ) {
      setStatus("Confirming Google sign-in");

      let tokens: DeviceTokenResponse;
      try {
        tokens = await mintDeviceToken().catch(async (deviceError: unknown) => {
          // A locked session left in this browser refuses the sign-in's own
          // calls ("SaphraONE is locked"). Signing in replaces it anyway.
          if (!isAppLockedError(deviceError)) throw deviceError;
          await endWalletSession().catch(() => undefined);
          return mintDeviceToken();
        });
      } catch (deviceError) {
        if (cancelled) {
          return;
        }

        const diagnostic = readGoogleOAuthDiagnostic();
        removeStorage(storageKeys.setupIntent);
        setGoogleReturnPending(false);
        setOauthDiagnostic(diagnostic);
        setError(
          getGoogleLoginErrorMessage(
            deviceError,
            "Google login failed.",
            redirectUri,
            diagnostic,
            appId,
            googleClientId,
          ),
        );
        setStatus("Google login failed");
        return;
      }

      if (cancelled) {
        return;
      }

      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${returnHash}`,
      );
      setGoogleVerifying(true);
      // Reads the token back off the URL and sends it to Circle with the
      // device token it was just given.
      sdk.updateConfigs(sdkConfigsFor(tokens), onLoginComplete);
    }

    /**
     * Confirming this device again (lib/circle-device.ts): Google is asked
     * first without showing anything, then, if it needs the person to choose,
     * with its account list. Each comes back here.
     */
    function continueGoogleReverify(attempts: number, googleError: string | null) {
      const reverify = readCircleReverify();
      if (!reverify) return;
      if (!googleError && attempts === 0) {
        writeCircleReverify({ ...reverify, googleAttempts: 1 });
        void startGoogleLogin({ loginHint: reverify.email, prompt: "none" });
        return;
      }
      if (googleError && attempts === 1) {
        writeCircleReverify({ ...reverify, googleAttempts: 2 });
        void startGoogleLogin({ loginHint: reverify.email, prompt: "select_account" });
        return;
      }
      if (googleError) {
        clearCircleReverify();
        setError(
          "Google couldn't confirm it's you. Tap Continue with Google to keep using SaphraONE on this device.",
        );
      }
    }

    const initializationTimer = window.setTimeout(() => {
      void initializeSdk();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(initializationTimer);
    };
  }, [appConfigChecked, appId, googleClientId, isConfigured, redirectUri]);

  /**
   * The device ID Circle's frame holds right now. Always asked of the frame,
   * never read back from this page's storage: the two can drift apart, and a
   * device token minted for a stale ID is rejected at sign-in.
   */
  const resolveDeviceId = useCallback(async () => {
    if (deviceIdRequestRef.current) {
      return deviceIdRequestRef.current;
    }

    const request = (async () => {
      const sdk = sdkRef.current;

      if (!sdk) {
        throw new Error("Circle SDK is still loading.");
      }

      let lastError: unknown = new Error("Device ID could not be created.");

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const nextDeviceId = await sdk.getDeviceId();

          if (!nextDeviceId) {
            throw new Error("Circle did not return a device ID.");
          }

          // Kept for renewing the login later (refreshCircleLogin).
          writeStorage(storageKeys.deviceId, nextDeviceId);
          return nextDeviceId;
        } catch (error) {
          lastError = error;

          if (attempt < 2) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, 500 * (attempt + 1));
            });
          }
        }
      }

      throw lastError;
    })();

    deviceIdRequestRef.current = request;

    try {
      return await request;
    } finally {
      if (deviceIdRequestRef.current === request) {
        deviceIdRequestRef.current = null;
      }
    }
  }, []);

  // The SDK gives up on verification after 10s without reporting it through
  // onLoginComplete; stop waiting so the button is usable again.
  useEffect(() => {
    if (!googleVerifying) {
      return;
    }

    const timer = window.setTimeout(() => {
      setGoogleVerifying(false);
      setGoogleReturnPending(false);
      setError("Google sign-in could not be confirmed. Please try again.");
      removeStorage(storageKeys.setupIntent);
    }, 20000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [googleVerifying]);

  async function loadBalances(userToken: string, walletId: string) {
    const payload = await callCircleWalletApi<{
      tokenBalances?: CircleTokenBalance[];
    }>("getTokenBalance", {
      userToken,
      walletId,
    });

    setBalances(payload.tokenBalances ?? []);
  }

  async function loadWallets(
    userToken = loginResult?.userToken,
    options: { login?: CircleLoginResult | null; showBusy?: boolean } = {},
  ) {
    if (!userToken) {
      return null;
    }

    const showBusy = options.showBusy ?? true;

    if (showBusy) {
      setIsBusy(true);
    }

    setError(null);

    try {
      const payload = await callCircleWalletApi<{ wallets?: CircleWallet[] }>(
        "listWallets",
        {
          userToken,
        },
      );
      const nextWallets = preferArcCircleWallets(payload.wallets ?? []);
      setWallets(nextWallets);
      writeCircleWallets(nextWallets);

      const walletAddress = nextWallets[0]?.address;

      if (walletAddress) {
        const identity = getCircleLoginIdentity(options.login ?? loginResult);
        await ensureCircleWalletSession(userToken);
        await ensureProfile({
          authProvider: "google",
          circleSocialUuid: identity.socialUserUUID,
          displayName: identity.name,
          walletAddress,
        }).catch(() => undefined);
      }

      if (nextWallets[0]) {
        await loadBalances(userToken, nextWallets[0].id);
        setStatus("Circle wallet loaded");
        if (
          typeof window !== "undefined" &&
          (window.location.pathname === "/" || window.location.pathname === "/sign-in") &&
          (enterAppAfterLoginRef.current ||
            readStorage(storageKeys.enterApp) === "true")
        ) {
          enterAppAfterLoginRef.current = false;
          removeStorage(storageKeys.enterApp);
          writePreferredWalletMode("circle");
          let destination = "/onboarding";
          try {
            const identity = getCircleLoginIdentity(options.login ?? loginResult);
            if (walletAddress) {
              const state = await fetchAccountState(
                walletAddress,
                identity.socialUserUUID,
              );
              destination = resolveSignInDestination({
                accountTypeSelected: Boolean(state.account.account_type_selected),
                isBusiness: state.account.account_type === "BUSINESS",
                next: consumeNextPath(),
              });
            }
          } catch {
            destination = "/onboarding";
          }
          router.replace(destination);
        }
      } else {
        setBalances([]);
        setStatus("No Circle wallet found");
      }

      return nextWallets;
    } catch (walletError) {
      setError(
        getClientErrorMessage(
          walletError,
          "Circle wallet could not be loaded.",
        ),
      );
      setStatus("Wallet load failed");
      return null;
    } finally {
      if (showBusy) {
        setIsBusy(false);
      }
    }
  }

  useEffect(() => {
    if (
      !loginResult?.userToken ||
      wallets.length > 0 ||
      setupChallengePendingRef.current
    ) {
      return;
    }

    void completeWalletSetup(loginResult);
  }, [loginResult, loginResult?.userToken, wallets.length]);

  useEffect(() => {
    const walletAddress = primaryWallet?.address;

    if (!loginResult || !walletAddress) {
      return;
    }

    const identity = getCircleLoginIdentity(loginResult);
    void ensureProfile({
      authProvider: "google",
      circleSocialUuid: identity.socialUserUUID,
      displayName: identity.name,
      walletAddress,
    }).catch(() => undefined);
  }, [loginResult, primaryWallet?.address]);

  /** SDK settings for Google sign-in, with device credentials once minted. */
  function sdkConfigsFor(tokens?: DeviceTokenResponse) {
    return {
      appSettings: {
        appId,
      },
      loginConfigs: {
        deviceEncryptionKey: tokens?.deviceEncryptionKey ?? "",
        deviceToken: tokens?.deviceToken ?? "",
        google: {
          clientId: googleClientId,
          redirectUri,
          selectAccountPrompt: true,
        },
      },
    };
  }

  /**
   * A device token for the device ID Circle's frame holds right now. Minted
   * on the way back from Google, never before leaving for it: Circle ties it
   * to that ID, and the token is also stored for the other pages' SDKs.
   */
  async function mintDeviceToken(): Promise<DeviceTokenResponse> {
    const deviceId = await resolveDeviceId();
    const tokens = await callCircleWalletApi<DeviceTokenResponse>(
      "createDeviceToken",
      {
        deviceId,
      },
    );

    writeStorage(storageKeys.deviceToken, tokens.deviceToken);
    writeStorage(storageKeys.deviceEncryptionKey, tokens.deviceEncryptionKey);

    return tokens;
  }

  /**
   * Google's sign-in address for a device re-check, stored the way the SDK
   * stores its own (it checks the state and nonce on the way back). Unlike
   * the SDK's, it names the account (login_hint), so "prompt=none" signs in
   * without showing anything even with several Google accounts on the phone.
   */
  function googleReverifyUrl(prompt: "none" | "select_account", loginHint?: string) {
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    window.localStorage.setItem("socialLoginProvider", googleProvider);
    window.localStorage.setItem("state", state);
    window.localStorage.setItem("nonce", nonce);
    const params = new URLSearchParams({
      client_id: googleClientId,
      nonce,
      prompt,
      redirect_uri: redirectUri,
      response_type: "id_token token",
      scope:
        "openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
      state,
    });
    if (loginHint) params.set("login_hint", loginHint);
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  function handleGoogleLogin() {
    return startGoogleLogin();
  }

  /**
   * Leaves for Google. Without `prompt`, the SDK's own sign-in (Google's
   * account list); with it, a device re-check (googleReverifyUrl).
   */
  async function startGoogleLogin(
    options: { loginHint?: string; prompt?: "none" | "select_account" } = {},
  ) {
    const sdk = sdkRef.current;

    if (!sdk) {
      setError("Circle SDK is still loading.");
      return;
    }

    if (!isConfigured) {
      setError(
        "Set NEXT_PUBLIC_CIRCLE_APP_ID and NEXT_PUBLIC_GOOGLE_CLIENT_ID, or configure CIRCLE_API_KEY so the app can read the Circle entity App ID.",
      );
      return;
    }

    if (!isValidRedirectUri(redirectUri)) {
      setError("Set NEXT_PUBLIC_GOOGLE_REDIRECT_URI to a valid http(s) URL.");
      return;
    }

    if (typeof window !== "undefined") {
      const redirectOrigin = new URL(redirectUri).origin;

      if (window.location.origin !== redirectOrigin) {
        setError(
          `Google login must start from the same origin it returns to. Open ${redirectOrigin}, or set NEXT_PUBLIC_GOOGLE_REDIRECT_URI to ${window.location.origin} and add that exact URI in Google Cloud.`,
        );
        return;
      }
    }

    setIsBusy(true);
    setError(null);
    setOauthDiagnostic(null);
    removeStorage(googleOAuthDiagnosticStorageKey);

    if (typeof window !== "undefined") {
      window.localStorage.removeItem("socialLoginProvider");
      window.localStorage.removeItem("state");
      window.localStorage.removeItem("nonce");
    }

    // Device credentials from an earlier attempt never carry into this one:
    // fresh ones are minted when Google sends the person back
    // (verifyGoogleReturn), for the device ID Circle's frame holds then.
    removeStorage(storageKeys.deviceToken);
    removeStorage(storageKeys.deviceEncryptionKey);
    removeStorage(storageKeys.deviceId);

    // A sign-in from a browser that holds no Circle login replaces any
    // session left behind. Left in place, a locked one refused the sign-in's
    // own calls ("SaphraONE is locked") with no lock screen to open it. A
    // device re-check keeps it: same account, already unlocked.
    if (!readStoredLogin() && !readCircleReverify()) {
      await endWalletSession().catch(() => undefined);
    }

    try {
      // Email sign-in shares this SDK instance and may have left its own
      // settings and callback on it.
      sdk.updateConfigs(sdkConfigsFor(), onLoginCompleteRef.current ?? undefined);
      setupCompletionStartedRef.current = false;
      writeStorage(storageKeys.setupIntent, "true");
      writeStorage(storageKeys.enterApp, "true");
      enterAppAfterLoginRef.current = true;
      setStatus("Redirecting to Google");
      if (options.prompt) {
        window.location.assign(googleReverifyUrl(options.prompt, options.loginHint));
        return;
      }
      await sdk.performLogin(googleProvider);
    } catch (loginError) {
      console.error("Google login start failed", loginError);

      removeStorage(storageKeys.setupIntent);
      setOauthDiagnostic(null);
      setError(
        getGoogleLoginErrorMessage(
          loginError,
          "Google login could not start.",
          redirectUri,
          null,
          appId,
          googleClientId,
        ),
      );
      setStatus("Google login unavailable");
    } finally {
      setIsBusy(false);
    }
  }

  function executeChallenge(
    challengeId: string,
    auth: CircleLoginResult,
    options: { createWalletIfMissing?: boolean } = {},
  ) {
    const sdk = sdkRef.current;

    if (!sdk) {
      setError("Circle SDK is still loading.");
      return;
    }

    sdk.setAuthentication({
      encryptionKey: auth.encryptionKey,
      userToken: auth.userToken,
    });
    setStatus("Opening wallet setup");
    setupChallengePendingRef.current = true;

    sdk.execute(challengeId, (challengeError) => {
      setupChallengePendingRef.current = false;
      if (challengeError) {
        const message = getClientErrorMessage(
          challengeError,
          "Wallet setup was not completed.",
        );
        setError(message);
        setStatus("Wallet setup failed");
        removeStorage(storageKeys.setupIntent);
        return;
      }

      setStatus("Wallet setup complete");
      removeStorage(storageKeys.setupIntent);
      window.setTimeout(() => {
        void (async () => {
          const nextWallets = await loadWalletsWithRetry(auth.userToken, {
            login: auth,
          });

          if (
            options.createWalletIfMissing !== false &&
            nextWallets &&
            nextWallets.length === 0
          ) {
            await createArcWallet(auth);
          }
        })().catch((err) => {
          setError(
            getClientErrorMessage(
              err,
              "Circle wallet could not be loaded.",
            ),
          );
          setStatus("Wallet setup failed");
        });
      }, 1600);
    });
  }

  async function loadWalletsWithRetry(
    userToken: string,
    options: {
      attempts?: number;
      delayMs?: number;
      login?: CircleLoginResult | null;
    } = {},
  ) {
    const attempts = options.attempts ?? 5;
    const delayMs = options.delayMs ?? 900;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const nextWallets = await loadWallets(userToken, {
        login: options.login,
        showBusy: false,
      });

      if (nextWallets === null || nextWallets.length > 0) {
        return nextWallets;
      }

      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }

    return [];
  }

  async function createArcWallet(auth: CircleLoginResult) {
    setStatus("Creating Arc wallet");
    const payload = await callCircleWalletApi<{ challengeId?: string }>(
      "createWallet",
      {
        blockchain: arcCircleBlockchain,
        refId: `swiftpay-arc-${Date.now()}`,
        userToken: auth.userToken,
        walletName: "SaphraONE",
      },
    );

    if (payload.challengeId) {
      executeChallenge(payload.challengeId, auth, {
        createWalletIfMissing: false,
      });
      return;
    }

    const nextWallets = await loadWalletsWithRetry(auth.userToken, {
      login: auth,
    });
    if (!nextWallets || nextWallets.length === 0) {
      throw new Error("Circle wallet setup started, but no Arc wallet is available yet. Refresh wallet in a moment.");
    }
  }

  async function completeWalletSetup(auth: CircleLoginResult) {
    if (!auth.userToken) {
      setError("Continue with Google before creating a wallet.");
      return;
    }

    if (setupCompletionStartedRef.current) {
      return;
    }

    setupCompletionStartedRef.current = true;
    setIsBusy(true);
    setError(null);

    try {
      setStatus("Checking Circle wallet");
      const existingWallets = await loadWallets(auth.userToken, {
        login: auth,
        showBusy: false,
      });

      if (existingWallets === null) {
        return;
      }

      if (existingWallets.some(isArcCircleWallet)) {
        removeStorage(storageKeys.setupIntent);
        setStatus("Circle wallet ready");
        return;
      }

      if (existingWallets.length > 0) {
        await createArcWallet(auth);
        removeStorage(storageKeys.setupIntent);
        return;
      }

      setStatus("Creating Circle wallet");
      const payload = await callCircleWalletApi<{ challengeId?: string }>(
        "initializeUser",
        {
          userToken: auth.userToken,
        },
      );

      if (!payload.challengeId) {
        const initializedWallets = await loadWalletsWithRetry(auth.userToken, {
          login: auth,
        });
        if (initializedWallets && initializedWallets.length > 0) {
          removeStorage(storageKeys.setupIntent);
          return;
        }
        await createArcWallet(auth);
        removeStorage(storageKeys.setupIntent);
        return;
      }

      executeChallenge(payload.challengeId, auth);
    } catch (walletError) {
      if (
        walletError instanceof CircleClientError &&
        String(walletError.code) === "155106"
      ) {
        try {
          const initializedWallets = await loadWalletsWithRetry(auth.userToken, {
            login: auth,
          });
          if (!initializedWallets || initializedWallets.length === 0) {
            await createArcWallet(auth);
          }
        } catch (recoveryError) {
          setError(
            getClientErrorMessage(
              recoveryError,
              "Circle wallet could not be loaded.",
            ),
          );
          setStatus("Wallet setup failed");
        }
        removeStorage(storageKeys.setupIntent);
        return;
      }

      setError(
        getClientErrorMessage(
          walletError,
          "Circle wallet could not be created.",
        ),
      );
      setStatus("Wallet setup failed");
      removeStorage(storageKeys.setupIntent);
    } finally {
      setupCompletionStartedRef.current = false;
      setIsBusy(false);
    }
  }

  async function handleInitializeWallet() {
    if (!loginResult?.userToken) {
      setError("Continue with Google before creating a wallet.");
      return;
    }

    setupCompletionStartedRef.current = false;
    writeStorage(storageKeys.setupIntent, "true");
    writeStorage(storageKeys.enterApp, "true");
    enterAppAfterLoginRef.current = true;
    await completeWalletSetup(loginResult);
  }

  const primaryAction = !loginResult ? (
    <button
      className="sp-bubble inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={
        !appConfigChecked || !sdkReady || isBusy || googleReturnPending
      }
      onClick={() => void handleGoogleLogin()}
      type="button"
    >
      {isBusy || googleReturnPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background">
          <GoogleLogo className="h-4 w-4" />
        </span>
      )}
      {googleReturnPending ? "Signing in with Google" : "Continue with Google"}
    </button>
  ) : primaryWallet ? (
    <Link
      className="sp-bubble inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
      href={
        accountContext?.account?.account_type_selected === false
          ? "/onboarding"
          : isBusinessAccount
            ? "/business"
            : "/dashboard"
      }
    >
      {accountContext?.account?.account_type_selected === false
        ? "Complete onboarding"
        : isBusinessAccount
          ? "Open Business Hub"
          : "Open dashboard"}
      <ArrowRight className="h-4 w-4" />
    </Link>
  ) : (
    <button
      className="sp-bubble inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={isBusy}
      onClick={() => void handleInitializeWallet()}
      type="button"
    >
      {isBusy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Wallet className="h-4 w-4" />
      )}
      {isBusy ? "Setting up Circle wallet" : "Finish Circle wallet setup"}
    </button>
  );

  const shellClassName = embedded
    ? "grid gap-4"
    : "surface-panel p-5 sm:p-6";
  const Shell = embedded ? "div" : "aside";

  return (
    <Shell className={shellClassName} id="google-login">
      {embedded && bare ? null : embedded ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Circle wallet</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Google sign-in for an embedded Circle wallet on Arc.
            </p>
          </div>
          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-primary">
            {primaryWallet ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Wallet className="h-4 w-4" />
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Google auth</p>
              <h2 className="mt-3 font-heading text-2xl font-semibold leading-snug text-foreground">
                Circle wallet
              </h2>
            </div>
            <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-primary">
              {primaryWallet ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Wallet className="h-5 w-5" />
              )}
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Continue with Google to create or load a Circle user-controlled wallet
            for SaphraONE transactions.
          </p>
        </>
      )}

      {balances.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {balances.slice(0, 2).map((balance, index) => (
            (() => {
              const symbol = getSupportedTokenSymbol(balance.token?.symbol);

              return (
                <div
                  className="rounded-lg border border-border bg-card px-3 py-2"
                  key={`${balance.token?.id ?? balance.token?.symbol ?? balance.token?.name ?? "token"}-${balance.amount ?? "0"}-${index}`}
                >
                  <div className="flex items-center gap-2">
                    {symbol ? (
                      <TokenIcon
                        className="h-5 w-5 shrink-0 rounded-full"
                        symbol={symbol}
                      />
                    ) : null}
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                      {balance.token?.symbol ?? balance.token?.name ?? "Token"}
                    </p>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">
                    {balance.amount ?? "0"}
                  </p>
                </div>
              );
            })()
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}

      {/* For whoever is setting Google up locally; nothing a customer can act on. */}
      {error && oauthDiagnostic && process.env.NODE_ENV !== "production" ? (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
          Google token diagnostic:{" "}
          {getGoogleOAuthDiagnosticSummary(oauthDiagnostic)}
        </div>
      ) : null}

      {error ? (
        <div className="mt-2 flex justify-end">
          <button
            className="text-xs font-semibold text-primary underline underline-offset-4 transition hover:opacity-80"
            onClick={() => {
              setError(null);
              setOauthDiagnostic(null);
              clearCircleSession({ clearDevice: true });
              removeStorage(googleOAuthDiagnosticStorageKey);
              void handleGoogleLogin();
            }}
            type="button"
          >
            Clear and Retry Google Login
          </button>
        </div>
      ) : null}

      <div className={embedded ? "grid gap-2" : "mt-5 grid gap-2"}>
        {primaryAction}
        {showRefreshWallet ? (
          <button
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!loginResult?.userToken || isBusy}
            onClick={() => void loadWallets()}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />
            Refresh wallet
          </button>
        ) : null}
      </div>
    </Shell>
  );
}
