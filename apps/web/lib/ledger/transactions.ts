// Server-only. The verified transaction ledger: one row per on-chain
// transaction an account makes through SaphraONE, read back from the chain.
// It feeds USDC campaigns and leaderboards; recording never blocks a payment.
import { isAddress } from "viem";

import { loadAgentWalletConfig } from "@/lib/agent-wallet/config";
import { isActivitySource } from "@/lib/activity/types";
import { arcChain } from "@/lib/chains";
import { classifyLedgerEntry } from "@/lib/ledger/classify";
import { usdPerEur } from "@/lib/referral/fx";
import { verifyWalletOutflow, type VerifiedOutflow } from "@/lib/referral/verify-activity";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const ledgerTable = process.env.SUPABASE_TRANSACTION_LEDGER_TABLE ?? "transaction_ledger";

/** Kill switch: set TX_LEDGER_DISABLED=true to stop writing (reads are unaffected). */
function ledgerEnabled() {
  return process.env.TX_LEDGER_DISABLED?.trim() !== "true";
}

/** The feature labels clients send for a transaction, mapped to ledger sources. */
const activityTypeSources: Record<string, string> = {
  BATCH_PAYMENT: "batch",
  INVOICE_PAYMENT: "invoice",
  PAYROLL_DISBURSEMENT: "payroll",
  POCKET_DEPOSIT: "save",
  SWAP: "swap",
  TRANSFER: "send",
};

/**
 * The ledger source for a client-reported transaction: the feature label when
 * it is a known one (checkout, recurepay, circle…), else the activity type.
 * Only a label — whether the row counts is decided from the chain.
 */
export function ledgerSourceFor(activityType: string, featureSource?: unknown) {
  if (isActivitySource(featureSource)) return featureSource;
  return activityTypeSources[activityType] ?? "send";
}

let warnedMissingTable = false;

/**
 * Record one transaction. Verifies it on Arc when the caller hasn't already
 * (pass `verified` to skip the second read), values it in USD at today's EUR
 * rate, and classifies it. Idempotent on (tx hash, wallet). Never throws.
 */
export async function recordLedgerTransaction(input: {
  /** The account the transaction belongs to (its owner wallet). */
  wallet: string;
  /**
   * The wallet the money actually left, when it isn't the account's own —
   * ALLIE pays from the owner's Agent Wallet.
   */
  sender?: string;
  txHash: string | null | undefined;
  source: string;
  verified?: VerifiedOutflow | null;
  metadata?: Record<string, unknown>;
  /** When it happened, for backfilled rows; defaults to now. */
  occurredAt?: string | null;
}): Promise<"recorded" | "skipped" | "failed"> {
  if (!ledgerEnabled()) return "skipped";
  const txHash = input.txHash?.trim().toLowerCase();
  if (!txHash || !/^0x[0-9a-f]{64}$/.test(txHash) || !isAddress(input.wallet)) return "skipped";
  if (input.sender && !isAddress(input.sender)) return "skipped";
  const wallet = input.wallet.toLowerCase();
  const sender = (input.sender ?? input.wallet).toLowerCase();

  try {
    const verified = input.verified ?? (await verifyWalletOutflow(txHash as `0x${string}`, sender));
    // Not mined, failed, or moved none of this wallet's stablecoins.
    if (!verified) return "skipped";

    const [agent, eurRate] = await Promise.all([
      loadAgentWalletConfig(wallet).catch(() => null),
      usdPerEur(),
    ]);
    const rate = verified.token === "EURC" ? eurRate : 1;
    const ownWallets = [wallet, sender, ...(agent?.walletAddress ? [agent.walletAddress] : [])];
    const { eligible, reason } = classifyLedgerEntry({
      amount: verified.amount,
      ownWallets,
      payees: verified.payees,
      source: input.source,
    });

    const { error } = await createSupabaseAdminClient()
      .from(ledgerTable)
      .upsert(
        {
          amount: verified.amount,
          amount_usd: verified.amount * rate,
          chain_id: arcChain.id,
          eligible,
          fee_amount: verified.feePaid,
          fee_usd: verified.feePaid * rate,
          ineligible_reason: reason,
          ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
          metadata: sender === wallet ? (input.metadata ?? {}) : { ...input.metadata, sender },
          payee_count: Object.keys(verified.payees).length,
          payees: verified.payees,
          source: input.source,
          token: verified.token,
          tx_hash: txHash,
          wallet_address: wallet,
        },
        { ignoreDuplicates: true, onConflict: "tx_hash,wallet_address" },
      );

    if (error) {
      // Before transaction-ledger.sql is run the table is missing: say so once.
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn("[ledger] could not record a transaction:", error.message);
      }
      return "failed";
    }
    return "recorded";
  } catch (error) {
    console.warn("[ledger]", error instanceof Error ? error.message : error);
    return "failed";
  }
}
