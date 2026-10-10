"use client";

import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Shield,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  callCircleWalletApi,
  circleSessionEventName,
  circleStorageKeys,
  clearCircleSession,
  getCircleLoginIdentity,
  readCircleLogin,
  readCircleSessionStorage,
  readCircleWallets,
  shortenCircleAddress,
  type CircleWallet,
} from "@/lib/circle-session";
import { readDeviceInfo } from "@/lib/device-info";
import {
  clearActivatedExternalProfile,
  platformAccessEventName,
  readActivatedExternalProfile,
} from "@/lib/platform-access";
import {
  endWalletSession,
  fetchWalletSessionForAddress,
  signInWalletSession,
  walletSessionChangedEventName,
  type WalletSessionStatus,
} from "@/lib/wallet-auth-client";

type SessionDeviceManagementProps = {
  embedded?: boolean;
};

function formatExpiry(value?: string) {
  if (!value) {
    return "Unknown";
  }

  const expiresAt = new Date(value);

  if (Number.isNaN(expiresAt.getTime())) {
    return "Unknown";
  }

  return expiresAt.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function SessionRow({
  action,
  detail,
  label,
  status,
  statusTone = "neutral",
}: {
  action?: ReactNode;
  detail?: string;
  label: string;
  status: string;
  statusTone?: "neutral" | "positive" | "warning";
}) {
  const badgeVariant =
    statusTone === "positive"
      ? "secondary"
      : statusTone === "warning"
        ? "outline"
        : "outline";

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {detail ? (
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
        <Badge variant={badgeVariant}>{status}</Badge>
      </div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function SessionDeviceManagement({
  embedded = false,
}: SessionDeviceManagementProps) {
  const { address, connector, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { isPending: isSigningIn, signMessageAsync } = useSignMessage();

  const [circleLogin, setCircleLogin] = useState(() => readCircleLogin());
  const [circleWalletAddress, setCircleWalletAddress] = useState("");
  const [activatedExternalProfile, setActivatedExternalProfile] = useState("");
  const [walletSession, setWalletSession] = useState<WalletSessionStatus | null>(
    null,
  );
  const [deviceInfo, setDeviceInfo] = useState(() => readDeviceInfo());
  const [circleDeviceId, setCircleDeviceId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isWalletActionPending, setIsWalletActionPending] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const circleIdentity = getCircleLoginIdentity(circleLogin);
  const circleWallets = useMemo(() => readCircleWallets(), [circleLogin]);
  const connectedAddress = address && isAddress(address) ? getAddress(address) : "";
  const normalizedConnectedAddress = connectedAddress.toLowerCase();
  const normalizedActivatedProfile = activatedExternalProfile.toLowerCase();
  const activeMode = circleLogin && circleWalletAddress ? "circle" : "external";
  const walletSessionAddress = walletSession?.ownerWallet?.toLowerCase() ?? "";
  const walletSessionMatchesWallet = Boolean(
    walletSession?.authenticated &&
      normalizedConnectedAddress &&
      walletSessionAddress === normalizedConnectedAddress,
  );
  const externalProfileMatchesWallet = Boolean(
    normalizedActivatedProfile &&
      normalizedConnectedAddress &&
      normalizedActivatedProfile === normalizedConnectedAddress,
  );
  const hasPlatformAccess = Boolean(
    circleLogin || normalizedActivatedProfile || walletSession?.authenticated,
  );

  const refreshLocalState = useCallback(() => {
    setCircleLogin(readCircleLogin());
    setActivatedExternalProfile(readActivatedExternalProfile());
    setCircleDeviceId(readCircleSessionStorage(circleStorageKeys.deviceId));
    setDeviceInfo(readDeviceInfo(navigator.userAgent));
  }, []);

  const refreshWalletSession = useCallback(async () => {
    const session = await fetchWalletSessionForAddress(
      connectedAddress || null,
    );
    setWalletSession(session);
    return session;
  }, [connectedAddress]);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      refreshLocalState();
      await refreshWalletSession();
    } catch (refreshError) {
      setWalletSession({ authenticated: false });
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Sessions could not be refreshed.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [refreshLocalState, refreshWalletSession]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    function handleSessionChange() {
      refreshLocalState();
      void refreshWalletSession();
    }

    window.addEventListener(circleSessionEventName, handleSessionChange);
    window.addEventListener(platformAccessEventName, handleSessionChange);
    window.addEventListener(walletSessionChangedEventName, handleSessionChange);
    window.addEventListener("storage", handleSessionChange);

    return () => {
      window.removeEventListener(circleSessionEventName, handleSessionChange);
      window.removeEventListener(platformAccessEventName, handleSessionChange);
      window.removeEventListener(
        walletSessionChangedEventName,
        handleSessionChange,
      );
      window.removeEventListener("storage", handleSessionChange);
    };
  }, [refreshLocalState, refreshWalletSession]);

  useEffect(() => {
    let cancelled = false;

    async function loadCircleWalletAddress() {
      if (!circleLogin?.userToken) {
        if (!cancelled) {
          setCircleWalletAddress("");
        }
        return;
      }

      const cachedAddress = readCircleWallets()[0]?.address ?? "";

      if (cachedAddress && !cancelled) {
        setCircleWalletAddress(cachedAddress);
      }

      try {
        const payload = await callCircleWalletApi<{ wallets?: CircleWallet[] }>(
          "listWallets",
          { userToken: circleLogin.userToken },
        );
        const walletAddress = payload.wallets?.[0]?.address ?? "";

        if (!cancelled) {
          setCircleWalletAddress(walletAddress);
        }
      } catch {
        if (!cancelled && !cachedAddress) {
          setCircleWalletAddress("");
        }
      }
    }

    void loadCircleWalletAddress();

    return () => {
      cancelled = true;
    };
  }, [circleLogin?.userToken]);

  async function handleWalletSignIn() {
    if (!isConnected || !connectedAddress) {
      setError("Connect an external wallet before starting a server session.");
      return;
    }

    setIsWalletActionPending(true);
    setError(null);
    setSuccess(null);

    try {
      const session = await signInWalletSession({
        connectorName: connector?.name,
        ownerWallet: connectedAddress,
        signMessage: (message) => signMessageAsync({ message }),
      });
      setWalletSession(session);
      setSuccess("Wallet session started on this device.");
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Wallet session could not be started.",
      );
    } finally {
      setIsWalletActionPending(false);
    }
  }

  async function handleEndWalletSession() {
    setIsWalletActionPending(true);
    setError(null);
    setSuccess(null);

    try {
      await endWalletSession();
      setWalletSession({ authenticated: false });
      setSuccess("Wallet session ended on this device.");
    } catch (endError) {
      setError(
        endError instanceof Error
          ? endError.message
          : "Wallet session could not be ended.",
      );
    } finally {
      setIsWalletActionPending(false);
    }
  }

  async function handleCircleSignOut() {
    setIsSigningOut(true);
    setError(null);
    setSuccess(null);

    try {
      clearCircleSession({ clearDevice: true });
      refreshLocalState();
      setSuccess("Circle session cleared on this device.");
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Circle session could not be cleared.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleClearExternalProfile() {
    setError(null);
    setSuccess(null);
    clearActivatedExternalProfile();
    refreshLocalState();
    setSuccess("Activated external wallet profile cleared.");
  }

  async function handleDisconnectWallet() {
    setError(null);
    setSuccess(null);

    try {
      await endWalletSession().catch(() => undefined);
      clearActivatedExternalProfile();
      await disconnectAsync();
      window.location.assign("/");
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Wallet could not be disconnected.",
      );
    }
  }

  async function handleSignOutAll() {
    setIsSigningOut(true);
    setError(null);
    setSuccess(null);

    try {
      await endWalletSession().catch(() => undefined);
      clearCircleSession({ clearDevice: true });
      clearActivatedExternalProfile();
      await disconnectAsync().catch(() => undefined);
      refreshLocalState();
      setWalletSession({ authenticated: false });
      window.location.assign("/");
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Sessions could not be cleared.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  const content = (
    <>
      {isLoading ? (
        <div className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sessions...
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <SessionRow
            detail={deviceInfo.summary}
            label="This device"
            status="Current browser"
            statusTone="positive"
          />

          <SessionRow
            detail={
              circleDeviceId
                ? `Circle device ${shortenCircleAddress(circleDeviceId, "Registered")}`
                : "No Circle device credentials stored in this browser tab"
            }
            label="Device registration"
            status={circleDeviceId ? "Registered" : "Not registered"}
            statusTone={circleDeviceId ? "positive" : "neutral"}
          />

          <SessionRow
            detail={
              hasPlatformAccess
                ? activeMode === "circle"
                  ? "Signed in with Google and Circle wallet"
                  : "External wallet profile activated"
                : "Connect a wallet or sign in with Google to use SaphraONE"
            }
            label="Platform access"
            status={hasPlatformAccess ? "Active" : "Inactive"}
            statusTone={hasPlatformAccess ? "positive" : "warning"}
          />

          <SessionRow
            action={
              circleLogin ? (
                <Button
                  disabled={isSigningOut}
                  onClick={() => void handleCircleSignOut()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isSigningOut ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4" />
                  )}
                  Sign out Google
                </Button>
              ) : undefined
            }
            detail={
              circleLogin
                ? [
                    circleIdentity.email ?? circleIdentity.name ?? "Google account",
                    circleWalletAddress
                      ? shortenCircleAddress(circleWalletAddress)
                      : circleWallets[0]?.id
                        ? "Circle wallet loading"
                        : "No Circle wallet loaded",
                  ].join(" · ")
                : "No active Circle session in this browser tab"
            }
            label="Circle session"
            status={circleLogin ? "Active" : "Signed out"}
            statusTone={circleLogin ? "positive" : "neutral"}
          />

          <SessionRow
            action={
              <div className="flex flex-wrap gap-2">
                {normalizedActivatedProfile ? (
                  <Button
                    onClick={() => void handleClearExternalProfile()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Clear activated profile
                  </Button>
                ) : null}
                {isConnected ? (
                  <Button
                    onClick={() => void handleDisconnectWallet()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Disconnect wallet
                  </Button>
                ) : null}
              </div>
            }
            detail={
              isConnected
                ? `${shortenAddress(connectedAddress)}${
                    connector?.name ? ` via ${connector.name}` : ""
                  }`
                : normalizedActivatedProfile
                  ? `${shortenCircleAddress(normalizedActivatedProfile)} saved as activated profile`
                  : "No external wallet connected"
            }
            label="External wallet"
            status={
              externalProfileMatchesWallet
                ? "Active profile"
                : isConnected
                  ? "Connected"
                  : normalizedActivatedProfile
                    ? "Saved profile"
                    : "Disconnected"
            }
            statusTone={
              externalProfileMatchesWallet || isConnected ? "positive" : "neutral"
            }
          />

          {!externalProfileMatchesWallet &&
          normalizedActivatedProfile &&
          normalizedConnectedAddress ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                The connected wallet does not match the activated external profile.
                Switch wallets or re-activate the current address from Home.
              </p>
            </div>
          ) : null}

          <SessionRow
            action={
              <div className="flex flex-wrap gap-2">
                {walletSession?.authenticated ? (
                  <Button
                    disabled={isWalletActionPending}
                    onClick={() => void handleEndWalletSession()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isWalletActionPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="h-4 w-4" />
                    )}
                    End wallet session
                  </Button>
                ) : isConnected ? (
                  <Button
                    disabled={isWalletActionPending || isSigningIn}
                    onClick={() => void handleWalletSignIn()}
                    size="sm"
                    type="button"
                  >
                    {isWalletActionPending || isSigningIn ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    Start wallet session
                  </Button>
                ) : null}
              </div>
            }
            detail={
              walletSession?.authenticated
                ? [
                    shortenCircleAddress(walletSession.ownerWallet),
                    walletSession.connectorName
                      ? `via ${walletSession.connectorName}`
                      : null,
                    `expires ${formatExpiry(walletSession.expiresAt)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Sign a message to unlock server-side wallet features such as beneficiaries"
            }
            label="Server wallet session"
            status={
              walletSessionMatchesWallet
                ? "Authenticated"
                : walletSession?.authenticated
                  ? "Mismatch"
                  : "Not signed in"
            }
            statusTone={
              walletSessionMatchesWallet
                ? "positive"
                : walletSession?.authenticated
                  ? "warning"
                  : "neutral"
            }
          />

          {!walletSessionMatchesWallet &&
          walletSession?.authenticated &&
          normalizedConnectedAddress ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                The server wallet session belongs to a different address than the
                wallet currently connected in this browser.
              </p>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-background px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Sign out everywhere on this device
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Clears Circle, external profile, wallet session, and disconnects
                  your browser wallet in this tab.
                </p>
              </div>
              <Button
                disabled={isSigningOut}
                onClick={() => void handleSignOutAll()}
                type="button"
                variant="destructive"
              >
                {isSigningOut ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                Sign out all
              </Button>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {success ? (
            <p className="inline-flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {success}
            </p>
          ) : null}
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div>{content}</div>;
  }

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-4 shadow-sm sm:px-5 sm:py-5">
      <div className="flex items-start gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          <MonitorSmartphone className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Sessions & devices</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Review what is active in this browser, manage wallet sessions, and sign
            out when you are done on a shared device.
          </p>
          {content}
        </div>
      </div>
    </section>
  );
}

function shortenAddress(value: string) {
  if (!value) {
    return "Not connected";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}