import "@/lib/env-compat";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  isAddress,
  keccak256,
  parseUnits,
  toHex,
  type Address,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { erc20Abi, swiftPayrollExecutorAbi } from "@/lib/contracts";
import { payrollDb, payrollTables, readPayrollDbError } from "@/lib/payroll/db";
import { executePayrollRun } from "@/lib/payroll/execution-service";
import { onchainFacts } from "@/lib/onchain-facts";
import {
  getEntitlement,
  isEntitlementActive,
} from "@/lib/referral/entitlement-service";
import type { PayrollRunRecord } from "@/lib/payroll/types";
import { arcTransport } from "@/lib/chains";

/**
 * Settles approved payroll runs without a human present.
 *
 * The operator decides only *whether a run the business already approved is
 * due*. Recipients and amounts come from the run's immutable snapshot, and the
 * money moves straight from the business wallet through an allowance it granted
 * and can revoke. The operator never holds payroll funds.
 */

export { swiftPayrollExecutorAbi };

export function payrollExecutorAddress(): Address | null {
  const value = process.env.NEXT_PUBLIC_SWIFTPAY_PAYROLL_EXECUTOR_ADDRESS?.trim();
  return value && isAddress(value) ? getAddress(value) : null;
}

function operatorPrivateKey() {
  const raw =
    process.env.SAPHRA_PAYROLL_OPERATOR_PRIVATE_KEY?.trim() ||
    process.env.SAPHRA_RECURRING_OPERATOR_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  return /^0x[a-fA-F0-9]{64}$/.test(key) ? key : null;
}


function clients() {
  const privateKey = operatorPrivateKey();
  if (!privateKey) return null;

  const chain = onchainFacts.chain as Chain;
  const transport = arcTransport();
  const account = privateKeyToAccount(privateKey);

  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}

/** Deterministic per run, so a retry can never pay the same payroll twice. */
function executionIdFor(run: PayrollRunRecord) {
  return keccak256(toHex(`swiftpay-payroll:${run.id}`));
}

export type PayrollSettlementOutcome = {
  payrollRunId: string;
  reason?: string;
  status: "PAID" | "SKIPPED" | "FAILED";
  txHash?: string;
};

/**
 * Approved runs that a schedule produced and that are still waiting to be paid.
 *
 * Restricted to SCHEDULED runs on purpose: a manually created run is a human's
 * to settle, and sweeping those up unattended would take away a decision they
 * did not delegate.
 */
async function listPayableRuns(limit: number): Promise<PayrollRunRecord[]> {
  const supabase = payrollDb();
  const { data, error } = await supabase
    .from(payrollTables.runs)
    .select("*")
    .eq("status", "APPROVED")
    .eq("source", "SCHEDULED")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(readPayrollDbError(error, "Failed to load payable runs."));
  }

  return (data ?? []) as PayrollRunRecord[];
}

