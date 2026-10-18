// Server-only. Prembly and daily-limit settings for Naira-ramp KYC/KYB.
import { isArcMainnet } from "@/lib/network";
import { defaultKycLimits, type KycLimits } from "@/lib/kyc/gate";

export type PremblyConfig = {
  apiKey: string;
  appId: string | null;
  baseUrl: string;
  environment: "sandbox" | "live";
};

const warned = new Set<string>();

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[kyc] ${message}`);
}

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Prembly settings, or null when KYC is off. A sandbox env on a mainnet
 * build (or live on testnet) turns it off so real money never meets test IDs.
 */
export function premblyConfig(): PremblyConfig | null {
  const apiKey = process.env.PREMBLY_API_KEY?.trim();
  if (!apiKey) return null;
  const environment = process.env.PREMBLY_ENV?.trim().toLowerCase() === "live" ? "live" : "sandbox";
  const mainnet = isArcMainnet();
  if ((environment === "live") !== mainnet) {
    warnOnce(
      `PREMBLY_ENV is ${environment} on an Arc ${mainnet ? "mainnet" : "testnet"} build; KYC is off.`,
    );
    return null;
  }
  return {
    apiKey,
    appId: process.env.PREMBLY_APP_ID?.trim() || null,
    baseUrl: (process.env.PREMBLY_BASE_URL?.trim() || "https://api.prembly.com").replace(/\/$/, ""),
    environment,
  };
}

export function kycLimits(): KycLimits {
  return {
    t1OnrampNgn: numberEnv("KYC_T1_ONRAMP_NGN", defaultKycLimits.t1OnrampNgn),
    t1OfframpUsdc: numberEnv("KYC_T1_OFFRAMP_USDC", defaultKycLimits.t1OfframpUsdc),
    t2OnrampNgn: numberEnv("KYC_T2_ONRAMP_NGN", defaultKycLimits.t2OnrampNgn),
    t2OfframpUsdc: numberEnv("KYC_T2_OFFRAMP_USDC", defaultKycLimits.t2OfframpUsdc),
    basicOnrampNgn: numberEnv("KYB_BASIC_ONRAMP_NGN", defaultKycLimits.basicOnrampNgn),
    basicOfframpUsdc: numberEnv("KYB_BASIC_OFFRAMP_USDC", defaultKycLimits.basicOfframpUsdc),
    fullOnrampNgn: numberEnv("KYB_FULL_ONRAMP_NGN", defaultKycLimits.fullOnrampNgn),
    fullOfframpUsdc: numberEnv("KYB_FULL_OFFRAMP_USDC", defaultKycLimits.fullOfframpUsdc),
  };
}

export function livenessMin() {
  return numberEnv("KYC_LIVENESS_MIN", 0.9);
}

export function faceMatchMin() {
  return numberEnv("KYC_FACE_MATCH_MIN", 0.8);
}

/**
 * Confirm BVN checks with Prembly's iGree OTP to the BVN's own phone.
 * Off until Prembly confirms iGree is enabled on the account. NIN checks
 * never use it.
 */
export function bvnConsentEnabled() {
  return process.env.KYC_BVN_IGREE?.trim() === "true";
}
