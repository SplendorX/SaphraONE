import "@/lib/env-compat";
import {
  createPublicClient,
  formatEther,
  getAddress,
  isAddress,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { onchainFacts } from "@/lib/onchain-facts";
import { arcTransport } from "@/lib/chains";

/**
 * Health of the wallets that run SaphraONE's scheduled jobs.
 *
 * Two things silently stop automation, and neither surfaces anywhere until a
 * job is due:
 *
 * 1. An operator runs out of gas. On Arc the native token is USDC, operators
 *    are never topped up automatically, and a drained one just stops.
 * 2. The key in the environment stops matching the operator the contract
 *    expects — which is what happens when someone rotates one half of a
 *    rotation. Every run then reverts with NotOperator.
 *
 * This checks both for every role, so the failure is found before a payday is.
 */

const OPERATOR_ABI = [
  {
    inputs: [],
    name: "operator",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

type RoleDefinition = {
  /** The executor's env name, then the old name it may still be set under. */
  executorEnv: string;
  legacyExecutorEnv?: string;
  keyEnv: string;
  role: string;
};

const ROLES: RoleDefinition[] = [
  {
    executorEnv: "NEXT_PUBLIC_SAPHRA_PAYROLL_ADDRESS",
    legacyExecutorEnv: "NEXT_PUBLIC_SWIFTPAY_PAYROLL_EXECUTOR_ADDRESS",
    keyEnv: "SAPHRA_PAYROLL_OPERATOR_PRIVATE_KEY",
    role: "payroll",
  },
  {
    executorEnv: "NEXT_PUBLIC_SAPHRA_RECUREPAY_ADDRESS",
    legacyExecutorEnv: "NEXT_PUBLIC_SWIFTRECUREPAY_EXECUTOR_ADDRESS",
    keyEnv: "SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY",
    role: "recurring",
  },
  {
    executorEnv: "NEXT_PUBLIC_EARN_AUTOSAVE_EXECUTOR_ADDRESS",
    keyEnv: "SAPHRA_EARN_OPERATOR_PRIVATE_KEY",
    role: "earn",
  },
];

/** The OnePoints treasury pays redemptions, so an empty one fails users. */
const TREASURY_KEY_ENV = "ONE_POINTS_TREASURY_PRIVATE_KEY";

export type OperatorStatus =
  | "OK"
  | "LOW_GAS"
  | "NO_GAS"
  | "KEY_MISMATCH"
  | "NOT_CONFIGURED";

export type OperatorHealth = {
  address: string | null;
  executor: string | null;
  gas: string;
  message?: string;
  onChainOperator?: string | null;
  role: string;
  status: OperatorStatus;
};

/** Below this, an operator is close to being unable to send. */
export function minimumGas() {
  const raw = process.env.OPERATOR_GAS_MIN?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.5;
}

function addressForKey(keyEnv: string): Address | null {
  const raw = process.env[keyEnv]?.trim();
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) return null;
  try {
    return privateKeyToAccount(key).address;
  } catch {
    return null;
  }
}

function client() {
  return createPublicClient({
    chain: onchainFacts.chain as Chain,
    transport: arcTransport(),
  });
}

async function checkRole(
  definition: RoleDefinition,
  publicClient: ReturnType<typeof client>,
  threshold: number,
): Promise<OperatorHealth> {
  const address = addressForKey(definition.keyEnv);
  const executorRaw =
    process.env[definition.executorEnv]?.trim() ||
    (definition.legacyExecutorEnv ? process.env[definition.legacyExecutorEnv]?.trim() : undefined);
  const executor =
    executorRaw && isAddress(executorRaw) ? getAddress(executorRaw) : null;

  if (!address || !executor) {
    return {
      address,
      executor,
      gas: "0",
      message: !address
        ? `${definition.keyEnv} is not set to a valid key.`
        : `${definition.executorEnv} is not set to a deployed contract.`,
      role: definition.role,
      status: "NOT_CONFIGURED",
    };
  }

  const [balance, onChainOperator] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient
      .readContract({
        abi: OPERATOR_ABI,
        address: executor,
        functionName: "operator",
      })
      .catch(() => null) as Promise<Address | null>,
  ]);

  const gas = formatEther(balance);

  // A mismatch outranks gas: topping up a wallet the contract will not accept
  // fixes nothing, so report the real cause.
  if (onChainOperator && onChainOperator.toLowerCase() !== address.toLowerCase()) {
    return {
      address,
      executor,
      gas,
      message: `The contract expects ${onChainOperator} but the configured key is ${address}. Every run will revert with NotOperator.`,
      onChainOperator,
      role: definition.role,
      status: "KEY_MISMATCH",
    };
  }

  const gasValue = Number(gas);
  if (gasValue <= 0) {
    return {
      address,
      executor,
      gas,
      message: "Out of gas — this operator cannot send any transaction.",
      onChainOperator,
      role: definition.role,
      status: "NO_GAS",
    };
  }

  if (gasValue < threshold) {
    return {
      address,
      executor,
      gas,
      message: `Gas is below ${threshold}. Top this operator up before it stops.`,
      onChainOperator,
      role: definition.role,
      status: "LOW_GAS",
    };
  }

  return {
    address,
    executor,
    gas,
    onChainOperator,
    role: definition.role,
    status: "OK",
  };
}

