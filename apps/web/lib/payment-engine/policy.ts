import { createSupabaseAdminClient } from "@/lib/supabase-server";

import { sumSpentUnitsSince } from "@/lib/payment-engine/ledger";
import { isValidTimeZone, startOfLocalDay } from "@/lib/payment-engine/local-day";
import type {
  PaymentIntent,
  PaymentIntentAsset,
} from "@/lib/payment-engine/intent";

export const paymentPoliciesTable =
  process.env.SUPABASE_PAYMENT_POLICIES_TABLE ?? "payment_policies";

export type PolicyStatus = "active" | "paused" | "revoked";

export type PolicyConfig = {
  ownerWallet: string;
  perTxLimitUnits: bigint;
  dailyLimitUnits: bigint;
  /** Empty means any recipient is allowed. */
  approvedRecipients: string[];
  approvedAssets: PaymentIntentAsset[];
  requiresApprovalAboveUnits: bigint;
  status: PolicyStatus;
};

export type PolicyResult = {
  allowed: boolean;
  reason?: string;
  /** True = a human must confirm before this intent executes. */
  requiresApproval?: boolean;
};

const oneUsdc = 1_000_000n;

/** Conservative defaults for a wallet that has not configured a policy yet. */
export const defaultPolicyConfig = {
  perTxLimitUnits: 25n * oneUsdc,
  dailyLimitUnits: 100n * oneUsdc,
  approvedRecipients: [] as string[],
  approvedAssets: ["USDC"] as PaymentIntentAsset[],
  requiresApprovalAboveUnits: 10n * oneUsdc,
  status: "active" as PolicyStatus,
};

function normalizeRecipientKey(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "").replace(/\.one$/i, "");
}

/**
 * The trust boundary between intent creation and execution.
 * Fails closed: any thrown error returns { allowed: false }.
 */
export function evaluatePolicy(
  intent: PaymentIntent,
  config: PolicyConfig,
  dailySpentUnits: bigint,
): PolicyResult {
  try {
    if (config.status !== "active") {
      return { allowed: false, reason: "Agent wallet is paused or revoked" };
    }

    if (!config.approvedAssets.includes(intent.asset)) {
      return { allowed: false, reason: "Asset not approved" };
    }

    if (intent.amountUnits > config.perTxLimitUnits) {
      return { allowed: false, reason: "Exceeds per-transaction limit" };
    }

    if (dailySpentUnits + intent.amountUnits > config.dailyLimitUnits) {
      return { allowed: false, reason: "Daily limit reached" };
    }

    if (config.approvedRecipients.length > 0) {
      const allowlist = config.approvedRecipients.map(normalizeRecipientKey);
      const candidates = [intent.recipient, intent.resolvedRecipient]
        .filter((value): value is string => Boolean(value))
        .map(normalizeRecipientKey);

      if (!candidates.some((candidate) => allowlist.includes(candidate))) {
        return { allowed: false, reason: "Recipient not on allowlist" };
      }
    }

    if (intent.amountUnits > config.requiresApprovalAboveUnits) {
      return { allowed: true, requiresApproval: true };
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: "Policy evaluation error" };
  }
}

type PolicyRow = {
  owner_wallet: string;
  per_tx_limit_units: string;
  daily_limit_units: string;
  approved_recipients: unknown;
  approved_assets: unknown;
  requires_approval_above_units: string;
  status: string;
};

function parseUnits(value: unknown, fallback: bigint) {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }

  const raw = String(value).trim();

  if (!/^\d+$/.test(raw)) {
    return fallback;
  }

  return BigInt(raw);
}

