
export type EarnVault = {
  vaultAddress: string;
  name?: string;
  protocol?: string;
  asset?: string;
  currentApy?: number;
  nativeApy?: number;
  vaultFee?: number;
  totalDeposits?: string;
  liquidity?: string;
  status?: string;
  circleGuarded?: boolean;
  chain?: string;
  [key: string]: unknown;
};

export type EarnAssetAmount = {
  symbol?: string;
  amount?: string;
  address?: string;
  type?: string;
  [key: string]: unknown;
};

export type EarnPnl =
  | {
      status: "available";
      principalDeposited?: string;
      totalYieldEarned?: string;
      [key: string]: unknown;
    }
  | {
      status: "pending";
      [key: string]: unknown;
    }
  | {
      status: "unavailable";
      reason?: string;
      [key: string]: unknown;
    };

export type EarnPosition = {
  wallet?: string;
  chain?: string;
  vaultAddress?: string;
  vaultName?: string;
  asset?: string;
  currentBalance?: string;
  currentApy?: number;
  shares?: string;
  pnl?: EarnPnl;
  accruedRewards?: unknown[];
  [key: string]: unknown;
};

export type EarnDepositQuote = {
  vaultAddress?: string;
  vaultName?: string;
  deposit?: EarnAssetAmount;
  expectedShares?: EarnAssetAmount;
  sharePrice?: string;
  currentApy?: number;
  fees?: EarnAssetAmount[];
  gasFees?: unknown[];
  [key: string]: unknown;
};

export type EarnWithdrawQuote = {
  vaultAddress?: string;
  vaultName?: string;
  withdrawal?: EarnAssetAmount;
  sharesToRedeem?: EarnAssetAmount;
  sharePrice?: string;
  maxWithdrawable?: EarnAssetAmount;
  fees?: EarnAssetAmount[];
  gasFees?: unknown[];
  earnKitWarnings?: string[];
  [key: string]: unknown;
};

export type EarnTxResult = {
  txHash: string;
  explorerUrl: string;
  amount: string;
};

export type EarnApiError = {
  error: string;
};
