// Server-only. The deposit fee on each sweep to Arc (lib/multichain/rules.ts):
// a flat 0.10 USDC, and on Ethereum enough to cover the gas Circle's Gas
// Station sponsors there, read live. Paid to the platform fee wallet on the
// source network as App Kit's custom fee.
import { platformFeeRecipient } from "@/lib/fees";
import type { MultichainChain } from "@/lib/multichain/chains";
import { depositFeeUnits } from "@/lib/multichain/rules";

/**
 * Gas one Ethereum sweep spends through the Gas Station paymaster: approve,
 * depositForBurn with the forwarding hook, the custom fee transfer, and the
 * user operation's overhead. Generous on purpose; tune with
 * MULTICHAIN_SWEEP_GAS_ETHEREUM once real sweeps are measured.
 */
const DEFAULT_ETHEREUM_SWEEP_GAS = 350_000n;
/** Used when CoinGecko can't be reached: high, so the fee still covers the gas. */
const DEFAULT_ETH_USD_FALLBACK = 5_000;
const PRICE_TTL_MS = 5 * 60 * 1000;

let ethPrice: { at: number; usdMicros: bigint } | null = null;

function rpcUrl(chain: MultichainChain) {
  return process.env[`MULTICHAIN_RPC_${chain.key.toUpperCase()}`]?.trim() || chain.rpcUrl;
}

async function gasPriceWei(chain: MultichainChain): Promise<bigint> {
  const response = await fetch(rpcUrl(chain), {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "eth_gasPrice", params: [] }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(8_000),
  });
  const payload = (await response.json()) as { result?: string };
  if (!response.ok || !payload.result) throw new Error("No gas price.");
  return BigInt(payload.result);
}

function usdMicros(value: number) {
  return BigInt(Math.round(value * 1_000_000));
}

/** ETH in micro-USD, from CoinGecko, cached for five minutes. */
async function ethUsdMicros(): Promise<bigint> {
  if (ethPrice && Date.now() - ethPrice.at < PRICE_TTL_MS) return ethPrice.usdMicros;
  try {
    const key = process.env.COINGECKO_API_KEY?.trim();
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", {
      cache: "no-store",
      headers: key ? { accept: "application/json", "x-cg-demo-api-key": key } : { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    const payload = (await response.json()) as { ethereum?: { usd?: number } };
    const usd = payload.ethereum?.usd;
    if (!response.ok || !usd || !Number.isFinite(usd)) throw new Error("No ETH price.");
    ethPrice = { at: Date.now(), usdMicros: usdMicros(usd) };
    return ethPrice.usdMicros;
  } catch {
    return usdMicros(Number(process.env.MULTICHAIN_ETH_USD_FALLBACK) || DEFAULT_ETH_USD_FALLBACK);
  }
}

/** Whether deposit fees are on: there's a platform wallet to pay them to. */
export function depositFeesEnabled() {
  return /^0x[a-fA-F0-9]{40}$/.test(platformFeeRecipient());
}

/**
 * The deposit fee for a sweep from `chain`, in USDC units: 0n when no fee
 * wallet is set, the 0.10 floor on most networks, and the gas-covering fee on
 * Ethereum. A failed gas read on Ethereum throws, so the sweep waits for the
 * next pass instead of charging a fee that may not cover the gas.
 */
export async function quoteDepositFee(chain: MultichainChain): Promise<bigint> {
  if (!depositFeesEnabled()) return 0n;
  if (chain.key !== "ethereum") return depositFeeUnits();
  const gasUnits = BigInt(process.env.MULTICHAIN_SWEEP_GAS_ETHEREUM?.trim() || DEFAULT_ETHEREUM_SWEEP_GAS);
  const [price, native] = await Promise.all([gasPriceWei(chain), ethUsdMicros()]);
  return depositFeeUnits({ gasPriceWei: price, gasUnits, nativeUsdMicros: native });
}

let shownFees: { at: number; fees: Record<string, bigint> } | null = null;
const SHOWN_FEES_TTL_MS = 60 * 1000;

/**
 * For the receive screen: each network's fee right now, in USDC. Ethereum's
 * moves with gas; cached a minute, since the screen polls.
 */
export async function depositFeesByNetwork(chains: readonly MultichainChain[]): Promise<Record<string, bigint>> {
  if (shownFees && Date.now() - shownFees.at < SHOWN_FEES_TTL_MS) return shownFees.fees;
  const fees: Record<string, bigint> = {};
  await Promise.all(
    chains.map(async (chain) => {
      const fee = await quoteDepositFee(chain).catch(() => null);
      if (fee !== null) fees[chain.key] = fee;
    }),
  );
  shownFees = { at: Date.now(), fees };
  return fees;
}