export type OperatorHealthReport = {
  checkedAt: string;
  healthy: boolean;
  minimumGas: number;
  problems: OperatorHealth[];
  results: OperatorHealth[];
};

export async function checkOperatorHealth(): Promise<OperatorHealthReport> {
  const publicClient = client();
  const threshold = minimumGas();

  const results = await Promise.all(
    ROLES.map((role) => checkRole(role, publicClient, threshold)),
  );

  // The treasury holds user float rather than gas, but an empty one fails
  // redemptions the same way, so it belongs in the same glance.
  const treasury = addressForKey(TREASURY_KEY_ENV);
  if (treasury) {
    const usdc = onchainFacts.usdcAddress;
    let held = "0";
    if (usdc) {
      const balance = (await publicClient
        .readContract({
          abi: [
            {
              inputs: [{ name: "account", type: "address" }],
              name: "balanceOf",
              outputs: [{ name: "", type: "uint256" }],
              stateMutability: "view",
              type: "function",
            },
          ],
          address: usdc,
          args: [treasury],
          functionName: "balanceOf",
        })
        .catch(() => BigInt(0))) as bigint;
      held = (Number(balance) / 1e6).toFixed(2);
    }

    results.push({
      address: treasury,
      executor: null,
      gas: held,
      message:
        Number(held) <= 0
          ? "The OnePoints treasury holds no USDC — redemptions will fail and refund."
          : undefined,
      role: "one-points-treasury",
      status: Number(held) <= 0 ? "NO_GAS" : "OK",
    });
  }

  const problems = results.filter((entry) => entry.status !== "OK");

  return {
    checkedAt: new Date().toISOString(),
    healthy: problems.length === 0,
    minimumGas: threshold,
    problems,
    results,
  };
}

/**
 * Post a summary to OPS_ALERT_WEBHOOK_URL when something needs attention.
 *
 * Shaped for Slack and Discord, which both accept `{ text }`. Silent when no
 * webhook is configured, so monitoring still works through the endpoint alone.
 */
export async function reportOperatorHealth(report: OperatorHealthReport) {
  const url = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!url || report.healthy) return { alerted: false };

  const lines = report.problems.map(
    (entry) =>
      `• *${entry.role}* — ${entry.status}${entry.message ? `: ${entry.message}` : ""} (balance ${entry.gas})`,
  );

  try {
    await fetch(url, {
      body: JSON.stringify({
        text: `SaphraONE operator health on ${onchainFacts.chain.name}:\n${lines.join("\n")}`,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return { alerted: true };
  } catch {
    // Never let a broken webhook fail the check itself.
    return { alerted: false };
  }
}
