import { zeroAddress, type Address, type Hex, type PublicClient } from "viem";

import {
  legacyFeeContracts,
  swiftRecurepayExecutorAbi,
  swiftRecurepayExecutorAddress,
} from "@/lib/contracts";
import { arcChain } from "@/lib/chains";

/** The RecurePay executor new authorizations use. */
export function currentRecurepayExecutor(): Address | null {
  return /^0x[0-9a-fA-F]{40}$/.test(swiftRecurepayExecutorAddress)
    ? (swiftRecurepayExecutorAddress as Address)
    : null;
}

/**
 * The old RecurePayExecutor on this network, when a different (Saphra)
 * executor is now configured; null when there is nothing older to fall back to.
 */
export function legacyRecurepayExecutor(): Address | null {
  const legacy = (legacyFeeContracts.recurePay as Record<number, string>)[arcChain.id];
  const current = currentRecurepayExecutor();
  if (!legacy || !current || legacy.toLowerCase() === current.toLowerCase()) return null;
  return legacy as Address;
}

/**
 * The executor holding `mandateId`. Mandates live in the contract they were
 * created on, so schedules authorized before SaphraRecurePay keep being paid
 * (and cancelled) on the old executor, at its old fee, until re-authorized.
 */
export async function resolveMandateExecutor(
  client: Pick<PublicClient, "readContract">,
  mandateId: Hex | null | undefined,
): Promise<Address | null> {
  const current = currentRecurepayExecutor();
  const legacy = legacyRecurepayExecutor();
  if (!current || !legacy || !mandateId) return current;

  const mandate = (await client.readContract({
    abi: swiftRecurepayExecutorAbi,
    address: current,
    args: [mandateId],
    functionName: "mandates",
  })) as readonly [Address, ...unknown[]];
  return mandate[0] && mandate[0] !== zeroAddress ? current : legacy;
}
