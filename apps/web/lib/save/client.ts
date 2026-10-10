import type { ArcTokenSymbol } from "@/lib/tokens";
import type {
  SavingsPocketRecord,
  SavingsSummary,
  SavingsTransactionRecord,
  SpendSaveConfigRecord,
  SpendSaveEventRecord,
} from "@/lib/save/types";

async function parseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  // HTML 404/500 pages (e.g. missing route) must not be parsed as JSON.
  if (
    !contentType.includes("application/json") ||
    text.trimStart().startsWith("<!")
  ) {
    throw new Error(
      response.ok
        ? "Save returned a non-JSON response."
        : `Save request failed (${response.status}). ${
            response.status === 404
              ? "API route not found — try restarting the dev server."
              : text.slice(0, 120).replace(/\s+/g, " ")
          }`,
    );
  }

  let payload: T & { message?: string };
  try {
    payload = JSON.parse(text) as T & { message?: string };
  } catch {
    throw new Error(
      `Save returned invalid JSON (${response.status}).`,
    );
  }

  if (!response.ok) {
    throw new Error(
      payload.message ?? `Save request failed (${response.status}).`,
    );
  }
  return payload;
}

function withWalletParams(
  path: string,
  ownerWallet: string,
  extra?: Record<string, string | undefined>,
) {
  const url = new URL(path, "http://local");
  url.searchParams.set("ownerWallet", ownerWallet);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export const notificationsChangedEvent = "saphra:notifications-changed";

export function emitNotificationsChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(notificationsChangedEvent));
}

export async function deleteSavingsNotifications(
  body: Record<string, unknown> & { silent?: boolean },
) {
  const { silent, ...payload } = body;
  const result = await parseJson<{
    deleted: number;
    notifications?: import("@/lib/save/notifications").SavingsNotificationRecord[];
    unreadCount?: number;
  }>(
    await fetch("/api/savings/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    }),
  );
  if (!silent) {
    emitNotificationsChanged();
  }
  return result;
}

export async function fetchSavingsSummary(
  ownerWallet: string,
  currency: ArcTokenSymbol = "USDC",
  circleSocialUuid?: string,
) {
  const path = withWalletParams("/api/savings/summary", ownerWallet, {
    currency,
    circleSocialUuid,
  });
  return parseJson<{ summary: SavingsSummary }>(
    await fetch(path, { cache: "no-store" }),
  );
}

export async function fetchSavingsPockets(
  ownerWallet: string,
  options: { includeArchived?: boolean; circleSocialUuid?: string } = {},
) {
  const path = withWalletParams("/api/savings/pockets", ownerWallet, {
    includeArchived: options.includeArchived ? "1" : undefined,
    circleSocialUuid: options.circleSocialUuid,
  });
  return parseJson<{ pockets: SavingsPocketRecord[] }>(
    await fetch(path, { cache: "no-store" }),
  );
}

export async function fetchSavingsPocket(
  pocketId: string,
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  // Flat route avoids Turbopack nested [id] 404s on Windows/dev.
  const path = withWalletParams("/api/savings/pocket", ownerWallet, {
    pocketId,
    circleSocialUuid,
  });
  return parseJson<{
    pocket: SavingsPocketRecord;
    stats: {
      totalDeposits: string;
      totalWithdrawals: string;
      lastDepositAt: string | null;
    };
    spendSave: SpendSaveConfigRecord | null;
    transactions: SavingsTransactionRecord[];
  }>(await fetch(path, { cache: "no-store" }));
}

export async function createSavingsPocket(body: Record<string, unknown>) {
  return parseJson<{ pocket: SavingsPocketRecord }>(
    await fetch("/api/savings/pockets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function updateSavingsPocket(
  pocketId: string,
  body: Record<string, unknown>,
) {
  return parseJson<{ pocket: SavingsPocketRecord }>(
    await fetch("/api/savings/pocket", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, pocketId }),
    }),
  );
}

export async function archiveSavingsPocket(
  pocketId: string,
  body: Record<string, unknown>,
) {
  return parseJson<{ pocket: SavingsPocketRecord }>(
    await fetch("/api/savings/pocket", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, pocketId }),
    }),
  );
}

/** Permanently removes a pocket that never held or moved funds. */
export async function deleteSavingsPocket(
  pocketId: string,
  body: Record<string, unknown>,
) {
  return parseJson<{ deleted: boolean; pocket: SavingsPocketRecord }>(
    await fetch("/api/savings/pocket", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, permanent: true, pocketId }),
    }),
  );
}

export async function initiateDeposit(
  pocketId: string,
  body: Record<string, unknown>,
) {
  return parseJson<{
    transaction: SavingsTransactionRecord;
    vaultAddress: string | null;
    pocketIdBytes32: string;
    tokenAddress: string;
    amountUnits: string;
  }>(
    await fetch("/api/savings/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, pocketId }),
    }),
  );
}

