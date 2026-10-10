"use client";

import { officialArcExplorerUrl } from "@/lib/network";

export type AllieActionPayload =
  | {
      type: "PaymentIntent";
      recipient: string;
      amountUsdc: number;
      asset: "USDC" | "EURC";
      note?: string;
    }
  | {
      type: "BatchPay";
      legs: { recipient: string; amountUsdc: number }[];
      asset: "USDC" | "EURC";
      note?: string;
    }
  | { type: "QueryBalance" }
  | { type: "ListTransactions"; limit?: number }
  | { type: "ActivitySummary"; period: "24h" | "7d" | "30d" | "all" }
  | { type: "SwapQuote"; fromAsset: "USDC" | "EURC"; toAsset: "USDC" | "EURC"; amountUsdc: number }
  | { type: "SaveStatus" }
  | { type: "EarnStatus" }
  | { type: "PayrollStatus" }
  | { type: "RecurringStatus" }
  | { type: "AgentControl"; action: "pause" | "resume" | "revoke" }
  | { type: "RequestPayment"; amountUsdc?: number; asset: "USDC" | "EURC"; note?: string }
  | {
      type: "Recurring";
      recipient: string;
      amountUsdc: number;
      asset: "USDC" | "EURC";
      frequency: string;
    }
  | { type: "Swap"; fromAsset: "USDC" | "EURC"; toAsset: "USDC" | "EURC"; amountUsdc: number }
  | { type: "Save"; action: "deposit" | "withdraw"; amountUsdc?: number; pocket?: string }
  | { type: "Earn"; action: "deposit" | "withdraw"; amountUsdc?: number }
  | {
      type: "Payroll";
      action: "run" | "team" | "add" | "approve" | "retry" | "schedules" | "groups";
      group?: string;
      name?: string;
    }
  | { type: "PayInvoice"; ref: string }
  | { type: "InvoiceStatus"; filter?: string; customer?: string }
  | {
      type: "CreateInvoice";
      customer?: string;
      amountUsdc?: number;
      asset: "USDC" | "EURC";
      description?: string;
    }
  | { type: "InvoiceAction"; action: "send" | "remind" | "cancel" | "view"; ref: string }
  | { type: "Clarify"; question: string };

export type AllieOutcomeRow = { label: string; value: string };

export type AllieOutcome =
  | { kind: "message"; text: string }
  | {
      kind: "panel";
      title: string;
      summary?: string;
      rows: AllieOutcomeRow[];
      href?: string;
      cta?: string;
    }
  | {
      kind: "prepare";
      title: string;
      summary: string;
      rows: AllieOutcomeRow[];
      href: string;
      cta: string;
      handoff: string;
    };

export type AllieBatchLegView = {
  address: string;
  amountUnits: string;
  label: string;
};

export type AllieFeeView = {
  fees: { kind: "platform" | "allie"; label: string; recipient: string; units: string }[];
  skipped: string[];
  totalFeeUnits: string;
  totalDebitUnits: string;
};

export type AllieChatResponse = {
  action: AllieActionPayload;
  tier: 1 | 2 | 3;
  confidence: number;
  allowed: boolean;
  requiresApproval?: boolean;
  reason?: string;
  intentId?: string;
  upgradeRequired?: boolean;
  /** OnePoints charged for calls past today's included Pro budget. */
  overagePoints?: number;
  rail?: string;
  estimatedFeeUnits?: string;
  estimatedSeconds?: number;
  resolvedRecipient?: string;
  recipientLabel?: string;
  amountUnits?: string;
  feeCharged?: boolean;
  outcome?: AllieOutcome;
  legs?: AllieBatchLegView[];
  fees?: AllieFeeView;
  totalDebitUnits?: string;
  /** The plan the fees were priced on: Pro has no per-payment ALLIE fee. */
  plan?: "free" | "pro";
  context?: {
    walletBalance: string;
    dailySpentUnits: string;
    dailyLimitUnits: string;
    approvedRecipients: string[];
    recentTransactions: {
      recipient: string;
      amountUsdc: number;
      date: string;
    }[];
    agentWalletStatus: "active" | "paused" | "revoked" | "not_created";
  };
};

