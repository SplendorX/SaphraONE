"use client";

/** Browser calls to /api/kyc and /api/kyb. Throws the server's message. */

export type KycState = {
  available: boolean;
  required: boolean;
  ready?: boolean;
  tier: number;
  status: "NONE" | "PENDING" | "VERIFIED" | "MANUAL_REVIEW" | "REJECTED";
  idType: "BVN" | "NIN" | null;
  idLast4: string | null;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  phone: string | null;
  limits: { onrampNgn: number; offrampUsdc: number };
  remainingToday: { onrampNgn: number; offrampUsdc: number };
  nextTier: number | null;
  flags: Record<string, unknown>;
  preview?: { firstName: string | null; lastName: string | null; last4: string | null };
};

export type KybState = {
  available: boolean;
  ready?: boolean;
  level: "NONE" | "BASIC" | "FULL";
  status: "NONE" | "PENDING" | "VERIFIED" | "MANUAL_REVIEW" | "REJECTED";
  companyType: "RC" | "BN" | "IT" | null;
  rcNumber: string | null;
  companyName: string | null;
  tinLast4: string | null;
  flags: Record<string, unknown>;
  limits: { onrampNgn: number; offrampUsdc: number };
};

export class KycApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly reason?: string;
  readonly remaining?: string;
  readonly nextTier?: number | null;
  readonly requiredTier?: number;

  constructor(input: { message: string; code: string; status: number; reason?: string; remaining?: string; nextTier?: number | null; requiredTier?: number }) {
    super(input.message);
    this.name = "KycApiError";
    this.code = input.code;
    this.status = input.status;
    this.reason = input.reason;
    this.remaining = input.remaining;
    this.nextTier = input.nextTier;
    this.requiredTier = input.requiredTier;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      // FormData bodies get their multipart boundary from the browser.
      ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}),
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
    throw new KycApiError({
      code: payload?.code ?? "ERROR",
      message: payload?.message ?? "Something went wrong. Try again in a moment.",
      nextTier: payload?.nextTier,
      reason: payload?.reason,
      remaining: payload?.remaining,
      requiredTier: payload?.requiredTier,
      status: response.status,
    });
  }
  return payload as T;
}

function walletQuery(wallet: string) {
  return `wallet=${encodeURIComponent(wallet)}`;
}

export async function fetchKycStatus(wallet: string) {
  return call<KycState>(`/api/kyc/status?${walletQuery(wallet)}`);
}

export async function submitKycIdentity(
  wallet: string,
  input: { type: "BVN" | "NIN"; number: string; dob: string; firstName: string; lastName: string },
) {
  return call<KycState & { consentRequired: boolean; consentPhone?: string | null }>(`/api/kyc/identity`, {
    body: JSON.stringify({ ...input, wallet }),
    method: "POST",
  });
}

/** The iGree code NIBSS sent to the BVN's phone. The BVN is sent again, never stored. */
export async function confirmKycConsent(wallet: string, number: string, code: string) {
  return call<KycState>(`/api/kyc/identity/consent`, { body: JSON.stringify({ code, number, wallet }), method: "POST" });
}

export async function submitKycSelfie(wallet: string, image: string, number: string) {
  return call<KycState>(`/api/kyc/selfie`, { body: JSON.stringify({ image, number, wallet }), method: "POST" });
}

export async function fetchKybStatus(wallet: string) {
  return call<KybState>(`/api/kyb/status?${walletQuery(wallet)}`);
}

export async function submitKybCac(wallet: string, input: { companyType: "RC" | "BN" | "IT"; rcNumber: string; companyName?: string }) {
  return call<KybState>(`/api/kyb/cac`, { body: JSON.stringify({ ...input, wallet }), method: "POST" });
}

/** A CAC status report or board resolution for a business in review. */
export async function uploadKybDocument(wallet: string, file: File) {
  const form = new FormData();
  form.set("wallet", wallet);
  form.set("file", file);
  return call<{ documents: { name: string; type: string; size: number; uploadedAt: string }[] }>(`/api/kyb/documents`, {
    body: form,
    method: "POST",
  });
}

export async function submitKybTin(wallet: string, number: string) {
  return call<KybState>(`/api/kyb/tin`, { body: JSON.stringify({ number, wallet }), method: "POST" });
}
