import type { Address } from "viem";

import {
  officialEurcAddress,
  officialUsdcAddress,
} from "@/lib/network";

type TokenInfo = {
  address: Address;
  decimals: number;
  name: string;
  symbol: string;
};

const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;

function token(
  address: Address | null,
  decimals: number,
  name: string,
  symbol: string,
): TokenInfo {
  return {
    address: address ?? zeroAddress,
    decimals,
    name,
    symbol,
  };
}

/**
 * Active Arc stablecoins. Testnet uses official Arc Testnet USDC/EURC.
 * Mainnet uses only addresses from env after official publication.
 */
export const arcTokens = {
  USDC: token(officialUsdcAddress(), 6, "USD Coin", "USDC"),
  EURC: token(officialEurcAddress(), 6, "Euro Coin", "EURC"),
} as const satisfies Record<string, TokenInfo>;


export type ArcTokenSymbol = keyof typeof arcTokens;

export const arcTokenSymbols = Object.keys(arcTokens) as ArcTokenSymbol[];
