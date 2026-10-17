/**
 * Where to go after signing in. A protected page the visitor was sent away
 * from comes back as `?next=` (see proxy.ts); it is remembered in
 * sessionStorage so it survives the Google sign-in round trip, and honoured
 * only for an account that is already set up (new accounts onboard first).
 */

const storageKey = "saphra:sign-in-next";

/**
 * `value` if it is a same-site path, else null. Rejects anything a browser
 * could read as another origin: `//host`, `/\host`, schemes, and `..`.
 */
export function readSafeNextPath(value: unknown) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.length > 2048) return null;
  if (path.startsWith("//") || path.includes("\\")) return null;
  // No control characters (a tab or newline inside "//" still reads as a host).
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  const pathname = path.split(/[?#]/)[0];
  if (/(^|\/)\.\.?(\/|$)/.test(pathname)) return null;
  if (/%2e|%2f|%5c/i.test(pathname)) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(pathname)) return null;
  // Sending someone back to the landing page (or sign-in) is not a destination.
  if (pathname === "/" || pathname === "/sign-in") return null;
  return path;
}

/** Saves `?next=` from the current URL, if it is safe. */
export function rememberNextPath() {
  if (typeof window === "undefined") return;
  rememberNextPathValue(new URLSearchParams(window.location.search).get("next"));
}

/** Saves `path` as where to land after signing in, if it is safe. */
export function rememberNextPathValue(path: unknown) {
  if (typeof window === "undefined") return;
  const next = readSafeNextPath(path);
  if (!next) return;
  try {
    window.sessionStorage.setItem(storageKey, next);
  } catch {
    // Private mode: the URL still carries it until the modal closes.
  }
}

/** The remembered destination (or the URL's), left in place. */
export function peekNextPath() {
  if (typeof window === "undefined") return null;
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(storageKey);
  } catch {
    stored = null;
  }
  return (
    readSafeNextPath(stored) ??
    readSafeNextPath(new URLSearchParams(window.location.search).get("next"))
  );
}

/** The remembered destination (or the URL's), cleared once read. */
export function consumeNextPath() {
  if (typeof window === "undefined") return null;
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(storageKey);
    window.sessionStorage.removeItem(storageKey);
  } catch {
    stored = null;
  }
  return (
    readSafeNextPath(stored) ??
    readSafeNextPath(new URLSearchParams(window.location.search).get("next"))
  );
}

export function resolveSignInDestination(input: {
  accountTypeSelected: boolean;
  isBusiness: boolean;
  next?: string | null;
}) {
  if (!input.accountTypeSelected) return "/onboarding";
  const next = readSafeNextPath(input.next);
  if (next) return next;
  return input.isBusiness ? "/business" : "/dashboard";
}
