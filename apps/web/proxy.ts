import "@/lib/env-compat";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { platformAccessCookieName } from "@/lib/platform-access";
import { readWalletToken, walletSessionCookieName } from "@/lib/wallet-session";

const protectedRouteMatchers = [
  "/activity",
  "/insights",
  "/transactions",
  "/dashboard",
  "/notifications",
  "/deposit",
  "/business",
  "/pay",
  "/send",
  "/settings",
  "/swap",
  "/bulkpay",
  "/recurepay",
  "/withdraw",
];

/** Called server-to-server by Circle; they carry no browser session. */
const crossSiteExemptApiPrefixes = [
  "/api/circles/webhooks/",
  "/api/multichain/webhooks/",
  "/api/recurring/webhooks/",
  "/api/ramp/webhooks/",
];

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedOrigins(request: NextRequest) {
  const origins = new Set<string>([request.nextUrl.origin]);
  // Behind a proxy the public host can differ from the internal one.
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    origins.add(`${proto}://${forwardedHost.split(",")[0].trim()}`);
  }
  for (const value of [
    process.env.NEXT_PUBLIC_APP_URL,
    ...(process.env.SAPHRA_ALLOWED_ORIGINS ?? "").split(","),
  ]) {
    try {
      if (value?.trim()) origins.add(new URL(value.trim()).origin);
    } catch {
      // Ignore malformed configuration.
    }
  }
  return origins;
}

/**
 * Cross-site request forgery guard for every state-changing API call.
 *
 * Session cookies are SameSite=Lax, so other sites cannot attach them to a
 * background POST in current browsers; this makes the rule explicit and
 * independent of browser defaults. Browsers always label such requests
 * (Sec-Fetch-Site, Origin). Requests with neither come from servers (cron,
 * webhooks, scripts), which hold no user's cookies, so they pass through to
 * each route's own authentication.
 */
function isForgedCrossSiteRequest(request: NextRequest) {
  if (safeMethods.has(request.method)) return false;
  const { pathname } = request.nextUrl;
  if (crossSiteExemptApiPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") return true;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  // Sandboxed frames and some redirects send the literal "null".
  if (origin === "null") return true;
  return !allowedOrigins(request).has(origin);
}

/** Reachable before the 2FA code is in: entering it, signing in or out, public Checkout. */
const twoFactorExemptApiPrefixes = ["/api/two-factor", "/api/auth/", "/api/checkout/"];
/**
 * Exact paths reachable from the 2FA screen's "Contact us": the
 * service status, and opening a support request. Both work for guests and
 * read nothing of the account (a ticket only names a wallet the request
 * itself proves), so a device waiting for its code learns nothing it shouldn't.
 */
const lockedScreenApiPaths = new Set(["/api/support/status", "/api/support/tickets"]);

/**
 * A sign-in to an account with two-factor authentication gets no API data
 * until the authenticator (or backup) code is entered (see lib/two-factor).
 */
function isTwoFactorPendingRequest(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    lockedScreenApiPaths.has(pathname) ||
    twoFactorExemptApiPrefixes.some((prefix) => pathname.startsWith(prefix))
  ) {
    return false;
  }
  const sessionCookie = request.cookies.get(walletSessionCookieName)?.value;
  if (!sessionCookie) return false;
  try {
    return Boolean(readWalletToken(sessionCookie, "session")?.mfaPending);
  } catch {
    return false;
  }
}

function isProtectedRoute(pathname: string) {
  return protectedRouteMatchers.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (isForgedCrossSiteRequest(request)) {
      return NextResponse.json(
        { message: "Cross-site requests are not allowed." },
        { status: 403 },
      );
    }
    if (isTwoFactorPendingRequest(request)) {
      return NextResponse.json(
        {
          locked: true,
          message: "Enter your two-factor code to continue.",
          reason: "two-factor",
        },
        { headers: { "Cache-Control": "no-store" }, status: 423 },
      );
    }
    return NextResponse.next();
  }

  if (!isProtectedRoute(pathname)) {
    return NextResponse.next();
  }

  if (
    request.cookies.get(platformAccessCookieName)?.value === "1" ||
    Boolean(request.cookies.get(walletSessionCookieName)?.value)
  ) {
    return NextResponse.next();
  }

  // Keep the query string (a prefilled /send?…&charge=…) so signing in lands
  // exactly where the visitor was going.
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = "";
  url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  url.hash = "";

  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/activity/:path*",
    "/insights/:path*",
    "/transactions/:path*",
    "/dashboard/:path*",
    "/deposit/:path*",
    "/business/:path*",
    "/pay/:path*",
    "/send/:path*",
    "/settings/:path*",
    "/swap/:path*",
    "/bulkpay/:path*",
    "/recurepay/:path*",
    "/withdraw/:path*",
  ],
};
