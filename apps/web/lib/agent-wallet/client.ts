// Server-only: reads CIRCLE_* secrets and must never reach a browser bundle.
import { arcCircleBlockchain } from "@/lib/chains";
import { createHash, randomUUID } from "node:crypto";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi as viemErc20Abi,
  getAddress,
  http,
  isAddress,
  maxUint256,
  zeroAddress,
  zeroHash,
  type Address,
} from "viem";
import {
  initiateDeveloperControlledWalletsClient,
  type CircleDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";

import { officialArcChainId, officialArcRpcUrl } from "@/lib/network";
import { getSaphraSendAddress, swiftPaySendAbi } from "@/lib/contracts";
import { arcTokens } from "@/lib/tokens";

import {
  formatAmountUnits,
  parseDecimalToUnits,
  type PaymentIntent,
  type PaymentIntentAsset,
} from "@/lib/payment-engine/intent";
import type { ExecutionResult } from "@/lib/payment-engine/executors";

export type AgentWalletInfo = {
  walletId: string;
  address: Address;
  blockchain: string;
  state: string;
};

/** Arc Testnet by default; flips with NEXT_PUBLIC_ARC_NETWORK. */
export function agentWalletBlockchain() {
  return arcCircleBlockchain;
}



const terminalStates: readonly string[] = [
  "COMPLETE",
  "FAILED",
  "DENIED",
  "CANCELLED",
];

const pollIntervalMs = 2_000;
const maxPollAttempts = 45;

let cachedClient: CircleDeveloperControlledWalletsClient | null = null;

/**
 * Credentials are environment-only and never leave this module.
 * Errors intentionally omit the values they were reading.
 */
export function getAgentWalletClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.CIRCLE_DEVELOPER_CONTROLLED_API_KEY?.trim();
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();

  if (!apiKey || !entitySecret) {
    throw new Error(
      "Agent Wallet is not configured. Set CIRCLE_DEVELOPER_CONTROLLED_API_KEY and CIRCLE_ENTITY_SECRET.",
    );
  }

  const baseUrl = process.env.CIRCLE_BASE_URL?.trim();

  cachedClient = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
    ...(baseUrl ? { baseUrl } : {}),
  });

  return cachedClient;
}

export function isAgentWalletConfigured() {
  return Boolean(
    process.env.CIRCLE_DEVELOPER_CONTROLLED_API_KEY?.trim() &&
      process.env.CIRCLE_ENTITY_SECRET?.trim(),
  );
}

/**
 * Circle's SDK surfaces failures as axios errors, whose `message` is only
 * "Request failed with status code 400". The useful text is in the response
 * body, so dig it out — otherwise every failure reads the same.
 */
export function readCircleError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      message?: string;
      response?: {
        data?: {
          message?: string;
          errors?: { message?: string; error?: string }[];
        };
      };
    };

    const data = candidate.response?.data;
    const nested = data?.errors?.find((entry) => entry.message || entry.error);
    const detail = data?.message ?? nested?.message ?? nested?.error;

    if (detail) {
      return detail;
    }

    if (candidate.message) {
      return candidate.message;
    }
  }

  return error instanceof Error ? error.message : fallback;
}

function walletSetName(ownerWallet: string) {
  return `SaphraONE ALLIE — ${ownerWallet.slice(0, 6)}…${ownerWallet.slice(-4)}`;
}

export async function createAgentWalletSet(ownerWallet: string) {
  const client = getAgentWalletClient();

  const response = await client.createWalletSet({
    name: walletSetName(ownerWallet),
    idempotencyKey: randomUUID(),
  });

  const walletSetId = response.data?.walletSet?.id;

  if (!walletSetId) {
    throw new Error("Circle did not return an agent wallet set id.");
  }

  return { walletSetId };
}

export async function createAgentWallet(
  walletSetId: string,
  ownerWallet: string,
): Promise<AgentWalletInfo> {
  const client = getAgentWalletClient();
  const blockchain = agentWalletBlockchain();

  const response = await client.createWallets({
    blockchains: [blockchain as never],
    count: 1,
    walletSetId,
    // EOA: on Arc, USDC is the native gas token, so funding the wallet with
    // USDC is all it needs to transact.
    accountType: "EOA",
    metadata: [{ refId: ownerWallet.toLowerCase() }],
    idempotencyKey: randomUUID(),
  });

  const wallet = response.data?.wallets?.[0];

  if (!wallet?.id || !wallet.address) {
    throw new Error("Circle did not return an agent wallet.");
  }

  return {
    walletId: wallet.id,
    address: wallet.address as Address,
    blockchain: wallet.blockchain ?? blockchain,
    state: wallet.state ?? "LIVE",
  };
}

