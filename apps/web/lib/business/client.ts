import type {
  BusinessAsset,
  BusinessPaymentRecord,
  DirectoryHit,
  PublicProfile,
  WorkspaceInvitationRecord,
  WorkspaceSummary,
} from "@/lib/business/types";
import type { OnboardingProfile } from "@/lib/business/service";

async function parseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!contentType.includes("application/json") || text.trimStart().startsWith("<!")) {
    throw new Error(
      response.ok
        ? "SaphraONE returned a non-JSON response."
        : `Request failed (${response.status}).`,
    );
  }
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

function withWallet(
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

function authBody(
  ownerWallet: string,
  circleSocialUuid?: string,
  extra?: Record<string, unknown>,
) {
  return { ownerWallet, circleSocialUuid, ...extra };
}

export async function fetchOnboardingState(
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  return parseJson<{
    invitations: WorkspaceInvitationRecord[];
    profile: OnboardingProfile | null;
    workspaces: WorkspaceSummary[];
  }>(
    await fetch(
      withWallet("/api/onboarding", ownerWallet, { circleSocialUuid }),
      { cache: "no-store" },
    ),
  );
}

export async function switchWorkspaceClient(
  ownerWallet: string,
  workspaceId: string,
  circleSocialUuid?: string,
) {
  return parseJson<{ workspace: WorkspaceSummary }>(
    await fetch(`/api/workspaces/${workspaceId}/switch`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function createBusinessPayment(
  ownerWallet: string,
  workspaceId: string,
  body: {
    amount: string;
    asset: BusinessAsset;
    memo?: string;
    recipient: string;
  },
  circleSocialUuid?: string,
) {
  return parseJson<{
    payment: BusinessPaymentRecord;
    requiredApprovals: number;
  }>(
    await fetch(`/api/workspaces/${workspaceId}/payments`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      method: "POST",
    }),
  );
}

export async function submitBusinessPayment(
  ownerWallet: string,
  workspaceId: string,
  paymentId: string,
  body: { circleTransactionId?: string; txHash?: string },
  circleSocialUuid?: string,
) {
  return parseJson<{ payment: BusinessPaymentRecord }>(
    await fetch(`/api/workspaces/${workspaceId}/payments/${paymentId}/submit`, {
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

export async function searchPeople(query: string) {
  return parseJson<{ results: DirectoryHit[] }>(
    await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      cache: "no-store",
    }),
  );
}

export async function fetchDirectoryProfile(username: string) {
  return parseJson<{ profile: PublicProfile }>(
    await fetch(`/api/directory/${encodeURIComponent(username)}`, {
      cache: "no-store",
    }),
  );
}
