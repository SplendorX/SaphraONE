/**
 * Browser-side Spend&Save / vault settlement for external (wagmi) and Circle wallets.
 */
import { maxUint256, type Address, type Hash, type Hex } from "viem";

import { erc20Abi } from "@/lib/contracts";
import { swiftSaveVaultAbi } from "@/lib/save/abis";
import {
  circleVaultDeposit,
  circleVaultWithdraw,
  type CircleVaultExecutor,
} from "@/lib/save/circle-vault";
import {
  completeSpendSave,
  prepareSpendSave,
  createSavingsRefund,
  confirmSavingsRefund,
} from "@/lib/save/client";
import type { ArcTokenSymbol } from "@/lib/tokens";

type ExternalWrite = (args: {
  address: Address;
  abi: typeof erc20Abi | typeof swiftSaveVaultAbi;
  functionName: string;
  args: readonly unknown[];
  chainId: number;
}) => Promise<Hash>;

export type SpendSaveSettlementResult = {
  saveAmount: string;
  currency: ArcTokenSymbol;
  savingsTxHash?: Hash;
  eventId?: string;
  transactionId?: string;
};

/**
 * After a payment is confirmed on-chain, settle the Spend&Save deposit leg.
 */
export async function recordBundledSpendSave(input: {
  ownerWallet: string;
  amount: string;
  currency: ArcTokenSymbol;
  paymentTxHash: Hash | string;
  circleSocialUuid?: string;
}): Promise<SpendSaveSettlementResult> {
  const prepared = await prepareSpendSave({
    ownerWallet: input.ownerWallet,
    amount: input.amount,
    currency: input.currency,
    paymentTxHash: input.paymentTxHash,
    paymentKind: "outgoing",
    requirePaymentTx: true,
    circleSocialUuid: input.circleSocialUuid,
  });

  await completeSpendSave({
    ownerWallet: input.ownerWallet,
    circleSocialUuid: input.circleSocialUuid,
    transactionId: prepared.transaction.id,
    eventId: prepared.event.id,
    txHash: input.paymentTxHash,
  });

  return {
    saveAmount: prepared.quote.saveAmount,
    currency: input.currency,
    savingsTxHash: input.paymentTxHash as Hash,
    eventId: prepared.event.id,
    transactionId: prepared.transaction.id,
  };
}

export async function settleSpendSaveAfterPayment(input: {
  ownerWallet: string;
  amount: string;
  currency: ArcTokenSymbol;
  paymentTxHash: Hash | string;
  circleSocialUuid?: string;
  mode: "external" | "circle";
  chainId: number;
  /** wagmi writeContractAsync */
  writeContractAsync?: ExternalWrite;
  /** Circle executor when mode === circle */
  circleExecutor?: CircleVaultExecutor;
  readAllowance?: (spender: Address) => Promise<bigint>;
}): Promise<SpendSaveSettlementResult> {
  const prepared = await prepareSpendSave({
    ownerWallet: input.ownerWallet,
    amount: input.amount,
    currency: input.currency,
    paymentTxHash: input.paymentTxHash,
    paymentKind: "outgoing",
    requirePaymentTx: true,
    circleSocialUuid: input.circleSocialUuid,
  });

  const vault = prepared.vaultAddress as Address;
  const amountUnits = BigInt(prepared.amountUnits);
  const tokenAddress = prepared.tokenAddress as Address;
  const pocketIdBytes32 = prepared.pocketIdBytes32 as Hex;

  let savingsHash: Hash | undefined;

  if (input.mode === "circle") {
    if (!input.circleExecutor) {
      throw new Error("Circle wallet is not ready for Spend&Save.");
    }
    const result = await circleVaultDeposit({
      executor: input.circleExecutor,
      vault,
      token: tokenAddress,
      pocketIdBytes32,
      amountUnits,
      refPrefix: `spend-save-${prepared.transaction.id.slice(0, 8)}`,
      readAllowance: input.readAllowance,
    });
    savingsHash = result.txHash;
    if (!savingsHash) {
      throw new Error(
        "Circle Spend&Save deposit submitted but no transaction hash yet. Check Save history — reconciliation will finish it.",
      );
    }
  } else {
    if (!input.writeContractAsync) {
      throw new Error("External wallet writer is not available.");
    }
    await input.writeContractAsync({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [vault, maxUint256],
      chainId: input.chainId,
    });
    savingsHash = await input.writeContractAsync({
      address: vault,
      abi: swiftSaveVaultAbi,
      functionName: "deposit",
      args: [pocketIdBytes32, tokenAddress, amountUnits],
      chainId: input.chainId,
    });
  }

  await completeSpendSave({
    ownerWallet: input.ownerWallet,
    circleSocialUuid: input.circleSocialUuid,
    transactionId: prepared.transaction.id,
    eventId: prepared.event.id,
    txHash: savingsHash,
  });

  return {
    saveAmount: prepared.quote.saveAmount,
    currency: input.currency,
    savingsTxHash: savingsHash,
    eventId: prepared.event.id,
    transactionId: prepared.transaction.id,
  };
}

