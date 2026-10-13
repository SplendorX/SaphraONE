import { parseEventLogs, type Address, type Hash, type Hex } from "viem";

import { recurringFeeUnits } from "@/lib/fees";
import { createRecurringPublicClient } from "@/lib/recurring/circle-adapter";
import {
  erc20Abi,
  swiftRecurepayExecutorAbi,
  swiftRecurepayExecutorAddress,
} from "@/lib/contracts";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  mandatePeriodSeconds,
  withScheduleDefaults,
  type RecurringAuthorizationStatus,
  type RecurringScheduleRecord,
} from "@/lib/recurring-utils";
import { arcTokens } from "@/lib/tokens";

const schedulesTable =
  process.env.SUPABASE_RECURRING_SCHEDULES_TABLE ?? "recurring_schedules";

export function computeDefaultTotalLimitUnits(schedule: RecurringScheduleRecord) {
  const amount = BigInt(schedule.amount_units);
  if (schedule.max_runs && schedule.max_runs > 0) {
    return (amount * BigInt(schedule.max_runs)).toString();
  }
  return null;
}

export async function verifyExecutorAllowance(input: {
  ownerWallet: string;
  requiredUnits: bigint;
  tokenSymbol: RecurringScheduleRecord["token_symbol"];
}) {
  if (!swiftRecurepayExecutorAddress) {
    return {
      allowance: 0n,
      error: "RecurePay executor is not configured.",
      ok: false as const,
    };
  }

  const publicClient = createRecurringPublicClient();
  const tokenInfo = arcTokens[input.tokenSymbol];
  const allowance = await publicClient.readContract({
    abi: erc20Abi,
    address: tokenInfo.address,
    args: [input.ownerWallet as Address, swiftRecurepayExecutorAddress as Address],
    functionName: "allowance",
  });

  if (allowance < input.requiredUnits) {
    return {
      allowance,
      error:
        "Approve the RecurePay executor for at least one payment plus its service fee.",
      ok: false as const,
    };
  }

  return { allowance, ok: true as const };
}

/** How far back to look for a schedule's mandate when no usable hash is given. */
const mandateLookbackBlocks = BigInt(9_000);
const mandateLookbackWindows = 3;

/**
 * Finds the mandate a schedule's owner created on-chain and checks it pays
 * exactly this schedule: same payer, recipient and token, a cap covering one
 * payment, and a period no longer than the schedule's.
 *
 * The browser's transaction hash is only a hint. Circle wallets sometimes
 * report the wrong transaction (for example the approval sent just before),
 * so when the hash holds no matching mandate, recent MandateCreated events for
 * this payer and recipient are read instead. Either way the chain decides.
 */
async function verifyScheduleMandate(input: {
  maxUnits: bigint;
  ownerWallet: string;
  schedule: RecurringScheduleRecord;
  txHash: string | null | undefined;
}): Promise<{ mandateId: Hex } | { error: string }> {
  if (!swiftRecurepayExecutorAddress) {
    return { error: "RecurePay executor is not configured." };
  }
  const publicClient = createRecurringPublicClient();
  const executor = swiftRecurepayExecutorAddress as Address;
  const owner = input.ownerWallet.toLowerCase();
  const recipient = input.schedule.beneficiary_wallet.toLowerCase();
  const token = arcTokens[input.schedule.token_symbol].address.toLowerCase();

  const matches = (args: { payer: string; recipient: string; token: string }) =>
    args.payer.toLowerCase() === owner &&
    args.recipient.toLowerCase() === recipient &&
    args.token.toLowerCase() === token;

  // Newest first.
  const candidates: Hex[] = [];

  if (input.txHash && /^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
    const receipt = await publicClient
      .waitForTransactionReceipt({ hash: input.txHash as Hash, timeout: 45_000 })
      .catch(() => null);
    if (receipt?.status === "success") {
      for (const log of parseEventLogs({
        abi: swiftRecurepayExecutorAbi,
        eventName: "MandateCreated",
        logs: receipt.logs.filter(
          (entry) => entry.address.toLowerCase() === executor.toLowerCase(),
        ),
      })) {
        if (matches(log.args)) candidates.push(log.args.mandateId);
      }
    }
  }

  if (candidates.length === 0) {
    const latest = await publicClient.getBlockNumber();
    for (let window = 0; window < mandateLookbackWindows; window += 1) {
      const toBlock = latest - mandateLookbackBlocks * BigInt(window);
      const fromBlock = toBlock - mandateLookbackBlocks + BigInt(1);
      if (fromBlock < BigInt(0)) break;
      const logs = await publicClient
        .getContractEvents({
          abi: swiftRecurepayExecutorAbi,
          address: executor,
          args: {
            payer: input.ownerWallet as Address,
            recipient: input.schedule.beneficiary_wallet as Address,
          },
          eventName: "MandateCreated",
          fromBlock,
          toBlock,
        })
        .catch(() => []);
      for (const log of [...logs].reverse()) {
        if (matches(log.args as { payer: string; recipient: string; token: string })) {
          candidates.push(log.args.mandateId as Hex);
        }
      }
      if (candidates.length > 0) break;
    }
  }

  if (candidates.length === 0) {
    return { error: "No Autopay mandate found for this schedule yet. Create it in your wallet." };
  }

  const schedulePeriod = mandatePeriodSeconds(
    input.schedule.frequency,
    input.schedule.interval_days,
  );
  let reason = "This schedule's Autopay mandate has been cancelled.";

  for (const mandateId of candidates) {
    const [, , , period, , , active, maxPerPeriod] = await publicClient.readContract({
      abi: swiftRecurepayExecutorAbi,
      address: executor,
      args: [mandateId],
      functionName: "mandates",
    });

    if (!active) continue;
    if (maxPerPeriod < input.maxUnits) {
      reason = "The mandate's limit is below this schedule's payment amount.";
      continue;
    }
    if (Number(period) > schedulePeriod) {
      reason = "The mandate's period is longer than this schedule's frequency.";
      continue;
    }
    return { mandateId };
  }

  return { error: reason };
}

