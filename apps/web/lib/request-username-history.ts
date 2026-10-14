import { arcNetworkTarget } from "@/lib/network";

/**
 * Recently requested usernames, kept per network and per signed-in wallet:
 * one account must never see another's history, and testnet names must not
 * appear on mainnet.
 */
function historyStorageKey(owner: string) {
  return `saphra.request.username-history.v2:${arcNetworkTarget()}:${owner.toLowerCase()}`;
}
const maxHistory = 8;

function normalizeStoredUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "").replace(/\.one$/i, "").replace(/\s/g, "");
}

export function readRequestUsernameHistory(owner: string | null | undefined): string[] {
  if (typeof window === "undefined" || !owner) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(historyStorageKey(owner));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set<string>();
    const usernames: string[] = [];

    for (const item of parsed) {
      if (typeof item !== "string") {
        continue;
      }

      const username = normalizeStoredUsername(item);
      if (!username || seen.has(username)) {
        continue;
      }

      seen.add(username);
      usernames.push(username);
    }

    return usernames.slice(0, maxHistory);
  } catch {
    return [];
  }
}

export function rememberRequestedUsername(
  owner: string | null | undefined,
  username: string,
): string[] {
  const normalized = normalizeStoredUsername(username);
  if (!owner || !normalized) {
    return readRequestUsernameHistory(owner);
  }

  const next = [
    normalized,
    ...readRequestUsernameHistory(owner).filter((item) => item !== normalized),
  ].slice(0, maxHistory);

  try {
    window.localStorage.setItem(historyStorageKey(owner), JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }

  return next;
}
