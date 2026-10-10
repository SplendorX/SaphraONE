import {
  createPublicClient,
  type Address,
  type PublicClient,
} from "viem";

import { earnConfig } from "@/lib/earn/config";
import { arcChain, arcTransport } from "@/lib/chains";

/**
 * Minimal Aave V3 Pool view for reserve data.
 * liquidityIndex is ray (1e27). currentLiquidityRate is ray APR.
 */
export const aavePoolAbi = [
  {
    type: "function",
    name: "getReserveData",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "configuration", type: "uint256" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000n;

export type ApySnapshotResult = {
  grossApyBps: number | null;
  netApyBps: number | null;
  underlyingApyBps: number | null;
  dataSource:
    | "aave_liquidity_rate"
    | "aave_liquidity_index"
    | "observed_growth"
    | "unavailable"
    | "simulation";
  isEstimate: boolean;
  isSimulation: boolean;
  liquidityIndex: string | null;
  currentLiquidityRateRay: string | null;
  message: string;
  capturedAt: string;
};

function createArcClient(): PublicClient {
  return createPublicClient({
    chain: arcChain,
    transport: arcTransport(),
  });
}

/** Convert Aave liquidity rate (ray APR, continuous-ish) to APY bps. */
export function liquidityRateRayToApyBps(rateRay: bigint): number {
  if (rateRay <= 0n) return 0;
  // APY ≈ rate (simple) for display; use rate * 10000 / 1e27
  const bps = (rateRay * 10_000n) / RAY;
  return Number(bps > 1_000_000n ? 1_000_000n : bps);
}

export function applyPerformanceFeeBps(
  grossApyBps: number | null,
  feeBps: number,
): number | null {
  if (grossApyBps === null) return null;
  const net = Math.floor((grossApyBps * (10_000 - feeBps)) / 10_000);
  return net < 0 ? 0 : net;
}

/**
 * Read live APY from Aave when pool supports getReserveData.
 * Never invents numbers — returns unavailable/simulation when data missing.
 */
export async function fetchAaveApy(options?: {
  pool?: Address | null;
  asset?: Address | null;
  feeBps?: number;
  mode?: "live" | "simulation" | "unavailable";
  client?: PublicClient;
}): Promise<ApySnapshotResult> {
  const mode = options?.mode ?? earnConfig.mode;
  const feeBps = options?.feeBps ?? earnConfig.performanceFeeBps;
  const capturedAt = new Date().toISOString();

  if (mode === "simulation") {
    return {
      grossApyBps: null,
      netApyBps: null,
      underlyingApyBps: null,
      dataSource: "simulation",
      isEstimate: true,
      isSimulation: true,
      liquidityIndex: null,
      currentLiquidityRateRay: null,
      message:
        "Simulation mode — no real APY. Testnet Demo does not produce economic yield.",
      capturedAt,
    };
  }

  if (mode === "unavailable") {
    return {
      grossApyBps: null,
      netApyBps: null,
      underlyingApyBps: null,
      dataSource: "unavailable",
      isEstimate: false,
      isSimulation: false,
      liquidityIndex: null,
      currentLiquidityRateRay: null,
      message: "Real yield strategy unavailable on this network.",
      capturedAt,
    };
  }

  const pool = options?.pool ?? earnConfig.aavePoolAddress;
  const asset = options?.asset ?? null;

  if (!pool) {
    return {
      grossApyBps: null,
      netApyBps: null,
      underlyingApyBps: null,
      dataSource: "unavailable",
      isEstimate: false,
      isSimulation: false,
      liquidityIndex: null,
      currentLiquidityRateRay: null,
      message: "Aave pool address not configured.",
      capturedAt,
    };
  }

  const client = options?.client ?? createArcClient();

  // Prefer currentLiquidityRate when getReserveData is available (real Aave V3).
  try {
    if (!asset) {
      throw new Error("asset required for getReserveData");
    }

    const reserve = (await client.readContract({
      address: pool,
      abi: aavePoolAbi,
      functionName: "getReserveData",
      args: [asset],
    })) as {
      liquidityIndex: bigint;
      currentLiquidityRate: bigint;
    };

    const underlyingApyBps = liquidityRateRayToApyBps(
      BigInt(reserve.currentLiquidityRate),
    );
    const netApyBps = applyPerformanceFeeBps(underlyingApyBps, feeBps);

    return {
      grossApyBps: underlyingApyBps,
      netApyBps,
      underlyingApyBps,
      dataSource: "aave_liquidity_rate",
      isEstimate: true,
      isSimulation: false,
      liquidityIndex: reserve.liquidityIndex.toString(),
      currentLiquidityRateRay: reserve.currentLiquidityRate.toString(),
      message:
        "Estimated APY from Aave currentLiquidityRate. Variable and not guaranteed.",
      capturedAt,
    };
  } catch {
    // Pool is mock or incompatible — no invented rate.
    return {
      grossApyBps: null,
      netApyBps: null,
      underlyingApyBps: null,
      dataSource: "unavailable",
      isEstimate: false,
      isSimulation: false,
      liquidityIndex: null,
      currentLiquidityRateRay: null,
      message:
        "Aave getReserveData unavailable on this pool. APY will use observed growth when history exists.",
      capturedAt,
    };
  }
}

// silence unused until indexer uses period math
void SECONDS_PER_YEAR;
