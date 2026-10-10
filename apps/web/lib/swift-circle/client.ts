import type {
  CircleActivityRecord,
  CircleInvitationRecord,
  CircleListItem,
  CircleMemberRecord,
  CircleMessageRecord,
  CirclePaymentIntentRecord,
  CirclePaymentRequestRecord,
  CirclePlatformLimits,
  CircleRecord,
  CircleRequestGroupRecord,
  CircleSaveAccountRecord,
  CircleSaveContributionRecord,
  CircleSavePocketRecord,
  CircleWithdrawalProposalRecord,
} from "@/lib/swift-circle/types";

async function parseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!contentType.includes("application/json") || text.trimStart().startsWith("<!")) {
    throw new Error(
      response.ok
        ? "Circle returned a non-JSON response."
        : `Circle request failed (${response.status}).`,
    );
  }
  let payload: T & { message?: string };
  try {
    payload = JSON.parse(text) as T & { message?: string };
  } catch {
    throw new Error(`Circle returned invalid JSON (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(payload.message ?? `Circle request failed (${response.status}).`);
  }
  return payload;
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

function authBody(ownerWallet: string, circleSocialUuid?: string, extra?: Record<string, unknown>) {
  return {
    ownerWallet,
    circleSocialUuid,
    ...extra,
  };
}

export async function fetchCircles(ownerWallet: string, circleSocialUuid?: string) {
  return parseJson<{
    circles: CircleListItem[];
    inbox: CircleInvitationRecord[];
    limits: CirclePlatformLimits;
  }>(
    await fetch(
      withWallet("/api/circles", ownerWallet, { circleSocialUuid }),
      { cache: "no-store" },
    ),
  );
}

export async function createCircleClient(
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{ circle: CircleRecord; invitations: CircleInvitationRecord[] }>(
    await fetch("/api/circles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function fetchCircleDetail(
  circleId: string,
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  return parseJson<{
    circle: CircleRecord;
    member: CircleMemberRecord;
    members: CircleMemberRecord[];
    save: CircleSaveAccountRecord | null;
    earn: null;
    limits: CirclePlatformLimits;
    activeCount: number;
  }>(
    await fetch(
      withWallet(`/api/circles/${circleId}`, ownerWallet, { circleSocialUuid }),
      { cache: "no-store" },
    ),
  );
}

export async function updateCircleClient(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{ circle: CircleRecord }>(
    await fetch(`/api/circles/${circleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function postCircleAction(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{ circle?: CircleRecord; ok?: boolean }>(
    await fetch(`/api/circles/${circleId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function inviteCircleMember(
  circleId: string,
  ownerWallet: string,
  username: string,
  circleSocialUuid?: string,
) {
  return parseJson<{ invitation: CircleInvitationRecord }>(
    await fetch(`/api/circles/${circleId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, { username })),
    }),
  );
}

export async function respondToInvitationClient(
  invitationId: string,
  ownerWallet: string,
  action: "accept" | "decline",
  circleSocialUuid?: string,
) {
  return parseJson<{ invitation: CircleInvitationRecord }>(
    await fetch(`/api/circles/invitations/${invitationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, { action })),
    }),
  );
}

export async function postMemberAction(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{ member: CircleMemberRecord }>(
    await fetch(`/api/circles/${circleId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function fetchMessages(
  circleId: string,
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  return parseJson<{ messages: CircleMessageRecord[] }>(
    await fetch(
      withWallet(`/api/circles/${circleId}/messages`, ownerWallet, {
        circleSocialUuid,
      }),
      { cache: "no-store" },
    ),
  );
}

export async function sendMessage(
  circleId: string,
  ownerWallet: string,
  content: string,
  circleSocialUuid?: string,
  replyToMessageId?: string,
) {
  return parseJson<{ message: CircleMessageRecord }>(
    await fetch(`/api/circles/${circleId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        authBody(ownerWallet, circleSocialUuid, { content, replyToMessageId }),
      ),
    }),
  );
}

export async function createPayment(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    intent: CirclePaymentIntentRecord;
    reused: boolean;
    recipients: Array<{
      wallet: string;
      username: string | null;
      amount: string;
      units: string;
    }>;
    execution: {
      method: "single" | "swiftbatch";
      contractAddress: string | null;
      callData: string | null;
      token: string;
      spender: string | null;
      requiredAllowanceUnits: string;
      feeBps: number;
      feeUnits: string;
      totalUnits: string;
      recipientCount: number;
      swiftbatchId: string | null;
    };
    feeAmount: string;
    finalTotal: string;
  }>(
    await fetch(`/api/circles/${circleId}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": String(body.idempotencyKey ?? crypto.randomUUID()),
      },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function submitPayment(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{ payment: CirclePaymentIntentRecord }>(
    await fetch(`/api/circles/${circleId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        authBody(ownerWallet, circleSocialUuid, { action: "submit", ...body }),
      ),
    }),
  );
}

export async function fetchPaymentRequests(
  circleId: string,
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  return parseJson<{
    groups: CircleRequestGroupRecord[];
    requests: CirclePaymentRequestRecord[];
  }>(
    await fetch(
      withWallet(`/api/circles/${circleId}/payment-requests`, ownerWallet, {
        circleSocialUuid,
      }),
      { cache: "no-store" },
    ),
  );
}

export async function createPaymentRequest(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    group: CircleRequestGroupRecord;
    requests: CirclePaymentRequestRecord[];
    reused: boolean;
  }>(
    await fetch(`/api/circles/${circleId}/payment-requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": String(body.idempotencyKey ?? crypto.randomUUID()),
      },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function respondPaymentRequest(
  requestId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{ request: CirclePaymentRequestRecord }>(
    await fetch(`/api/circles/payment-requests/${requestId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function fetchSave(
  circleId: string,
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  return parseJson<{
    account: CircleSaveAccountRecord;
    pocketOwner?: string | null;
    progress: number | null;
    vaultAddress: string | null;
    contributions: CircleSaveContributionRecord[];
    pockets: CircleSavePocketRecord[];
    memberTotals: Array<{ wallet: string; amount: string; amount_units: string }>;
  }>(
    await fetch(
      withWallet(`/api/circles/${circleId}/save`, ownerWallet, { circleSocialUuid }),
      { cache: "no-store" },
    ),
  );
}

export async function contributeSave(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    contribution: CircleSaveContributionRecord;
    pocketIdBytes32: string;
    pocketOwner: string;
    reused: boolean;
    tokenAddress: string;
    vaultAddress: string;
  }>(
    await fetch(`/api/circles/${circleId}/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": String(body.idempotencyKey ?? crypto.randomUUID()),
      },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function submitSave(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    contribution: CircleSaveContributionRecord;
    confirmed: boolean;
    pendingConfirmation: boolean;
  }>(
    await fetch(`/api/circles/${circleId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        authBody(ownerWallet, circleSocialUuid, { action: "submit", ...body }),
      ),
    }),
  );
}

export async function confirmSave(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    contribution: CircleSaveContributionRecord;
    confirmed: boolean;
    pendingConfirmation: boolean;
  }>(
    await fetch(`/api/circles/${circleId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        authBody(ownerWallet, circleSocialUuid, { action: "confirm", ...body }),
      ),
    }),
  );
}

export async function createCircleSavePocket(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{ pocket: CircleSavePocketRecord }>(
    await fetch(`/api/circles/${circleId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        authBody(ownerWallet, circleSocialUuid, { action: "createPocket", ...body }),
      ),
    }),
  );
}

export async function archiveCircleSavePocket(
  circleId: string,
  ownerWallet: string,
  pocketId: string,
  circleSocialUuid?: string,
) {
  return parseJson<{ pocket: CircleSavePocketRecord }>(
    await fetch(`/api/circles/${circleId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        authBody(ownerWallet, circleSocialUuid, { action: "archivePocket", pocketId }),
      ),
    }),
  );
}

export async function fetchWithdrawals(
  circleId: string,
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  return parseJson<{ withdrawals: CircleWithdrawalProposalRecord[] }>(
    await fetch(
      withWallet(`/api/circles/${circleId}/withdrawals`, ownerWallet, {
        circleSocialUuid,
      }),
      { cache: "no-store" },
    ),
  );
}

export async function createWithdrawal(
  circleId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    proposal: CircleWithdrawalProposalRecord;
    reused: boolean;
    required?: number;
  }>(
    await fetch(`/api/circles/${circleId}/withdrawals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": String(body.idempotencyKey ?? crypto.randomUUID()),
      },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function postWithdrawalAction(
  withdrawalId: string,
  ownerWallet: string,
  body: Record<string, unknown>,
  circleSocialUuid?: string,
) {
  return parseJson<{
    vaultCall?: {
      amountUnits: string;
      destination: string;
      needsForward: boolean;
      owner: string;
      pocketId: string;
      pocketIdBytes32: string;
      token: string;
      vault: string;
    } | null;
    withdrawal: CircleWithdrawalProposalRecord;
  }>(
    await fetch(`/api/circles/withdrawals/${withdrawalId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authBody(ownerWallet, circleSocialUuid, body)),
    }),
  );
}

export async function fetchActivity(
  circleId: string,
  ownerWallet: string,
  circleSocialUuid?: string,
) {
  return parseJson<{ activity: CircleActivityRecord[] }>(
    await fetch(
      withWallet(`/api/circles/${circleId}/activity`, ownerWallet, {
        circleSocialUuid,
      }),
      { cache: "no-store" },
    ),
  );
}
