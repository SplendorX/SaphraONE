import {
  createPublicClient,
  encodeFunctionData,
  http,
  erc20Abi as viemErc20Abi,
  formatUnits,
  maxUint256,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import {
  erc20Abi,
  getSaphraSendAddress,
  swiftPaySendAbi,
} from "@/lib/contracts";
import { arcChain } from "@/lib/chains";
import { callCircleWalletApi } from "@/lib/circle-session";
import { arcTokens } from "@/lib/tokens";
import { withTxApproval } from "@/lib/tx-approval/client";

type ExternalWrite = (args: {
  address: Address;
  abi: typeof erc20Abi | typeof swiftPaySendAbi;
  functionName: string;
  args: readonly unknown[];
  chainId: number;
}) => Promise<Hash>;

type CircleExecutor = {
  /** The Circle wallet paying: lets the send be confirmed once for all its calls. */
  walletId?: string;
  execute: (callData: Hex, contractAddress: Address, refId: string) => Promise<{
    txHash?: string;
    transactionId?: string;
  }>;
};

export type BundledSendInput = {
  chainId: number;
  token: Address;
  recipient: Address;
  paymentUnits: bigint;
  feeUnits: bigint;
  feeRecipient: Address;
  router?: string;
  save?: {
    vault: Address;
    pocketId: Hex;
    amount: bigint;
  };
  mode: "external" | "circle";
  writeContractAsync?: ExternalWrite;
  readAllowance?: (spender: Address) => Promise<bigint>;
  circleExecutor?: CircleExecutor;
};

export type BundledSendResult = {
  txHash?: Hash;
  transactionId?: string;
  bundledSave: boolean;
};

export function sendRouterAddress(override?: string): Address | null {
  const value = (override || getSaphraSendAddress()).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    return null;
  }
  return value as Address;
}

