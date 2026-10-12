// Browser calls for multichain receive. Types only from the server modules.
import type { NetworkFeeView, OutboundTransferView } from "@/lib/multichain/send-service";
import type { FeeMode } from "@/lib/multichain/rules";
import type { IncomingDepositView, MultichainOverview } from "@/lib/multichain/view";

export type { FeeMode, IncomingDepositView, MultichainOverview, NetworkFeeView, OutboundTransferView };

export type DepositAddressView = {
  address: string;
  minDeposit: number;
  network: string;
  networkName: string;
  typicalWait: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.message || "Something went wrong. Try again.");
  }
  return payload;
}

export async function fetchMultichainOverview(ownerWallet: string) {
  const response = await fetch(`/api/multichain/deposits?ownerWallet=${encodeURIComponent(ownerWallet)}`, {
    cache: "no-store",
  });
  return readJson<MultichainOverview>(response);
}

export async function requestDepositAddress(ownerWallet: string, network: string) {
  const response = await fetch("/api/multichain/addresses", {
    body: JSON.stringify({ network, ownerWallet }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return readJson<DepositAddressView>(response);
}

export async function refreshIncomingDeposits(ownerWallet: string) {
  const response = await fetch("/api/multichain/deposits/refresh", {
    body: JSON.stringify({ ownerWallet }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return readJson<MultichainOverview & { found: number }>(response);
}

// ─── Send to another network ─────────────────────────────────────────────────

export type SendQuote = {
  amount: string;
  fee: string;
  feeMode: FeeMode;
  message: string | null;
  network: string;
  networkName: string;
  receive: string;
  /** SaphraONE's flat fee, paid as its own transfer before the burn ("0" when none). */
  serviceFee: string;
  serviceFeeRecipient: string | null;
  /** Everything that leaves the balance. */
  total: string;
};

export async function fetchSendQuote(
  ownerWallet: string,
  network: string,
  amount: string,
  feeMode: FeeMode,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ amount, feeMode, network, ownerWallet });
  const response = await fetch(`/api/multichain/quote?${params}`, { cache: "no-store", signal });
  return readJson<SendQuote>(response);
}

export async function fetchNetworkFees(ownerWallet: string, signal?: AbortSignal) {
  const response = await fetch(`/api/multichain/fees?${new URLSearchParams({ ownerWallet })}`, {
    cache: "no-store",
    signal,
  });
  return readJson<{ fees: NetworkFeeView[] }>(response);
}

export async function startCrossChainSend(input: {
  amount: string;
  destination: string;
  feeMode: FeeMode;
  network: string;
  ownerWallet: string;
}) {
  const response = await fetch("/api/multichain/transfers", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  return readJson<{ quote: SendQuote; transfer: OutboundTransferView }>(response);
}

export async function reportCrossChainSend(
  id: string,
  body: {
    ownerWallet: string;
    burnTxHash?: string;
    error?: string;
    bridgeResult?: unknown;
    serviceFeeTxHash?: string;
    /** With `error`: the browser can't tell whether the burn happened. */
    unconfirmed?: boolean;
  },
) {
  const response = await fetch(`/api/multichain/transfers/${encodeURIComponent(id)}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  return readJson<{ transfer: OutboundTransferView }>(response);
}

export async function fetchCrossChainSend(ownerWallet: string, id: string) {
  const response = await fetch(
    `/api/multichain/transfers/${encodeURIComponent(id)}?ownerWallet=${encodeURIComponent(ownerWallet)}`,
    { cache: "no-store" },
  );
  return readJson<{ transfer: OutboundTransferView | null }>(response);
}