function parseRecipients(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function parseAssets(value: unknown): PaymentIntentAsset[] {
  if (!Array.isArray(value)) {
    return ["USDC"];
  }

  const assets = value.filter(
    (entry): entry is PaymentIntentAsset => entry === "USDC" || entry === "EURC",
  );

  return assets.length > 0 ? assets : ["USDC"];
}

function parseStatus(value: unknown): PolicyStatus {
  return value === "paused" || value === "revoked" || value === "active"
    ? value
    : "active";
}

function policyFromRow(row: PolicyRow): PolicyConfig {
  return {
    ownerWallet: row.owner_wallet,
    perTxLimitUnits: parseUnits(
      row.per_tx_limit_units,
      defaultPolicyConfig.perTxLimitUnits,
    ),
    dailyLimitUnits: parseUnits(
      row.daily_limit_units,
      defaultPolicyConfig.dailyLimitUnits,
    ),
    approvedRecipients: parseRecipients(row.approved_recipients),
    approvedAssets: parseAssets(row.approved_assets),
    requiresApprovalAboveUnits: parseUnits(
      row.requires_approval_above_units,
      defaultPolicyConfig.requiresApprovalAboveUnits,
    ),
    status: parseStatus(row.status),
  };
}

export async function loadPolicyConfig(
  ownerWallet: string,
): Promise<PolicyConfig | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from(paymentPoliciesTable)
    .select("*")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .maybeSingle<PolicyRow>();

  if (error) {
    throw new Error(error.message || "Payment policy could not be loaded.");
  }

  return data ? policyFromRow(data) : null;
}

export async function savePolicyConfig(config: PolicyConfig) {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.from(paymentPoliciesTable).upsert(
    {
      owner_wallet: config.ownerWallet.toLowerCase(),
      per_tx_limit_units: config.perTxLimitUnits.toString(),
      daily_limit_units: config.dailyLimitUnits.toString(),
      approved_recipients: config.approvedRecipients,
      approved_assets: config.approvedAssets,
      requires_approval_above_units:
        config.requiresApprovalAboveUnits.toString(),
      status: config.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_wallet" },
  );

  if (error) {
    throw new Error(error.message || "Payment policy could not be saved.");
  }
}

export async function updatePolicyStatus(
  ownerWallet: string,
  status: PolicyStatus,
) {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from(paymentPoliciesTable)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("owner_wallet", ownerWallet.toLowerCase());

  if (error) {
    throw new Error(error.message || "Payment policy could not be updated.");
  }
}

/** The owner's time zone for the daily limit; UTC until the browser reports one. */
export async function loadPolicyTimeZone(ownerWallet: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from(paymentPoliciesTable)
    .select("timezone")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .maybeSingle<{ timezone: string | null }>();

  if (error) {
    // e.g. the timezone column is not migrated yet: fall back to UTC days
    // rather than blocking every payment on the daily-limit check.
    console.warn("[policy] time zone unavailable, using UTC:", error.message);
    return "UTC";
  }
  return isValidTimeZone(data?.timezone) ? data.timezone : "UTC";
}

/**
 * Records the owner's time zone. Touches only that column, so it never
 * overwrites limits; with no policy row yet, it creates one on the defaults.
 */
export async function savePolicyTimeZone(ownerWallet: string, timeZone: string) {
  if (!isValidTimeZone(timeZone)) return;
  const { error } = await createSupabaseAdminClient()
    .from(paymentPoliciesTable)
    .upsert(
      { owner_wallet: ownerWallet.toLowerCase(), timezone: timeZone },
      { onConflict: "owner_wallet" },
    );

  if (error) {
    throw new Error(error.message || "Payment policy could not be updated.");
  }
}

/** Spend since the owner's most recent local midnight: "today" in their zone. */
export async function getDailySpentUnits(ownerWallet: string) {
  const timeZone = await loadPolicyTimeZone(ownerWallet);
  return sumSpentUnitsSince(ownerWallet, startOfLocalDay(timeZone));
}

/** Falls back to the conservative defaults when no row exists yet. */
export async function loadPolicyConfigOrDefault(ownerWallet: string) {
  const config = await loadPolicyConfig(ownerWallet);

  return (
    config ?? {
      ownerWallet: ownerWallet.toLowerCase(),
      ...defaultPolicyConfig,
      approvedRecipients: [...defaultPolicyConfig.approvedRecipients],
      approvedAssets: [...defaultPolicyConfig.approvedAssets],
    }
  );
}

export function serializePolicyConfig(config: PolicyConfig) {
  return {
    ownerWallet: config.ownerWallet,
    perTxLimitUnits: config.perTxLimitUnits.toString(),
    dailyLimitUnits: config.dailyLimitUnits.toString(),
    approvedRecipients: config.approvedRecipients,
    approvedAssets: config.approvedAssets,
    requiresApprovalAboveUnits: config.requiresApprovalAboveUnits.toString(),
    status: config.status,
  };
}