function encodeErc20Approve(spender: Address, amount: bigint) {
  return encodeFunctionData({
    abi: viemErc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}

function encodeRouterSend(input: {
  token: Address;
  recipient: Address;
  paymentUnits: bigint;
  vault: Address;
  pocketId: Hex;
  saveAmount: bigint;
}) {
  return encodeFunctionData({
    abi: swiftPaySendAbi,
    functionName: "send",
    args: [
      input.token,
      input.recipient,
      input.paymentUnits,
      input.vault,
      input.pocketId,
      input.saveAmount,
    ],
  });
}

/**
 * Payment + 0.1% fee + optional Spend&Save in a single contract call.
 * Never opens a wallet prompt per leg.
 */
async function resolveSendRouter(override?: string): Promise<Address> {
  const fromInput = sendRouterAddress(override);
  if (fromInput) {
    return fromInput;
  }

  const fromEnv = sendRouterAddress();
  if (fromEnv) {
    return fromEnv;
  }

  if (typeof fetch === "function") {
    try {
      const response = await fetch("/api/platform/contracts", {
        cache: "no-store",
      });
      const payload = (await response.json()) as { sendRouter?: string };
      const fromApi = sendRouterAddress(payload.sendRouter);
      if (fromApi) {
        return fromApi;
      }
    } catch {
      // fall through
    }
  }

  throw new Error(
    "Send router is not configured. Set NEXT_PUBLIC_SWIFTPAY_SEND_ADDRESS.",
  );
}

function isTxHash(value: unknown): value is Hash {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** Arc client for confirming wallet transactions. */
let arcClient: ReturnType<typeof createPublicClient> | null = null;

function arcReceiptClient(chainId: number) {
  if (chainId !== arcChain.id) return null;
  arcClient ??= createPublicClient({ chain: arcChain, transport: http() });
  return arcClient;
}

/**
 * Wait until a transaction is mined and fail loudly if it reverted. A wallet
 * returns a hash as soon as it broadcasts, so a hash alone does not mean the
 * money moved.
 */
async function confirmOnChain(chainId: number, hash: Hash, what: "approval" | "payment") {
  const client = arcReceiptClient(chainId);
  if (!client) return;

  let status: "success" | "reverted";
  try {
    ({ status } = await client.waitForTransactionReceipt({ hash, timeout: 90_000 }));
  } catch {
    throw new Error(
      what === "payment"
        ? "The payment is taking longer than usual to confirm. Check Activity before sending again, so it isn't paid twice."
        : "The approval is taking longer than usual to confirm. Wait a moment, then try the payment again.",
    );
  }

  if (status !== "success") {
    throw new Error(
      what === "payment"
        ? "The payment failed on-chain, so nothing was sent. Only the network fee was used. Try again."
        : "The approval failed on-chain, so the payment was not sent. Try again.",
    );
  }
}

async function runBundledSend(
  input: BundledSendInput,
): Promise<BundledSendResult> {
  const router = await resolveSendRouter(input.router);

  const saveAmount = input.save?.amount ?? 0n;
  const bundledSave = saveAmount > 0n;
  const total = input.paymentUnits + input.feeUnits + saveAmount;
  let allowance: bigint | null = null;
  if (input.readAllowance) {
    try {
      allowance = await Promise.race([
        input.readAllowance(router),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6_000)),
      ]);
    } catch {
      allowance = null;
    }
  }
  // An allowance we could not read is treated as missing. Guessing "enough"
  // sends a payment the router cannot pull, which reverts on-chain after the
  // wallet has already reported it as sent.
  const needsApproval = allowance === null || allowance < total;

  async function approveRouter() {
    if (input.mode === "external") {
      if (!input.writeContractAsync) {
        throw new Error("Wallet writer is not available.");
      }
      const approveHash = await input.writeContractAsync({
        address: input.token,
        abi: erc20Abi,
        functionName: "approve",
        args: [router, maxUint256],
        chainId: input.chainId,
      });
      // The payment must not go out before the approval is mined.
      await confirmOnChain(input.chainId, approveHash, "approval");
      return;
    }

    if (!input.circleExecutor) {
      throw new Error("Circle wallet is not ready.");
    }
    const approval = await input.circleExecutor.execute(
      encodeErc20Approve(router, maxUint256),
      input.token,
      "send-approve",
    );
    // Circle queues the payment straight after; sent before the approval is
    // mined, the router can't pull the funds and the payment reverts after
    // Circle has already reported it as sent.
    if (!isTxHash(approval.txHash)) {
      throw new Error(
        "The approval is taking longer than usual to confirm. Wait a moment, then try the payment again.",
      );
    }
    await confirmOnChain(input.chainId, approval.txHash, "approval");
  }

  if (needsApproval) {
    await approveRouter();
  }

  if (input.mode === "external") {
    if (!input.writeContractAsync) {
      throw new Error("Wallet writer is not available.");
    }

    const hash = await input.writeContractAsync({
      address: router,
      abi: swiftPaySendAbi,
      functionName: "send",
      args: [
        input.token,
        input.recipient,
        input.paymentUnits,
        input.save?.vault ?? zeroAddress,
        input.save?.pocketId ?? zeroHash,
        saveAmount,
      ],
      chainId: input.chainId,
    });
    await confirmOnChain(input.chainId, hash, "payment");
    return { txHash: hash, bundledSave };
  }

  if (!input.circleExecutor) {
    throw new Error("Circle wallet is not ready.");
  }

  const result = await input.circleExecutor.execute(
    encodeRouterSend({
      token: input.token,
      recipient: input.recipient,
      paymentUnits: input.paymentUnits,
      vault: input.save?.vault ?? zeroAddress,
      pocketId: input.save?.pocketId ?? zeroHash,
      saveAmount,
    }),
    router,
    "send-bundle",
  );
  // Circle answers once the person confirms, not once the payment lands:
  // only a mined, successful payment counts as sent.
  if (!isTxHash(result.txHash)) {
    throw new Error(
      "Your transfer was submitted and is still confirming. Your balance will update shortly — no need to send it again.",
    );
  }
  await confirmOnChain(input.chainId, result.txHash, "payment");
  return {
    txHash: result.txHash,
    transactionId: result.transactionId,
    bundledSave,
  };
}

export async function executeCircleContract(params: {
  userToken: string;
  walletId: string;
  contractAddress: Address;
  callData: Hex;
  refId?: string;
}) {
  return callCircleWalletApi<{
    challengeId?: string;
    id?: string;
  }>("createContractExecution", {
    callData: params.callData,
    contractAddress: params.contractAddress,
    feeLevel: "HIGH",
    refId: params.refId,
    userToken: params.userToken,
    walletId: params.walletId,
  });
}

/**
 * Send with the router. A Circle-wallet send is confirmed once (Face ID, PIN
 * or 2FA, see lib/tx-approval) for both its approval and the payment; the
 * server checks the recipient and amount of each call against it.
 */
export async function executeBundledSend(
  input: BundledSendInput,
): Promise<BundledSendResult> {
  const walletId = input.mode === "circle" ? input.circleExecutor?.walletId : undefined;
  if (!walletId) {
    return runBundledSend(input);
  }
  const token = Object.values(arcTokens).find(
    (entry) => entry.address.toLowerCase() === input.token.toLowerCase(),
  );
  return withTxApproval(
    {
      amount: formatUnits(input.paymentUnits, token?.decimals ?? 6),
      destination: input.recipient,
      kind: "send",
      maxUses: 2,
      title: "Send money",
      token: token?.symbol ?? "USDC",
      walletId,
    },
    () => runBundledSend(input),
  );
}
