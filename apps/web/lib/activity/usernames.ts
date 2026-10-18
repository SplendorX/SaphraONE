"use client";

import { useEffect, useState } from "react";

// Shared across the dashboard so the feed and the receipt resolve each wallet once.
const cache = new Map<string, string | null>();
/** ALLIE Agent Wallets met in lookups, by address: who owns each. */
const agentOwnerCache = new Map<string, { owner: string; username: string | null }>();
const listeners = new Set<() => void>();

async function resolve(wallets: string[]) {
  const pending = wallets.filter((wallet) => !cache.has(wallet));
  if (pending.length === 0) return;
  // Mark as in flight so concurrent callers do not refetch.
  pending.forEach((wallet) => cache.set(wallet, null));

  try {
    const response = await fetch("/api/search/wallets", {
      body: JSON.stringify({ wallets: pending }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error("lookup failed");
    const { agentOwners, usernames } = (await response.json()) as {
      agentOwners?: Record<string, { owner: string; username: string | null }>;
      usernames?: Record<string, string>;
    };
    Object.entries(usernames ?? {}).forEach(([wallet, username]) =>
      cache.set(wallet.toLowerCase(), username),
    );
    Object.entries(agentOwners ?? {}).forEach(([wallet, owner]) =>
      agentOwnerCache.set(wallet.toLowerCase(), owner),
    );
    listeners.forEach((listener) => listener());
  } catch {
    // Allow a later render to retry.
    pending.forEach((wallet) => cache.delete(wallet));
  }
}

/**
 * "@owner via ALLIE" when this wallet is someone's ALLIE Agent Wallet, for
 * money it sent. Resolved by the same lookup as useWalletUsernames, so call
 * it from a component that passed this wallet to that hook.
 */
export function allieSenderLabel(wallet?: string | null) {
  const agent = wallet ? agentOwnerCache.get(wallet.toLowerCase()) : undefined;
  if (!agent) return null;
  const owner = agent.username
    ? `${agent.username}.one`
    : `${agent.owner.slice(0, 6)}…${agent.owner.slice(-4)}`;
  return `${owner} via ALLIE`;
}

/**
 * Whether `wallet` is `owner`'s own ALLIE Agent Wallet: money moved to it is
 * a deposit to ALLIE, money back from it a withdrawal. Resolved by the same
 * lookup as useWalletUsernames, so call it from a component that passed this
 * wallet to that hook.
 */
export function isOwnAgentWallet(wallet?: string | null, owner?: string | null) {
  if (!wallet || !owner) return false;
  return agentOwnerCache.get(wallet.toLowerCase())?.owner.toLowerCase() === owner.toLowerCase();
}

/**
 * Public SaphraONE @usernames for the given wallets. Wallets without an
 * account (or not yet resolved) are absent, so callers fall back to the
 * address.
 */
export function useWalletUsernames(wallets: Array<string | null | undefined>) {
  const [, setVersion] = useState(0);
  const key = [
    ...new Set(
      wallets
        .filter((wallet): wallet is string => Boolean(wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet)))
        .map((wallet) => wallet.toLowerCase()),
    ),
  ]
    .sort()
    .join(",");

  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    // The endpoint caps a lookup at 100 wallets.
    for (let index = 0; index < list.length; index += 100) {
      void resolve(list.slice(index, index + 100));
    }
  }, [key]);

  return (wallet?: string | null) =>
    wallet ? cache.get(wallet.toLowerCase()) ?? null : null;
}
