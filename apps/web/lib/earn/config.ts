import { arcExplorerUrl } from "@/lib/chains";
import type { Address } from "viem";

/**
 * SaphraONE Earn network / yield mode configuration.
 *
 * Modes:
 * - live: verified Aave Pool + aToken configured; real protocol yield
 * - simulation: MockAave / testnet demo — never show as real yield
 * - unavailable: no strategy configured for this network
 *
 * Switch mainnet by setting env after official Arc + Aave addresses are published.
 */

export type EarnMode = "live" | "simulation" | "unavailable";

function readAddress(value?: string | null): Address | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  if (/^0x0{40}$/i.test(trimmed)) return null;
  return trimmed as Address;
}

const vault = readAddress(process.env.NEXT_PUBLIC_EARN_VAULT_ADDRESS);
const strategy = readAddress(process.env.NEXT_PUBLIC_EARN_STRATEGY_ADDRESS);
const aavePool = readAddress(process.env.NEXT_PUBLIC_AAVE_POOL_ADDRESS);
const aToken = readAddress(process.env.NEXT_PUBLIC_AAVE_ATOKEN_USDC);

const explicitMode = process.env.NEXT_PUBLIC_EARN_MODE?.trim().toLowerCase();

function resolveMode(): EarnMode {
  if (explicitMode === "live" || explicitMode === "simulation" || explicitMode === "unavailable") {
    // Never allow "live" without vault + pool + aToken
    if (explicitMode === "live") {
      if (vault && strategy && aavePool && aToken) return "live";
      return "unavailable";
    }
    return explicitMode;
  }

  if (vault && strategy && aavePool && aToken) {
    // If strategy was deployed as simulation, env should set EARN_MODE=simulation
    return "simulation";
  }

  if (vault && strategy) {
    return "simulation";
  }

  return "unavailable";
}

export const earnConfig = {
  mode: resolveMode(),
  vaultAddress: vault,
  strategyAddress: strategy,
  aavePoolAddress: aavePool,
  aTokenAddress: aToken,
  /** Default 5% performance fee display (on-chain is source of truth). */
  performanceFeeBps: Number(process.env.NEXT_PUBLIC_EARN_PERFORMANCE_FEE_BPS || 500),
  protocolName: "Aave USDC Supply",
  explorerBase: arcExplorerUrl,
} as const;

export function earnModeBanner(mode: EarnMode = earnConfig.mode): {
  tone: "warning" | "danger" | "success";
  title: string;
  body: string;
} {
  switch (mode) {
    case "live":
      return {
        tone: "success",
        title: "Live yield strategy",
        body: "USDC is supplied to a verified Aave market. Yield is variable and not guaranteed. APY is sourced from protocol data.",
      };
    case "simulation":
      return {
        tone: "warning",
        title: "Testnet Demo — no real economic yield",
        body: "Simulation only. Balances and any accrued “yield” are not real financial returns. Do not treat this as production earnings.",
      };
    default:
      return {
        tone: "danger",
        title: "Real yield strategy unavailable on this network",
        body: "No verified Aave USDC market is configured. Deposits are disabled until official addresses are set.",
      };
  }
}



export function explorerAddressUrl(address: string): string {
  return `${earnConfig.explorerBase}/address/${address}`;
}

export function explorerTxUrl(hash: string): string {
  return `${earnConfig.explorerBase}/tx/${hash}`;
}
