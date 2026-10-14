import { NextResponse, type NextRequest } from "next/server";
import { createPublicClient, type Address } from "viem";

import { fetchAaveApy } from "@/lib/earn/aave-apy";
import { earnConfig, earnModeBanner } from "@/lib/earn/config";
import { bpsToPercentString, formatUnitsToDecimal } from "@/lib/earn/decimal";
import { swiftPayVaultAbi, yieldStrategyAbi } from "@/lib/earn/abis";
import { adminCan } from "@/lib/admin/access";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { arcTokens } from "@/lib/tokens";
import { arcChain, arcTransport } from "@/lib/chains";

export const runtime = "nodejs";


export async function GET(request: NextRequest) {
  if (!(await adminCan(request, "earn"))) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const banner = earnModeBanner();
  const client = createPublicClient({
    chain: arcChain,
    transport: arcTransport(),
  });

  let totalAssets = 0n;
  let totalSupply = 0n;
  let feeBps = earnConfig.performanceFeeBps;
  let strategyName: string | null = null;
  let strategyHealthy: boolean | null = null;
  let isSimulation: boolean | null = null;
  let paused: boolean | null = null;
  const errors: string[] = [];

  if (earnConfig.vaultAddress) {
    try {
      totalAssets = (await client.readContract({
        address: earnConfig.vaultAddress,
        abi: swiftPayVaultAbi,
        functionName: "totalAssets",
      })) as bigint;
      totalSupply = (await client.readContract({
        address: earnConfig.vaultAddress,
        abi: swiftPayVaultAbi,
        functionName: "totalSupply",
      })) as bigint;
      feeBps = Number(
        (await client.readContract({
          address: earnConfig.vaultAddress,
          abi: swiftPayVaultAbi,
          functionName: "performanceFeeBps",
        })) as bigint,
      );
      paused = (await client.readContract({
        address: earnConfig.vaultAddress,
        abi: swiftPayVaultAbi,
        functionName: "paused",
      })) as boolean;
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Vault read failed.",
      );
    }
  }

  if (earnConfig.strategyAddress) {
    try {
      strategyName = (await client.readContract({
        address: earnConfig.strategyAddress,
        abi: yieldStrategyAbi,
        functionName: "strategyName",
      })) as string;
      strategyHealthy = (await client.readContract({
        address: earnConfig.strategyAddress,
        abi: yieldStrategyAbi,
        functionName: "isHealthy",
      })) as boolean;
      isSimulation = (await client.readContract({
        address: earnConfig.strategyAddress,
        abi: yieldStrategyAbi,
        functionName: "isSimulation",
      })) as boolean;
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "Strategy read failed.",
      );
    }
  }

  const apy = await fetchAaveApy({
    pool: earnConfig.aavePoolAddress,
    asset: arcTokens.USDC.address as Address,
    feeBps,
    mode: earnConfig.mode,
  });

  let depositCount = 0;
  let withdrawalCount = 0;
  let uniqueUsers = 0;
  let feeEvents: Array<{ gross_yield: string; fee: string; timestamp: string | null }> =
    [];

  try {
    const supabase = createSupabaseAdminClient();
    const vault = earnConfig.vaultAddress?.toLowerCase();

    const deposits = await supabase
      .from("earn_deposits")
      .select("wallet_address", { count: "exact", head: false })
      .limit(5000);
    const withdrawals = await supabase
      .from("earn_withdrawals")
      .select("id", { count: "exact", head: true });
    const fees = await supabase
      .from("earn_fee_events")
      .select("gross_yield, fee, timestamp")
      .order("created_at", { ascending: false })
      .limit(20);

    depositCount = deposits.count ?? deposits.data?.length ?? 0;
    withdrawalCount = withdrawals.count ?? 0;
    const wallets = new Set(
      (deposits.data ?? []).map((r) => r.wallet_address?.toLowerCase()),
    );
    uniqueUsers = wallets.size;
    feeEvents = fees.data ?? [];

    if (vault) {
      // counts already global; ok for single-vault deploy
    }
  } catch {
    // DB optional for admin shell
  }

  const decimals = arcTokens.USDC.decimals;

  return NextResponse.json({
    mode: earnConfig.mode,
    banner,
    tvl: {
      totalAssetsUnits: totalAssets.toString(),
      totalAssetsDisplay: formatUnitsToDecimal(totalAssets, decimals),
      totalSupply: totalSupply.toString(),
    },
    users: {
      depositEvents: depositCount,
      withdrawalEvents: withdrawalCount,
      uniqueDepositorsIndexed: uniqueUsers,
    },
    fees: {
      performanceFeeBps: feeBps,
      recent: feeEvents,
    },
    apy: {
      ...apy,
      grossApyDisplay: bpsToPercentString(apy.grossApyBps),
      netApyDisplay: bpsToPercentString(apy.netApyBps),
    },
    strategy: {
      name: strategyName,
      healthy: strategyHealthy,
      isSimulation,
      address: earnConfig.strategyAddress,
      aavePool: earnConfig.aavePoolAddress,
      aToken: earnConfig.aTokenAddress,
    },
    vault: {
      address: earnConfig.vaultAddress,
      paused,
    },
    network: {
      chainId: arcChain.id,
      name: arcChain.name,
      explorer: earnConfig.explorerBase,
    },
    errors,
    notes: [
      "On-chain TVL is authoritative.",
      "Indexed user counts depend on earn indexer + Supabase.",
      "Never invent APY — null means unavailable or simulation.",
    ],
  });
}