type TokenBalanceEntry = {
  amount?: string;
  token?: { id?: string; symbol?: string; name?: string; decimals?: number };
};

async function readTokenBalances(walletId: string) {
  const client = getAgentWalletClient();

  const response = await client.getWalletTokenBalance({
    id: walletId,
    includeAll: true,
  });

  return (response.data?.tokenBalances ?? []) as TokenBalanceEntry[];
}

function matchAssetBalance(
  balances: TokenBalanceEntry[],
  asset: PaymentIntentAsset,
) {
  return balances.find((entry) => {
    const symbol = entry.token?.symbol?.toUpperCase();
    const name = entry.token?.name?.toUpperCase();
    return symbol === asset || name?.includes(asset);
  });
}

export async function getAgentWalletBalance(
  walletId: string,
  asset: PaymentIntentAsset,
): Promise<bigint> {
  const balances = await readTokenBalances(walletId);
  const match = matchAssetBalance(balances, asset);

  // `amount` is already a human decimal — the token's own `decimals` (18 for
  // native USDC on Arc) describes the token, not this string.
  return parseDecimalToUnits(match?.amount);
}

/** Balances for every asset SaphraONE supports, in 6-decimal units. */
export async function getAgentWalletBalances(walletId: string) {
  const balances = await readTokenBalances(walletId);

  return {
    USDC: parseDecimalToUnits(matchAssetBalance(balances, "USDC")?.amount),
    EURC: parseDecimalToUnits(matchAssetBalance(balances, "EURC")?.amount),
  };
}

/**
 * Prefer Circle's own token id — on Arc, USDC is the native gas token and a
 * token address is not always the right handle. Falls back to the address from
 * lib/network via lib/tokens (never a hardcoded constant).
 */
async function resolveTokenTarget(
  walletId: string,
  asset: PaymentIntentAsset,
) {
  const balances = await readTokenBalances(walletId);
  const tokenId = matchAssetBalance(balances, asset)?.token?.id;

  if (tokenId) {
    return { tokenId } as const;
  }

  return {
    tokenAddress: arcTokens[asset].address,
    blockchain: agentWalletBlockchain(),
  } as const;
}

export async function getAgentTransaction(transactionId: string) {
  const client = getAgentWalletClient();
  const response = await client.getTransaction({ id: transactionId });
  return response.data?.transaction ?? null;
}

/**
 * ALLIE's only execution path. The intent must already have passed the policy
 * engine and carry an explicitly confirmed, resolved recipient.
 */
