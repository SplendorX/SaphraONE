import "@/lib/env-compat";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  isAddress,
  parseUnits,
  type Chain,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { erc20Abi } from "@/lib/contracts";
import { onchainFacts } from "@/lib/onchain-facts";
import { arcTransport } from "@/lib/chains";

/**
 * The OnePoints treasury: the wallet that receives USDC when points are
 * bought and pays it out when points are redeemed.
 *
 * Server-only. The key never leaves the server, and every caller here moves
 * real funds, so the guards below are the safety boundary rather than
 * convenience checks.
 */

export class TreasuryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreasuryError";
  }
}

function normalizeKey(value?: string | null): `0x${string}` | null {
  const raw = value?.trim();
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  return /^0x[a-fA-F0-9]{64}$/.test(key) ? key : null;
}

function treasuryPrivateKey() {
  return normalizeKey(
    process.env.ONE_POINTS_TREASURY_PRIVATE_KEY ??
      process.env.SAPHRA_CIRCLE_TREASURY_PRIVATE_KEY,
  );
}

/**
 * The largest single redemption the treasury will pay automatically.
 *
 * A bug or a compromised account should not be able to drain the treasury in
 * one call; anything larger needs a human.
 */
export function maxAutomaticPayoutUsdc() {
  const raw = process.env.ONE_POINTS_MAX_PAYOUT_USDC?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

function clients() {
  const privateKey = treasuryPrivateKey();
  if (!privateKey) return null;

  const chain = onchainFacts.chain as Chain;
  const transport = arcTransport();
  const account = privateKeyToAccount(privateKey);

  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

/**
 * Pay USDC out of the treasury.
 *
 * Throws rather than returning a partial result: the caller treats any throw
 * as "no funds moved" and reverses the points it already debited.
 */
export async function payUsdcFromTreasury(input: {
  /**
   * An admin approved this payout by hand (admin rewards review), so it may
   * exceed the automatic cap. Never set from a user-facing route.
   */
  adminApproved?: boolean;
  to: string;
  usdcAmount: number;
}): Promise<Hash> {
  const ctx = clients();
  const usdc = onchainFacts.usdcAddress;

  if (!ctx || !usdc) {
    throw new TreasuryError(
      "Payouts are not configured: set ONE_POINTS_TREASURY_PRIVATE_KEY.",
    );
  }

  if (!isAddress(input.to)) {
    throw new TreasuryError("The destination wallet is not a valid address.");
  }

  if (!Number.isFinite(input.usdcAmount) || input.usdcAmount <= 0) {
    throw new TreasuryError("The payout amount must be greater than zero.");
  }

  const cap = maxAutomaticPayoutUsdc();
  if (input.usdcAmount > cap && !input.adminApproved) {
    throw new TreasuryError(
      `Redemptions above ${cap} USDC are reviewed manually. Redeem a smaller amount or contact support.`,
    );
  }

  const amountUnits = parseUnits(input.usdcAmount.toFixed(6), 6);

  // Check first so an underfunded treasury fails before any points are spent,
  // rather than reverting on chain afterwards.
  const balance = (await ctx.publicClient.readContract({
    abi: erc20Abi,
    address: usdc,
    args: [ctx.account.address],
    functionName: "balanceOf",
  })) as bigint;

  if (balance < amountUnits) {
    throw new TreasuryError(
      "The OnePoints treasury is temporarily out of USDC. Your points were not spent.",
    );
  }

  const hash = await ctx.walletClient.writeContract({
    abi: erc20Abi,
    address: usdc,
    args: [getAddress(input.to), amountUnits],
    functionName: "transfer",
  });

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new TreasuryError("The payout transaction reverted on chain.");
  }

  return hash;
}