/**
 * Full refund reversal: create REVERSAL intent → on-chain withdraw → confirm ledger.
 */
export async function executeSavingsReversal(input: {
  ownerWallet: string;
  originalTransactionId: string;
  circleSocialUuid?: string;
  mode: "external" | "circle";
  chainId: number;
  writeContractAsync?: ExternalWrite;
  circleExecutor?: CircleVaultExecutor;
  idempotencyKey?: string;
  reason?: string;
}) {
  const prepared = await createSavingsRefund({
    ownerWallet: input.ownerWallet,
    circleSocialUuid: input.circleSocialUuid,
    originalTransactionId: input.originalTransactionId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason ?? "payment_refund",
    mode: "REVERSAL",
  });

  if (!prepared.vaultAddress || !prepared.pocketIdBytes32) {
    throw new Error("SwiftSaveVault is not configured for reversals.");
  }

  const vault = prepared.vaultAddress as Address;
  const amountUnits = BigInt(prepared.amountUnits);
  const tokenAddress = prepared.tokenAddress as Address;
  const pocketIdBytes32 = prepared.pocketIdBytes32 as Hex;

  // Already completed (idempotent replay)
  if (prepared.transaction.status === "COMPLETED") {
    return {
      transaction: prepared.transaction,
      txHash: prepared.transaction.tx_hash as Hash | null,
      alreadyCompleted: true,
    };
  }

  let txHash: Hash | undefined;

  if (input.mode === "circle") {
    if (!input.circleExecutor) {
      throw new Error("Circle wallet is not ready for reversal.");
    }
    const result = await circleVaultWithdraw({
      executor: input.circleExecutor,
      vault,
      token: tokenAddress,
      pocketIdBytes32,
      amountUnits,
      refPrefix: `reversal-${prepared.transaction.id.slice(0, 8)}`,
    });
    txHash = result.txHash;
  } else {
    if (!input.writeContractAsync) {
      throw new Error("External wallet writer is not available.");
    }
    txHash = await input.writeContractAsync({
      address: vault,
      abi: swiftSaveVaultAbi,
      functionName: "withdraw",
      args: [pocketIdBytes32, tokenAddress, amountUnits],
      chainId: input.chainId,
    });
  }

  if (!txHash) {
    throw new Error(
      "Reversal withdraw submitted without a hash. Open Save — reconciliation will finalize when the hash is available.",
    );
  }

  // Confirm via refund endpoint (on-chain receipt is source of truth)
  const confirmed = await confirmSavingsRefund({
    ownerWallet: input.ownerWallet,
    circleSocialUuid: input.circleSocialUuid,
    transactionId: prepared.transaction.id,
    txHash,
  });

  return {
    transaction: confirmed.transaction,
    pocket: confirmed.pocket,
    txHash,
    alreadyCompleted: false,
  };
}

