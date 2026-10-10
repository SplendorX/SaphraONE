import type { Address, Hash, Hex } from "viem";

import type {
  PaymentIntent,
  PaymentIntentAsset,
} from "@/lib/payment-engine/intent";

/**
 * One interface so the router can call any wallet type uniformly.
 * Circle user wallets, external (wagmi) wallets, and ALLIE's Agent Wallet
 * are all implementations of this.
 */
export interface WalletExecutor {
  execute(intent: PaymentIntent): Promise<ExecutionResult>;
  estimateFee(intent: PaymentIntent): Promise<bigint>;
  getBalance(asset: PaymentIntentAsset): Promise<bigint>;
}

export type ExecutionResult = {
  txHash?: string;
  transactionId?: string;
  status: "submitted" | "failed";
  error?: string;
};

/** Structurally compatible with wagmi's `writeContractAsync`. */
type ExternalWrite = (args: {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  chainId: number;
}) => Promise<Hash>;

export type ExternalExecutorDeps = {
  /** wagmi's writeContractAsync, bound to the connected wallet. */
  writeContractAsync: ExternalWrite;
  /** Reads the router allowance so the send can skip a redundant approve. */
  readAllowance?: (spender: Address) => Promise<bigint>;
  /** ERC-20 balanceOf for the connected address. */
  readBalance?: (token: Address) => Promise<bigint>;
  feeRecipient: Address;
  sendRouter?: string;
};

export type CircleExecutorDeps = {
  /** Same shape execute-send already accepts for Circle user wallets. */
  circleExecutor: {
    execute: (
      callData: Hex,
      contractAddress: Address,
      refId: string,
    ) => Promise<{ txHash?: string; transactionId?: string }>;
  };
  readAllowance?: (spender: Address) => Promise<bigint>;
  readBalance?: (token: Address) => Promise<bigint>;
  feeRecipient: Address;
  sendRouter?: string;
};

export type AgentExecutorDeps = {
  walletId: string;
  /** Injected so this module stays free of the Circle DCW SDK import. */
  transfer: (walletId: string, intent: PaymentIntent) => Promise<ExecutionResult>;
  balance: (walletId: string, asset: PaymentIntentAsset) => Promise<bigint>;
};

