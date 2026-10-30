import { SWAP_FEE_BPS } from "@/lib/fees";
import { withApproval } from "@/lib/tx-approval/client";
import type { ArcTokenSymbol } from "@/lib/tokens";
import { arcTokens } from "@/lib/tokens";
import { arcAddChainParameter, arcSwitchErrorMessage } from "@/lib/arc-network";
import { arcChain } from "@/lib/chains";
import { isArcMainnet } from "@/lib/network";
import type { Abi, Address, Hash, Hex } from "viem";

type Eip1193Provider = {
  on: <TEvent extends string>(
    event: TEvent,
    listener: (...args: unknown[]) => void,
  ) => void;
  request: <TReturn = unknown>(args: {
    method: string;
    params?: unknown;
  }) => Promise<TReturn>;
  removeListener: <TEvent extends string>(
    event: TEvent,
    listener: (...args: unknown[]) => void,
  ) => void;
};

type WalletConnector = {
  getProvider?: (parameters?: { chainId?: number }) => Promise<unknown> | unknown;
};

type SwapRequest = {
  amountIn: string;
  connector: WalletConnector | undefined;
  slippageBps: number;
  stopLimit?: string;
  tokenIn: ArcTokenSymbol;
  tokenOut: ArcTokenSymbol;
};

type CircleChallengeExecutionResult = {
  transactionId?: string;
  txHash?: string;
};

export type CircleUserWalletKitRequest = {
  executeChallenge: (
    challengeId: string,
    label?: string,
  ) => Promise<CircleChallengeExecutionResult>;
  onStatus?: (status: string) => void;
  userToken: string;
  walletAddress: Address;
  walletId: string;
};

export type CircleUserWalletSwapRequest = CircleUserWalletKitRequest & {
  amountIn: string;
  slippageBps: number;
  stopLimit?: string;
  tokenIn: ArcTokenSymbol;
  tokenOut: ArcTokenSymbol;
};

export type CircleSwapEstimate = {
  estimatedOutput: string;
  estimatedOutputAmount: string;
  fees: string[];
  minimumOutput: string;
  stopLimitAmount: string;
};

export type CircleSwapExecution = {
  amountOut?: string;
  explorerUrl?: string;
  txHash: string;
};

// The Arc network the app is configured for (mainnet or testnet), and the
// matching App Kit chain name.
const ARC_CHAIN_ID = arcChain.id;
const ARC_CHAIN_ID_HEX = `0x${ARC_CHAIN_ID.toString(16)}`;
const ARC_CHAIN_NAME = arcChain.name;
const APP_KIT_ARC_CHAIN = isArcMainnet() ? "Arc" : "Arc_Testnet";
const CIRCLE_API_ORIGIN = "https://api.circle.com";
const CIRCLE_STABLECOIN_KIT_PROXY_PATHS = new Set([
  "/v1/stablecoinKits/quote",
  "/v1/stablecoinKits/swap",
  "/v1/stablecoinKits/swap/status",
]);
const NATIVE_TOKEN_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const zeroBigInt = BigInt(0);
const defaultFeeBufferBasisPoints = BigInt(500);
const basisPointsDenominator = BigInt(10_000);
const circleTransactionHashAttempts = 60;
const circleTransactionHashDelayMs = 1_000;
const circleTransactionReceiptTimeoutMs = 10 * 60 * 1_000;
const circleTransactionReceiptPollMs = 2_000;
const circleApprovalOptimisticWaitMs = 20_000;

type AnyRecord = Record<string, unknown>;

type CircleContractExecutionChallenge = {
  challengeId?: string;
  id?: string;
  transaction?: CircleWalletTransaction;
  transactionId?: string;
  txHash?: string;
};

type CircleWalletTransaction = {
  contractAddress?: string;
  createDate?: string;
  errorDetails?: string;
  errorReason?: string;
  id?: string;
  refId?: string;
  state?: string;
  transaction?: CircleWalletTransaction;
  transactionHash?: string;
  transactionId?: string;
  transactionType?: string;
  txHash?: string;
  updateDate?: string;
  walletId?: string;
};

type CircleUserChallenge = {
  challenge?: CircleUserChallenge;
  correlationIds?: string[];
  errorCode?: number | string;
  errorMessage?: string;
  id?: string;
  status?: string;
  type?: string;
};

type EstimatedGas = {
  fee: string;
  gas: bigint;
  gasPrice: bigint;
};

type EvmEstimateOverrides = {
  gasLimit?: number;
};

type EvmPreparedRequest = {
  estimate: (
    overrides?: EvmEstimateOverrides,
    fallback?: EstimatedGas,
  ) => Promise<EstimatedGas>;
  execute: (overrides?: EvmEstimateOverrides) => Promise<string>;
  getCallData?: () => {
    data: Hex;
    to: Address;
    value?: bigint;
  };
  type: "evm";
};

type CircleTransactionWaitContext = {
  challengeId?: string;
  contractAddress: Address;
  label: string;
  refId: string;
  transactionId?: string;
  waitForEffect?: () => Promise<boolean>;
};

type CircleRecoveredTransactionHash = {
  transactionId?: string;
  txHash: string;
};

type EvmPrepareParams = {
  abi?: Abi;
  address: Address;
  args?: readonly unknown[];
  blockNumber?: bigint;
  functionName?: string;
  type: "evm";
  value?: bigint;
};

const erc20SwapAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const satisfies Abi;

