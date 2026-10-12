"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { DeletionPendingScreen } from "@/components/account/deletion-pending-screen";
import { useBusinessActor } from "@/components/business/use-business-actor";
import { fetchAccountState } from "@/lib/account/client";
import type { AccountRecord, BusinessAccountProfile } from "@/lib/account/types";
import { profileUpdatedEventName } from "@/lib/profile";
import { walletSessionChangedEventName } from "@/lib/wallet-auth-client";

type AccountContextValue = {
  account: AccountRecord | null;
  circleSocialUuid?: string;
  isBusiness: boolean;
  loading: boolean;
  ownerWallet: string | null;
  profile: BusinessAccountProfile | null;
  refresh: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

/**
 * The last account state seen in this browser, so names, pictures and logos
 * show on the first frame of each page instead of popping in. Display only:
 * it's replaced by the server's answer straight after.
 */
const accountCacheKey = "saphra.accountCache";

type CachedAccount = {
  account: AccountRecord;
  ownerWallet: string;
  profile: BusinessAccountProfile | null;
};

function readCachedAccount(ownerWallet: string): CachedAccount | null {
  try {
    const cached = JSON.parse(window.localStorage.getItem(accountCacheKey) ?? "null") as CachedAccount | null;
    return cached?.ownerWallet === ownerWallet.toLowerCase() ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedAccount(value: CachedAccount | null) {
  try {
    if (!value) {
      window.localStorage.removeItem(accountCacheKey);
      return;
    }
    // Very large inline pictures stay out of storage; the server sends them.
    const tooBig = (url?: string | null) => (url?.length ?? 0) > 200_000;
    if (tooBig(value.account.avatar_url) || tooBig(value.profile?.logo_url)) return;
    window.localStorage.setItem(accountCacheKey, JSON.stringify({ ...value, ownerWallet: value.ownerWallet.toLowerCase() }));
  } catch {}
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { circleSocialUuid, ownerWallet } = useBusinessActor();
  const [account, setAccount] = useState<AccountRecord | null>(null);
  const [profile, setProfile] = useState<BusinessAccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingDeletion, setPendingDeletion] = useState<{ scheduledFor: string } | null>(null);
  /** "Open my wallet to move funds": the app for this visit, with a banner. */
  const [deletionDismissed, setDeletionDismissed] = useState(false);
  const accountRef = useRef<AccountRecord | null>(null);
  accountRef.current = account;

  const refresh = useCallback(async () => {
    if (!ownerWallet) {
      setAccount(null);
      setProfile(null);
      setPendingDeletion(null);
      setLoading(false);
      return;
    }
    if (!accountRef.current) {
      const cached = readCachedAccount(ownerWallet);
      if (cached) {
        setAccount(cached.account);
        setProfile(cached.profile);
      } else {
        setLoading(true);
      }
    }
    try {
      const state = await fetchAccountState(ownerWallet, circleSocialUuid);
      setAccount(state.account);
      setProfile(state.profile);
      writeCachedAccount({ account: state.account, ownerWallet, profile: state.profile });
      setPendingDeletion(state.pendingDeletion ?? null);
    } catch {
      setAccount(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [circleSocialUuid, ownerWallet]);

  useEffect(() => {
    void refresh();

    function onProfileOrSessionChange() {
      void refresh();
    }

    window.addEventListener(profileUpdatedEventName, onProfileOrSessionChange);
    window.addEventListener(
      walletSessionChangedEventName,
      onProfileOrSessionChange,
    );

    return () => {
      window.removeEventListener(
        profileUpdatedEventName,
        onProfileOrSessionChange,
      );
      window.removeEventListener(
        walletSessionChangedEventName,
        onProfileOrSessionChange,
      );
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      account,
      circleSocialUuid,
      isBusiness: account?.account_type === "BUSINESS",
      loading,
      ownerWallet,
      profile,
      refresh,
    }),
    [account, circleSocialUuid, loading, ownerWallet, profile, refresh],
  );

  return (
    <AccountContext.Provider value={value}>
      {children}
      {pendingDeletion && ownerWallet && !deletionDismissed ? (
        <DeletionPendingScreen
          onContinue={() => setDeletionDismissed(true)}
          onRestored={() => {
            setPendingDeletion(null);
            void refresh();
          }}
          ownerWallet={ownerWallet}
          scheduledFor={pendingDeletion.scheduledFor}
        />
      ) : null}
      {pendingDeletion && ownerWallet && deletionDismissed ? (
        <button className="da-banner" onClick={() => setDeletionDismissed(false)} type="button">
          Your account is scheduled for deletion. <span>Restore it</span>
        </button>
      ) : null}
    </AccountContext.Provider>
  );
}

const fallbackAccountContext: AccountContextValue = {
  account: null,
  circleSocialUuid: undefined,
  isBusiness: false,
  loading: false,
  ownerWallet: null,
  profile: null,
  refresh: async () => {},
};

export function useAccountContext() {
  const value = useContext(AccountContext);
  return value ?? fallbackAccountContext;
}

export function useOptionalAccount() {
  return useContext(AccountContext);
}
