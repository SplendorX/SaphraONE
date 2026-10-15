// Server-only. Centiiv Protocol settings for the Naira on/off-ramp.
import { isArcMainnet } from "@/lib/network";
import type { RampCurrency, RampEnvironment } from "@/lib/ramp/types";

export type CentiivConfig = {
  /** Secret key (sk_…): orders and banking. Server-only. */
  apiKey: string;
  /** Public key (pk_…): Centiiv's /public/* endpoints (quotes) require it. */
  publicKey: string | null;
  baseUrl: string;
  webhookSecret: string | null;
  environment: RampEnvironment;
};

const warned = new Set<string>();

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[ramp] ${message}`);
}

/**
 * SANDBOX for `sk_sandbox_…` / `pk_sandbox_…`, LIVE for `sk_live_…` /
 * `pk_live_…`, null otherwise. Centiiv routes by the same prefixes.
 * (`cnt-test_` / `cnt-live_` keys belong to Centiiv's Payment API, a
 * different product; the Protocol API rejects them.)
 */
export function keyEnvironment(apiKey: string): RampEnvironment | null {
  const prefix = apiKey.trim().toLowerCase();
  if (/^(sk|pk)_sandbox_/.test(prefix)) return "SANDBOX";
  if (/^(sk|pk)_live_/.test(prefix)) return "LIVE";
  return null;
}

/**
 * Centiiv settings, or null when the ramp is off. A sandbox key on a mainnet
 * build, or a live key on a testnet build, turns it off: real money must
 * never meet testnet addresses.
 */
export function centiivConfig(): CentiivConfig | null {
  const apiKey = process.env.CENTIIV_API_KEY?.trim();
  if (!apiKey) return null;

  const environment = keyEnvironment(apiKey);
  if (!environment || !/^sk_/i.test(apiKey)) {
    warnOnce(
      /^cnt-/i.test(apiKey)
        ? "CENTIIV_API_KEY is a Payment API key (cnt-…). The ramp needs Protocol API keys: sk_sandbox_… / sk_live_… here and pk_… in CENTIIV_PUBLIC_KEY. The ramp is off."
        : "CENTIIV_API_KEY must be a Protocol API secret key (sk_sandbox_… or sk_live_…); the ramp is off.",
    );
    return null;
  }
  const publicKey = process.env.CENTIIV_PUBLIC_KEY?.trim() || null;
  if (publicKey && (!/^pk_/i.test(publicKey) || keyEnvironment(publicKey) !== environment)) {
    warnOnce(`CENTIIV_PUBLIC_KEY must be a ${environment === "LIVE" ? "pk_live_" : "pk_sandbox_"}… key; the ramp is off.`);
    return null;
  }
  const mainnet = isArcMainnet();
  if ((environment === "LIVE") !== mainnet) {
    warnOnce(
      `CENTIIV_API_KEY is a ${environment.toLowerCase()} key on an Arc ${mainnet ? "mainnet" : "testnet"} build; the ramp is off.`,
    );
    return null;
  }

  return {
    apiKey,
    publicKey,
    baseUrl: (process.env.CENTIIV_API_BASE_URL?.trim() || "https://api.centiiv.io").replace(/\/$/, ""),
    webhookSecret: process.env.CENTIIV_WEBHOOK_SECRET?.trim() || null,
    environment,
  };
}

export function rampEnabled() {
  return Boolean(centiivConfig());
}

/** RAMP_CURRENCIES narrows the fiat currencies on offer. Only NGN exists today. */
export function rampCurrencies(): RampCurrency[] {
  const wanted = (process.env.RAMP_CURRENCIES?.trim() || "NGN")
    .split(",")
    .map((value) => value.trim().toUpperCase());
  return wanted.includes("NGN") ? ["NGN"] : [];
}
