// Server-only. Centiiv Protocol settings for the Naira on/off-ramp.
import { isArcMainnet } from "@/lib/network";
import type { RampCurrency, RampEnvironment } from "@/lib/ramp/types";

export type CentiivConfig = {
  apiKey: string;
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

/** SANDBOX for `sk_sandbox_…`, LIVE for `sk_live_…`, null otherwise. */
export function keyEnvironment(apiKey: string): RampEnvironment | null {
  if (/sandbox/i.test(apiKey)) return "SANDBOX";
  if (/live/i.test(apiKey)) return "LIVE";
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
  if (!environment) {
    warnOnce("CENTIIV_API_KEY is neither a sandbox nor a live key; the ramp is off.");
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
