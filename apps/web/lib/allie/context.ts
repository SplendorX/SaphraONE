import { createSupabaseAdminClient } from "@/lib/supabase-server";

import {
  formatAmountUnits,
  type PaymentIntentAsset,
} from "@/lib/payment-engine/intent";
import { paymentIntentsTable } from "@/lib/payment-engine/ledger";
import { localIsoMinute } from "@/lib/payment-engine/local-day";
import { loadContacts } from "@/lib/payment-engine/contacts";
import {
  getDailySpentUnits,
  loadPolicyTimeZone,
  loadPolicyConfigOrDefault,
} from "@/lib/payment-engine/policy";
import {
  getAgentWalletBalance,
  isAgentWalletConfigured,
} from "@/lib/agent-wallet/client";
import { loadAgentWalletConfig } from "@/lib/agent-wallet/config";

/** Hard caps so the prompt cannot grow with the user's history. */
export const maxContextTransactions = 5;
export const maxContextRecipients = 20;
/** Contact names shown to the model; enough to resolve "send mum 10". */
const maxContextContacts = 40;

export type AllieRecentTransaction = {
  recipient: string;
  amountUsdc: number;
  date: string;
};

export type AllieContext = {
  walletBalance: bigint;
  dailySpentUnits: bigint;
  dailyLimitUnits: bigint;
  approvedRecipients: string[];
  recentTransactions: AllieRecentTransaction[];
  agentWalletStatus: "active" | "paused" | "revoked" | "not_created";
  /** The owner's IANA zone, for resolving dates in schedules. */
  timeZone: string;
  /** Local time now, ISO with offset, to the minute. */
  localNow: string;
  /** Names of the owner's saved contacts — names only, never wallets. */
  contactNames: string[];
};

type RecentRow = {
  recipient: string;
  resolved_recipient: string | null;
  amount_units: string;
  asset: string;
  created_at: string;
};

function shortenRecipient(value: string) {
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }

  return value;
}

async function loadRecentTransactions(ownerWallet: string) {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from(paymentIntentsTable)
    .select("recipient,resolved_recipient,amount_units,asset,created_at")
    .eq("initiator_id", ownerWallet.toLowerCase())
    .in("status", ["submitted", "confirming", "completed"])
    .order("created_at", { ascending: false })
    .limit(maxContextTransactions)
    .returns<RecentRow[]>();

  if (error) {
    return [] as AllieRecentTransaction[];
  }

  return (data ?? []).map((row) => ({
    recipient: shortenRecipient(row.recipient || row.resolved_recipient || ""),
    amountUsdc: Number.parseFloat(formatAmountUnits(BigInt(row.amount_units))),
    date: row.created_at.slice(0, 10),
  }));
}

/**
 * Bounded prompt context. Never includes primary wallet private data,
 * Circle tokens, session tokens, or anything the user has not already seen.
 */
export async function buildAllieContext(
  ownerWallet: string,
  options: { asset?: PaymentIntentAsset } = {},
): Promise<AllieContext> {
  const [policy, dailySpentUnits, recentTransactions, agentWallet, timeZone, contacts] =
    await Promise.all([
      loadPolicyConfigOrDefault(ownerWallet),
      getDailySpentUnits(ownerWallet).catch(() => 0n),
      loadRecentTransactions(ownerWallet).catch(
        () => [] as AllieRecentTransaction[],
      ),
      loadAgentWalletConfig(ownerWallet).catch(() => null),
      loadPolicyTimeZone(ownerWallet),
      loadContacts(ownerWallet),
    ]);

  let walletBalance = 0n;

  if (agentWallet && isAgentWalletConfigured()) {
    try {
      walletBalance = await getAgentWalletBalance(
        agentWallet.walletId,
        options.asset ?? "USDC",
      );
    } catch {
      walletBalance = 0n;
    }
  }

  return {
    walletBalance,
    dailySpentUnits,
    dailyLimitUnits: policy.dailyLimitUnits,
    approvedRecipients: policy.approvedRecipients.slice(
      0,
      maxContextRecipients,
    ),
    recentTransactions: recentTransactions.slice(0, maxContextTransactions),
    agentWalletStatus: agentWallet ? agentWallet.status : "not_created",
    timeZone,
    localNow: localIsoMinute(timeZone),
    contactNames: contacts
      .map((contact) => contact.name)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, maxContextContacts),
  };
}

/**
 * Stable string used both for the LLM prompt and for the dedupe cache key.
 * Deterministic ordering matters — an unstable render would defeat the cache.
 */
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The local calendar day's weekday, read from "YYYY-MM-DDTHH:MM±HH:MM". */
function weekdayOf(localIso: string) {
  const day = new Date(`${localIso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(day.getTime()) ? "day" : weekdays[day.getUTCDay()];
}

export function renderAllieContext(context: AllieContext) {
  const lines = [
    // Resolves "tomorrow", "Monday 9am" for schedules. Minute precision keeps
    // the cache key stable within its 60-second life.
    // The weekday too: models miscount "next friday" from a bare date.
    `Current time: ${context.localNow} (${context.timeZone}), a ${weekdayOf(context.localNow)}`,
    `User's ALLIE wallet balance: ${formatAmountUnits(context.walletBalance)} USDC`,
    context.approvedRecipients.length > 0
      ? `Approved recipients: ${context.approvedRecipients.join(", ")}`
      : "Approved recipients: any recipient allowed",
    `Today's spending so far: ${formatAmountUnits(context.dailySpentUnits)} USDC (daily limit, resets at the owner's local midnight: ${formatAmountUnits(context.dailyLimitUnits)} USDC)`,
    `Agent wallet status: ${context.agentWalletStatus}`,
  ];

  if (context.contactNames.length > 0) {
    lines.push(`Saved contacts: ${context.contactNames.join(", ")}`);
  }

  if (context.recentTransactions.length > 0) {
    lines.push(
      `Recent transactions: ${context.recentTransactions
        .map(
          (entry) => `${entry.recipient} ${entry.amountUsdc} USDC on ${entry.date}`,
        )
        .join("; ")}`,
    );
  }

  return lines.join("\n");
}

export function serializeAllieContext(context: AllieContext) {
  return {
    ...context,
    walletBalance: context.walletBalance.toString(),
    dailySpentUnits: context.dailySpentUnits.toString(),
    dailyLimitUnits: context.dailyLimitUnits.toString(),
  };
}
