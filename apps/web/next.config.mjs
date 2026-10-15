import { config as loadEnv } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(projectRoot, "../..");

loadEnv({ path: join(workspaceRoot, ".env"), quiet: true });
loadEnv({ path: join(projectRoot, ".env.local"), quiet: true });

// Testnet only: a mainnet build must never fall back to a testnet contract.
if (
  process.env.NEXT_PUBLIC_ARC_NETWORK?.trim().toLowerCase() !== "mainnet" &&
  !process.env.NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS?.trim()
) {
  process.env.NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS =
    "0xcBF3559D59b536cc3aB55C32e502F72Bd111588a";
}

const publicEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      key.startsWith("NEXT_PUBLIC_") &&
      typeof value === "string" &&
      value.trim().length > 0,
  ),
);

function allowedDevOrigins() {
  const origins = new Set(["localhost", "127.0.0.1"]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).hostname);
    } catch {
      // Ignore invalid app URLs.
    }
  }
  return [...origins];
}

const onrampFrameOrigins = [
  "https://onramp.arc.io",
  "https://*.transak.com",
  "https://*.socure.com",
  "https://*.socure.io",
]
  .map((origin) => `"${origin}"`)
  .join(" ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: publicEnv,
  allowedDevOrigins: allowedDevOrigins(),
  reactStrictMode: false,
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  experimental: {
    // Turbopack's on-disk dev cache (on by default in Next 16) served stale
    // CSS, hung the server and took 40s+ per write on this Windows setup, so
    // edits often needed a restart to show. Off: every edit is compiled fresh.
    turbopackFileSystemCacheForDev: false,
    // The same cache for `next build` (on by default since Next 16.3) lives in
    // .next/cache/turbopack, which Vercel restores between deploys. A warm
    // build reused the previous deploy's compiled globals.css and shipped
    // stale styles (the BulkPay redesign went out unstyled). Off: every
    // deploy compiles all CSS from source. Builds are slower, never stale.
    turbopackFileSystemCacheForBuild: false,
  },
  webpack(config) {
    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : []),
      "pino-pretty",
      "lokijs",
      "encoding",
    ];
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };

    return config;
  },
  // The service worker must never be served stale, or an old version keeps
  // running after a deploy.
  //
  // Security headers apply to every route. The CSP deliberately leaves
  // script-src alone: the Circle and WalletConnect SDKs load code and frames
  // from many origins. It still blocks framing (clickjacking), <base>
  // hijacking, plugins and form posts to other sites.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
          {
            // Report-only for now: logs (via /api/csp-report) every script
            // loaded from another origin, without blocking it. Once the logs
            // list what the Circle and WalletConnect SDKs need, add those
            // origins here and switch this header to enforce, so a script
            // injected into the page can't load code from elsewhere.
            key: "Content-Security-Policy-Report-Only",
            value:
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; report-uri /api/csp-report",
          },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // Circle's Onramp can render inline (installed app, in-app
            // browsers) and needs the camera and microphone for its identity
            // check and payment for checkout. Its frame origins come from
            // onramp.arc.io's own frame-src: Transak pays, Socure verifies.
            key: "Permissions-Policy",
            value: [
              `camera=(self ${onrampFrameOrigins})`,
              `microphone=(${onrampFrameOrigins})`,
              "geolocation=()",
              `payment=(${onrampFrameOrigins})`,
            ].join(", "),
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  // BulkPay (formerly BatchPay, at /batchpay), RecurePay and Circle used to live under /swiftBatch,
  // /swiftRecurepay and /swiftCircle. Old bookmarks, shared links, stored
  // notifications and ALLIE history keep working.
  async redirects() {
    return [
      // The old domain (SwiftPay) moves to app.saphra.one. API routes stay
      // put so webhooks and callbacks still registered on it keep landing.
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: "(?:www\\.)?getswiftpay\\.xyz" }],
        destination: "https://app.saphra.one/:path",
        permanent: true,
      },
      { source: "/swiftCircle", destination: "/circle", permanent: true },
      { source: "/swiftCircle/:path*", destination: "/circle/:path*", permanent: true },
      { source: "/batchpay", destination: "/bulkpay", permanent: true },
      { source: "/batchpay/:path*", destination: "/bulkpay/:path*", permanent: true },
      { source: "/swiftBatch", destination: "/bulkpay", permanent: true },
      { source: "/swiftBatch/:path*", destination: "/bulkpay/:path*", permanent: true },
      { source: "/swiftRecurepay", destination: "/recurepay", permanent: true },
      { source: "/swiftRecurepay/:path*", destination: "/recurepay/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
