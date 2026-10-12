"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const lastPathKey = "saphra.lastPath";
const previousPathKey = "saphra.previousPath";

/** Pages a back button never returns to: signing in again isn't "back". */
const neverBackTo = /^\/(?:sign-in|onboarding)(?:\/|$)/;

/**
 * Remembers the page this tab is on, so a page can tell whether it was
 * reached from inside SaphraONE or opened fresh (say, from a phone camera).
 *
 * It also makes every page's back button go back: a link labelled "Back…"
 * (or marked data-back) returns to the page this tab came from, like the
 * phone's own back. Its href is only the fallback, for a page opened fresh.
 * Before this, back links pointed at /dashboard, which sends a business
 * account to Overview wherever it came from. data-no-history-back opts out.
 */
export function InAppNavigationTracker() {
  const pathname = usePathname();

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.(
        'a[aria-label^="Back"], a[data-back]',
      ) as HTMLAnchorElement | null;
      if (!link || link.hasAttribute("data-no-history-back") || link.target === "_blank") return;
      const previous = readPreviousInAppPath(window.location.pathname);
      if (!previous || neverBackTo.test(previous)) return;
      event.preventDefault();
      window.history.back();
    }
    // Capture: runs before Next's <Link> handler, which then stands down.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    try {
      const storage = window.sessionStorage;
      const last = storage.getItem(lastPathKey);
      // A reload keeps where this page was entered from.
      if (last === pathname) return;
      if (last) storage.setItem(previousPathKey, last);
      else storage.removeItem(previousPathKey);
      storage.setItem(lastPathKey, pathname);
    } catch {}
  }, [pathname]);
  return null;
}

/**
 * The SaphraONE page this tab was on before `pathname`, or null when the tab
 * opened straight onto it. Works before or after the tracker has run.
 */
export function readPreviousInAppPath(pathname: string) {
  try {
    const storage = window.sessionStorage;
    const last = storage.getItem(lastPathKey);
    if (!last) return null;
    if (last !== pathname) return last;
    return storage.getItem(previousPathKey);
  } catch {
    return null;
  }
}
