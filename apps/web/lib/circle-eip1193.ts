"use client";

import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

import {
  currentCircleAuth, callCircleWalletApi } from "@/lib/circle-session";
import {
  extractCircleTransactionId,
  extractCircleTxHash,
  describeCircleTxFailure,
  recoverCircleTxDetails,
} from "@/lib/circle-tx";
import { postArcRpc } from "@/lib/chains";
import { onchainFacts } from "@/lib/onchain-facts";

/**
 * An EIP-1193 provider backed by a Circle user-controlled wallet.
 *
 * Circle's own App Kit adapter is developer-controlled and server-side: it
 * signs with an entity secret. SaphraONE's Google users hold *user-controlled*
 * wallets that sign through a PIN challenge in the browser, which no shipped
 * adapter speaks.
 *
 * Rather than write a bespoke App Kit adapter, this presents the Circle wallet
 * as the one interface every kit already accepts, so
 * `createViemAdapterFromProvider` treats it like any injected wallet:
 *
 * - reads are forwarded to the Arc RPC
 * - `eth_sendTransaction` becomes a contract-execution challenge, the PIN
 *   prompt, then a poll for the mined hash
 * - `eth_signTypedData_v4` becomes a SIGN_TYPEDDATA challenge, which the vault
 *   router needs for its time-boxed authorization
 *
 * Only what a same-chain vault flow needs is implemented. Batched calls and
 * raw message signing fail with EIP-1193 code 4200 so callers take their
 * sequential path rather than misbehave.
 */

export type CircleProviderConfig = {
  address: string;
  encryptionKey: string;
  /** Resolves the initialized W3S SDK used to run the PIN challenge. */
  getSdk: () => Promise<W3SSdk | null> | W3SSdk | null;
  userToken: string;
  walletId: string;
};

type RpcRequest = { method: string; params?: unknown[] | object };

class ProviderRpcError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "ProviderRpcError";
  }
}

/**
 * Circle's PIN screen came back with an error. Only 155701 (the person
 * closed it) is a cancel; anything else, after they confirmed, is a real
 * failure and keeps Circle's own words. Labelling every error a cancel is
 * how a failed send read "Cancelled. Nothing was sent." Either way the
 * challenge never ran, so nothing left the wallet.
 */
function challengeError(error: { code?: unknown; message?: string }) {
  const code = String(error.code ?? "");
  if (code === "155701") {
    return new ProviderRpcError(4001, error.message || "Cancelled in Circle wallet.");
  }
  const failure = new ProviderRpcError(
    -32603,
    `${code ? `[${code}] ` : ""}${error.message || "Circle couldn't complete this transaction."}`,
  );
  failure.name = "CircleChallengeError";
  return failure;
}

/** A Circle confirmation that failed before anything was sent (see challengeError). */
export function isCircleChallengeError(error: unknown) {
  for (let cause = error, depth = 0; cause instanceof Error && depth < 6; depth += 1) {
    if (cause.name === "CircleChallengeError") return true;
    cause = (cause as Error & { cause?: unknown }).cause;
  }
  return false;
}

function toHexChainId(chainId: number) {
  return `0x${chainId.toString(16)}`;
}

