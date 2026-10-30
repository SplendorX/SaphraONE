"use client";

import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { AppKit } from "@circle-fin/app-kit";
import { createPublicClient, getAddress, isAddress } from "viem";
import { toJsonSafe } from "@/lib/earn/serialize";
import type {
  EarnDepositQuote,
  EarnPosition,
  EarnTxResult,
  EarnWithdrawQuote,
} from "@/lib/earn/types";
import { arcTransport, postArcRpc } from "@/lib/chains";
import { earnAppKitChain, explorerTxUrl, onchainFacts } from "@/lib/onchain-facts";
import { formatUsdc, parseUsdc } from "@/lib/onchain-money";

/**
 * Earn signed by the wallet in the browser.
 *
 * Deposits and withdrawals move the signer's own USDC, so the signer has to be
 * the person holding the funds. Building the adapter from the connected
 * wallet's EIP-1193 provider keeps the position, the shares, and the risk with
 * them — a server-held key would move the server's money instead.
 *
 * No Circle API key is passed: App Kit runs Earn in permissionless mode when
 * `config` is omitted, so nothing secret has to reach the browser.
 */

export class EarnWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EarnWalletError";
  }
}

/** Thrown when the wallet owner declines a signature. Not a failure to report. */
export class EarnRejectedError extends Error {
  constructor() {
    super("Cancelled in wallet.");
    this.name = "EarnRejectedError";
  }
}

export type EarnWalletContext = {
  currentChainId?: number;
  /** Supplies an EIP-1193 provider: an injected wallet, or the Circle shim. */
  resolveProvider: (() => Promise<unknown>) | null | undefined;
  switchChainAsync?: (args: { chainId: number }) => Promise<unknown>;
};

export type EarnOperationInput = EarnWalletContext & {
  amount: string;
  vaultAddress: string;
};

function isRejection(value: unknown): boolean {
  const message = value instanceof Error ? value.message : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes("user rejected") ||
    normalized.includes("user denied") ||
    normalized.includes("rejected the request") ||
    normalized.includes("4001")
  );
}

/**
 * Build the most specific message the cause actually carries.
 *
 * App Kit throws `KitError`, which adds a `code` and often wraps the real
 * cause underneath. Collapsing all of that into one generic sentence leaves
 * nothing to debug, so keep whatever detail exists.
 */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    const kit = cause as Error & { code?: unknown };
    const first = (cause.message.split(/\r?\n/)[0] ?? "").trim();
    const base = first || cause.name || "Invest request failed.";
    const trimmed = base.length > 300 ? base.slice(0, 300) + "…" : base;
    return kit.code === undefined || kit.code === null
      ? trimmed
      : trimmed + " (" + String(kit.code) + ")";
  }

  if (typeof cause === "string" && cause.trim()) {
    return cause.trim().slice(0, 300);
  }

  if (cause && typeof cause === "object") {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, 300);
    }
    try {
      return JSON.stringify(cause).slice(0, 300);
    } catch {
      // Not serializable; fall through to the generic message.
    }
  }

  return "Invest request failed.";
}

function rethrow(cause: unknown): never {
  // Our own signals already carry the right message and must not be rewrapped
  // — rewrapping a cancellation turns it into a reported failure.
  if (cause instanceof EarnRejectedError || cause instanceof EarnWalletError) {
    throw cause;
  }
  if (isRejection(cause)) {
    throw new EarnRejectedError();
  }

  // The rendered string is necessarily short; keep the whole cause reachable.
  console.error("[earn] request failed", cause);
  throw new EarnWalletError(describeCause(cause));
}

function assertVaultAddress(vaultAddress: string) {
  if (!isAddress(vaultAddress)) {
    throw new EarnWalletError("Select a vault first.");
  }
  return getAddress(vaultAddress);
}

/**
 * Build the `from` context App Kit expects, moving the wallet onto Arc first.
 * Signing against the wrong chain is the most common way these calls fail.
 */
async function earnFrom(context: EarnWalletContext) {
  if (!context.resolveProvider) {
    throw new EarnWalletError(
      "Sign in with Google or connect a wallet to use Invest.",
    );
  }

  if (
    context.currentChainId !== undefined &&
    context.currentChainId !== onchainFacts.chainId &&
    context.switchChainAsync
  ) {
    try {
      await context.switchChainAsync({ chainId: onchainFacts.chainId });
    } catch (cause) {
      if (isRejection(cause)) throw new EarnRejectedError();
      throw new EarnWalletError(
        `Switch your wallet to ${onchainFacts.chain.name} to use Invest.`,
      );
    }
  }

  const provider = await context.resolveProvider();
  const adapter = await createViemAdapterFromProvider({
    // App Kit otherwise selects its own single RPC endpoint. That bypasses the
    // app's configured Arc RPC and its failover list, which can leave a valid
    // Earn request failing during prepare/simulation with only the provider's
    // opaque 5099 error. Keep every read, gas estimate, and receipt check on
    // the same resilient Arc transport used by the rest of SaphraONE.
    getPublicClient: () =>
      createPublicClient({
        chain: onchainFacts.chain,
        transport: arcTransport(),
      }),
    provider: provider as Parameters<
      typeof createViemAdapterFromProvider
    >[0]["provider"],
  });

  return { adapter, chain: earnAppKitChain() };
}