export async function authorizeRecurringSchedule(input: {
  authorizationTxHash?: string | null;
  expiresAt?: string | null;
  maxPaymentAmountUnits?: string | null;
  ownerWallet: string;
  schedule: RecurringScheduleRecord;
  totalLimitUnits?: string | null;
}) {
  const schedule = withScheduleDefaults(input.schedule);
  const maxUnits = BigInt(
    input.maxPaymentAmountUnits ?? schedule.amount_units,
  );
  const mandate = await verifyScheduleMandate({
    maxUnits,
    ownerWallet: input.ownerWallet,
    schedule,
    txHash: input.authorizationTxHash,
  });
  if ("error" in mandate) {
    return { error: mandate.error };
  }

  const required = maxUnits + recurringFeeUnits(maxUnits);
  const verified = await verifyExecutorAllowance({
    ownerWallet: input.ownerWallet,
    requiredUnits: required,
    tokenSymbol: schedule.token_symbol,
  });

  if (!verified.ok) {
    return { error: verified.error };
  }

  const now = new Date().toISOString();
  const totalLimitUnits =
    input.totalLimitUnits ??
    schedule.total_limit_units ??
    computeDefaultTotalLimitUnits(schedule);

  const supabase = createSupabaseAdminClient();
  const mutation = await supabase
    .from(schedulesTable)
    .update({
      authorization_expires_at: input.expiresAt ?? schedule.ends_at,
      authorization_mandate_id: mandate.mandateId,
      authorization_status: "AUTHORIZED" satisfies RecurringAuthorizationStatus,
      authorization_tx_hash: input.authorizationTxHash ?? null,
      authorized_at: now,
      authorized_recipient: schedule.beneficiary_wallet.toLowerCase(),
      authorized_token: schedule.token_symbol,
      autopay_enabled: true,
      max_payment_amount: schedule.amount,
      max_payment_amount_units: maxUnits.toString(),
      total_limit_units: totalLimitUnits,
      updated_at: now,
    })
    .eq("id", schedule.id)
    .eq("owner_wallet", input.ownerWallet.toLowerCase())
    .select("*")
    .single();

  if (mutation.error || !mutation.data) {
    return {
      error: mutation.error?.message ?? "Could not store Autopay authorization.",
    };
  }

  return { schedule: withScheduleDefaults(mutation.data as RecurringScheduleRecord) };
}

export async function revokeRecurringAuthorization(input: {
  ownerWallet: string;
  scheduleId: string;
}) {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const mutation = await supabase
    .from(schedulesTable)
    .update({
      authorization_status: "REVOKED" satisfies RecurringAuthorizationStatus,
      autopay_enabled: false,
      updated_at: now,
    })
    .eq("id", input.scheduleId)
    .eq("owner_wallet", input.ownerWallet.toLowerCase())
    .select("*")
    .single();

  if (mutation.error || !mutation.data) {
    return { error: mutation.error?.message ?? "Could not revoke Autopay." };
  }

  return { schedule: withScheduleDefaults(mutation.data as RecurringScheduleRecord) };
}

export function authorizationInvalidatedByUpdate(
  current: RecurringScheduleRecord,
  updates: {
    amountUnits?: string;
    frequency?: string;
    intervalDays?: number | null;
    tokenSymbol?: string;
  },
) {
  if (current.authorization_status !== "AUTHORIZED") {
    return false;
  }
  // The on-chain mandate's period was sized for the old frequency.
  if (updates.frequency && updates.frequency !== current.frequency) {
    return true;
  }
  if (
    updates.intervalDays !== undefined &&
    (updates.intervalDays ?? null) !== (current.interval_days ?? null)
  ) {
    return true;
  }
  if (updates.amountUnits && updates.amountUnits !== current.amount_units) {
    return true;
  }
  if (
    updates.tokenSymbol &&
    updates.tokenSymbol.toUpperCase() !== current.token_symbol.toUpperCase()
  ) {
    return true;
  }
  return false;
}