export async function confirmDeposit(
  pocketId: string,
  body: Record<string, unknown>,
) {
  return parseJson<{
    transaction: SavingsTransactionRecord;
    pocket: SavingsPocketRecord;
  }>(
    await fetch("/api/savings/deposit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, pocketId }),
    }),
  );
}

export async function initiateWithdraw(
  pocketId: string,
  body: Record<string, unknown>,
) {
  return parseJson<{
    transaction: SavingsTransactionRecord;
    vaultAddress: string | null;
    pocketIdBytes32: string;
    tokenAddress: string;
    amountUnits: string;
  }>(
    await fetch("/api/savings/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, pocketId }),
    }),
  );
}

export async function confirmWithdraw(
  pocketId: string,
  body: Record<string, unknown>,
) {
  return parseJson<{
    transaction: SavingsTransactionRecord;
    pocket: SavingsPocketRecord;
  }>(
    await fetch("/api/savings/withdraw", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, pocketId }),
    }),
  );
}


export async function fetchSpendSave(
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  const path = withWalletParams("/api/spend-save", ownerWallet, {
    circleSocialUuid,
  });
  return parseJson<{
    config: SpendSaveConfigRecord | null;
    pocket: SavingsPocketRecord | null;
    vaultAddress: string | null;
  }>(await fetch(path, { cache: "no-store" }));
}

export async function saveSpendSaveConfig(body: Record<string, unknown>) {
  return parseJson<{ config: SpendSaveConfigRecord }>(
    await fetch("/api/spend-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}


export async function pauseSpendSave(body: Record<string, unknown>) {
  return parseJson<{ config: SpendSaveConfigRecord }>(
    await fetch("/api/spend-save/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function resumeSpendSave(body: Record<string, unknown>) {
  return parseJson<{ config: SpendSaveConfigRecord }>(
    await fetch("/api/spend-save/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function disableSpendSave(body: Record<string, unknown>) {
  // Prefer DELETE /api/spend-save; fall back to POST /disable.
  try {
    return await parseJson<{ config: SpendSaveConfigRecord }>(
      await fetch("/api/spend-save", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return parseJson<{ config: SpendSaveConfigRecord }>(
      await fetch("/api/spend-save/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
}

export async function fetchSpendSaveHistory(
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  const path = withWalletParams("/api/spend-save/history", ownerWallet, {
    circleSocialUuid,
  });
  return parseJson<{ events: SpendSaveEventRecord[]; history?: SpendSaveEventRecord[] }>(
    await fetch(path, { cache: "no-store" }),
  );
}

export async function createSavingsRefund(body: Record<string, unknown>) {
  return parseJson<{
    transaction: SavingsTransactionRecord;
    vaultAddress: string | null;
    pocketIdBytes32: string | null;
    tokenAddress: string;
    amountUnits: string;
  }>(
    await fetch("/api/savings/refunds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(typeof body.idempotencyKey === "string"
          ? { "Idempotency-Key": body.idempotencyKey }
          : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

/** Finalize REVERSAL/ADJUSTMENT after vault.withdraw confirms on-chain. */
export async function confirmSavingsRefund(body: Record<string, unknown>) {
  return parseJson<{
    transaction: SavingsTransactionRecord;
    pocket: SavingsPocketRecord;
    message?: string;
  }>(
    await fetch("/api/savings/refunds", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(typeof body.idempotencyKey === "string"
          ? { "Idempotency-Key": body.idempotencyKey }
          : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

export type PaymentQuote = {
  paymentAmount: string;
  paymentAmountUnits: string;
  platformFeeBps: number;
  platformFeeLabel: string;
  platformFeeAmount: string;
  platformFeeUnits: string;
  feeRecipient: string;
  sendRouter: string;
  vaultAddress: string;
  spendSave: {
    active: boolean;
    saveAmount: string;
    saveAmountUnits: string;
    percentage: string;
    pocketName?: string;
    pocketId?: string;
    pocketIdBytes32?: string;
    targetCapped?: boolean;
  };
  totalRequired: string;
  totalRequiredUnits: string;
  currency: string;
};

export async function quotePayment(body: Record<string, unknown>) {
  return parseJson<PaymentQuote>(
    await fetch("/api/payments/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}


export async function prepareSpendSave(body: Record<string, unknown>) {
  return parseJson<{
    event: SpendSaveEventRecord;
    transaction: SavingsTransactionRecord;
    vaultAddress: string | null;
    pocketIdBytes32: string;
    tokenAddress: string;
    amountUnits: string;
    quote: {
      paymentAmount: string;
      saveAmount: string;
      totalRequired: string;
      saveAmountUnits: string;
      totalRequiredUnits: string;
      percentage: string;
    };
  }>(
    await fetch("/api/spend-save/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export async function completeSpendSave(body: Record<string, unknown>) {
  return parseJson<{
    event: SpendSaveEventRecord;
    transaction: SavingsTransactionRecord;
    pocket: SavingsPocketRecord;
  }>(
    await fetch("/api/spend-save/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