export type AllieExecutionResponse = {
  attemptId: string;
  intentId: string;
  rail: string;
  result: {
    txHash?: string;
    transactionId?: string;
    status: "submitted" | "failed";
    error?: string;
  };
  fees?: AllieFeeView;
  batch?: {
    status: "submitted" | "failed";
    submitted: number;
    failed: number;
    feesFailed: number;
    legs: {
      recipient: string;
      label?: string;
      kind: "payment" | "fee";
      amountUnits: string;
      txHash?: string;
      status: "submitted" | "failed";
      error?: string;
    }[];
  } | null;
};

export type AgentWalletRecord = {
  ownerWallet: string;
  walletSetId: string;
  walletId: string;
  walletAddress: string;
  blockchain: string;
  status: "active" | "paused" | "revoked";
  createdAt: string;
  updatedAt: string;
};

export type AgentWalletResponse = {
  agentWallet: AgentWalletRecord | null;
  balances: { USDC: string; EURC: string } | null;
  configured: boolean;
};

export type PolicyRecord = {
  ownerWallet: string;
  perTxLimitUnits: string;
  dailyLimitUnits: string;
  approvedRecipients: string[];
  approvedAssets: ("USDC" | "EURC")[];
  requiresApprovalAboveUnits: string;
  status: "active" | "paused" | "revoked";
};

export type WalletContext = {
  ownerWallet: string;
  circleSocialUuid?: string;
};

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | (T & { message?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? "ALLIE request failed.");
  }

  return payload as T;
}

function contextParams(context: WalletContext) {
  const params = new URLSearchParams({ ownerWallet: context.ownerWallet });

  if (context.circleSocialUuid) {
    params.set("circleSocialUuid", context.circleSocialUuid);
  }

  return params;
}

