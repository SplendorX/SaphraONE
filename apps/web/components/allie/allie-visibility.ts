/**
 * Routes that render their own ALLIE surface, or that a signed-out visitor
 * can reach. The launcher stays out of both, and its code isn't even loaded
 * there (components/allie/allie-launcher-slot.tsx).
 */
const hiddenExactPaths = new Set(["/", "/onboarding", "/roadmap", "/sign-in"]);
const hiddenPathPrefixes = ["/invoice/", "/u/", "/r/", "/admin"];

export function isAllieHiddenPath(pathname: string) {
  if (hiddenExactPaths.has(pathname)) {
    return true;
  }

  return hiddenPathPrefixes.some((prefix) => pathname.startsWith(prefix));
}
