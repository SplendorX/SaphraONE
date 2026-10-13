import "@/lib/env-compat";
import {
  createPublicClient,
  createWalletClient,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  erc20Abi,
  swiftRecurepayExecutorAbi,
  swiftRecurepayExecutorAddress,
} from "@/lib/contracts";
import { recurringFeeUnits } from "@/lib/fees";
import { legacyRecurepayExecutor } from "@/lib/recurring/executor";
import { buildAutopayExecutionId } from "@/lib/recurring-utils";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";
import { arcChain, arcTransport } from "@/lib/chains";

function getOperatorPrivateKey() {
  return process.env.SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY?.trim() || null;
}

export function isRecurringOperatorConfigured() {
  return Boolean(swiftRecurepayExecutorAddress && getOperatorPrivateKey());
}

export function createRecurringPublicClient() {
  return createPublicClient({
    chain: arcChain,
    transport: arcTransport(),
  });
}

export function createRecurringArcClients() {
  const privateKey = getOperatorPrivateKey();
  if (!privateKey) {
    return null;
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createRecurringPublicClient();
  const walletClient = createWalletClient({
    account,
    chain: arcChain,
    transport: arcTransport(),
  });

  return { account, publicClient, walletClient };
}

/** The fee `executor` (the configured one by default) takes on a payment. */
export function computeRecurringFeeUnits(amountUnits: bigint, executor?: string) {
  return recurringFeeUnits(amountUnits, executor);
}

export type CircleAdapterSubmitInput = {
  amountUnits: bigint;
  executionId: string;
  /** The payer's on-chain mandate; it fixes the recipient, token and cap. */
  mandateId: Hex;
  /** The executor holding the mandate (see resolveMandateExecutor). */
  executor?: Address;
};

export type CircleAdapterSubmitResult =
  | { ok: true; alreadyConsumed: false; txHash: Hash }
  | { ok: true; alreadyConsumed: true; txHash?: Hash }
  | { ok: false; error: string; permanent?: boolean };

/**
 * On-chain adapter for autonomous Autopay.
 * Uses the platform operator key against SwiftRecurepayExecutor — never a user key.
 * Circle user-controlled wallets authorize via a one-time ERC-20 approve.
 */
export async function circleAdapterSubmitPayment(
  input: CircleAdapterSubmitInput,
): Promise<CircleAdapterSubmitResult> {
  const executor = input.executor ?? (swiftRecurepayExecutorAddress as Address);
  if (!executor) {
    return { error: "RecurePay executor is not configured.", ok: false };
  }

  const clients = createRecurringArcClients();
  if (!clients) {
    return { error: "Recurring operator wallet is not configured.", ok: false };
  }

  const onchainOperator = await clients.publicClient.readContract({
    abi: swiftRecurepayExecutorAbi,
    address: executor,
    functionName: "operator",
  });

  if (onchainOperator.toLowerCase() !== clients.account.address.toLowerCase()) {
    return {
      error: "Recurring operator wallet does not match the onchain executor operator.",
      ok: false,
      permanent: true,
    };
  }

  const executionKey = buildAutopayExecutionId(input.executionId);
  const alreadyConsumed = await clients.publicClient.readContract({
    abi: swiftRecurepayExecutorAbi,
    address: executor,
    args: [executionKey],
    functionName: "consumedExecutionIds",
  });

  if (alreadyConsumed) {
    return { alreadyConsumed: true, ok: true };
  }

  try {
    const hash = await clients.walletClient.writeContract({
      abi: swiftRecurepayExecutorAbi,
      address: executor,
      args: [executionKey, input.mandateId, input.amountUnits],
      functionName: "executeRecurringPayment",
    });

    return { alreadyConsumed: false, ok: true, txHash: hash as Hash };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Autopay transaction failed.";
    const permanent =
      /already executed|not operator|mandate ?inactive|mandate ?expired|exceeds ?mandate ?limit/i.test(
        message,
      );
    return { error: message, ok: false, permanent };
  }
}

export async function circleAdapterReadBalanceAndAllowance(input: {
  payer: Address;
  tokenSymbol: ArcTokenSymbol;
  /** The executor to read the allowance for; the configured one by default. */
  executor?: Address;
}) {
  const executor = input.executor ?? (swiftRecurepayExecutorAddress as Address);
  if (!executor) {
    return { allowance: 0n, balance: 0n, configured: false as const };
  }

  const publicClient = createRecurringPublicClient();
  const tokenInfo = arcTokens[input.tokenSymbol];
  const [balance, allowance] = await Promise.all([
    publicClient.readContract({
      abi: erc20Abi,
      address: tokenInfo.address,
      args: [input.payer],
      functionName: "balanceOf",
    }),
    publicClient.readContract({
      abi: erc20Abi,
      address: tokenInfo.address,
      args: [input.payer, executor],
      functionName: "allowance",
    }),
  ]);

  return { allowance, balance, configured: true as const };
}

export async function circleAdapterGetReceipt(txHash: Hash) {
  const publicClient = createRecurringPublicClient();
  try {
    return await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    return null;
  }
}

/** Whether a payment was made, on the configured executor or the old one. */
export async function circleAdapterWasConsumed(executionId: string) {
  if (!swiftRecurepayExecutorAddress) {
    return false;
  }

  const publicClient = createRecurringPublicClient();
  const executors = [swiftRecurepayExecutorAddress as Address, legacyRecurepayExecutor()].filter(
    (value): value is Address => Boolean(value),
  );
  for (const address of executors) {
    const consumed = await publicClient.readContract({
      abi: swiftRecurepayExecutorAbi,
      address,
      args: [buildAutopayExecutionId(executionId)],
      functionName: "consumedExecutionIds",
    });
    if (consumed) return true;
  }
  return false;
}