export async function executeAgentTransfer(
  walletId: string,
  intent: PaymentIntent,
  options: { idempotencyKey?: string } = {},
): Promise<ExecutionResult> {
  const recipient = intent.resolvedRecipient;

  if (!recipient) {
    return {
      status: "failed",
      error: "Intent recipient has not been resolved to an address yet.",
    };
  }

  try {
    const client = getAgentWalletClient();
    const tokenTarget = await resolveTokenTarget(walletId, intent.asset);

    const response = await client.createTransaction({
      walletId,
      ...tokenTarget,
      amount: [formatAmountUnits(intent.amountUnits)],
      destinationAddress: recipient,
      refId: intent.intentId,
      fee: { type: "level", config: { feeLevel: "HIGH" } },
      // Circle requires a UUID here. intentId is a uuid v4 and is unique per
      // intent, so a retried execution collapses onto the same transfer. A
      // batch leg passes its own derived key instead.
      idempotencyKey: options.idempotencyKey ?? intent.intentId,
    } as Parameters<typeof client.createTransaction>[0]);

    const transactionId = response.data?.id;

    if (!transactionId) {
      return { status: "failed", error: "Circle did not return a transaction." };
    }

    // Poll briefly so the confirmation card can show a real hash.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const transaction = await getAgentTransaction(transactionId);
      const state = transaction?.state;

      if (transaction?.txHash) {
        return {
          txHash: transaction.txHash,
          transactionId,
          status: "submitted",
        };
      }

      if (state && terminalStates.includes(state) && state !== "COMPLETE") {
        return {
          transactionId,
          status: "failed",
          error: `Agent transfer ${state.toLowerCase()}.`,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return { transactionId, status: "submitted" };
  } catch (error) {
    return {
      status: "failed",
      error: readCircleError(error, "Agent transfer could not be submitted."),
    };
  }
}

export type AgentFundingInstruction = {
  agentWalletAddress: Address;
  token: Address;
  asset: PaymentIntentAsset;
  amountUnits: string;
  amountDisplay: string;
  chainBlockchain: string;
};

/**
 * Funding moves value OUT of the user's primary wallet, so it must be signed by
 * the user — the server never has those keys. This validates the request and
 * returns the transfer the client is to sign.
 */
export function prepareAgentWalletFunding(input: {
  agentWalletAddress: Address;
  fromAddress: Address;
  amountUnits: bigint;
  asset?: PaymentIntentAsset;
}): AgentFundingInstruction {
  if (input.amountUnits <= 0n) {
    throw new Error("Funding amount must be greater than zero.");
  }

  if (
    input.fromAddress.toLowerCase() === input.agentWalletAddress.toLowerCase()
  ) {
    throw new Error("Agent wallet cannot fund itself.");
  }

  const asset = input.asset ?? "USDC";

  return {
    agentWalletAddress: input.agentWalletAddress,
    token: arcTokens[asset].address,
    asset,
    amountUnits: input.amountUnits.toString(),
    amountDisplay: formatAmountUnits(input.amountUnits),
    chainBlockchain: agentWalletBlockchain(),
  };
}

/**
 * Kept for the documented Phase E surface. Funding is user-signed, so this
 * only validates and hands back the instruction via the API route.
 */
export async function fundAgentWallet(
  walletId: string,
  fromAddress: Address,
  amountUnits: bigint,
): Promise<void> {
  if (!walletId.trim()) {
    throw new Error("Agent wallet id is required.");
  }

  if (amountUnits <= 0n) {
    throw new Error("Funding amount must be greater than zero.");
  }

  if (!fromAddress) {
    throw new Error("A funding source address is required.");
  }
}

export type AgentBatchLeg = {
  recipient: Address;
  amountUnits: bigint;
  label?: string;
  /** Fee legs are reported separately so a fee failure never reads as a
   *  failed payment. */
  kind?: "payment" | "fee";
};

export type AgentBatchResult = {
  status: "submitted" | "failed";
  legs: {
    recipient: string;
    label?: string;
    kind: "payment" | "fee";
    amountUnits: string;
    txHash?: string;
    transactionId?: string;
    status: "submitted" | "failed";
    error?: string;
  }[];
  submitted: number;
  failed: number;
  feesFailed: number;
};

/**
 * Circle requires a UUID idempotency key. Each leg of a batch needs its own,
 * and it has to be stable so a retried batch does not double-pay a leg that
 * already went through.
 */
function legIdempotencyKey(intentId: string, index: number) {
  const hex = createHash("sha256")
    .update(`${intentId}:${index}`)
    .digest("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Pays several recipients from the Agent Wallet, one transfer per leg.
 *
 * Legs are sequential on purpose: Circle serialises nonces per wallet, and a
 * partial failure has to leave a readable trail of exactly which legs landed.
 */
export async function executeAgentBatch(
  walletId: string,
  intent: PaymentIntent,
  legs: AgentBatchLeg[],
): Promise<AgentBatchResult> {
  const results: AgentBatchResult["legs"] = [];

  for (const [index, leg] of legs.entries()) {
    const legIntent: PaymentIntent = {
      ...intent,
      amountUnits: leg.amountUnits,
      resolvedRecipient: leg.recipient,
      recipient: leg.label ?? leg.recipient,
      idempotencyKey: legIdempotencyKey(intent.intentId, index),
    };

    // Payments go through the router so the platform fee is taken on-chain
    // in the same call; ALLIE's own fee is a plain transfer.
    const outcome =
      (leg.kind ?? "payment") === "payment"
        ? await executeAgentRouterSend(
            walletId,
            intent,
            { amountUnits: leg.amountUnits, recipient: leg.recipient },
            { idempotencyKey: legIdempotencyKey(intent.intentId, index) },
          )
        : await executeAgentTransfer(walletId, legIntent, {
            idempotencyKey: legIdempotencyKey(intent.intentId, index),
          });

    results.push({
      amountUnits: leg.amountUnits.toString(),
      error: outcome.error,
      kind: leg.kind ?? "payment",
      label: leg.label,
      recipient: leg.recipient,
      status: outcome.status,
      transactionId: outcome.transactionId,
      txHash: outcome.txHash,
    });
  }

  // Success is judged on the payments. A fee that fails is reported, but it
  // does not turn a delivered payment into a failure.
  const payments = results.filter((leg) => leg.kind === "payment");
  const submitted = payments.filter((leg) => leg.status === "submitted").length;

  return {
    failed: payments.length - submitted,
    feesFailed: results.filter(
      (leg) => leg.kind === "fee" && leg.status === "failed",
    ).length,
    legs: results,
    status: submitted > 0 ? "submitted" : "failed",
    submitted,
  };
}

// ─── SwiftPaySend router ─────────────────────────────────────────────────────

/**
 * Agent payments settle through the same SwiftPaySend router every other
 * SaphraONE send uses, so the 0.1% platform fee is taken on-chain in the same
 * transaction rather than as a second transfer we have to remember to make.
 *
 * The router pulls with `transferFrom`, so the Agent Wallet has to approve it
 * once before the first payment.
 */

const approvalStates: readonly string[] = ["CONFIRMED", "COMPLETE"];

function arcPublicClient() {
  const rpcUrl = officialArcRpcUrl();
  const chainId = officialArcChainId();

  if (!rpcUrl || !chainId) {
    throw new Error("Arc RPC is not configured. Set NEXT_PUBLIC_ARC_RPC_URL.");
  }

  return createPublicClient({ transport: http(rpcUrl) });
}

export function agentSendRouter(): Address {
  const configured = getSaphraSendAddress().trim();

  if (!isAddress(configured)) {
    throw new Error(
      "The SaphraONE send router is not configured. Set NEXT_PUBLIC_SWIFTPAY_SEND_ADDRESS.",
    );
  }

  return getAddress(configured) as Address;
}

/** Waits for a Circle transaction to actually land, not merely to be accepted. */
async function waitForConfirmation(transactionId: string) {
  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    const transaction = await getAgentTransaction(transactionId);
    const state = transaction?.state;

    if (state && approvalStates.includes(state)) {
      return transaction;
    }

    if (state && terminalStates.includes(state) && state !== "COMPLETE") {
      throw new Error(`Approval ${state.toLowerCase()}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Timed out waiting for the router approval to confirm.");
}

/**
 * Approves the router to pull from the Agent Wallet, if it cannot already.
 * Reads the live allowance first so a funded wallet never pays for a
 * redundant approval.
 */
export async function ensureRouterAllowance(input: {
  walletId: string;
  walletAddress: Address;
  token: Address;
  required: bigint;
}): Promise<{ approved: boolean; txHash?: string }> {
  const router = agentSendRouter();

  let allowance = 0n;

  try {
    allowance = await arcPublicClient().readContract({
      abi: viemErc20Abi,
      address: input.token,
      args: [input.walletAddress, router],
      functionName: "allowance",
    });
  } catch {
    // An unreadable allowance is treated as zero: approving again is safe,
    // sending without an approval is not.
    allowance = 0n;
  }

  if (allowance >= input.required) {
    return { approved: false };
  }

  const client = getAgentWalletClient();

  const response = await client.createContractExecutionTransaction({
    walletId: input.walletId,
    contractAddress: input.token,
    callData: encodeFunctionData({
      abi: viemErc20Abi,
      args: [router, maxUint256],
      functionName: "approve",
    }),
    fee: { type: "level", config: { feeLevel: "HIGH" } },
    idempotencyKey: randomUUID(),
  } as Parameters<typeof client.createContractExecutionTransaction>[0]);

  const transactionId = response.data?.id;

  if (!transactionId) {
    throw new Error("Circle did not return an approval transaction.");
  }

  const confirmed = await waitForConfirmation(transactionId);

  return { approved: true, txHash: confirmed?.txHash };
}

/**
 * One payment through the router. The router moves the payment to the
 * recipient and the 0.1% fee to its own fee recipient in a single call, so
 * this is the whole settlement — there is no separate platform fee transfer.
 */
export async function executeAgentRouterSend(
  walletId: string,
  intent: PaymentIntent,
  leg: { recipient: Address; amountUnits: bigint },
  options: { idempotencyKey?: string } = {},
): Promise<ExecutionResult> {
  try {
    const client = getAgentWalletClient();
    const router = agentSendRouter();

    const response = await client.createContractExecutionTransaction({
      walletId,
      contractAddress: router,
      callData: encodeFunctionData({
        abi: swiftPaySendAbi,
        args: [
          arcTokens[intent.asset].address,
          leg.recipient,
          leg.amountUnits,
          zeroAddress,
          zeroHash,
          0n,
        ],
        functionName: "send",
      }),
      refId: intent.intentId,
      fee: { type: "level", config: { feeLevel: "HIGH" } },
      idempotencyKey: options.idempotencyKey ?? intent.intentId,
    } as Parameters<typeof client.createContractExecutionTransaction>[0]);

    const transactionId = response.data?.id;

    if (!transactionId) {
      return { status: "failed", error: "Circle did not return a transaction." };
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const transaction = await getAgentTransaction(transactionId);
      const state = transaction?.state;

      if (transaction?.txHash) {
        return { txHash: transaction.txHash, transactionId, status: "submitted" };
      }

      if (state && terminalStates.includes(state) && state !== "COMPLETE") {
        return {
          transactionId,
          status: "failed",
          error: `Payment ${state.toLowerCase()}.`,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return { transactionId, status: "submitted" };
  } catch (error) {
    return {
      status: "failed",
      error: readCircleError(error, "Payment could not be submitted."),
    };
  }
}
