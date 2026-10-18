// Server-only. What the browser sees of multichain receive.
import { multichainChainByCircleBlockchain } from "@/lib/multichain/chains";
import { depositFeesByNetwork } from "@/lib/multichain/deposit-fee";
import { enabledMultichainChains, multichainEnabled } from "@/lib/multichain/flag";
import { unitsToUsdc } from "@/lib/multichain/rules";
import { walletAllowed } from "@/lib/multichain/service";
import {
  listDepositAddresses,
  listDepositsForOwner,
  listSweepsByIds,
  type ChainDepositRow,
  type ChainSweepRow,
} from "@/lib/multichain/store";

export type IncomingDepositView = {
  id: string;
  network: string;
  networkName: string;
  amount: string;
  /** Who paid, on that network ("0x6f97…464f"); null when unknown. */
  sender: string | null;
  /** What reached Arc, after Circle's network fee. Set once credited. */
  amountCredited: string | null;
  status: "arriving" | "below-min" | "credited" | "retrying" | "on-hold" | "failed";
  sourceTxUrl: string;
  mintTxHash: string | null;
  createdAt: string;
  creditedAt: string | null;
};

function statusOf(row: ChainDepositRow): IncomingDepositView["status"] {
  switch (row.state) {
    case "CREDITED":
      return "credited";
    case "BELOW_MIN":
      return "below-min";
    case "NEEDS_REVIEW":
      return "on-hold";
    case "FAILED":
      // A failed sweep is retried; a transfer that failed on its own network never arrived.
      return row.sweep_id ? "retrying" : "failed";
    default:
      return "arriving";
  }
}

function depositView(row: ChainDepositRow, sweep: ChainSweepRow | undefined): IncomingDepositView | null {
  const chain = multichainChainByCircleBlockchain(row.chain);
  if (!chain) return null;
  // One sweep can carry several deposits; the credited amount is shown per
  // deposit only when it carried just this one.
  const solo = sweep && sweep.amount === row.amount_in;
  return {
    amount: row.amount_in,
    amountCredited: row.state === "CREDITED" && solo ? sweep.amount_credited : null,
    createdAt: row.created_at,
    creditedAt: row.credited_at,
    id: row.id,
    mintTxHash: sweep?.mint_tx_hash ?? null,
    network: chain.key,
    networkName: chain.name,
    sender: row.sender_address ? `${row.sender_address.slice(0, 6)}…${row.sender_address.slice(-4)}` : null,
    sourceTxUrl: chain.explorerTx(row.source_tx_hash),
    status: statusOf(row),
  };
}

export type MultichainOverview = {
  addresses: { address: string; network: string }[];
  /** `depositFee`: SaphraONE's fee per sweep in USDC ("0.1"), null when none is charged or unknown. */
  chains: { depositFee: string | null; key: string; minDeposit: number; name: string; typicalWait: string }[];
  deposits: IncomingDepositView[];
  enabled: boolean;
};

export async function multichainOverview(ownerWallet: string): Promise<MultichainOverview> {
  const enabled = enabledMultichainChains();
  const fees = multichainEnabled ? await depositFeesByNetwork(enabled).catch(() => ({}) as Record<string, bigint>) : {};
  const chains = enabled.map((chain) => ({
    depositFee: fees[chain.key] ? unitsToUsdc(fees[chain.key]) : null,
    key: chain.key,
    minDeposit: chain.minDeposit,
    name: chain.name,
    typicalWait: chain.typicalWait,
  }));
  if (!multichainEnabled || !walletAllowed(ownerWallet)) {
    return { addresses: [], chains, deposits: [], enabled: false };
  }

  const [addresses, deposits] = await Promise.all([
    listDepositAddresses(ownerWallet),
    listDepositsForOwner(ownerWallet),
  ]);
  const sweeps = await listSweepsByIds([...new Set(deposits.map((row) => row.sweep_id).filter(Boolean) as string[])]);
  const sweepById = new Map(sweeps.map((sweep) => [sweep.id, sweep]));

  return {
    addresses: addresses.flatMap((row) => {
      const chain = multichainChainByCircleBlockchain(row.chain);
      return chain ? [{ address: row.address, network: chain.key }] : [];
    }),
    chains,
    deposits: deposits
      .map((row) => depositView(row, row.sweep_id ? sweepById.get(row.sweep_id) : undefined))
      .filter((row): row is IncomingDepositView => row !== null),
    enabled: true,
  };
}

