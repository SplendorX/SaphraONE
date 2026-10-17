/**
 * Where the developer platform lives. Pure (reads env only), so the proxy, the
 * pages and the tests share one answer.
 *
 * Each deployment serves one mode: the mainnet (Production) deployment is
 * "live" and the testnet (Preview) deployment is the "sandbox". Each mode has
 * two hosts on that deployment, sharing its database and sign-in:
 *
 *   portal  developers.saphra.one          sandbox.developers.saphra.one
 *   API     api.saphra.one/v1/…            sandbox.api.saphra.one/v1/…
 *
 * The sandbox/live toggle on the portal moves between the two portals.
 */
import { isArcMainnet } from "@/lib/network";

export type DeveloperMode = "live" | "sandbox";

export type DeveloperUrls = {
  /** The developer portal: landing page, docs and console. */
  portal: string;
  /** The API host; requests go to `${api}/v1/…`. */
  api: string;
};

const defaults: Record<DeveloperMode, DeveloperUrls> = {
  live: { api: "https://api.saphra.one", portal: "https://developers.saphra.one" },
  sandbox: { api: "https://sandbox.api.saphra.one", portal: "https://sandbox.developers.saphra.one" },
};

function readOrigin(value: string | undefined, fallback: string) {
  const raw = value?.trim();
  if (!raw) return fallback;
  try {
    return new URL(raw).origin;
  } catch {
    return fallback;
  }
}

// Literal process.env reads, so Next inlines them in browser bundles too.
function configured(mode: DeveloperMode): DeveloperUrls {
  return mode === "live"
    ? {
        api: readOrigin(process.env.NEXT_PUBLIC_API_LIVE_URL, defaults.live.api),
        portal: readOrigin(process.env.NEXT_PUBLIC_DEVELOPERS_LIVE_URL, defaults.live.portal),
      }
    : {
        api: readOrigin(process.env.NEXT_PUBLIC_API_SANDBOX_URL, defaults.sandbox.api),
        portal: readOrigin(process.env.NEXT_PUBLIC_DEVELOPERS_SANDBOX_URL, defaults.sandbox.portal),
      };
}

/** This deployment's mode: live on mainnet, the sandbox on testnet. */
export function developerMode(): DeveloperMode {
  return isArcMainnet() ? "live" : "sandbox";
}

export function otherDeveloperMode(mode: DeveloperMode): DeveloperMode {
  return mode === "live" ? "sandbox" : "live";
}

export function developerUrls(mode: DeveloperMode = developerMode()): DeveloperUrls {
  return configured(mode);
}

/** `https://api.saphra.one/v1`, or the sandbox's. */
export function apiBaseUrl(mode: DeveloperMode = developerMode()) {
  return `${developerUrls(mode).api}/v1`;
}

/** The secret key prefix a mode issues. */
export function keyPrefixFor(mode: DeveloperMode) {
  return mode === "live" ? "sk_live_" : "sk_test_";
}

function hostOf(origin: string) {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return "";
  }
}

/** The first host a request names (x-forwarded-host wins behind a proxy). */
export function requestHost(headers: { get(name: string): string | null }) {
  const raw = headers.get("x-forwarded-host") ?? headers.get("host") ?? "";
  return raw.split(",")[0].trim().toLowerCase();
}

export type DeveloperSurface = "portal" | "api";

/**
 * Which developer host `host` is, or null for the main app. Hosts of both
 * modes count, so a domain attached to the other deployment still routes.
 */
export function developerSurfaceFor(host: string): DeveloperSurface | null {
  const clean = host.trim().toLowerCase();
  if (!clean) return null;
  for (const mode of ["live", "sandbox"] as const) {
    const urls = configured(mode);
    if (clean === hostOf(urls.portal)) return "portal";
    if (clean === hostOf(urls.api)) return "api";
  }
  return null;
}
