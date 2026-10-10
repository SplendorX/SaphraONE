/**
 * Circle (embedded) wallet helpers for SwiftSaveVault deposit / withdraw.
 * Reuses existing Circle user-controlled contractExecution flow.
 */
import {
  encodeFunctionData,
  formatUnits,
  maxUint256,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import {
  callCircleWalletApi,
  type CircleLoginResult,
} from "@/lib/circle-session";
import {
  extractCircleTransactionId,
  extractCircleTxHash,
  recoverCircleTxHash,
} from "@/lib/circle-tx";
import { erc20Abi } from "@/lib/contracts";
import { swiftSaveVaultAbi } from "@/lib/save/abis";
import { arcTokens } from "@/lib/tokens";
import { confirmFlow } from "@/lib/tx-approval/client";

type CircleContractChallenge = {
  challengeId?: string;
  id?: string;
  data?: {
    challengeId?: string;
    id?: string;
    transactionId?: string;
    txHash?: string;
  };
};

export type CircleVaultExecutor = {
  login: CircleLoginResult;
  walletId: string;
  /** Circle W3S SDK execute(challengeId, cb) */
  executeChallenge: (challengeId: string) => Promise<{
    transactionId?: string;
    txHash?: string;
  }>;
};

function getChallengeId(payload: CircleContractChallenge) {
  return (
    payload.challengeId ??
    payload.data?.challengeId ??
    payload.id ??
    payload.data?.id
  );
}

export function encodeErc20Approve(spender: Address, amount: bigint = maxUint256) {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}

export function encodeVaultDeposit(input: {
  pocketIdBytes32: Hex;
  token: Address;
  amountUnits: bigint;
}) {
  return encodeFunctionData({
    abi: swiftSaveVaultAbi,
    functionName: "deposit",
    args: [input.pocketIdBytes32, input.token, input.amountUnits],
  });
}



export function encodeVaultWithdraw(input: {
  pocketIdBytes32: Hex;
  token: Address;
  amountUnits: bigint;
}) {
  return encodeFunctionData({
    abi: swiftSaveVaultAbi,
    functionName: "withdraw",
    args: [input.pocketIdBytes32, input.token, input.amountUnits],
  });
}

export async function executeCircleContractCall(input: {
  executor: CircleVaultExecutor;
  contractAddress: Address;
  callData: Hex;
  refId: string;
  label: string;
  skipHashes?: string[];
}): Promise<{ txHash?: Hash; transactionId?: string }> {
  const challenge = await callCircleWalletApi<CircleContractChallenge>(
    "createContractExecution",
    {
      callData: input.callData,
      contractAddress: input.contractAddress,
      feeLevel: "MEDIUM",
      refId: input.refId,
      userToken: input.executor.login.userToken,
      walletId: input.executor.walletId,
    },
  );

  const challengeId = getChallengeId(challenge);
  if (!challengeId) {
    throw new Error(`Circle did not return a challenge for ${input.label}.`);
  }

  const result = await input.executor.executeChallenge(challengeId);
  let txHash =
    extractCircleTxHash(result) ??
    (result.txHash && /^0x[a-fA-F0-9]{64}$/i.test(result.txHash)
      ? result.txHash
      : undefined);
  const transactionId =
    extractCircleTransactionId(result) ?? result.transactionId;

  if (!txHash) {
    txHash =
      (await recoverCircleTxHash({
        attempts: 12,
        skipHashes: input.skipHashes,
        transactionId,
        userToken: input.executor.login.userToken,
        walletId: input.executor.walletId,
      })) ?? undefined;
  }

  return {
    txHash: txHash as Hash | undefined,
    transactionId,
  };
}

/**
 * Approve USDC/EURC for the vault (if needed) and deposit savings amount.
 * Used for Spend&Save second leg and manual deposits with Circle wallets.
 */
export async function circleVaultDeposit(input: {
  executor: CircleVaultExecutor;
  vault: Address;
  token: Address;
  pocketIdBytes32: Hex;
  amountUnits: bigint;
  refPrefix?: string;
  readAllowance?: (spender: Address) => Promise<bigint>;
}): Promise<{ txHash?: Hash; transactionId?: string }> {
  const token = Object.values(arcTokens).find(
    (entry) => entry.address.toLowerCase() === input.token.toLowerCase(),
  );
  // One confirmation for approve + deposit. Saving pays nobody, so the
  // server refuses any call in it that would.
  return confirmFlow(
    input.executor.walletId,
    {
      amount: formatUnits(input.amountUnits, token?.decimals ?? 6),
      maxUses: 3,
      recipients: [],
      title: "Add to savings",
      token: token?.symbol ?? "USDC",
    },
    () => depositToVault(input),
  );
}

async function depositToVault(input: Parameters<typeof circleVaultDeposit>[0]) {
  const prefix = input.refPrefix ?? "swift-save-deposit";

  let approvalTxHash: Hash | undefined;
  let needsApprove = true;

  if (input.readAllowance) {
    try {
      const allowance = await input.readAllowance(input.vault);
      if (allowance >= input.amountUnits) {
        needsApprove = false;
      }
    } catch {
      needsApprove = true;
    }
  }

  if (needsApprove) {
    const approval = await executeCircleContractCall({
      executor: input.executor,
      contractAddress: input.token,
      callData: encodeErc20Approve(input.vault),
      refId: `${prefix}-approve-${Date.now()}`,
      label: "vault approve",
    });
    approvalTxHash = approval.txHash;
  }

  return executeCircleContractCall({
    executor: input.executor,
    contractAddress: input.vault,
    callData: encodeVaultDeposit({
      pocketIdBytes32: input.pocketIdBytes32,
      token: input.token,
      amountUnits: input.amountUnits,
    }),
    refId: `${prefix}-deposit-${Date.now()}`,
    label: "vault deposit",
    skipHashes: approvalTxHash ? [approvalTxHash] : undefined,
  });
}

/**
 * Withdraw from SwiftSaveVault back to the Circle wallet (refund/reversal leg).
 */
export async function circleVaultWithdraw(input: {
  executor: CircleVaultExecutor;
  vault: Address;
  token: Address;
  pocketIdBytes32: Hex;
  amountUnits: bigint;
  refPrefix?: string;
}): Promise<{ txHash?: Hash; transactionId?: string }> {
  const prefix = input.refPrefix ?? "swift-save-withdraw";
  return executeCircleContractCall({
    executor: input.executor,
    contractAddress: input.vault,
    callData: encodeVaultWithdraw({
      pocketIdBytes32: input.pocketIdBytes32,
      token: input.token,
      amountUnits: input.amountUnits,
    }),
    refId: `${prefix}-${Date.now()}`,
    label: "vault withdraw",
  });
}
