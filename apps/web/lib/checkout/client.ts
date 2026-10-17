import type {
  ChargeIntentMethod,
  ChargeStatus,
  ChargeSummary,
  ChargeWithPayments,
  PublicChargePayload,
  PublicStorefrontPayload,
} from "@/lib/checkout/types";

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: T & { message?: string };
  try {
    payload = JSON.parse(text) as T & { message?: string };
  } catch {
    throw new Error(`Invalid JSON (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(payload.message ?? `Request failed (${response.status}).`);
  }
  return payload;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  try {
    return await parseJson<T>(await fetch(input, init));
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Could not reach SaphraONE. Refresh and try again.");
    }
    throw error;
  }
}

function postJson<T>(path: string, body: unknown, headers?: Record<string, string>) {
  return requestJson<T>(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
  });
}

function withWallet(path: string, ownerWallet: string, extra?: Record<string, string | undefined>) {
  const url = new URL(path, "http://local");
  url.searchParams.set("ownerWallet", ownerWallet);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}?${url.searchParams.toString()}`;
}

function chargePath(code: string, action?: string) {
  return `/api/checkout/charges/${encodeURIComponent(code)}${action ? `/${action}` : ""}`;
}

// ── Merchant ────────────────────────────────────────────────────────────────

export type MerchantAuth = { ownerWallet: string; circleSocialUuid?: string };

export function createChargeClient(
  auth: MerchantAuth,
  body: { amount: string; currency?: string; note?: string },
  idempotencyKey: string,
) {
  return postJson<{ charge: ChargeWithPayments }>(
    "/api/business/checkout/charges",
    { ...auth, ...body },
    { "Idempotency-Key": idempotencyKey },
  );
}

export function fetchCharges(
  auth: MerchantAuth,
  options?: { status?: ChargeStatus; page?: number; kind?: "IN_PERSON" | "ONLINE" },
) {
  return requestJson<{ charges: ChargeWithPayments[]; page: number; summary: ChargeSummary }>(
    withWallet("/api/business/checkout/charges", auth.ownerWallet, {
      circleSocialUuid: auth.circleSocialUuid,
      kind: options?.kind,
      page: options?.page ? String(options.page) : undefined,
      status: options?.status,
    }),
    { cache: "no-store" },
  );
}

export function fetchCharge(auth: MerchantAuth, chargeId: string) {
  return requestJson<{ charge: ChargeWithPayments }>(
    withWallet(`/api/business/checkout/charges/${chargeId}`, auth.ownerWallet, {
      circleSocialUuid: auth.circleSocialUuid,
    }),
    { cache: "no-store" },
  );
}

export function cancelChargeClient(auth: MerchantAuth, chargeId: string) {
  return postJson<{ charge: ChargeWithPayments }>(
    `/api/business/checkout/charges/${chargeId}/cancel`,
    auth,
  );
}

/** Attach a transfer the matcher missed to this charge. */
export function reconcileChargeClient(auth: MerchantAuth, chargeId: string, txHash: string) {
  return postJson<{ charge: ChargeWithPayments }>(
    `/api/business/checkout/charges/${chargeId}/reconcile`,
    { ...auth, txHash },
  );
}

// ── Public payer ────────────────────────────────────────────────────────────

export function fetchPublicCharge(code: string) {
  return requestJson<PublicChargePayload>(chargePath(code), { cache: "no-store" });
}

export function updateChargeTip(code: string, tip: string) {
  return postJson<PublicChargePayload>(chargePath(code, "tip"), { tip });
}

export function registerChargeIntentClient(
  code: string,
  body: { method: ChargeIntentMethod; payerWallet?: string; reference?: string },
) {
  return postJson<PublicChargePayload>(chargePath(code, "intent"), body);
}

export function payPublicCharge(
  code: string,
  body: { txHash: string; payerWallet?: string; via?: "BRIDGE" },
) {
  return postJson<PublicChargePayload>(chargePath(code, "pay"), body);
}

/** The card/bank widget says the money is on its way. */
export function reportChargeSettled(
  code: string,
  body: { amount?: string; tokenSymbol?: string; reference?: string },
) {
  return postJson<PublicChargePayload>(chargePath(code, "settled"), body);
}

/** A Circle Onramp session paying this charge (raw; parse with the kit). */
export function createChargeOnrampSession(code: string) {
  return postJson<{ session: unknown }>(chargePath(code, "onramp-session"), {});
}

/** Whether card/bank payments are configured on this deployment. */
export async function fetchOnrampEnabled() {
  try {
    const result = await requestJson<{ enabled?: boolean }>("/api/onramp/sessions", {
      cache: "no-store",
    });
    return Boolean(result.enabled);
  } catch {
    return false;
  }
}

export function fetchPublicStorefront(username: string) {
  return requestJson<PublicStorefrontPayload>(
    `/api/checkout/storefront/${encodeURIComponent(username)}`,
    { cache: "no-store" },
  );
}

export function createStorefrontChargeClient(
  username: string,
  body: { amount: string; tip?: string; currency?: string },
) {
  return postJson<{ code: string }>(
    `/api/checkout/storefront/${encodeURIComponent(username)}/charges`,
    body,
  );
}

/** The SaphraONE /send link that pays a charge (signed-out visitors sign in first). */
export function saphraSendHref(input: {
  code: string;
  destinationWallet: string;
  total: string;
  currency: string;
}) {
  const params = new URLSearchParams({
    amount: input.total,
    charge: input.code,
    memo: input.code,
    to: input.destinationWallet,
    token: input.currency,
  });
  return `/send?${params.toString()}`;
}