const usdcSwapAbi = [
  ...erc20SwapAbi,
  {
    type: "function",
    name: "increaseAllowance",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "increment", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

const circleSwapAdapterAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "instructions",
            type: "tuple[]",
            components: [
              { name: "target", type: "address" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
              { name: "tokenIn", type: "address" },
              { name: "amountToApprove", type: "uint256" },
              { name: "tokenOut", type: "address" },
              { name: "minTokenOut", type: "uint256" },
            ],
          },
          {
            name: "tokens",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "beneficiary", type: "address" },
            ],
          },
          { name: "execId", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "metadata", type: "bytes" },
        ],
      },
      {
        name: "tokenInputs",
        type: "tuple[]",
        components: [
          { name: "permitType", type: "uint8" },
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "permitCalldata", type: "bytes" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

function toChainIdHex(value: unknown) {
  if (typeof value === "number") return `0x${value.toString(16)}`;
  if (typeof value === "string") {
    return value.startsWith("0x") ? value.toLowerCase() : `0x${Number(value).toString(16)}`;
  }
  return "";
}

function errorCode(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "number") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Makes sure the wallet itself is on Arc: switch (adding Arc first when the
 * wallet doesn't know it), then wait until the wallet actually reports Arc,
 * since mobile wallets can take a moment after the user returns.
 */
async function ensureWalletOnArc(
  request: <T = unknown>(args: { method: string; params?: unknown }) => Promise<T>,
) {
  const readChain = async () => toChainIdHex(await request({ method: "eth_chainId" }));
  if ((await readChain()) === ARC_CHAIN_ID_HEX) return;

  try {
    try {
      await request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
    } catch (error) {
      const code = errorCode(error);
      const text = error instanceof Error ? error.message : String(error ?? "");
      if (code !== 4902 && !/unrecognized chain|not been added|unknown chain/i.test(text)) throw error;
      await request({
        method: "wallet_addEthereumChain",
        params: [{ ...arcAddChainParameter, chainId: ARC_CHAIN_ID_HEX }],
      });
    }
  } catch (error) {
    throw new Error(arcSwitchErrorMessage(error));
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await readChain()) === ARC_CHAIN_ID_HEX) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Your wallet is still on another network. Switch it to ${ARC_CHAIN_NAME} and try again.`);
}

async function getBrowserProvider(connector: WalletConnector | undefined) {
  const provider = connector?.getProvider
    ? await connector.getProvider({ chainId: ARC_CHAIN_ID })
    : undefined;

  const fallbackProvider =
    typeof window !== "undefined"
      ? (window as Window & { ethereum?: unknown }).ethereum
      : undefined;

  const resolvedProvider = provider ?? fallbackProvider;

  const candidate = resolvedProvider as Partial<Eip1193Provider>;

  if (!resolvedProvider || typeof candidate.request !== "function") {
    throw new Error("Connect an EIP-1193 wallet before swapping.");
  }

  const rawRequest = async <TReturn = unknown>(args: {
    method: string;
    params?: unknown;
  }) => (await candidate.request?.call(resolvedProvider, args)) as TReturn;

  // MetaMask mobile reconnects each time the user comes back from the app,
  // and often reports its default network (Ethereum) afterwards, even though
  // the user approved Arc a moment before. So before every transaction, check
  // the wallet's real network and bring it back to Arc, instead of letting
  // the transaction fail and the swap hang.
  let ensuring: Promise<void> | null = null;
  const ensureArc = () =>
    (ensuring ??= ensureWalletOnArc(rawRequest).finally(() => {
      ensuring = null;
    }));

  const browserProvider = {
    on:
      typeof candidate.on === "function"
        ? candidate.on.bind(resolvedProvider)
        : () => undefined,
    request: async <TReturn = unknown>(args: {
      method: string;
      params?: unknown;
    }) => {
      // viem reads the chain right before it sends a transaction.
      if (args.method === "eth_chainId" || args.method === "eth_sendTransaction") {
        await ensureArc();
      }
      return rawRequest<TReturn>(args);
    },
    removeListener:
      typeof candidate.removeListener === "function"
        ? candidate.removeListener.bind(resolvedProvider)
        : () => undefined,
  } satisfies Eip1193Provider;

  await ensureArc();

  return browserProvider;
}

async function callCircleUserWalletApi<T>(
  action: string,
  params: Record<string, unknown> = {},
) {
  // Money-moving calls carry SaphraONE's own confirmation (lib/tx-approval).
  params = await withApproval(action, params);
  const response = await fetch("/api/circle/user-wallets", {
    body: JSON.stringify({
      action,
      ...params,
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
  const text = await response.text();
  let payload: T & { error?: string; message?: string };

  try {
    payload = text
      ? (JSON.parse(text) as T & { error?: string; message?: string })
      : ({} as T & { error?: string; message?: string });
  } catch {
    payload = {
      message: text || "Circle wallet request returned a non-JSON response.",
    } as T & { error?: string; message?: string };
  }

  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? "Circle wallet request failed.");
  }

  return payload;
}

function buildSwapConfig(
  slippageBps: number,
  stopLimit?: string,
  allowanceStrategy?: "approve" | "permit",
) {
  // No kitKey here: App Kit refuses any credential in a browser. The SDK runs
  // in its keyless mode, and withCircleStablecoinProxy routes its requests
  // through /api/circle, which attaches the server-side KIT_KEY.
  const feeRecipient =
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim() ?? "";

  return {
    slippageBps,
    ...(allowanceStrategy ? { allowanceStrategy } : {}),
    ...(stopLimit ? { stopLimit } : {}),
    ...(feeRecipient
      ? {
          customFee: {
            percentageBps: SWAP_FEE_BPS,
            recipientAddress: feeRecipient,
          },
        }
      : {}),
  };
}

function asAddress(value: unknown, label: string) {
  if (
    typeof value === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(value)
  ) {
    return value as Address;
  }

  throw new Error(`${label} must be a valid EVM address.`);
}

function getOptionalAddress(value: unknown) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value as Address)
    : undefined;
}

function asBigInt(value: unknown, label: string) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new Error(`${label} must be an integer amount.`);
}

function isEvmTransactionHash(value: unknown): value is string {
  return (
    typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value)
  );
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function getObject(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function findTransactionHash(value: unknown): string | undefined {
  if (isEvmTransactionHash(value)) {
    return value;
  }

  const object = getObject(value);

  if (!object) {
    return undefined;
  }

  for (const key of ["txHash", "transactionHash", "hash"]) {
    const candidate = object[key];

    if (isEvmTransactionHash(candidate)) {
      return candidate;
    }
  }

  for (const candidate of Object.values(object)) {
    const txHash = findTransactionHash(candidate);

    if (txHash) {
      return txHash;
    }
  }

  return undefined;
}

function getCircleTransactionId(value: unknown) {
  const object = getObject(value);

  if (!object) {
    return undefined;
  }

  const transaction = getObject(object.transaction);
  const data = getObject(object.data);
  const dataTransaction = getObject(data?.transaction);

  for (const candidate of [
    object.transactionId,
    transaction?.id,
    dataTransaction?.id,
    object.id,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}

function getCircleTransactionState(value: unknown) {
  const object = getObject(value);
  const transaction = getObject(object?.transaction);
  const data = getObject(object?.data);
  const dataTransaction = getObject(data?.transaction);
  const state = object?.state ?? transaction?.state ?? dataTransaction?.state;

  return typeof state === "string" ? state : undefined;
}

function getCircleTransactionError(value: unknown) {
  const object = getObject(value);
  const transaction = getObject(object?.transaction);
  const data = getObject(object?.data);
  const dataTransaction = getObject(data?.transaction);
  const reason =
    object?.errorDetails ??
    object?.errorReason ??
    transaction?.errorDetails ??
    transaction?.errorReason ??
    dataTransaction?.errorDetails ??
    dataTransaction?.errorReason;

  return typeof reason === "string" && reason.trim() ? reason : undefined;
}

function getCircleTransactionString(value: unknown, key: string) {
  const object = getObject(value);
  const transaction = getObject(object?.transaction);
  const data = getObject(object?.data);
  const dataTransaction = getObject(data?.transaction);

  for (const candidate of [
    object?.[key],
    transaction?.[key],
    dataTransaction?.[key],
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}

function getCircleTransactions(value: unknown): CircleWalletTransaction[] {
  const object = getObject(value);
  const data = getObject(object?.data);

  for (const candidate of [object?.transactions, data?.transactions]) {
    if (Array.isArray(candidate)) {
      return candidate
        .filter((transaction) => getObject(transaction))
        .map((transaction) => transaction as CircleWalletTransaction);
    }
  }

  const transaction = getObject(object?.transaction);

  return transaction ? [transaction as CircleWalletTransaction] : [];
}

function createCircleRefId(label: string) {
  const cleanedLabel = label.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const randomValue =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

  return `SaphraONE ${cleanedLabel || "transaction"} ${randomValue.slice(0, 8)}`.slice(
    0,
    50,
  );
}

function isMatchingCircleTransaction(
  transaction: CircleWalletTransaction,
  refId: string,
  contractAddress: Address,
  walletId: string,
) {
  if (getCircleTransactionString(transaction, "refId") !== refId) {
    return false;
  }

  const transactionWalletId = getCircleTransactionString(transaction, "walletId");

  if (transactionWalletId && transactionWalletId !== walletId) {
    return false;
  }

  const transactionContractAddress = getCircleTransactionString(
    transaction,
    "contractAddress",
  );

  return (
    !transactionContractAddress ||
    transactionContractAddress.toLowerCase() === contractAddress.toLowerCase()
  );
}

function assertCircleTransactionDidNotFail(value: unknown) {
  const state = getCircleTransactionState(value)?.toUpperCase();

  if (state && ["CANCELLED", "DENIED", "FAILED", "STUCK"].includes(state)) {
    throw new Error(
      getCircleTransactionError(value) ??
        `Circle transaction ${state.toLowerCase()}.`,
    );
  }
}

function isCircleTransactionComplete(value: unknown) {
  const state = getCircleTransactionState(value)?.toUpperCase();

  return state === "COMPLETE" || state === "CONFIRMED";
}

function getCircleChallengeStatus(value: unknown) {
  const object = getObject(value);
  const challenge = getObject(object?.challenge);
  const data = getObject(object?.data);
  const dataChallenge = getObject(data?.challenge);
  const status = object?.status ?? challenge?.status ?? dataChallenge?.status;

  return typeof status === "string" ? status : undefined;
}

function getCircleChallengeError(value: unknown) {
  const object = getObject(value);
  const challenge = getObject(object?.challenge);
  const data = getObject(object?.data);
  const dataChallenge = getObject(data?.challenge);
  const reason =
    object?.errorMessage ??
    object?.errorCode ??
    challenge?.errorMessage ??
    challenge?.errorCode ??
    dataChallenge?.errorMessage ??
    dataChallenge?.errorCode;

  return typeof reason === "string" && reason.trim()
    ? reason
    : typeof reason === "number"
      ? String(reason)
      : undefined;
}

function getCircleCorrelationIds(value: unknown) {
  const object = getObject(value);
  const challenge = getObject(object?.challenge);
  const data = getObject(object?.data);
  const dataChallenge = getObject(data?.challenge);

  for (const candidate of [
    object?.correlationIds,
    challenge?.correlationIds,
    dataChallenge?.correlationIds,
  ]) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (correlationId): correlationId is string =>
          typeof correlationId === "string" && correlationId.trim().length > 0,
      );
    }
  }

  return [];
}

function assertCircleChallengeDidNotFail(value: unknown) {
  const status = getCircleChallengeStatus(value)?.toUpperCase();

  if (status && ["CANCELLED", "DENIED", "EXPIRED", "FAILED"].includes(status)) {
    throw new Error(
      getCircleChallengeError(value) ??
        `Circle challenge ${status.toLowerCase()}.`,
    );
  }
}

function getContextChain(context: unknown) {
  if (
    typeof context === "object" &&
    context !== null &&
    "chain" in context &&
    typeof context.chain === "object" &&
    context.chain !== null
  ) {
    return context.chain as AnyRecord;
  }

  throw new Error(`${ARC_CHAIN_NAME} context is required for Circle wallet swaps.`);
}

function getContextAddress(context: unknown, fallback: Address) {
  if (
    typeof context === "object" &&
    context !== null &&
    "address" in context &&
    typeof context.address === "string"
  ) {
    return asAddress(context.address, "Context address");
  }

  return fallback;
}

function getContextUsdcAddress(context: unknown) {
  const chain = getContextChain(context);

  return getOptionalAddress(chain.usdcAddress) ?? arcTokens.USDC.address;
}

function getContextAdapterAddress(context: unknown) {
  const chain = getContextChain(context);
  const kitContracts =
    typeof chain.kitContracts === "object" && chain.kitContracts !== null
      ? (chain.kitContracts as AnyRecord)
      : undefined;

  return asAddress(kitContracts?.adapter, "Circle swap adapter contract");
}

function stringifyReadResult(result: unknown) {
  if (typeof result === "bigint") {
    return result.toString();
  }

  if (
    typeof result === "string" ||
    typeof result === "number" ||
    typeof result === "boolean"
  ) {
    return String(result);
  }

  return JSON.stringify(result);
}

function isReadOnlyFunction(abi: Abi, functionName: string) {
  return abi.some(
    (item) =>
      item.type === "function" &&
      item.name === functionName &&
      (item.stateMutability === "view" || item.stateMutability === "pure"),
  );
}

function isActiveArcChain(chain: unknown) {
  return (
    typeof chain === "object" &&
    chain !== null &&
    "type" in chain &&
    "chainId" in chain &&
    "chain" in chain &&
    chain.type === "evm" &&
    chain.chainId === ARC_CHAIN_ID &&
    chain.chain === APP_KIT_ARC_CHAIN
  );
}

async function withCircleStablecoinProxy<TResult>(
  operation: () => Promise<TResult>,
) {
  if (typeof window === "undefined") {
    return operation();
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(
      request?.url ?? input.toString(),
      window.location.origin,
    );

    if (
      url.origin === CIRCLE_API_ORIGIN &&
      CIRCLE_STABLECOIN_KIT_PROXY_PATHS.has(url.pathname)
    ) {
      const proxyUrl = `/api/circle${url.pathname}${url.search}`;

      return originalFetch(proxyUrl, {
        ...init,
        body: init?.body ?? request?.body ?? undefined,
        headers: init?.headers ?? request?.headers,
        method: init?.method ?? request?.method,
      });
    }

    return originalFetch(input, init);
  };

  try {
    return await operation();
  } finally {
    window.fetch = originalFetch;
  }
}

export async function createCircleUserWalletAdapter(
  request: CircleUserWalletKitRequest,
) {
  const { createPublicClient, encodeFunctionData, formatUnits, http } =
    await import("viem");
  const publicClient = createPublicClient({
    chain: arcChain,
    transport: http(arcChain.rpcUrls.default.http[0]),
  });
  const transactionWaitContexts = new Map<string, CircleTransactionWaitContext>();

  async function getGasPrice() {
    return publicClient.getGasPrice();
  }

  function normalizeTxHash(txHash: string) {
    return txHash.toLowerCase();
  }

  function rememberCircleTransaction(
    txHash: string,
    context: CircleTransactionWaitContext,
  ) {
    transactionWaitContexts.set(normalizeTxHash(txHash), context);
  }

  function createSyntheticReceipt(txHash: string) {
    return {
      txHash,
      status: "success" as const,
      cumulativeGasUsed: zeroBigInt,
      gasUsed: zeroBigInt,
      blockNumber: zeroBigInt,
      transactionIndex: 0,
      effectiveGasPrice: zeroBigInt,
    };
  }

  function formatReceipt(receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>) {
    return {
      txHash: receipt.transactionHash,
      status: receipt.status,
      cumulativeGasUsed: receipt.cumulativeGasUsed,
      gasUsed: receipt.gasUsed,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      transactionIndex: receipt.transactionIndex,
      effectiveGasPrice: receipt.effectiveGasPrice,
    };
  }

  async function getCircleTransaction(transactionId: string) {
    return callCircleUserWalletApi<{ transaction?: CircleWalletTransaction }>(
      "getTransaction",
      {
        transactionId,
        userToken: request.userToken,
      },
    );
  }

  async function listCircleTransactions(params: Record<string, unknown> = {}) {
    return callCircleUserWalletApi<{
      transactions?: CircleWalletTransaction[];
    }>("listTransactions", {
      pageSize: 50,
      userToken: request.userToken,
      walletId: request.walletId,
      ...params,
    });
  }

  async function tryGetCircleTransaction(transactionId: string) {
    try {
      return await getCircleTransaction(transactionId);
    } catch {
      return undefined;
    }
  }

  async function getCircleChallenge(challengeId: string) {
    return callCircleUserWalletApi<{ challenge?: CircleUserChallenge }>(
      "getChallenge",
      {
        challengeId,
        userToken: request.userToken,
      },
    );
  }

  async function findCircleTransactionByHash(txHash: string) {
    const payload = await listCircleTransactions({ txHash });

    return getCircleTransactions(payload).find(
      (transaction) => findTransactionHash(transaction)?.toLowerCase() === txHash.toLowerCase(),
    );
  }

  function createWaitForEffect(params: EvmPrepareParams) {
    if (
      (params.functionName !== "approve" &&
        params.functionName !== "increaseAllowance") ||
      !params.args ||
      params.args.length < 2
    ) {
      return undefined;
    }

    const spender = getOptionalAddress(params.args[0]);
    const amount = asBigInt(params.args[1], "Approval amount");

    if (!spender) {
      return undefined;
    }

    const startingAllowancePromise = publicClient
      .readContract({
        address: params.address,
        abi: erc20SwapAbi,
        functionName: "allowance",
        args: [request.walletAddress, spender],
      })
      .catch(() => undefined);

    return async () => {
      const allowance = await publicClient.readContract({
        address: params.address,
        abi: erc20SwapAbi,
        functionName: "allowance",
        args: [request.walletAddress, spender],
      });
      const startingAllowance = await startingAllowancePromise;

      if (
        params.functionName === "increaseAllowance" &&
        startingAllowance !== undefined
      ) {
        return allowance >= startingAllowance + amount;
      }

      return amount === zeroBigInt
        ? allowance === zeroBigInt
        : allowance >= amount;
    };
  }

  async function waitForCircleTransactionHashByRef(
    refId: string,
    contractAddress: Address,
    transactionId?: string,
    challengeId?: string,
  ): Promise<CircleRecoveredTransactionHash | undefined> {
    for (let attempt = 0; attempt < circleTransactionHashAttempts; attempt += 1) {
      const transactionIds = new Set<string>();

      if (transactionId) {
        transactionIds.add(transactionId);
      }

      if (challengeId) {
        const challengeDetail = await getCircleChallenge(challengeId);

        assertCircleChallengeDidNotFail(challengeDetail);

        for (const correlationId of getCircleCorrelationIds(challengeDetail)) {
          transactionIds.add(correlationId);
        }
      }

      for (const candidateTransactionId of transactionIds) {
        const detail = await tryGetCircleTransaction(candidateTransactionId);

        if (detail) {
          const detailHash = findTransactionHash(detail);

          if (detailHash) {
            return {
              transactionId: candidateTransactionId,
              txHash: detailHash,
            };
          }

          assertCircleTransactionDidNotFail(detail);
        }
      }

      const payload = await listCircleTransactions();
      const transaction = getCircleTransactions(payload).find((candidate) =>
        isMatchingCircleTransaction(
          candidate,
          refId,
          contractAddress,
          request.walletId,
        ),
      );

      if (transaction) {
        const txHash = findTransactionHash(transaction);

        if (txHash) {
          return {
            transactionId: getCircleTransactionId(transaction),
            txHash,
          };
        }

        assertCircleTransactionDidNotFail(transaction);

        const transactionId = getCircleTransactionId(transaction);

        if (transactionId) {
          const detail = await getCircleTransaction(transactionId);
          const detailHash = findTransactionHash(detail);

          if (detailHash) {
            return {
              transactionId,
              txHash: detailHash,
            };
          }

          assertCircleTransactionDidNotFail(detail);
        }
      }

      request.onStatus?.(
        transaction
          ? "Waiting for Circle transaction hash"
          : "Finding Circle transaction",
      );
      await wait(circleTransactionHashDelayMs);
    }

    return undefined;
  }

  function createReadRequest(params: EvmPrepareParams): EvmPreparedRequest {
    const abi = params.abi;
    const functionName = params.functionName;

    if (!abi || !functionName) {
      throw new Error("Read requests require an ABI function.");
    }

    return {
      type: "evm",
      estimate: async () => ({
        fee: "0",
        gas: zeroBigInt,
        gasPrice: zeroBigInt,
      }),
      execute: async () => {
        const result = await publicClient.readContract({
          address: params.address,
          abi,
          functionName,
          args: [...(params.args ?? [])],
          ...(params.blockNumber !== undefined
            ? { blockNumber: params.blockNumber }
            : {}),
        });

        return stringifyReadResult(result);
      },
    };
  }

  function createWriteRequest(
    params: EvmPrepareParams,
    context: unknown,
    label: string,
  ): EvmPreparedRequest {
    const abi = params.abi;
    const functionName = params.functionName;

    if (!abi || !functionName) {
      throw new Error("Write requests require an ABI function.");
    }

    const data = encodeFunctionData({
      abi,
      functionName,
      args: [...(params.args ?? [])],
    });
    const waitForEffect = createWaitForEffect(params);

    function rememberAndReturn(
      txHash: string,
      context: {
        challengeId?: string;
        refId: string;
        transactionId?: string;
      },
    ) {
      rememberCircleTransaction(txHash, {
        ...context,
        contractAddress: params.address,
        label,
        waitForEffect,
      });

      return txHash;
    }

    return {
      type: "evm",
      getCallData: () => ({
        to: params.address,
        data,
        ...(params.value !== undefined ? { value: params.value } : {}),
      }),
      estimate: async (overrides, fallback) => {
        let gas = fallback?.gas;

        try {
          gas = await publicClient.estimateGas({
            account: getContextAddress(context, request.walletAddress),
            to: params.address,
            data,
            ...(params.value !== undefined ? { value: params.value } : {}),
            ...(overrides?.gasLimit !== undefined
              ? { gas: BigInt(overrides.gasLimit) }
              : {}),
          });
        } catch {
          gas = fallback?.gas ?? BigInt(overrides?.gasLimit ?? 0);
        }

        const gasPrice = await getGasPrice();

        return {
          gas,
          gasPrice,
          fee: (gas * gasPrice).toString(),
        };
      },
      execute: async () => {
        request.onStatus?.(`Preparing ${label}`);

        const refId = createCircleRefId(label);
        const challenge = await callCircleUserWalletApi<CircleContractExecutionChallenge>(
          "createContractExecution",
          {
            amount:
              params.value !== undefined && params.value > zeroBigInt
                ? formatUnits(params.value, arcChain.nativeCurrency.decimals)
                : undefined,
            callData: data,
            contractAddress: params.address,
            feeLevel: "HIGH",
            refId,
            userToken: request.userToken,
            walletId: request.walletId,
          },
        );
        const challengeId = challenge.challengeId ?? challenge.id;
        const transactionId = getCircleTransactionId(challenge);
        const immediateHash = findTransactionHash(challenge);

        if (immediateHash) {
          return rememberAndReturn(immediateHash, {
            challengeId,
            refId,
            transactionId,
          });
        }

        if (!challengeId) {
          throw new Error("Circle did not return a contract execution challenge.");
        }

        request.onStatus?.(`Confirm ${label} in Circle wallet`);
        const result = await request.executeChallenge(challengeId, label);
        const resultHash = result.txHash ?? findTransactionHash(result);

        if (resultHash) {
          return rememberAndReturn(resultHash, {
            challengeId,
            refId,
            transactionId:
              transactionId ?? result.transactionId ?? getCircleTransactionId(result),
          });
        }

        const knownTransactionId =
          transactionId ?? result.transactionId ?? getCircleTransactionId(result);
        const recoveredTransaction = await waitForCircleTransactionHashByRef(
          refId,
          params.address,
          knownTransactionId,
          challengeId,
        );

        if (!recoveredTransaction) {
          throw new Error(
            "Circle confirmed the request, but the transaction hash is still pending.",
          );
        }

        return rememberAndReturn(recoveredTransaction.txHash, {
          challengeId,
          refId,
          transactionId:
            recoveredTransaction.transactionId ?? knownTransactionId,
        });
      },
    };
  }

  return {
    chainType: "evm",
    capabilities: { addressContext: "user-controlled" },
    ensureChain: async (targetChain: unknown) => {
      if (!isActiveArcChain(targetChain)) {
        throw new Error(`Circle wallet swaps only support ${ARC_CHAIN_NAME}.`);
      }
    },
    getAddress: async () => request.walletAddress,
    getTokenDecimals: async (tokenAddress: string) => {
      const normalizedTokenAddress = tokenAddress.toLowerCase();

      if (
        normalizedTokenAddress === arcTokens.USDC.address.toLowerCase()
      ) {
        return arcTokens.USDC.decimals;
      }

      if (
        normalizedTokenAddress === arcTokens.EURC.address.toLowerCase()
      ) {
        return arcTokens.EURC.decimals;
      }

      const decimals = await publicClient.readContract({
        address: asAddress(tokenAddress, "Token address"),
        abi: erc20SwapAbi,
        functionName: "decimals",
        args: [],
      });

      return Number(decimals);
    },
    calculateTransactionFee: async (
      baseComputeUnits: bigint,
      bufferBasisPoints?: bigint,
    ) => {
      const gasPrice = await getGasPrice();
      const basisPoints = bufferBasisPoints ?? defaultFeeBufferBasisPoints;
      const gas =
        baseComputeUnits +
        (baseComputeUnits * basisPoints) / basisPointsDenominator;

      return {
        gas,
        gasPrice,
        fee: (gas * gasPrice).toString(),
      };
    },
    prepare: async (
      params: EvmPrepareParams,
      context: unknown,
    ): Promise<EvmPreparedRequest> => {
      if (params.type !== "evm") {
        throw new Error("Circle wallet swaps only support EVM requests.");
      }

      if (!params.abi || !params.functionName) {
        throw new Error("Circle wallet swaps require contract calldata.");
      }

      return isReadOnlyFunction(params.abi, params.functionName)
        ? createReadRequest(params)
        : createWriteRequest(params, context, params.functionName);
    },
    prepareAction: async (
      action: string,
      params: AnyRecord,
      context: unknown,
    ): Promise<EvmPreparedRequest> => {
      switch (action) {
        case "token.balanceOf": {
          const tokenAddress = asAddress(params.tokenAddress, "Token address");
          const walletAddress =
            getOptionalAddress(params.walletAddress) ?? request.walletAddress;

          return createReadRequest({
            type: "evm",
            address: tokenAddress,
            abi: erc20SwapAbi,
            functionName: "balanceOf",
            args: [walletAddress],
          });
        }

        case "token.allowance": {
          const tokenAddress = asAddress(params.tokenAddress, "Token address");
          const walletAddress =
            getOptionalAddress(params.walletAddress) ?? request.walletAddress;
          const delegate = asAddress(params.delegate, "Spender address");

          return createReadRequest({
            type: "evm",
            address: tokenAddress,
            abi: erc20SwapAbi,
            functionName: "allowance",
            args: [walletAddress, delegate],
          });
        }

        case "token.approve": {
          const tokenAddress = asAddress(params.tokenAddress, "Token address");
          const delegate = asAddress(params.delegate, "Spender address");
          const amount = asBigInt(params.amount, "Approval amount");

          return createWriteRequest(
            {
              type: "evm",
              address: tokenAddress,
              abi: erc20SwapAbi,
              functionName: "approve",
              args: [delegate, amount],
            },
            context,
            "token approval",
          );
        }

        case "usdc.balanceOf": {
          const walletAddress =
            getOptionalAddress(params.walletAddress) ?? request.walletAddress;

          return createReadRequest({
            type: "evm",
            address: getContextUsdcAddress(context),
            abi: usdcSwapAbi,
            functionName: "balanceOf",
            args: [walletAddress],
          });
        }

        case "usdc.allowance": {
          const walletAddress =
            getOptionalAddress(params.walletAddress) ?? request.walletAddress;
          const delegate = asAddress(params.delegate, "Spender address");

          return createReadRequest({
            type: "evm",
            address: getContextUsdcAddress(context),
            abi: usdcSwapAbi,
            functionName: "allowance",
            args: [walletAddress, delegate],
          });
        }

        case "usdc.increaseAllowance": {
          const delegate = asAddress(params.delegate, "Spender address");
          const amount = asBigInt(params.amount, "Approval amount");

          return createWriteRequest(
            {
              type: "evm",
              address: getContextUsdcAddress(context),
              abi: usdcSwapAbi,
              functionName: "increaseAllowance",
              args: [delegate, amount],
            },
            context,
            "USDC approval",
          );
        }

        case "usdc.name":
          return createReadRequest({
            type: "evm",
            address: getContextUsdcAddress(context),
            abi: usdcSwapAbi,
            functionName: "name",
            args: [],
          });

        case "swap.execute": {
          const tokenInAddress = asAddress(
            params.tokenInAddress,
            "Input token address",
          );
          const value =
            tokenInAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS
              ? asBigInt(params.inputAmount, "Input amount")
              : undefined;

          return createWriteRequest(
            {
              type: "evm",
              address: getContextAdapterAddress(context),
              abi: circleSwapAdapterAbi,
              functionName: "execute",
              args: [
                params.executeParams,
                Array.isArray(params.tokenInputs) ? params.tokenInputs : [],
                params.signature,
              ],
              ...(value !== undefined ? { value } : {}),
            },
            context,
            "swap",
          );
        }

        // Earn uses the same Circle adapter contract's execute ABI as Swap.
        // Keeping this on the native Circle user-wallet adapter is essential:
        // Circle SCAs approve and broadcast through challenges, not through a
        // generic injected-wallet eth_sendTransaction implementation.
        case "earn.deposit":
        case "earn.withdraw":
        case "earn.claimRewards": {
          return createWriteRequest(
            {
              type: "evm",
              address: getContextAdapterAddress(context),
              abi: circleSwapAdapterAbi,
              functionName: "execute",
              args: [
                params.executeParams,
                Array.isArray(params.tokenInputs) ? params.tokenInputs : [],
                params.signature,
              ],
            },
            context,
            action.replace("earn.", "Earn "),
          );
        }

        default:
          throw new Error(`Circle wallet does not support ${action}.`);
      }
    },
    resetState: () => undefined,
    switchToChain: async () => undefined,
    validateChainSupport: (targetChain: unknown) => {
      if (!isActiveArcChain(targetChain)) {
        throw new Error(`Circle wallet swaps only support ${ARC_CHAIN_NAME}.`);
      }
    },
    waitForTransaction: async (txHash: string, config?: AnyRecord) => {
      const timeout =
        typeof config?.timeout === "number"
          ? Math.max(config.timeout, circleTransactionReceiptTimeoutMs)
          : circleTransactionReceiptTimeoutMs;
      const waitStartedAt = Date.now();
      const deadline = Date.now() + timeout;
      const normalizedTxHash = normalizeTxHash(txHash);
      const context = transactionWaitContexts.get(normalizedTxHash);
      let lastError: unknown;

      request.onStatus?.("Waiting for transaction confirmation");

      while (Date.now() < deadline) {
        try {
          const receipt = await publicClient.getTransactionReceipt({
            hash: txHash as Hash,
          });

          return formatReceipt(receipt);
        } catch (error) {
          lastError = error;
        }

        if (context?.waitForEffect) {
          try {
            if (await context.waitForEffect()) {
              return createSyntheticReceipt(txHash);
            }
          } catch (error) {
            lastError = error;
          }
        }

        if (
          context?.waitForEffect &&
          Date.now() - waitStartedAt >= circleApprovalOptimisticWaitMs
        ) {
          request.onStatus?.("Approval accepted, starting swap");

          return createSyntheticReceipt(txHash);
        }

        if (context?.transactionId) {
          const transaction = await tryGetCircleTransaction(context.transactionId);

          if (transaction) {
            assertCircleTransactionDidNotFail(transaction);

            if (isCircleTransactionComplete(transaction)) {
              return createSyntheticReceipt(txHash);
            }
          }
        }

        try {
          const transaction = await findCircleTransactionByHash(txHash);

          if (transaction) {
            assertCircleTransactionDidNotFail(transaction);

            if (isCircleTransactionComplete(transaction)) {
              return createSyntheticReceipt(txHash);
            }
          }
        } catch (error) {
          lastError = error;
        }

        await wait(circleTransactionReceiptPollMs);
      }

      throw new Error(
        lastError instanceof Error
          ? `Timed out waiting for transaction confirmation: ${lastError.message}`
          : "Timed out waiting for transaction confirmation.",
      );
    },
  };
}

async function buildSwapParams(request: SwapRequest) {
  const [
    { AppKit, SwapChain },
    { createViemAdapterFromProvider },
    { createPublicClient, http },
  ] = await Promise.all([
    import("@circle-fin/app-kit"),
    import("@circle-fin/adapter-viem-v2"),
    import("viem"),
  ]);
  const adapter = await createViemAdapterFromProvider({
    capabilities: { addressContext: "user-controlled" },
    getPublicClient: () =>
      createPublicClient({
        chain: arcChain,
        transport: http(arcChain.rpcUrls.default.http[0]),
      }),
    provider: await getBrowserProvider(request.connector),
  });
  const kit = new AppKit();

  return {
    kit,
    params: {
      amountIn: request.amountIn,
      config: buildSwapConfig(request.slippageBps, request.stopLimit),
      from: {
        adapter,
        chain: APP_KIT_ARC_CHAIN === "Arc" ? SwapChain.Arc : SwapChain.Arc_Testnet,
      },
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
    },
  };
}

async function buildCircleUserWalletSwapParams(
  request: CircleUserWalletSwapRequest,
) {
  const [{ AppKit, SwapChain }, adapter] = await Promise.all([
    import("@circle-fin/app-kit"),
    createCircleUserWalletAdapter(request),
  ]);
  const kit = new AppKit() as {
    estimateSwap: (params: unknown) => Promise<{
      estimatedOutput: { amount: string; token: string };
      fees?: { amount: string; token: string; type: string }[];
      stopLimit: { amount: string; token: string };
    }>;
    swap: (params: unknown) => Promise<{
      amountOut?: string;
      explorerUrl?: string;
      txHash: string;
    }>;
  };

  return {
    kit,
    params: {
      amountIn: request.amountIn,
      config: buildSwapConfig(request.slippageBps, request.stopLimit, "approve"),
      from: {
        adapter,
        chain: APP_KIT_ARC_CHAIN === "Arc" ? SwapChain.Arc : SwapChain.Arc_Testnet,
      },
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
    },
  };
}

export async function estimateCircleSwap(
  request: SwapRequest,
): Promise<CircleSwapEstimate> {
  const { kit, params } = await buildSwapParams(request);
  const estimate = await withCircleStablecoinProxy(() =>
    kit.estimateSwap(params),
  );

  return {
    estimatedOutput: `${estimate.estimatedOutput.amount} ${estimate.estimatedOutput.token}`,
    estimatedOutputAmount: estimate.estimatedOutput.amount,
    fees:
      estimate.fees?.map((fee) => `${fee.amount} ${fee.token} ${fee.type}`) ??
      [],
    minimumOutput: `${estimate.stopLimit.amount} ${estimate.stopLimit.token}`,
    stopLimitAmount: estimate.stopLimit.amount,
  };
}

export async function estimateCircleUserWalletSwap(
  request: CircleUserWalletSwapRequest,
): Promise<CircleSwapEstimate> {
  const { kit, params } = await buildCircleUserWalletSwapParams(request);
  const estimate = await withCircleStablecoinProxy(() =>
    kit.estimateSwap(params),
  );

  return {
    estimatedOutput: `${estimate.estimatedOutput.amount} ${estimate.estimatedOutput.token}`,
    estimatedOutputAmount: estimate.estimatedOutput.amount,
    fees:
      estimate.fees?.map((fee) => `${fee.amount} ${fee.token} ${fee.type}`) ??
      [],
    minimumOutput: `${estimate.stopLimit.amount} ${estimate.stopLimit.token}`,
    stopLimitAmount: estimate.stopLimit.amount,
  };
}

export async function executeCircleSwap(
  request: SwapRequest,
): Promise<CircleSwapExecution> {
  const { kit, params } = await buildSwapParams(request);
  const result = await withCircleStablecoinProxy(() => kit.swap(params));

  return {
    amountOut: result.amountOut,
    explorerUrl: result.explorerUrl,
    txHash: result.txHash,
  };
}

export async function executeCircleUserWalletSwap(
  request: CircleUserWalletSwapRequest,
): Promise<CircleSwapExecution> {
  const { kit, params } = await buildCircleUserWalletSwapParams(request);
  const result = await withCircleStablecoinProxy(() => kit.swap(params));

  return {
    amountOut: result.amountOut,
    explorerUrl: result.explorerUrl,
    txHash: result.txHash,
  };
}
