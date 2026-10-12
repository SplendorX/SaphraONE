"use client";

import { getAddress, isAddress } from "viem";

import { readCircleLogin } from "@/lib/circle-session";
import {
  normalizeUsername,
  validateUsername,
} from "@/lib/profile-utils";

export {
  buildUsernameCandidate,
  formatUsernameLabel,
  normalizeUsername,
  validateUsername,
} from "@/lib/profile-utils";

export const profileUpdatedEventName = "saphra:profile-updated";

export type ProfileRecord = {
  auth_provider: string;
  avatar_url: string | null;
  bio: string | null;
  circle_social_uuid: string | null;
  created_at: string;
  display_name: string | null;
  updated_at: string;
  username: string;
  wallet_address: string;
};

export type EnsureProfileInput = {
  authProvider?: "email" | "external" | "google";
  circleSocialUuid?: string;
  displayName?: string;
  walletAddress: string;
};

/**
 * The last profile seen per wallet, in memory and in this browser, so a
 * picture shows on the first frame instead of initials first. Always
 * refreshed from the server after; never trusted for anything but display.
 */
const profileCacheKey = "saphra.profileCache";
const profileCacheLimit = 8;
/** Skip storing very large inline pictures; they stay in memory only. */
const maxStoredAvatarLength = 200_000;
const profileMemory = new Map<string, ProfileRecord>();

function readStoredProfiles(): Record<string, ProfileRecord> {
  try {
    const raw = window.localStorage.getItem(profileCacheKey);
    return raw ? (JSON.parse(raw) as Record<string, ProfileRecord>) : {};
  } catch {
    return {};
  }
}

/** The last known profile for a wallet, or null. Synchronous: use it as initial state. */
export function readCachedProfile(walletAddress: string | null | undefined): ProfileRecord | null {
  if (typeof window === "undefined" || !walletAddress) return null;
  const wallet = walletAddress.toLowerCase();
  const cached = profileMemory.get(wallet) ?? readStoredProfiles()[wallet] ?? null;
  if (cached) profileMemory.set(wallet, cached);
  return cached;
}

function writeCachedProfile(walletAddress: string, profile: ProfileRecord | null) {
  if (typeof window === "undefined") return;
  const wallet = walletAddress.toLowerCase();
  if (profile) profileMemory.set(wallet, profile);
  else profileMemory.delete(wallet);
  try {
    const stored = readStoredProfiles();
    delete stored[wallet];
    if (profile && (profile.avatar_url?.length ?? 0) <= maxStoredAvatarLength) {
      stored[wallet] = profile;
    }
    // Newest last; keep only the most recent few.
    const entries = Object.entries(stored).slice(-profileCacheLimit);
    window.localStorage.setItem(profileCacheKey, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
  // Warm the browser's image cache too, so the <img> paints at once.
  if (profile?.avatar_url && !profile.avatar_url.startsWith("data:")) {
    const image = new Image();
    image.src = profile.avatar_url;
  }
}

export function notifyProfileUpdated(profile: Partial<ProfileRecord> & { wallet_address: string }) {
  if (typeof window === "undefined") {
    return;
  }

  const cached = readCachedProfile(profile.wallet_address);
  if (cached) writeCachedProfile(profile.wallet_address, { ...cached, ...profile });

  window.dispatchEvent(
    new CustomEvent(profileUpdatedEventName, { detail: profile }),
  );
}

function normalizeWalletAddress(value: string) {
  if (!isAddress(value)) {
    return null;
  }

  return getAddress(value).toLowerCase();
}

export async function fetchProfile(walletAddress: string) {
  const normalizedWallet = normalizeWalletAddress(walletAddress);

  if (!normalizedWallet) {
    return null;
  }

  const response = await fetch(
    `/api/profile?wallet=${encodeURIComponent(normalizedWallet)}`,
    { cache: "no-store" },
  );

  if (response.status === 404) {
    writeCachedProfile(normalizedWallet, null);
    return null;
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message ?? "Profile could not be loaded.");
  }

  const payload = (await response.json()) as { profile: ProfileRecord };
  writeCachedProfile(normalizedWallet, payload.profile);
  return payload.profile;
}

export async function fetchProfileByUsername(username: string) {
  const normalizedUsername = normalizeUsername(username);
  const validationError = validateUsername(normalizedUsername);

  if (validationError) {
    return null;
  }

  const response = await fetch(
    `/api/profile?username=${encodeURIComponent(normalizedUsername)}`,
    { cache: "no-store" },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message ?? "Profile could not be loaded.");
  }

  const payload = (await response.json()) as { profile: ProfileRecord };
  return payload.profile;
}

export async function ensureProfile(input: EnsureProfileInput) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);

  if (!walletAddress) {
    return null;
  }

  const response = await fetch("/api/profile", {
    body: JSON.stringify({
      authProvider: input.authProvider ?? "external",
      circleSocialUuid: input.circleSocialUuid,
      // Proof of wallet control, required before the server links a Circle
      // identity to this wallet.
      circleUserToken: input.circleSocialUuid
        ? readCircleLogin()?.userToken
        : undefined,
      displayName: input.displayName,
      walletAddress,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message ?? "Profile could not be created.");
  }

  const payload = (await response.json()) as { profile: ProfileRecord };
  return payload.profile;
}

export type ProfileContact = {
  contactEmail: string | null;
  country: string | null;
  phone: string | null;
  /** False until profiles-personal-contact.sql has been run. */
  ready: boolean;
};

/** The owner's private contact details, for Settings. */
export async function fetchProfileContact(walletAddress: string, circleSocialUuid?: string) {
  const params = new URLSearchParams({ wallet: walletAddress });
  if (circleSocialUuid) params.set("circleSocialUuid", circleSocialUuid);
  const response = await fetch(`/api/profile/contact?${params}`, { cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()) as ProfileContact;
}

export async function updateProfileUsername(input: {
  avatarUrl?: string | null;
  bio?: string | null;
  circleSocialUuid?: string;
  /** Personal contact details; omit to leave them unchanged. */
  contactEmail?: string | null;
  country?: string | null;
  phone?: string | null;
  displayName?: string | null;
  username: string;
  walletAddress: string;
}) {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  const username = normalizeUsername(input.username);
  const validationError = validateUsername(username);

  if (!walletAddress) {
    throw new Error("A valid wallet address is required.");
  }

  if (validationError) {
    throw new Error(validationError);
  }

  const response = await fetch("/api/profile", {
    body: JSON.stringify({
      avatarUrl: input.avatarUrl,
      bio: input.bio,
      circleSocialUuid: input.circleSocialUuid,
      contactEmail: input.contactEmail,
      country: input.country,
      displayName: input.displayName,
      phone: input.phone,
      username,
      walletAddress,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message ?? "Username could not be updated.");
  }

  const payload = (await response.json()) as { profile: ProfileRecord };
  notifyProfileUpdated(payload.profile);
  return payload.profile;
}