async function settleRun(
  run: PayrollRunRecord,
  ctx: NonNullable<ReturnType<typeof clients>>,
  executor: Address,
): Promise<PayrollSettlementOutcome> {
  const snapshot = run.snapshot;
  if (!snapshot?.recipients?.length) {
    return {
      payrollRunId: run.id,
      reason: "The approved snapshot is missing, so there is nothing to pay.",
      status: "FAILED",
    };
  }

  const token = onchainFacts.usdcAddress;
  if (!token) {
    return {
      payrollRunId: run.id,
      reason: "USDC is not configured.",
      status: "FAILED",
    };
  }

  const payer = getAddress(run.account_id);
  const recipients: Address[] = [];
  const amounts: bigint[] = [];

  for (const item of snapshot.recipients) {
    if (!isAddress(item.recipient_destination)) {
      return {
        payrollRunId: run.id,
        reason: `${item.recipient_name} has no on-chain address, so this run needs manual payment.`,
        status: "SKIPPED",
      };
    }
    recipients.push(getAddress(item.recipient_destination));
    amounts.push(parseUnits(item.total_amount, 6));
  }

  const gross = amounts.reduce((total, value) => total + value, BigInt(0));
  // Mirrors the executor's 1% so the allowance and balance checks match what
  // the contract will actually pull.
  const required = gross + (gross * BigInt(100)) / BigInt(10_000);

  const [balance, allowance] = await Promise.all([
    ctx.publicClient.readContract({
      abi: erc20Abi,
      address: token,
      args: [payer],
      functionName: "balanceOf",
    }) as Promise<bigint>,
    ctx.publicClient.readContract({
      abi: erc20Abi,
      address: token,
      args: [payer, executor],
      functionName: "allowance",
    }) as Promise<bigint>,
  ]);

  if (allowance < required) {
    return {
      payrollRunId: run.id,
      reason:
        "This business has not approved enough USDC for automatic payroll. Approve the payroll executor to resume.",
      status: "SKIPPED",
    };
  }

  if (balance < required) {
    return {
      payrollRunId: run.id,
      reason: "The business wallet does not hold enough USDC for this run.",
      status: "SKIPPED",
    };
  }

  // The executor only pays payees the business registered on-chain, within
  // their cap per period. Checking first turns a certain revert into a reason
  // the business can act on.
  const owed = new Map<Address, bigint>();
  recipients.forEach((recipient, index) => {
    owed.set(recipient, (owed.get(recipient) ?? BigInt(0)) + amounts[index]);
  });
  for (const [recipient, amount] of owed) {
    const remaining = (await ctx.publicClient.readContract({
      abi: swiftPayrollExecutorAbi,
      address: executor,
      args: [payer, token, recipient],
      functionName: "remainingInPeriod",
    })) as bigint;
    if (remaining < amount) {
      const name =
        snapshot.recipients.find(
          (item) => item.recipient_destination.toLowerCase() === recipient.toLowerCase(),
        )?.recipient_name ?? recipient;
      return {
        payrollRunId: run.id,
        reason:
          remaining === BigInt(0)
            ? `${name} isn't registered for automatic payroll yet, or was already paid this period. Register the team on the Schedules page.`
            : `${name}'s pay is above their automatic payroll cap. Update the team registration or pay this run by hand.`,
        status: "SKIPPED",
      };
    }
  }

  const hash = await ctx.walletClient.writeContract({
    abi: swiftPayrollExecutorAbi,
    address: executor,
    args: [executionIdFor(run), token, payer, recipients, amounts],
    functionName: "executePayroll",
  });

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    return {
      payrollRunId: run.id,
      reason: "The payroll transaction reverted on chain.",
      status: "FAILED",
      txHash: hash,
    };
  }

  // Record it through the normal path so items, audit and status all move the
  // way they do for a manually settled run.
  await executePayrollRun({
    accountId: run.account_id,
    actorId: "system:payroll-operator",
    payrollRunId: run.id,
    txHash: hash,
  });

  return { payrollRunId: run.id, status: "PAID", txHash: hash };
}

export async function processScheduledPayrollPayments(limit = 10) {
  const executor = payrollExecutorAddress();
  const ctx = clients();

  if (!executor || !ctx) {
    return {
      configured: false,
      processed: 0,
      results: [] as PayrollSettlementOutcome[],
    };
  }

  const runs = await listPayableRuns(limit);
  const results: PayrollSettlementOutcome[] = [];

  // One lookup per business rather than per run.
  const entitled = new Map<string, boolean>();

  for (const run of runs) {
    let outcome: PayrollSettlementOutcome;
    try {
      const account = run.account_id.toLowerCase();
      if (!entitled.has(account)) {
        entitled.set(
          account,
          isEntitlementActive(
            await getEntitlement(account, "PAYROLL_AUTO_SCHEDULE"),
          ),
        );
      }

      // Premium covers paying without anyone present. Schedules still build
      // the runs for free — an unsubscribed business just approves and pays
      // them by hand, so nothing silently stops working.
      outcome = entitled.get(account)
        ? await settleRun(run, ctx, executor)
        : {
            payrollRunId: run.id,
            reason:
              "Automatic payment is premium. This run is ready for manual approval and payment.",
            status: "SKIPPED",
          };
    } catch (cause) {
      outcome = {
        payrollRunId: run.id,
        reason:
          cause instanceof Error ? cause.message.split("\n")[0] : "Run failed.",
        status: "FAILED",
      };
    }

    if (outcome.status !== "PAID") {
      console.info("[payroll-operator]", run.id, outcome.status, outcome.reason);
    }

    results.push(outcome);
  }

  return { configured: true, processed: results.length, results };
}