export async function sendAllieMessage(
  input: WalletContext & { message: string; sessionId: string },
) {
  const response = await fetch("/api/swiftagent/chat", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return parseResponse<AllieChatResponse>(response);
}

/** The only call that executes a payment. Always user-initiated. */
export async function confirmAlliePayment(
  input: WalletContext & { intentId: string },
) {
  const response = await fetch("/api/swiftagent/execute", {
    body: JSON.stringify({ ...input, confirmed: true }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return parseResponse<AllieExecutionResponse>(response);
}

/**
 * Calls off an intent that has not reached the executor yet. Once the ledger
 * marks it cancelled the execute route refuses it, so a dismissed card cannot
 * be revived by replaying its id.
 */
export async function cancelAlliePayment(
  input: WalletContext & { intentId: string },
) {
  const { intentId, ...context } = input;

  const response = await fetch(
    `/api/payment-engine/intents/${encodeURIComponent(intentId)}/cancel`,
    {
      body: JSON.stringify(context),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );

  return parseResponse<{ intentId: string; status: "cancelled" }>(response);
}

export async function fetchAgentWallet(context: WalletContext) {
  const response = await fetch(
    `/api/agent-wallet?${contextParams(context).toString()}`,
    { cache: "no-store" },
  );

  return parseResponse<AgentWalletResponse>(response);
}

export async function createAgentWalletRequest(context: WalletContext) {
  const response = await fetch("/api/agent-wallet", {
    body: JSON.stringify(context),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return parseResponse<{ agentWallet: AgentWalletRecord; created: boolean }>(
    response,
  );
}

export async function setAgentWalletStatus(
  input: WalletContext & { status: "active" | "paused" },
) {
  const response = await fetch("/api/agent-wallet", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });

  return parseResponse<{ status: "active" | "paused" }>(response);
}

export async function revokeAgentWallet(context: WalletContext) {
  const response = await fetch(
    `/api/agent-wallet?${contextParams(context).toString()}`,
    { method: "DELETE" },
  );

  return parseResponse<{ revoked: boolean }>(response);
}

export type FundingInstruction = {
  agentWalletAddress: string;
  token: string;
  asset: "USDC" | "EURC";
  amountUnits: string;
  amountDisplay: string;
  chainBlockchain: string;
};

export async function prepareFunding(
  input: WalletContext & {
    amountUsdc: string;
    asset?: "USDC" | "EURC";
    fromAddress?: string;
  },
) {
  const response = await fetch("/api/agent-wallet/fund", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return parseResponse<{ funding: FundingInstruction }>(response);
}

export async function fetchAlliePolicy(context: WalletContext) {
  const params = contextParams(context);
  // The daily limit resets at this browser's local midnight.
  try {
    params.set("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    // Without it the server keeps the last known zone (UTC by default).
  }
  const response = await fetch(
    `/api/payment-engine/policies?${params.toString()}`,
    { cache: "no-store" },
  );

  return parseResponse<{
    configured: boolean;
    dailySpentUnits: string;
    policy: PolicyRecord;
  }>(response);
}

export async function saveAlliePolicy(
  input: WalletContext & Omit<PolicyRecord, "ownerWallet">,
) {
  const response = await fetch("/api/payment-engine/policies", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });

  return parseResponse<{ policy: PolicyRecord }>(response);
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function unitsToDisplay(units: string | bigint, decimals = 6) {
  const value = typeof units === "bigint" ? units : BigInt(units || "0");
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");

  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function displayToUnits(value: string, decimals = 6) {
  const raw = value.trim();

  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return null;
  }

  const [whole, fraction = ""] = raw.split(".");

  if (fraction.length > decimals) {
    return null;
  }

  return BigInt(whole + fraction.padEnd(decimals, "0")).toString();
}

export function explorerTxUrl(txHash: string) {
  const base = officialArcExplorerUrl();
  return base ? `${base}/tx/${txHash}` : "";
}

/** Shortens any 0x value — addresses (40 hex) and tx hashes (64 hex) alike. */
export function shortenAddress(value: string) {
  if (!/^0x[a-fA-F0-9]{8,}$/.test(value)) {
    return value;
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

// ─── ALLIE Pro ───────────────────────────────────────────────────────────────

export type AlliePlan = {
  monthlyFeeUsdc: number;
  /** The same Pro term paid in OnePoints. */
  monthlyFeePoints: number;
  termDays: number;
  dailyCallBudget: number;
  /** Each call past the daily budget, charged to OnePoints. */
  overageFeeUsdc: number;
  overageFeePoints: number;
  dailyEscalationBudget: number;
  /** Per-payment fee charged on Free, in 6-decimal units. */
  perPaymentFeeUnits: string;
  feeRecipient: string;
};

export type AllieSubscriptionState = {
  plan: AlliePlan;
  subscription: {
    ownerWallet: string;
    tier: "free" | "pro";
    subscribedAt: string | null;
    expiresAt: string | null;
    recurringScheduleId: string | null;
  } | null;
  tier: "free" | "pro";
  usageToday: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costEstimateUsdc: number;
  };
};

export async function fetchAlliePlan(context: WalletContext) {
  const response = await fetch(
    `/api/allie/subscription?${contextParams(context).toString()}`,
    { cache: "no-store" },
  );

  return parseResponse<AllieSubscriptionState>(response);
}

/** The server ruled a Pro payment out for good: wrong amount, failed, too old or already used. */
export class ProPaymentRejectedError extends Error {}

export async function activateAlliePro(
  input: WalletContext & { txHash: string },
) {
  const response = await fetch("/api/allie/subscription", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (response.status === 409 || response.status === 422) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ProPaymentRejectedError(payload?.message ?? "That payment can't activate Pro.");
  }

  return parseResponse<AllieSubscriptionState & { txHash: string }>(response);
}

/** Pay for ALLIE Pro from the OnePoints balance. */
export async function activateAllieProWithPoints(input: WalletContext) {
  const response = await fetch("/api/allie/subscription", {
    body: JSON.stringify({ ...input, paymentMethod: "swiftpoints" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return parseResponse<AllieSubscriptionState & { paidPoints: number }>(response);
}