/** Forward a read to the Arc RPC. Circle has no read surface of its own. */
async function rpcCall(method: string, params: unknown[]) {
  const response = await postArcRpc({ id: Date.now(), jsonrpc: "2.0", method, params });

  if (!response.ok) {
    throw new ProviderRpcError(-32603, `RPC ${method} failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    error?: { code?: number; message?: string };
    result?: unknown;
  };

  if (payload.error) {
    throw new ProviderRpcError(
      payload.error.code ?? -32603,
      payload.error.message ?? `RPC ${method} failed.`,
    );
  }

  return payload.result;
}

type TransactionRequest = {
  data?: string;
  to?: string;
  value?: string;
};

function normalizeTx(params: unknown[]): TransactionRequest {
  const tx = params[0];
  if (!tx || typeof tx !== "object") {
    throw new ProviderRpcError(-32602, "A transaction object is required.");
  }
  return tx as TransactionRequest;
}

/**
 * Circle takes the native value as a decimal string, not wei hex. On Arc the
 * native token is USDC (18 decimals at the RPC level).
 */
function hexValueToDecimalString(value?: string) {
  if (!value || value === "0x" || value === "0x0") {
    return undefined;
  }
  try {
    const wei = BigInt(value);
    if (wei === BigInt(0)) return undefined;
    const base = BigInt(10) ** BigInt(18);
    const whole = wei / base;
    const fraction = (wei % base).toString().padStart(18, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return undefined;
  }
}

function extractSignature(result: unknown): string | undefined {
  const root = (result ?? {}) as Record<string, unknown>;
  const data = (root.data ?? {}) as Record<string, unknown>;
  const candidates = [data.signature, data.signedMessage, root.signature];
  return candidates.find(
    (value): value is string =>
      typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value),
  );
}

/**
 * Hashes this tab already returned per wallet. Circle's SDK often answers
 * without a transaction id, and the fallback lookup ("newest transaction")
 * then finds the previous call (an approve) before the new one (its burn) is
 * listed. Skipping hashes already handed out stops that mix-up.
 */
const returnedHashes = new Map<string, Set<string>>();

function rememberHash(walletId: string, hash: string) {
  const seen = returnedHashes.get(walletId) ?? new Set<string>();
  seen.add(hash.toLowerCase());
  returnedHashes.set(walletId, seen);
  return hash;
}

export function createCircleWalletProvider(config: CircleProviderConfig) {
  const accounts = [config.address.toLowerCase()];

  async function sendTransaction(params: unknown[]): Promise<string> {
    const tx = normalizeTx(params);

    if (!tx.to) {
      throw new ProviderRpcError(
        -32602,
        "Circle wallets cannot deploy contracts, only call them.",
      );
    }

    const sdk = await config.getSdk();
    if (!sdk) {
      throw new ProviderRpcError(
        4100,
        "Circle wallet confirmation is not ready. Reload and try again.",
      );
    }

    const challenge = await callCircleWalletApi<{
      challengeId?: string;
      id?: string;
    }>("createContractExecution", {
      amount: hexValueToDecimalString(tx.value),
      callData: tx.data ?? "0x",
      contractAddress: tx.to,
      feeLevel: "HIGH",
      userToken: config.userToken,
      walletId: config.walletId,
    });

    const challengeId = challenge.challengeId || challenge.id;
    if (!challengeId) {
      throw new ProviderRpcError(
        -32603,
        "Circle did not return a confirmation challenge.",
      );
    }

    sdk.setAuthentication(currentCircleAuth(config));

    const executed = await new Promise<{
      transactionId?: string;
      txHash?: string;
    }>((resolve, reject) => {
      sdk.execute(challengeId, (error, result) => {
        if (error) {
          reject(challengeError(error));
          return;
        }
        resolve({
          transactionId: extractCircleTransactionId(result),
          txHash: extractCircleTxHash(result),
        });
      });
    });

    if (executed.txHash) {
      return rememberHash(config.walletId, executed.txHash);
    }

    // Circle usually returns the id first and the hash once mined; the caller
    // is a viem client that expects a hash back from eth_sendTransaction.
    // Circle can take a while to index the hash on a busy network: up to ~60s.
    const recovered = await recoverCircleTxDetails({
      attempts: 40,
      skipHashes: [...(returnedHashes.get(config.walletId) ?? [])],
      // Without a transaction id, the challenge names the transaction it made.
      challengeId,
      transactionId: executed.transactionId,
      userToken: config.userToken,
      walletId: config.walletId,
    });

    if (recovered.failure) {
      throw new ProviderRpcError(-32603, describeCircleTxFailure(recovered.failure));
    }
    if (!recovered.txHash) {
      throw new ProviderRpcError(
        -32603,
        // Worded for people: the transfer is on its way, not failed.
        "Your transfer was submitted and is still confirming. Your balance will update shortly — no need to send it again.",
      );
    }

    return rememberHash(config.walletId, recovered.txHash);
  }

  /**
   * EIP-712 signing through Circle's SIGN_TYPEDDATA challenge.
   *
   * The Earn router pulls funds with a signed, time-boxed authorization rather
   * than a prior allowance, so a vault deposit needs this as well as contract
   * execution.
   */
  async function signTypedData(params: unknown[]): Promise<string> {
    // eth_signTypedData_v4 is [address, jsonPayload].
    const payload = params[1];
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);

    const sdk = await config.getSdk();
    if (!sdk) {
      throw new ProviderRpcError(
        4100,
        "Circle wallet confirmation is not ready. Reload and try again.",
      );
    }

    const challenge = await callCircleWalletApi<{
      challengeId?: string;
      id?: string;
    }>("signTypedData", {
      data,
      userToken: config.userToken,
      walletId: config.walletId,
    });

    const challengeId = challenge.challengeId || challenge.id;
    if (!challengeId) {
      throw new ProviderRpcError(
        -32603,
        "Circle did not return a signing challenge.",
      );
    }

    sdk.setAuthentication(currentCircleAuth(config));

    const signature = await new Promise<string | undefined>((resolve, reject) => {
      sdk.execute(challengeId, (error, result) => {
        if (error) {
          reject(challengeError(error));
          return;
        }
        resolve(extractSignature(result));
      });
    });

    if (!signature) {
      throw new ProviderRpcError(
        -32603,
        "Circle completed the challenge without returning a signature.",
      );
    }

    return signature;
  }

  async function request({ method, params }: RpcRequest): Promise<unknown> {
    const args = Array.isArray(params) ? params : [];

    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return accounts;

      case "eth_chainId":
        return toHexChainId(onchainFacts.chainId);

      case "net_version":
        return String(onchainFacts.chainId);

      case "eth_sendTransaction":
        return sendTransaction(args);

      // The Circle wallet is pinned to Arc; a switch to Arc is a no-op and a
      // switch anywhere else is genuinely unsupported.
      case "wallet_switchEthereumChain": {
        const target = (args[0] as { chainId?: string } | undefined)?.chainId;
        if (
          !target ||
          target.toLowerCase() === toHexChainId(onchainFacts.chainId)
        ) {
          return null;
        }
        throw new ProviderRpcError(
          4902,
          `Circle wallets operate on ${onchainFacts.chain.name} only.`,
        );
      }

      case "wallet_addEthereumChain":
        return null;

      // Declined explicitly so callers take their sequential path instead of
      // assuming batching or typed-data signing is available.
      case "wallet_sendCalls":
      case "wallet_getCallsStatus":
      case "wallet_getCapabilities":
        throw new ProviderRpcError(
          4200,
          "Circle wallets do not support batched calls.",
        );

      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4":
        return signTypedData(args);

      case "personal_sign":
      case "eth_sign":
        throw new ProviderRpcError(
          4200,
          "Signing raw messages is not available on Circle wallets yet.",
        );

      default:
        return rpcCall(method, args);
    }
  }

  // Kits probe for listener support; accept and ignore, since this wallet
  // emits no chain or account changes of its own.
  const provider = {
    on: () => provider,
    removeListener: () => provider,
    request,
  };

  return provider;
}
