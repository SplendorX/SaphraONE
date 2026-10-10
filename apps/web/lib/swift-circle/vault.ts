import {
  getAddress,
  isAddress,
  keccak256,
  stringToBytes,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import { swiftSaveVaultAbi } from "@/lib/save/abis";
import { swiftSaveVaultAddress } from "@/lib/save/config";
import { createRecurringPublicClient } from "@/lib/recurring/circle-adapter";
import { readArcReceipt, type DepositVerification } from "@/lib/swift-circle/deposits";
import { circleErrors } from "@/lib/swift-circle/errors";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";

export function circleSavePocketIdBytes32(pocketId: string): Hex {
  return keccak256(
    stringToBytes(`swiftpay:circle-save:pocket:${pocketId.toLowerCase()}`),
  );
}

export function requireCircleSaveVault(): Address {
  const vault = swiftSaveVaultAddress();
  if (!vault) {
    throw circleErrors.providerUnavailable(
      "Circle Save requires SwiftSaveVault. Set NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS.",
    );
  }
  return vault;
}

export async function assertCircleSaveVaultCanWithdraw(input: {
  amountUnits: bigint;
  owner: Address;
  pocketIdBytes32: Hex;
  token: Address;
  vault: Address;
}) {
  const client = createRecurringPublicClient();
  let available = 0n;
  try {
    available = (await client.readContract({
      abi: swiftSaveVaultAbi,
      address: input.vault,
      args: [input.owner, input.pocketIdBytes32, input.token],
      functionName: "pocketBalance",
    })) as bigint;
  } catch {
    throw circleErrors.invalid("Could not read the Circle Save pocket vault balance.");
  }
  if (available < input.amountUnits) {
    throw circleErrors.invalid(
      available <= 0n
        ? "This Circle Save pocket has no on-chain vault balance. Deposit into the pocket first. Execute only withdraws from the Save vault, never from your operator wallet."
        : "This withdrawal is larger than the on-chain pocket vault balance.",
    );
  }
  try {
    await client.simulateContract({
      account: input.owner,
      address: input.vault,
      abi: swiftSaveVaultAbi,
      functionName: "withdraw",
      args: [input.pocketIdBytes32, input.token, input.amountUnits],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Pocket withdraw cannot be simulated.";
    if (/InsufficientPocketBalance|insufficient/i.test(message)) {
      throw circleErrors.invalid(
        "This Circle Save pocket does not have enough vault balance for this withdrawal.",
      );
    }
    throw circleErrors.invalid(message.slice(0, 280));
  }
}

export async function readCircleSaveVaultHoldings(input: {
  owners: readonly string[];
  pocketId: string;
  token: Address;
  vault: Address;
}) {
  const client = createRecurringPublicClient();
  const pocketIdBytes32 = circleSavePocketIdBytes32(input.pocketId);
  const holdings: Array<{ owner: Address; units: bigint }> = [];
  const seen = new Set<string>();
  for (const raw of input.owners) {
    if (!isAddress(raw)) continue;
    const owner = getAddress(raw);
    const key = owner.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const units = (await client.readContract({
        abi: swiftSaveVaultAbi,
        address: input.vault,
        args: [owner, pocketIdBytes32, input.token],
        functionName: "pocketBalance",
      })) as bigint;
      if (units > 0n) {
        holdings.push({ owner, units });
      }
    } catch {
      // skip wallets the vault cannot read
    }
  }
  return {
    holdings,
    pocketIdBytes32,
    total: holdings.reduce((sum, row) => sum + row.units, 0n),
  };
}

export function pickCircleSaveVaultOwner(input: {
  actor: Address;
  amountUnits: bigint;
  holdings: Array<{ owner: Address; units: bigint }>;
  host: Address;
}): Address {
  const hostHold = input.holdings.find(
    (row) => row.owner.toLowerCase() === input.host.toLowerCase(),
  );
  if ((hostHold?.units ?? 0n) >= input.amountUnits) {
    return input.host;
  }
  const actorHold = input.holdings.find(
    (row) => row.owner.toLowerCase() === input.actor.toLowerCase(),
  );
  if ((actorHold?.units ?? 0n) >= input.amountUnits) {
    return input.actor;
  }
  if (input.holdings.reduce((sum, row) => sum + row.units, 0n) <= 0n) {
    throw circleErrors.invalid(
      "This Circle Save pocket has no on-chain vault balance, so recorded ledger deposits cannot be withdrawn here.",
    );
  }
  throw circleErrors.invalid(
    "This Circle Save pocket’s vault balance is held by a different member wallet, so this host wallet cannot withdraw it.",
  );
}

export type CircleSaveVaultCall = {
  amountUnits: string;
  destination: string;
  needsForward: boolean;
  owner: string;
  pocketId: string;
  pocketIdBytes32: Hex;
  token: Address;
  vault: Address;
};

export function tokenTransferred(input: {
  logs: readonly {
    address: string;
    topics: readonly string[];
    data: string;
  }[];
  token: Address;
  from: Address;
  to: Address;
}): bigint {
  const tokenAddr = input.token.toLowerCase();
  const from = input.from.toLowerCase();
  const to = input.to.toLowerCase();
  const transferTopic =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  let total = 0n;
  for (const log of input.logs) {
    if (log.address.toLowerCase() !== tokenAddr) continue;
    if (log.topics[0]?.toLowerCase() !== transferTopic) continue;
    if (log.topics.length < 3) continue;
    const src = `0x${(log.topics[1] ?? "").slice(-40)}`.toLowerCase();
    const dest = `0x${(log.topics[2] ?? "").slice(-40)}`.toLowerCase();
    if (src !== from || dest !== to) continue;
    try {
      const amount = BigInt(log.data || "0x0");
      if (amount > 0n) total += amount;
    } catch {
      // skip malformed log
    }
  }
  return total;
}

export async function verifyCircleSaveWithdrawal(input: {
  amountUnits: bigint;
  asset: ArcTokenSymbol | string;
  destination: Address;
  owner: Address;
  txHash: Hash;
  waitMs?: number;
}): Promise<DepositVerification> {
  void input.destination;
  const vault = swiftSaveVaultAddress();
  if (!vault) {
    return {
      ok: false,
      pending: false,
      reason: "SwiftSaveVault is not configured.",
    };
  }
  const token =
    input.asset === "EURC" ? arcTokens.EURC : arcTokens.USDC;
  const receipt = await readArcReceipt(input.txHash, input.waitMs ?? 0);
  if (!receipt) {
    return {
      ok: false,
      pending: true,
      reason: "The Arc transaction is not indexed yet.",
    };
  }
  if (receipt.status !== "success") {
    return {
      ok: false,
      pending: false,
      reason:
        "The pocket withdrawal reverted on Arc. The Save vault did not release this amount — usually the pocket has no on-chain vault balance yet.",
    };
  }
  const logs = receipt.logs as Array<{
    address: string;
    topics: readonly string[];
    data: string;
  }>;
  const fromVault = tokenTransferred({
    logs,
    token: token.address,
    from: vault,
    to: input.owner,
  });
  const withdrawn = vaultWithdrawnAmount({
    logs,
    owner: input.owner,
    token: token.address,
    vault,
  });
  if (fromVault < input.amountUnits && withdrawn < input.amountUnits) {
    return {
      ok: false,
      pending: false,
      reason:
        "This transaction did not withdraw from the Circle Save pocket. Operator-wallet transfers are not allowed.",
    };
  }
  return { ok: true, creditedUnits: input.amountUnits };
}

const WITHDRAWN_TOPIC = keccak256(
  stringToBytes("Withdrawn(address,bytes32,address,uint256)"),
);

function vaultWithdrawnAmount(input: {
  logs: readonly {
    address: string;
    topics: readonly string[];
    data: string;
  }[];
  owner: Address;
  token: Address;
  vault: Address;
}) {
  const vaultAddr = input.vault.toLowerCase();
  const owner = input.owner.toLowerCase();
  const token = input.token.toLowerCase();
  const topic = WITHDRAWN_TOPIC.toLowerCase();
  let total = 0n;
  for (const log of input.logs) {
    if (log.address.toLowerCase() !== vaultAddr) continue;
    if (log.topics[0]?.toLowerCase() !== topic) continue;
    const logOwner = `0x${(log.topics[1] ?? "").slice(-40)}`.toLowerCase();
    const logToken = `0x${(log.topics[3] ?? "").slice(-40)}`.toLowerCase();
    if (logOwner !== owner || logToken !== token) continue;
    try {
      const amount = BigInt(log.data || "0x0");
      if (amount > 0n) total += amount;
    } catch {
      // skip malformed log
    }
  }
  return total;
}
