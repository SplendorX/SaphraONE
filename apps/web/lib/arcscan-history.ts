import { arcExplorerUrl } from "@/lib/chains";
import { formatUnits, isAddress, type Address, type Hash } from "viem";

import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";

export const arcScanBaseUrl = arcExplorerUrl;

export type WalletTransfer = {
  amount: string;
  blockNumber: number;
  counterparty: Address;
  counterpartyIsContract: boolean;
  direction: "in" | "out";
  hash: Hash;
  logIndex: number;
  method: string | null;
  symbol: ArcTokenSymbol;
  timestamp: string | null;
  /** Set when the transfer came from the user's ALLIE Agent Wallet. */
  viaAgentWallet?: boolean;
  /** A receipt built from an activity record whose other party is a name
   *  ("@ada", a pocket) rather than an address. */
  counterpartyLabel?: string;
  /** A send paid out on another network (e.g. "Base"): `counterparty` is the
   *  recipient there, not the bridge contract the Arc transfer went to. */
  destinationNetwork?: string;
};

type ArcScanAddress = {
  hash?: string;
  is_contract?: boolean;
};

export type ArcScanTokenTransfer = {
  block_number?: number;
  from?: ArcScanAddress | null;
  log_index?: number;
  method?: string | null;
  timestamp?: string | null;
  to?: ArcScanAddress | null;
  token?: {
    address_hash?: string;
    decimals?: string;
    symbol?: string;
  } | null;
  total?: {
    decimals?: string;
    value?: string;
  } | null;
  transaction_hash?: string;
};

export type ArcScanTokenTransferResponse = {
  items?: ArcScanTokenTransfer[];
  message?: string;
};

export function getArcScanHistoryUrls(address: string) {
  return Object.values(arcTokens).map(
    (token) =>
      `${arcScanBaseUrl}/api/v2/addresses/${address}/token-transfers?type=ERC-20&token=${token.address}`,
  );
}

function getTokenSymbol(tokenAddress?: string): ArcTokenSymbol | undefined {
  if (!tokenAddress) {
    return undefined;
  }

  return (Object.keys(arcTokens) as ArcTokenSymbol[]).find(
    (symbol) =>
      arcTokens[symbol].address.toLowerCase() ===
      tokenAddress.toLowerCase(),
  );
}

function normalizeAddress(value?: string): Address | undefined {
  if (!value || !isAddress(value)) {
    return undefined;
  }

  return value as Address;
}

/** Platform fee wallets — transfers to these are hidden from end-user history. */
export function getPlatformFeeRecipientAddresses(): string[] {
  const values = [
    process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim(),
    process.env.PLATFORM_FEE_RECIPIENT?.trim(),
  ].filter(Boolean) as string[];

  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function isPlatformFeeTransfer(
  transfer: Pick<WalletTransfer, "direction" | "counterparty">,
  feeRecipients: string[],
) {
  if (transfer.direction !== "out" || feeRecipients.length === 0) {
    return false;
  }
  return feeRecipients.includes(transfer.counterparty.toLowerCase());
}

export function normalizeArcScanTokenTransfers(
  address: string,
  payload: ArcScanTokenTransferResponse | ArcScanTokenTransferResponse[],
  options?: {
    /** When true (default), hide outbound transfers to the platform fee recipient. */
    hidePlatformFees?: boolean;
  },
) {
  const walletAddress = address.toLowerCase();
  const payloads = Array.isArray(payload) ? payload : [payload];
  const hidePlatformFees = options?.hidePlatformFees !== false;
  const feeRecipients = hidePlatformFees
    ? getPlatformFeeRecipientAddresses()
    : [];

  return payloads
    .flatMap((item) => item.items ?? [])
    .map((transfer): WalletTransfer | undefined => {
      const symbol = getTokenSymbol(transfer.token?.address_hash);
      const from = normalizeAddress(transfer.from?.hash);
      const to = normalizeAddress(transfer.to?.hash);
      const hash = transfer.transaction_hash;
      const value = transfer.total?.value;

      if (!symbol || !from || !to || !hash || !value) {
        return undefined;
      }

      const direction = from.toLowerCase() === walletAddress ? "out" : "in";
      const counterparty = direction === "out" ? to : from;
      const counterpartyIsContract =
        direction === "out"
          ? Boolean(transfer.to?.is_contract)
          : Boolean(transfer.from?.is_contract);
      const decimals = Number(
        transfer.total?.decimals ??
          transfer.token?.decimals ??
          arcTokens[symbol].decimals,
      );

      return {
        amount: formatUnits(BigInt(value), decimals),
        blockNumber: transfer.block_number ?? 0,
        counterparty,
        counterpartyIsContract,
        direction,
        hash: hash as Hash,
        logIndex: transfer.log_index ?? 0,
        method: transfer.method ?? null,
        symbol,
        timestamp: transfer.timestamp ?? null,
      };
    })
    .filter((transfer): transfer is WalletTransfer => Boolean(transfer))
    .filter((transfer) => !isPlatformFeeTransfer(transfer, feeRecipients))
    .sort((left, right) => {
      if (left.blockNumber === right.blockNumber) {
        return right.logIndex - left.logIndex;
      }

      return right.blockNumber - left.blockNumber;
    })
    .slice(0, 100);
}

/** A wallet's recent USDC/EURC transfers from ArcScan, newest first. */
export async function fetchArcScanTransfers(
  address: string,
  options?: Parameters<typeof normalizeArcScanTokenTransfers>[2],
) {
  const responses = await Promise.all(
    getArcScanHistoryUrls(address).map((url) =>
      fetch(url, {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      }),
    ),
  );

  if (responses.some((response) => !response.ok)) {
    throw new Error("ArcScan could not load this wallet history.");
  }

  const payload = (await Promise.all(
    responses.map((response) => response.json()),
  )) as ArcScanTokenTransferResponse[];

  return normalizeArcScanTokenTransfers(address, payload, options);
}
