import type {
  AccountRecord,
  BusinessAccountProfile,
  InvoiceItemInput,
  InvoiceRecord,
  InvoiceSummary,
  InvoiceWithItems,
} from "@/lib/account/types";
import type { ChargeSummary } from "@/lib/checkout/types";

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

function authBody(
  ownerWallet: string,
  circleSocialUuid?: string,
  extra?: Record<string, unknown>,
) {
  return { circleSocialUuid, ownerWallet, ...extra };
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

export async function fetchAccountState(ownerWallet: string, circleSocialUuid?: string) {
  return requestJson<{
    account: AccountRecord;
    /** Set while the account waits out its deletion grace period. */
    pendingDeletion?: { requestedAt: string; scheduledFor: string } | null;
    profile: BusinessAccountProfile | null;
  }>(withWallet("/api/account", ownerWallet, { circleSocialUuid }), {
    cache: "no-store",
  });
}

export async function completeAccountOnboardingClient(
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    account: AccountRecord;
    profile: BusinessAccountProfile | null;
  }>(
    await fetch("/api/account", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function upgradeAccountClient(
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    account: AccountRecord;
    profile: BusinessAccountProfile | null;
  }>(
    await fetch("/api/account/upgrade-to-business", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}



export async function updateBusinessAccountProfileClient(
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{ profile: BusinessAccountProfile }>(
    await fetch("/api/business/profile", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    }),
  );
}

export async function fetchBusinessOverview(
  ownerWallet: string,
  circleSocialUuid?: string,
  workspaceId?: string,
) {
  return parseJson<{
    account: AccountRecord;
    checkout?: ChargeSummary | null;
    invoices: InvoiceRecord[];
    profile: BusinessAccountProfile | null;
    summary: InvoiceSummary;
  }>(
    await fetch(
      withWallet("/api/business/overview", ownerWallet, {
        circleSocialUuid,
        workspaceId,
      }),
      {
        cache: "no-store",
      },
    ),
  );
}

export async function fetchInvoices(
  ownerWallet: string,
  page = 1,
  circleSocialUuid?: string,
  workspaceId?: string,
) {
  return parseJson<{
    invoices: InvoiceRecord[];
    page: number;
    pageSize: number;
    total: number;
  }>(
    await fetch(
      withWallet("/api/business/invoices", ownerWallet, {
        circleSocialUuid,
        page: String(page),
        workspaceId,
      }),
      { cache: "no-store" },
    ),
  );
}

export async function createInvoiceClient(
  ownerWallet: string,
  body: { items: InvoiceItemInput[] } & Record<string, unknown>,
  circleSocialUuid?: string,
  workspaceId?: string,
) {
  return parseJson<{ invoice: InvoiceWithItems }>(
    await fetch("/api/business/invoices", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, { ...body, workspaceId })),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function sendInvoiceClient(
  ownerWallet: string,
  invoiceId: string,
  circleSocialUuid?: string,
  workspaceId?: string,
) {
  return parseJson<{ invoice: InvoiceWithItems }>(
    await fetch(`/api/business/invoices/${invoiceId}/send`, {
      body: JSON.stringify(
        authBody(ownerWallet, circleSocialUuid, { origin: window.location.origin, workspaceId }),
      ),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

/** Email an open invoice to its customer; `email` sets the address when it has none. */
export async function emailInvoiceClient(
  ownerWallet: string,
  invoiceId: string,
  email?: string,
  circleSocialUuid?: string,
  workspaceId?: string,
) {
  return parseJson<{ invoice: InvoiceWithItems }>(
    await fetch(`/api/business/invoices/${invoiceId}/email`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, { email, workspaceId })),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function cancelInvoiceClient(
  ownerWallet: string,
  invoiceId: string,
  circleSocialUuid?: string,
  workspaceId?: string,
) {
  return parseJson<{ invoice: InvoiceWithItems }>(
    await fetch(`/api/business/invoices/${invoiceId}/cancel`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, { workspaceId })),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function fetchPublicInvoice(publicId: string) {
  return requestJson<{
    business: {
      description: string | null;
      logoUrl: string | null;
      name: string;
      username: string | null;
      website: string | null;
    };
    destinationWallet: string;
    invoice: InvoiceWithItems;
  }>(`/api/invoices/${encodeURIComponent(publicId)}/public`, { cache: "no-store" });
}

export async function fetchInvoice(
  ownerWallet: string,
  invoiceId: string,
  circleSocialUuid?: string,
  workspaceId?: string,
) {
  return parseJson<{ invoice: InvoiceWithItems }>(
    await fetch(
      withWallet(`/api/business/invoices/${invoiceId}`, ownerWallet, { circleSocialUuid, workspaceId }),
      { cache: "no-store" },
    ),
  );
}

export async function payPublicInvoice(
  publicId: string,
  body: { amount: string; asset: string; txHash: string },
) {
  return parseJson<{
    destinationWallet: string;
    invoice: InvoiceWithItems;
  }>(
    await fetch(`/api/invoices/${encodeURIComponent(publicId)}/pay`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export type BusinessVerificationState = {
  ready: boolean;
  eligible: boolean;
  missing: string[];
  country: { code: string; name: string } | null;
  options: {
    type: "VAT" | "REGISTRATION" | "TAX" | "LEI";
    label: string;
    placeholder: string;
    automatic: boolean;
    source?: string;
  }[];
  review: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  status: "UNVERIFIED" | "PENDING" | "VERIFIED";
  submission: {
    createdAt: string;
    idNumber: string;
    idType: string;
    method: "AUTOMATIC" | "MANUAL";
    note: string | null;
    reason: string | null;
    registryName: string | null;
    source: string | null;
    status: "PENDING" | "APPROVED" | "REJECTED";
  } | null;
};

export async function fetchBusinessVerification(ownerWallet: string, circleSocialUuid?: string) {
  return parseJson<BusinessVerificationState>(
    await fetch(withWallet("/api/business/verification", ownerWallet, { circleSocialUuid }), {
      cache: "no-store",
    }),
  );
}

export async function submitBusinessVerification(
  ownerWallet: string,
  body: { idType: string; idNumber: string },
  circleSocialUuid?: string,
) {
  return parseJson<BusinessVerificationState>(
    await fetch("/api/business/verification", {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}
