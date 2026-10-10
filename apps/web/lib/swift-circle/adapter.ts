import "@/lib/env-compat";
import { isAddress, type Address } from "viem";

import { createRecurringPublicClient } from "@/lib/recurring/circle-adapter";
import { erc20Abi } from "@/lib/contracts";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";

const loadedEnv: Record<string, string> = {};

function envValue(name: string) {
  return (process.env[name] || loadedEnv[name] || "").trim();
}

/**
 * Thin adapter over existing SaphraONE / Circle / Arc rails.
 * Circle (the SaphraONE feature) never calls raw Circle APIs from route handlers.
 */
export function circleTreasuryAddress(): Address | null {
  for (const value of [
    envValue("SAPHRA_CIRCLE_TREASURY_ADDRESS"),
    envValue("TREASURY_WALLET"),
    envValue("SAPHRA_RECURRING_OPERATOR_ADDRESS"),
    envValue("EVM_WALLET_ADDRESS"),
    envValue("WALLET_ADDRESS"),
  ]) {
    if (isAddress(value)) {
      return value as Address;
    }
  }
  return null;
}

export async function getWalletTokenBalance(input: {
  wallet: Address;
  asset: ArcTokenSymbol;
}) {
  const token = arcTokens[input.asset];
  const client = createRecurringPublicClient();
  const balance = await client.readContract({
    abi: erc20Abi,
    address: token.address,
    args: [input.wallet],
    functionName: "balanceOf",
  });
  return balance as bigint;
}

