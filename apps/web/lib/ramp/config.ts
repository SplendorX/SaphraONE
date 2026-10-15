// Server-only. Centiiv Protocol settings for the Naira on/off-ramp.
import { isArcMainnet } from "@/lib/network";
import type { RampCurrency, RampEnvironment } from "@/lib/ramp/types";

export type CentiivConfig = {
  /**
   * The Protocol API public key (pk_…). Centiiv's aggregator endpoints
   * (quotes, orders, banking) accept only this key; secret sk_ keys get a 403.
   * Kept server-side all the same.
   */
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
  const publicKey = process.env.CENTIIV_PUBLIC_KEY?.trim();
  const secretOrOther = process.env.CENTIIV_API_KEY?.trim();
  // CENTIIV_API_KEY may hold the pk_ key too; an sk_ key there can't be used.
  const apiKey = publicKey || (secretOrOther && /^pk_/i.test(secretOrOther) ? secretOrOther : null);
  if (!apiKey) {
    if (secretOrOther) {
      warnOnce(
        /^cnt-/i.test(secretOrOther)
          ? "CENTIIV_API_KEY is a Payment API key (cnt-…); the ramp needs the Protocol API public key in CENTIIV_PUBLIC_KEY (pk_sandbox_… / pk_live_…). The ramp is off."
          : "Set CENTIIV_PUBLIC_KEY to your Protocol API public key (pk_sandbox_… / pk_live_…): Centiiv's quote, order and banking endpoints reject secret sk_ keys. The ramp is off.",
      );
    }
    return null;
  }

  const environment = keyEnvironment(apiKey);
  if (!environment || !/^pk_/i.test(apiKey)) {
    warnOnce("CENTIIV_PUBLIC_KEY must be a Protocol API public key (pk_sandbox_… or pk_live_…); the ramp is off.");
    return null;
  }
  const mainnet = isArcMainnet();
  if ((environment === "LIVE") !== mainnet) {
    warnOnce(
      `The Centiiv key is a ${environment.toLowerCase()} key on an Arc ${mainnet ? "mainnet" : "testnet"} build; the ramp is off.`,
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
