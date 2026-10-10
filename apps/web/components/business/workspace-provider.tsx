"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useBusinessActor } from "@/components/business/use-business-actor";
import {
  fetchOnboardingState,
  switchWorkspaceClient,
} from "@/lib/business/client";
import type {
  WorkspaceInvitationRecord,
  WorkspaceSummary,
} from "@/lib/business/types";
import type { OnboardingProfile } from "@/lib/business/service";
import { applyAppLocale } from "@/lib/locales";
import { profileUpdatedEventName } from "@/lib/profile";
import { walletSessionChangedEventName } from "@/lib/wallet-auth-client";
import { useOptionalAccount } from "@/components/account/account-provider";

const storageKey = "saphra.activeWorkspaceId";

type WorkspaceContextValue = {
  actorReady: boolean;
  circleSocialUuid?: string;
  invitations: WorkspaceInvitationRecord[];
  loading: boolean;
  ownerWallet: string | null;
  profile: OnboardingProfile | null;
  refresh: () => Promise<void>;
  setWorkspace: (workspaceId: string) => Promise<void>;
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { circleSocialUuid, ownerWallet } = useBusinessActor();
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitationRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!ownerWallet) {
      setProfile(null);
      setWorkspaces([]);
      setInvitations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const state = await fetchOnboardingState(ownerWallet, circleSocialUuid);
      setProfile(state.profile);
      setWorkspaces(state.workspaces);
      setInvitations(state.invitations);

      if (state.profile?.locale) {
        applyAppLocale(state.profile.locale);
      }

      const validWorkspaceIds = new Set(state.workspaces.map((item) => item.id));
      const stored =
        typeof window === "undefined" ? null : localStorage.getItem(storageKey);
      const validStored = stored && validWorkspaceIds.has(stored) ? stored : null;
      const validDefault =
        state.profile?.default_workspace_id &&
        validWorkspaceIds.has(state.profile.default_workspace_id)
          ? state.profile.default_workspace_id
          : null;
      const nextId = validStored ?? validDefault ?? state.workspaces[0]?.id ?? null;
      setWorkspaceId(nextId);
      if (typeof window !== "undefined") {
        if (nextId) {
          localStorage.setItem(storageKey, nextId);
        } else {
          localStorage.removeItem(storageKey);
        }
      }
    } catch {
      setProfile(null);
      setWorkspaces([]);
      setInvitations([]);
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

  const setWorkspace = useCallback(
    async (nextId: string) => {
      if (!ownerWallet) return;
      const next = await switchWorkspaceClient(
        ownerWallet,
        nextId,
        circleSocialUuid,
      );
      localStorage.setItem(storageKey, next.workspace.id);
      setWorkspaceId(next.workspace.id);
      setWorkspaces((current) => {
        if (current.some((item) => item.id === next.workspace.id)) {
          return current.map((item) =>
            item.id === next.workspace.id ? next.workspace : item,
          );
        }
        return [...current, next.workspace];
      });
    },
    [circleSocialUuid, ownerWallet],
  );

  const workspace =
    workspaces.find((item) => item.id === workspaceId) ?? workspaces[0] ?? null;

  const value = useMemo(
    () => ({
      actorReady: Boolean(ownerWallet),
      circleSocialUuid,
      invitations,
      loading,
      ownerWallet,
      profile,
      refresh,
      setWorkspace,
      workspace,
      workspaces,
    }),
    [
      circleSocialUuid,
      invitations,
      loading,
      ownerWallet,
      profile,
      refresh,
      setWorkspace,
      workspace,
      workspaces,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}

const fallbackWorkspaceContext: WorkspaceContextValue = {
  actorReady: false,
  circleSocialUuid: undefined,
  invitations: [],
  loading: false,
  ownerWallet: null,
  profile: null,
  refresh: async () => {},
  setWorkspace: async () => {},
  workspace: null,
  workspaces: [],
};

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  return value ?? fallbackWorkspaceContext;
}

export function useOptionalWorkspace() {
  return useContext(WorkspaceContext);
}

export function OnboardingRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  const context = useOptionalWorkspace();
  const accountContext = useOptionalAccount();

  useEffect(() => {
    if (!context || !context.ownerWallet) return;
    if (pathname.startsWith("/onboarding")) return;
    if (context.loading || accountContext?.loading) return;

    const accountSelected = accountContext?.account?.account_type_selected;
    const workspaceSelected = context.profile?.account_type_selected;

    // If either context has confirmed that account onboarding is finished, never redirect to onboarding
    if (accountSelected === true || workspaceSelected === true) {
      return;
    }

    // Only redirect if at least one profile is loaded and confirmed not selected
    if (
      (accountContext?.account && accountSelected === false) ||
      (context.profile && workspaceSelected === false)
    ) {
      router.replace("/onboarding");
    }
  }, [accountContext?.account, accountContext?.loading, context?.loading, context?.ownerWallet, context?.profile, pathname, router]);

  return null;
}
