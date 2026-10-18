import { NextResponse, type NextRequest } from "next/server";

import { isBusinessHttpError } from "@/lib/business/errors";
import { requireActorWallet } from "@/lib/business/auth";
import { readIdempotencyKey } from "@/lib/save/idempotency";
import { CircleHttpError } from "@/lib/swift-circle/errors";
import { isPayrollError } from "@/lib/payroll/errors";

export async function readJsonBody(request: NextRequest) {
  try {
    const data = await request.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function jsonOk(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function jsonBusinessError(error: unknown) {
  if (isBusinessHttpError(error) || error instanceof CircleHttpError || isPayrollError(error)) {
    return NextResponse.json(
      {
        message: error.userMessage,
        code: error.code,
        ...(isBusinessHttpError(error) && error.details ? error.details : {}),
      },
      { status: error.status },
    );
  }

  const message =
    error instanceof Error ? error.message : "Something went wrong.";
  console.error("[saphra-business]", error);
  return NextResponse.json({ message }, { status: 500 });
}

export async function readActor(
  request: NextRequest,
  body?: Record<string, unknown> | null,
) {
  const ownerWallet =
    body?.ownerWallet ?? request.nextUrl.searchParams.get("ownerWallet");
  const circleSocialUuid =
    body?.circleSocialUuid ??
    request.nextUrl.searchParams.get("circleSocialUuid");
  const rawWorkspaceId =
    body?.workspaceId ??
    request.headers.get("x-workspace-id") ??
    request.nextUrl.searchParams.get("workspaceId");
  const workspaceId =
    typeof rawWorkspaceId === "string" && rawWorkspaceId.trim()
      ? rawWorkspaceId.trim()
      : undefined;

  const actorWallet = await requireActorWallet({
    ownerWallet,
    circleSocialUuid,
  });

  return {
    actorWallet,
    circleSocialUuid:
      typeof circleSocialUuid === "string" ? circleSocialUuid : undefined,
    idempotencyKey: readIdempotencyKey(request, body ?? undefined),
    workspaceId,
  };
}