function earnKit() {
  return new AppKit();
}

const ERC4626_DECIMALS_SELECTOR = "0x313ce567";
const SUPPORTED_SHARE_DECIMALS = 18;

/**
 * Refuse vaults whose shares are not 18 decimals.
 *
 * The Earn router derives its minimum-output slippage bound in 18 decimals
 * regardless of the vault's own share decimals, then compares it against the
 * real share amount. On a 6-decimal vault the bound is ~1e12 times too large,
 * so the deposit always reverts with `InsufficientOutput` during simulation.
 *
 * Checked before signing: the revert happens after the wallet prompt, so
 * without this the owner approves a transaction that cannot succeed.
 */
async function assertVaultShareDecimals(vaultAddress: string) {
  let decimals: number;
  try {
    const response = await postArcRpc({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ data: ERC4626_DECIMALS_SELECTOR, to: vaultAddress }, "latest"],
    });
    const payload = (await response.json()) as { result?: string };
    if (!payload.result || payload.result === "0x") return;
    decimals = Number(BigInt(payload.result));
  } catch {
    // Unreadable decimals are not a reason to block; let the SDK decide.
    return;
  }

  if (Number.isFinite(decimals) && decimals !== SUPPORTED_SHARE_DECIMALS) {
    throw new EarnWalletError(
      `This vault issues ${decimals}-decimal shares, which Circle's Earn router cannot price correctly yet — the deposit would revert on simulation. Pick a vault with 18-decimal shares.`,
    );
  }
}

function readTxResult(
  result: { amount?: string; txHash?: string },
  fallbackAmount: string,
  label: string,
): EarnTxResult {
  if (!result.txHash) {
    throw new EarnWalletError(`${label} submitted without a transaction hash.`);
  }

  return {
    amount: result.amount || fallbackAmount,
    explorerUrl: explorerTxUrl(result.txHash),
    txHash: result.txHash,
  };
}

export async function browserDepositQuote(
  input: EarnOperationInput,
): Promise<EarnDepositQuote> {
  const vaultAddress = assertVaultAddress(input.vaultAddress);
  const amount = formatUsdc(parseUsdc(input.amount));
  try {
    const from = await earnFrom(input);
    const quote = await earnKit().earn.getDepositQuote({
      amount,
      from,
      vaultAddress,
    });
    return toJsonSafe(quote) as EarnDepositQuote;
  } catch (cause) {
    rethrow(cause);
  }
}

export async function browserDeposit(
  input: EarnOperationInput,
): Promise<EarnTxResult> {
  const vaultAddress = assertVaultAddress(input.vaultAddress);
  const amount = formatUsdc(parseUsdc(input.amount));
  try {
    await assertVaultShareDecimals(vaultAddress);
    const from = await earnFrom(input);
    const result = await earnKit().earn.deposit({
      amount,
      from,
      vaultAddress,
    });
    return readTxResult(
      result as { amount?: string; txHash?: string },
      amount,
      "Deposit",
    );
  } catch (cause) {
    rethrow(cause);
  }
}

export async function browserWithdrawQuote(
  input: EarnOperationInput,
): Promise<EarnWithdrawQuote> {
  const vaultAddress = assertVaultAddress(input.vaultAddress);
  const amount = formatUsdc(parseUsdc(input.amount));
  try {
    const from = await earnFrom(input);
    const quote = await earnKit().earn.getWithdrawalQuote({
      amount,
      from,
      vaultAddress,
    });
    return toJsonSafe(quote) as EarnWithdrawQuote;
  } catch (cause) {
    rethrow(cause);
  }
}

export async function browserWithdraw(
  input: EarnOperationInput,
): Promise<EarnTxResult> {
  const vaultAddress = assertVaultAddress(input.vaultAddress);
  const amount = formatUsdc(parseUsdc(input.amount));
  try {
    const from = await earnFrom(input);
    const result = await earnKit().earn.withdraw({
      amount,
      from,
      vaultAddress,
    });
    return readTxResult(
      result as { amount?: string; txHash?: string },
      amount,
      "Withdrawal",
    );
  } catch (cause) {
    rethrow(cause);
  }
}

/**
 * A wallet that has never deposited has no registered position. The service
 * reports that as an input error, but it is the normal state for every new
 * user — report "nothing here" instead of a failure.
 */
function isMissingPosition(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  // KitError puts the human-readable id on `name`; `code` is numeric.
  const name = String((cause as Error & { name?: unknown }).name ?? "");
  const message = cause.message.toLowerCase();
  return (
    name === "EARN_INVALID_INPUT" &&
    message.includes("position") &&
    message.includes("not registered")
  );
}

export async function browserPosition(
  input: EarnWalletContext & { vaultAddress: string },
): Promise<EarnPosition | null> {
  const vaultAddress = assertVaultAddress(input.vaultAddress);
  try {
    // Reading a position must not move the wallet's chain; a read is not worth
    // a network-switch prompt.
    const from = await earnFrom({ ...input, switchChainAsync: undefined });
    const position = await earnKit().earn.getPosition({
      from,
      vaultAddress,
    });
    return toJsonSafe(position) as EarnPosition;
  } catch (cause) {
    if (isMissingPosition(cause)) {
      return null;
    }
    rethrow(cause);
  }
}
