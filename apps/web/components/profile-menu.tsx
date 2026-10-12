"use client";

import {
  ChevronDown,
  CheckCircle2,
  Copy,
  LogOut,
  UserCircle,
  Wallet,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { personalCircleWallet } from "@/lib/business/provision-wallet";
import {
  callCircleWalletApi,
  circleSessionEventName,
  clearCircleSession,
  getCircleLoginIdentity,
  readCircleWallets,
  readCircleLogin,
  shortenCircleAddress,
  type CircleLoginResult,
  type CircleWallet,
  writeCircleWallets,
} from "@/lib/circle-session";
import {
  clearActivatedExternalProfile,
  markPlatformProfileConnected,
  platformAccessEventName,
  readActivatedExternalProfile,
  writeActivatedExternalProfile,
} from "@/lib/platform-access";
import {
  ensureProfile,
  fetchProfile,
  readCachedProfile,
  formatUsernameLabel,
  profileUpdatedEventName,
  type ProfileRecord,
} from "@/lib/profile";
import { useDisconnect } from "wagmi";
import { endWalletSession } from "@/lib/wallet-auth-client";
import { useOptionalAccount } from "@/components/account/account-provider";
import { useT } from "@/components/locale-provider";
import { resolvePlatformWalletMode } from "@/lib/wallet-mode";

import "./profile-menu.css";

export type WalletMode = "circle" | "external";

type ProfileMenuProps = {
  circleLogin?: CircleLoginResult | null;
  circleWalletAddress?: string;
  externalAddress?: string;
  externalWalletAction?: ReactNode;
  onCircleSessionCleared?: () => void;
  onWalletModeChange?: (mode: WalletMode) => void;
  walletMode?: WalletMode;
};

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

function getProfileInitials(value?: string | null) {
  const normalized = value?.replace(/^@+/, "").replace(/[_-]+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function ProfileAvatar({
  avatarUrl,
  fallbackLabel,
  size = "md",
}: {
  avatarUrl?: string | null;
  fallbackLabel?: string | null;
  size?: "lg" | "md";
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = getProfileInitials(fallbackLabel);
  const sizeClass = size === "lg" ? "h-12 w-12" : "h-7 w-7";

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  return (
    <span
      className={`profile-avatar inline-flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-black`}
    >
      {avatarUrl && !imageFailed ? (
        <img
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
          src={avatarUrl}
        />
      ) : initials ? (
        <span>{initials}</span>
      ) : (
        <UserCircle className={size === "lg" ? "h-6 w-6" : "h-4 w-4"} />
      )}
    </span>
  );
}

export function ProfileMenu({
  circleLogin,
  circleWalletAddress,
  externalAddress,
  externalWalletAction,
  onCircleSessionCleared,
  onWalletModeChange,
  walletMode,
}: ProfileMenuProps) {
  const t = useT();

  const { disconnect } = useDisconnect();
  const accountContext = useOptionalAccount();
  const isBusinessAccount = accountContext?.isBusiness ?? false;
  const businessProfile = accountContext?.profile ?? null;
  const accountRecord = accountContext?.account ?? null;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [storedLogin, setStoredLogin] = useState<CircleLoginResult | null>(
    null,
  );
  const [activatedExternalProfile, setActivatedExternalProfile] = useState("");
  const [loadedCircleWalletAddress, setLoadedCircleWalletAddress] =
    useState("");
  const [copiedUsername, setCopiedUsername] = useState(false);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const activeLogin = circleLogin === undefined ? storedLogin : circleLogin;
  const identity = getCircleLoginIdentity(activeLogin);
  const resolvedCircleWalletAddress =
    circleWalletAddress ?? loadedCircleWalletAddress;
  const activeMode =
    walletMode ??
    resolvePlatformWalletMode();
  const activeAddress =
    activeMode === "circle" ? resolvedCircleWalletAddress : externalAddress;
  const normalizedExternalAddress = externalAddress?.toLowerCase() ?? "";
  const isActivatedExternalWallet = Boolean(
    normalizedExternalAddress &&
      activatedExternalProfile === normalizedExternalAddress,
  );
  const isCurrentExternalWallet = Boolean(
    externalAddress && activeMode === "external",
  );
  const googleLabel = useMemo(() => {
    if (!activeLogin) {
      return "No Google account connected";
    }

    return identity.email ?? identity.name ?? "Google account connected";
  }, [activeLogin, identity.email, identity.name]);
  const buttonLabel = isBusinessAccount
    ? businessProfile?.business_name ||
      (accountRecord?.username ? `@${accountRecord.username}` : "Business")
    : profile?.display_name
    ? profile.display_name
    : profile?.username
    ? `@${profile.username}`
    : isCurrentExternalWallet && activeAddress
      ? shortenCircleAddress(activeAddress)
      : identity.email ??
        identity.name ??
        (activeAddress
          ? shortenCircleAddress(activeAddress)
          : externalAddress
            ? shortenCircleAddress(externalAddress)
            : "Account");
  const profileProviderLabel = activeLogin
    ? identity.provider === "EmailOtp"
      ? "Email"
      : identity.provider
    : externalAddress
      ? t("profile.externalWallet")
      : "Google";
  const profilePrimaryLabel = isBusinessAccount
    ? businessProfile?.business_name || accountRecord?.username || "Business"
    : profile?.display_name || profile?.username
    ? profile?.display_name || `@${profile?.username}`
    : activeLogin
      ? googleLabel
      : externalAddress
        ? isActivatedExternalWallet
          ? t("profile.walletProfileActive")
          : t("profile.walletConnected")
        : googleLabel;
  const profileSecondaryLabel = isBusinessAccount
    ? accountRecord?.username
      ? `@${accountRecord.username}`
      : t("profile.businessAccount")
    : profile?.username
    ? profile.display_name
      ? `@${profile.username}`
      : activeLogin
      ? (identity.email ?? identity.name ?? "")
      : externalAddress
        ? shortenCircleAddress(externalAddress)
        : activeAddress
          ? shortenCircleAddress(activeAddress)
          : ""
    : activeLogin && identity.name && identity.email
      ? identity.name
      : externalAddress
        ? shortenCircleAddress(externalAddress)
        : "";
  const shouldShowExternalWalletAction = Boolean(
    externalAddress &&
      onWalletModeChange &&
      (!isActivatedExternalWallet || activeMode !== "external"),
  );
  const externalWalletActionLabel =
    activeMode === "external"
      ? t("profile.continueWithWallet")
      : t("profile.switchToWallet");

  useEffect(() => {
    function refreshStoredLogin() {
      const login = readCircleLogin();

      if (login) {
        markPlatformProfileConnected();
      }

      setStoredLogin(login);
    }

    refreshStoredLogin();
    window.addEventListener(circleSessionEventName, refreshStoredLogin);
    window.addEventListener("storage", refreshStoredLogin);

    return () => {
      window.removeEventListener(circleSessionEventName, refreshStoredLogin);
      window.removeEventListener("storage", refreshStoredLogin);
    };
  }, []);

  useEffect(() => {
    function refreshActivatedExternalProfile() {
      setActivatedExternalProfile(readActivatedExternalProfile());
    }

    refreshActivatedExternalProfile();
    window.addEventListener(
      platformAccessEventName,
      refreshActivatedExternalProfile,
    );
    window.addEventListener("storage", refreshActivatedExternalProfile);

    return () => {
      window.removeEventListener(
        platformAccessEventName,
        refreshActivatedExternalProfile,
      );
      window.removeEventListener("storage", refreshActivatedExternalProfile);
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCircleWalletAddress() {
      if (!activeLogin?.userToken || circleWalletAddress !== undefined) {
        setLoadedCircleWalletAddress("");
        return;
      }

      const cachedWallets = readCircleWallets();
      const cachedWalletAddress =
        personalCircleWallet(cachedWallets)?.address ?? "";

      if (cachedWalletAddress) {
        setLoadedCircleWalletAddress(cachedWalletAddress);
      }

      try {
        const payload = await callCircleWalletApi<{ wallets?: CircleWallet[] }>(
          "listWallets",
          {
            userToken: activeLogin.userToken,
          },
        );
        const wallets = payload.wallets ?? [];
        const walletAddress = personalCircleWallet(wallets)?.address ?? "";

        if (!cancelled) {
          setLoadedCircleWalletAddress(walletAddress);
          writeCircleWallets(wallets);
        }
      } catch {
        if (!cancelled && !cachedWalletAddress) {
          setLoadedCircleWalletAddress("");
        }
      }
    }

    void loadCircleWalletAddress();

    return () => {
      cancelled = true;
    };
  }, [activeLogin?.userToken, circleWalletAddress]);

  useEffect(() => {
    let cancelled = false;
    const walletAddress =
      activeMode === "circle"
        ? resolvedCircleWalletAddress
        : isActivatedExternalWallet
          ? normalizedExternalAddress
          : "";

    async function loadProfile() {
      if (!walletAddress) {
        if (!cancelled) {
          setProfile(null);
        }
        return;
      }

      // The last known profile first, so the picture is there at once.
      const cached = readCachedProfile(walletAddress);
      if (cached && !cancelled) setProfile(cached);

      try {
        let nextProfile = await fetchProfile(walletAddress);

        if (!nextProfile) {
          nextProfile = await ensureProfile({
            authProvider: activeLogin ? "google" : "external",
            circleSocialUuid: identity.socialUserUUID,
            displayName: identity.name,
            walletAddress,
          });
        }

        if (!cancelled) {
          setProfile(nextProfile);
        }
      } catch {
        if (!cancelled) {
          setProfile(cached);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [
    activeLogin,
    activeMode,
    identity.name,
    identity.socialUserUUID,
    isActivatedExternalWallet,
    normalizedExternalAddress,
    resolvedCircleWalletAddress,
  ]);

  useEffect(() => {
    function handleProfileUpdated(event: Event) {
      const customEvent = event as CustomEvent<ProfileRecord>;
      const updatedProfile = customEvent.detail;
      const walletAddress =
        activeMode === "circle"
          ? resolvedCircleWalletAddress?.toLowerCase()
          : normalizedExternalAddress;

      if (
        updatedProfile?.wallet_address?.toLowerCase() === walletAddress
      ) {
        setProfile(updatedProfile);
      }
    }

    window.addEventListener(profileUpdatedEventName, handleProfileUpdated);

    return () => {
      window.removeEventListener(
        profileUpdatedEventName,
        handleProfileUpdated,
      );
    };
  }, [
    activeMode,
    normalizedExternalAddress,
    resolvedCircleWalletAddress,
  ]);

  function handleSignOut() {
    clearCircleSession({ clearDevice: true });
    clearActivatedExternalProfile();
    try {
      window.localStorage.removeItem("saphra.activeWorkspaceId");
      window.localStorage.removeItem("saphra.preferredWalletMode");
    } catch {}
    void endWalletSession().catch(() => undefined);
    try {
      disconnect();
    } catch {}
    setOpen(false);
    setStoredLogin(null);
    setLoadedCircleWalletAddress("");
    setProfile(null);
    onCircleSessionCleared?.();
    window.location.assign("/");
  }

  function selectExternalWallet() {
    if (externalAddress) {
      writeActivatedExternalProfile(externalAddress);
      void ensureProfile({
        authProvider: "external",
        walletAddress: externalAddress,
      }).catch(() => undefined);
    }

    onWalletModeChange?.("external");
    setOpen(false);
  }

  async function copyUsername(username: string) {
    if (typeof navigator === "undefined") {
      return;
    }

    try {
      await navigator.clipboard.writeText(formatUsernameLabel(username));
      setCopiedUsername(true);
      window.setTimeout(() => setCopiedUsername(false), 1600);
    } catch {
      setCopiedUsername(false);
    }
  }

  // The copy button sits on whichever line shows the @username: the second
  // line when a display name sits above it, otherwise the first.
  // A business shows its name first and the @username under it.
  const menuUsername = isBusinessAccount ? accountRecord?.username || profile?.username : profile?.username;
  const usernameOnSecondLine = Boolean(
    isBusinessAccount
      ? accountRecord?.username && businessProfile?.business_name
      : profile?.username && profile.display_name,
  );
  const copyUsernameButton = menuUsername ? (
    <button
      aria-label={t("profile.copyUsername")}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:border-primary/30 hover:text-primary"
      onClick={() => void copyUsername(menuUsername)}
      type="button"
    >
      {copiedUsername ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  ) : null;

  return (
    <div className="relative z-[90] shrink-0" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="profile-trigger inline-flex h-11 max-w-[13rem] items-center justify-center gap-2 px-3 text-sm sm:px-4"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ProfileAvatar
          avatarUrl={
            isBusinessAccount
              ? businessProfile?.logo_url
              : profile?.avatar_url
          }
          fallbackLabel={
            isBusinessAccount
              ? businessProfile?.business_name
              : profile?.username ?? profilePrimaryLabel
          }
        />
        <span className="profile-trigger-name hidden min-w-0 truncate sm:inline">
          {buttonLabel}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>

      {open ? (
        <div
          className="fixed left-2 right-2 top-20 z-[120] max-h-[calc(100vh-6rem)] w-auto overflow-y-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg sm:left-auto sm:right-4 sm:w-[min(22rem,calc(100vw-2rem))]"
          role="menu"
        >
          <div className="rounded-lg border border-border bg-muted px-3 py-3">
            <div className="flex items-start gap-3">
              <ProfileAvatar
                avatarUrl={
                  isBusinessAccount
                    ? businessProfile?.logo_url
                    : profile?.avatar_url
                }
                fallbackLabel={
                  isBusinessAccount
                    ? businessProfile?.business_name
                    : profile?.username ?? profilePrimaryLabel
                }
                size="lg"
              />
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-muted">
                  {profileProviderLabel}
                </p>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-bold text-foreground">
                    {profilePrimaryLabel}
                  </p>
                  {!usernameOnSecondLine ? copyUsernameButton : null}
                </div>
                {profileSecondaryLabel ? (
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <p className="truncate text-xs font-semibold text-muted">
                      {profileSecondaryLabel}
                    </p>
                    {usernameOnSecondLine ? copyUsernameButton : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-sm">
            {/* Phones: the top bar has no room for the theme switch, so it lives here. */}
            <div className="profile-theme-row flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 sm:hidden">
              <span className="font-semibold text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
            {!activeLogin ? (
              <div className="rounded-lg border border-border px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-muted-foreground">
                    External wallet
                  </span>
                  <span className="font-mono text-xs font-bold text-foreground">
                    {shortenCircleAddress(externalAddress)}
                  </span>
                </div>
                {shouldShowExternalWalletAction ? (
                  <button
                    className="sp-bubble mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-swift-600 px-3 text-sm font-bold text-white shadow-[0_10px_24px_rgba(66,17,143,0.18)] transition hover:-translate-y-0.5 hover:bg-swift-700 active:translate-y-0"
                    onClick={selectExternalWallet}
                    type="button"
                  >
                    <Wallet className="h-4 w-4" />
                    {externalWalletActionLabel}
                  </button>
                ) : externalAddress ? (
                  <div className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    External wallet active
                  </div>
                ) : null}
                {externalWalletAction ? (
                  <div className="mt-3">{externalWalletAction}</div>
                ) : (
                  <Link
                    className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 active:translate-y-0"
                    href="/dashboard"
                  >
                    <Wallet className="h-4 w-4" />
                    Open wallet options
                  </Link>
                )}
              </div>
            ) : null}
          </div>

          <div className="mt-3 grid gap-2">
            {activeLogin ? (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 text-sm font-semibold text-rose-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-500/15 active:translate-y-0 dark:text-rose-400"
                onClick={handleSignOut}
                type="button"
              >
                <LogOut className="h-4 w-4" />
                {activeLogin.oAuthInfo?.provider === "Email" || activeLogin.oAuthInfo?.provider === "EmailOtp"
                  ? "Sign out"
                  : t("profile.signOutGoogle")}
              </button>
            ) : externalAddress ? (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 text-sm font-semibold text-rose-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-500/15 active:translate-y-0 dark:text-rose-400"
                onClick={handleSignOut}
                type="button"
              >
                <LogOut className="h-4 w-4" />
                Disconnect wallet
              </button>
            ) : (
              <Link
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 active:translate-y-0"
                href="/#google-login"
              >
                <GoogleLogo />
                Google login
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
