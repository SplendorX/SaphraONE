import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";

import { jsonError, readJsonRecord } from "@/lib/http";
import {
  assertRecurringAccess,
  normalizeOwnerWallet,
} from "@/lib/recurring-auth";
import {
  createIntent,
  isPaymentIntentAsset,
  isPaymentIntentInitiatorType,
  parseAmountUnits,
  type CreateIntentParams,
  type PaymentIntentInitiatorType,
} from "@/lib/payment-engine/intent";
import {
  insertIntent,
  loadIntentLifecycle,
  loadIntentsForWallet,
  serializeIntent,
} from "@/lib/payment-engine/ledger";

export const runtime = "nodejs";

type CreateIntentBody = {
  amountUnits?: unknown;
  amountUsdc?: unknown;
  asset?: unknown;
  chainId?: unknown;
  circleSocialUuid?: unknown;
  idempotencyKey?: unknown;
  initiatorId?: unknown;
  initiatorType?: unknown;
  metadata?: unknown;
  recipient?: unknown;
  resolvedRecipient?: unknown;
};

function normalizeRecipient(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Either an EVM address or an @username handle the engine resolves later.
  if (isAddress(trimmed) || /^@?[a-zA-Z0-9_.-]{2,32}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function normalizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readAmountUnits(body: CreateIntentBody) {
  if (body.amountUnits !== undefined && body.amountUnits !== null) {
    const raw = String(body.amountUnits).trim();
    if (!/^\d+$/.test(raw)) {
      return null;
    }
    const units = BigInt(raw);
    return units > 0n ? units : null;
  }

  return parseAmountUnits(body.amountUsdc);
}

export async function POST(request: NextRequest) {
  const body = await readJsonRecord<CreateIntentBody>(request);

  if (!body) {
    return jsonError("A valid JSON body is required.", 400);
  }

  const initiatorType: PaymentIntentInitiatorType =
    isPaymentIntentInitiatorType(body.initiatorType)
      ? body.initiatorType
      : "human";

  const initiatorId = normalizeOwnerWallet(body.initiatorId);

  if (!initiatorId) {
    return jsonError("A valid initiator wallet is required.", 400);
  }

  const canAccess = await assertRecurringAccess({
    circleSocialUuid: body.circleSocialUuid,
    ownerWallet: initiatorId,
  });

  if (!canAccess) {
    return jsonError("Authorize this wallet before creating intents.", 401);
  }

  const recipient = normalizeRecipient(body.recipient);

  if (!recipient) {
    return jsonError("A valid recipient address or ONE ID is required.", 400);
  }

  if (body.asset !== undefined && !isPaymentIntentAsset(body.asset)) {
    return jsonError("Asset must be USDC or EURC.", 400);
  }

  const amountUnits = readAmountUnits(body);

  if (!amountUnits) {
    return jsonError("A payment amount greater than zero is required.", 400);
  }

  const resolvedRecipient =
    typeof body.resolvedRecipient === "string" &&
    isAddress(body.resolvedRecipient)
      ? body.resolvedRecipient
      : isAddress(recipient)
        ? recipient
        : undefined;

  const chainId =
    typeof body.chainId === "number" && Number.isFinite(body.chainId)
      ? body.chainId
      : undefined;

  const params: CreateIntentParams = {
    initiatorId,
    recipient,
    resolvedRecipient: resolvedRecipient as CreateIntentParams["resolvedRecipient"],
    asset: isPaymentIntentAsset(body.asset) ? body.asset : "USDC",
    amountUnits,
    chainId,
    metadata: normalizeMetadata(body.metadata),
    idempotencyKey:
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : undefined,
  };

  try {
    const intent = createIntent(initiatorType, params);
    const saved = await insertIntent(intent);

    return NextResponse.json({ intent: serializeIntent(saved) }, { status: 201 });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Payment intent could not be created.",
      500,
    );
  }
}

export async function GET(request: NextRequest) {
  const intentId = request.nextUrl.searchParams.get("intentId");
  const circleSocialUuid =
    request.nextUrl.searchParams.get("circleSocialUuid") ?? undefined;

  try {
    if (intentId) {
      const lifecycle = await loadIntentLifecycle(intentId);

      if (!lifecycle) {
        return jsonError("Payment intent was not found.", 404);
      }

      const canAccess = await assertRecurringAccess({
        circleSocialUuid,
        ownerWallet: lifecycle.intent.initiatorId,
      });

      if (!canAccess) {
        return jsonError("Authorize this wallet before loading intents.", 401);
      }

      return NextResponse.json({
        attempts: lifecycle.attempts,
        intent: serializeIntent(lifecycle.intent),
        settlements: lifecycle.settlements,
      });
    }

    const initiatorId = normalizeOwnerWallet(
      request.nextUrl.searchParams.get("initiatorId"),
    );

    if (!initiatorId) {
      return jsonError("Provide an intentId or a valid initiatorId.", 400);
    }

    const canAccess = await assertRecurringAccess({
      circleSocialUuid,
      ownerWallet: initiatorId,
    });

    if (!canAccess) {
      return jsonError("Authorize this wallet before loading intents.", 401);
    }

    const limitParam = Number(request.nextUrl.searchParams.get("limit"));
    const intents = await loadIntentsForWallet(initiatorId, {
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 25,
    });

    return NextResponse.json({ intents: intents.map(serializeIntent) });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Payment intents could not be loaded.",
      500,
    );
  }
}
