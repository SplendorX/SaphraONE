"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  getAddress,
  isAddress,
  type Chain,
  type EIP1193Provider,
  type Hash,
} from "viem";

import { arcChain, arcTransport } from "@/lib/chains";
import { usdcUnits } from "@/lib/ramp/rules";
import { arcTokens } from "@/lib/tokens";
import { confirmFlow } from "@/lib/tx-approval/client";

/**
 * Sends exactly `amount` USDC on Arc to Centiiv's deposit wallet for a
 * withdrawal, with one confirmation. `onBroadcast` runs as soon as the hash
 * exists, before waiting for the block, so a closed tab can still finish
 * recording it.
 */
export async function sendUsdcOnArc(input: {
  resolveProvider: () => Promise<unknown>;
  circleWalletId: string | null;
  from: string;
  to: string;
  amount: string;
  onBroadcast?: (hash: Hash) => void;
}): Promise<Hash> {
  if (!isAddress(input.to)) throw new Error("The withdrawal address isn't valid. Start again.");
  // Exact units from the decimal string: a float never reaches the signature.
  const units = usdcUnits(input.amount);
  if (!units) throw new Error("The withdrawal amount isn't valid. Start again.");

  const recipient = getAddress(input.to);
  const chain = arcChain as Chain;

  return confirmFlow(
    input.circleWalletId,
    { amount: input.amount, maxUses: 2, recipients: [recipient], title: "Withdraw to bank", token: "USDC" },
    async () => {
      const walletClient = createWalletClient({
        account: getAddress(input.from),
        chain,
        transport: custom((await input.resolveProvider()) as EIP1193Provider),
      });
      const hash = await walletClient.writeContract({
        abi: erc20Abi,
        address: arcTokens.USDC.address,
        args: [recipient, units],
        functionName: "transfer",
      });
      input.onBroadcast?.(hash);
      const receipt = await createPublicClient({ chain, transport: arcTransport() }).waitForTransactionReceipt({
        hash,
        timeout: 90_000,
      });
      if (receipt.status !== "success") throw new Error("The transfer failed on Arc. No USDC was taken.");
      return hash;
    },
  );
}
