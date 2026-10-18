"use client";

import type {
  RampBank,
  RampBeneficiary,
  RampDirection,
  RampOrderView,
  RampQuote,
  RampStatusInfo,
  ResolvedBankAccount,
} from "@/lib/ramp/types";

/** Browser calls to /api/ramp. Each throws the server's message on failure. */

export class RampApiError extends Error {
  readonly code: string;
  readonly reason?: string;
  readonly remaining?: string;
  readonly nextTier?: number | null;
  readonly requiredTier?: number;

  constructor(input: {
    message: string;
    code?: string;
    reason?: string;
    remaining?: string;
    nextTier?: number | null;
    requiredTier?: number;
  }) {
    super(input.message);
    this.name = "RampApiError";
    this.code = input.code ?? "ERROR";
    this.reason = input.reason;
    this.remaining = input.remaining;
    this.nextTier = input.nextTier;
    this.requiredTier = input.requiredTier;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as (T & {
    message?: string;
    code?: string;
    reason?: string;
    remaining?: string;
    nextTier?: number | null;
    requiredTier?: number;
  }) | null;
  if (!response.ok) {
    throw new RampApiError({
      code: payload?.code,
      message: payload?.message ?? "Something went wrong. Try again in a moment.",
      nextTier: payload?.nextTier,
      reason: payload?.reason,
      remaining: payload?.remaining,
      requiredTier: payload?.requiredTier,
    });
  }
  return { status: response.status, data: payload as T };
}

function walletQuery(wallet: string) {
  return `wallet=${encodeURIComponent(wallet)}`;
}

export async function fetchRampStatus(wallet?: string): Promise<RampStatusInfo | null> {
  try {
    const query = wallet ? `?${walletQuery(wallet)}` : "";
    return (await call<RampStatusInfo>(`/api/ramp/status${query}`)).data;
  } catch {
    return null;
  }
}

export async function requestQuote(wallet: string, direction: RampDirection, amount: string) {
  return (
    await call<RampQuote>("/api/ramp/quotes", {
      body: JSON.stringify({ amount, direction, wallet }),
      method: "POST",
    })
  ).data;
}

export async function createOrder(input: {
  wallet: string;
  direction: RampDirection;
  amount: string;
  beneficiaryId?: string;
  idempotencyKey: string;
}) {
  const { idempotencyKey, ...body } = input;
  return (
    await call<{ order: RampOrderView }>("/api/ramp/orders", {
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": idempotencyKey },
      method: "POST",
    })
  ).data.order;
}

export async function getOrder(wallet: string, id: string) {
  return (await call<{ order: RampOrderView }>(`/api/ramp/orders/${encodeURIComponent(id)}?${walletQuery(wallet)}`))
    .data.order;
}

export async function listOrders(wallet: string) {
  return (await call<{ orders: RampOrderView[] }>(`/api/ramp/orders?${walletQuery(wallet)}`)).data.orders;
}

/** `pending` while the server can't see the transaction on Arc yet. */
export async function reportCryptoSent(wallet: string, id: string, txHash: string) {
  const { data } = await call<{ pending: boolean; order: RampOrderView }>(
    `/api/ramp/orders/${encodeURIComponent(id)}/crypto-sent`,
    { body: JSON.stringify({ txHash, wallet }), method: "POST" },
  );
  return data;
}

export async function listBanks(wallet: string) {
  return (await call<{ banks: RampBank[] }>(`/api/ramp/banks?${walletQuery(wallet)}`)).data.banks;
}

export async function verifyAccount(wallet: string, bankCode: string, accountNumber: string) {
  return (
    await call<{ account: ResolvedBankAccount }>("/api/ramp/beneficiaries/verify", {
      body: JSON.stringify({ accountNumber, bankCode, wallet }),
      method: "POST",
    })
  ).data.account;
}

export async function listBeneficiaries(wallet: string) {
  return (await call<{ beneficiaries: RampBeneficiary[] }>(`/api/ramp/beneficiaries?${walletQuery(wallet)}`)).data
    .beneficiaries;
}

export async function saveBeneficiary(wallet: string, bankCode: string, accountNumber: string) {
  return (
    await call<{ beneficiary: RampBeneficiary }>("/api/ramp/beneficiaries", {
      body: JSON.stringify({ accountNumber, bankCode, wallet }),
      method: "POST",
    })
  ).data.beneficiary;
}

export async function deleteBeneficiary(wallet: string, id: string) {
  await call(`/api/ramp/beneficiaries?id=${encodeURIComponent(id)}&${walletQuery(wallet)}`, { method: "DELETE" });
}

// ── Remembering an open order across reloads ────────────────────────────

const openOrderKey = (direction: RampDirection, wallet: string) =>
  `saphra:ramp-open:${direction.toLowerCase()}:${wallet.toLowerCase()}`;

export function readOpenOrderId(direction: RampDirection, wallet: string) {
  try {
    return localStorage.getItem(openOrderKey(direction, wallet));
  } catch {
    return null;
  }
}

export function rememberOpenOrderId(direction: RampDirection, wallet: string, id: string | null) {
  try {
    if (id) localStorage.setItem(openOrderKey(direction, wallet), id);
    else localStorage.removeItem(openOrderKey(direction, wallet));
  } catch {
    // Private mode: the order just won't resume after a reload.
  }
}

/** A withdrawal transfer that was sent but not yet recorded by the server. */
export type PendingWithdrawal = { orderId: string; hash: string };

const pendingKey = (wallet: string) => `saphra:ramp-sent:${wallet.toLowerCase()}`;

export function readPendingWithdrawal(wallet: string): PendingWithdrawal | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(wallet));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingWithdrawal>;
    return value.orderId && value.hash && /^0x[0-9a-fA-F]{64}$/.test(value.hash)
      ? { hash: value.hash, orderId: value.orderId }
      : null;
  } catch {
    return null;
  }
}

export function rememberPendingWithdrawal(wallet: string, value: PendingWithdrawal | null) {
  try {
    if (value) sessionStorage.setItem(pendingKey(wallet), JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey(wallet));
  } catch {
    // Storage blocked: recovery after a reload isn't available.
  }
}

/** Reports a sent withdrawal, retrying while Arc catches up (up to 4 retries). */
export async function reportCryptoSentWithRetry(wallet: string, id: string, txHash: string) {
  let last: Awaited<ReturnType<typeof reportCryptoSent>> | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** (attempt - 1)));
    last = await reportCryptoSent(wallet, id, txHash);
    if (!last.pending) return last;
  }
  return last!;
}
