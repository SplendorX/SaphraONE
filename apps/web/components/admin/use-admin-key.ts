"use client";

import { useCallback, useEffect, useState } from "react";

const storageKey = "saphra.admin-key";

/**
 * The admin key typed into an admin page, kept for this browser tab only
 * (sessionStorage), so a reload or another admin page doesn't ask again.
 * `ready` turns true once the stored key has been read, so pages load with it
 * rather than without it.
 */
export function useAdminKey() {
  const [key, setKeyState] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setKeyState(window.sessionStorage.getItem(storageKey) ?? "");
    } catch {
      // Storage blocked: the key just isn't remembered.
    }
    setReady(true);
  }, []);

  const setKey = useCallback((next: string) => {
    setKeyState(next);
    try {
      if (next) window.sessionStorage.setItem(storageKey, next);
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      // Storage blocked: the key just isn't remembered.
    }
  }, []);

  return { key, ready, setKey };
}

/** The message for a failed admin load: a missing or wrong key says so plainly. */
export function adminLoadError(status: number, hasKey: boolean, fallback: string) {
  if (status === 401) {
    return hasKey ? "The owner key wasn't accepted. Sign out and sign in again." : "Sign in to the admin platform again.";
  }
  if (status === 403) return "You don't have access to this tool.";
  return fallback;
}
