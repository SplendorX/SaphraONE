import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";

import { jsonError, readJsonRecord } from "@/lib/http";
import {
  assertRecurringAccess,
  normalizeOwnerWallet,
} from "@/lib/recurring-auth";
import type { PaymentIntentAsset } from "@/lib/payment-engine/intent";
import {
  getDailySpentUnits,
  loadPolicyTimeZone,
  savePolicyTimeZone,
  loadPolicyConfig,
  loadPolicyConfigOrDefault,
  savePolicyConfig,
  serializePolicyConfig,
  type PolicyConfig,
  type PolicyStatus,
} from "@/lib/payment-engine/policy";
import { isValidTimeZone } from "@/lib/payment-engine/local-day";

export const runtime = "nodejs";

const maxApprovedRecipients = 200;

type PolicyBody = {
  approvedAssets?: unknown;
  approvedRecipients?: unknown;
  circleSocialUuid?: unknown;
  dailyLimitUnits?: unknown;
  ownerWallet?: unknown;
  perTxLimitUnits?: unknown;
  requiresApprovalAboveUnits?: unknown;
  status?: unknown;
};

function readUnits(value: unknown, field: string) {
  if (value === undefined || value === null) {
    return { ok: false, error: `${field} is required.` } as const;
  }

  const raw = String(value).trim();

  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      error: `${field} must be a whole number of token units.`,
    } as const;
  }

  const units = BigInt(raw);

  // 1e15 units = 1 billion USDC. Anything above is a typo, not a limit.
  if (units > 10n ** 15n) {
    return { ok: false, error: `${field} is unrealistically large.` } as const;
  }

  return { ok: true, units } as const;
}

function readRecipients(value: unknown) {
  if (value === undefined || value === null) {
    return { ok: true, recipients: [] as string[] } as const;
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: "approvedRecipients must be an array." } as const;
  }

  if (value.length > maxApprovedRecipients) {
    return {
      ok: false,
      error: `approvedRecipients cannot exceed ${maxApprovedRecipients} entries.`,
    } as const;
  }

  const recipients: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      return {
        ok: false,
        error: "approvedRecipients must contain strings.",
      } as const;
    }

    const trimmed = entry.trim();

    if (!trimmed) {
      continue;
    }

    if (!isAddress(trimmed) && !/^@?[a-zA-Z0-9_.-]{2,32}$/.test(trimmed)) {
      return {
        ok: false,
        error: `"${trimmed}" is not a valid address or ONE ID.`,
      } as const;
    }

    recipients.push(trimmed);
  }

  return { ok: true, recipients } as const;
}

function readAssets(value: unknown) {
  if (value === undefined || value === null) {
    return { ok: true, assets: ["USDC"] as PaymentIntentAsset[] } as const;
  }

  if (!Array.isArray(value)) {
    return { ok: false, error: "approvedAssets must be an array." } as const;
  }

  const assets = value.filter(
    (entry): entry is PaymentIntentAsset =>
      entry === "USDC" || entry === "EURC",
  );

  if (assets.length !== value.length) {
    return {
      ok: false,
      error: "approvedAssets may only contain USDC or EURC.",
    } as const;
  }

  if (assets.length === 0) {
    return {
      ok: false,
      error: "At least one approved asset is required.",
    } as const;
  }

  return { ok: true, assets: Array.from(new Set(assets)) } as const;
}

function readStatus(value: unknown) {
  if (value === undefined || value === null) {
    return { ok: true, status: "active" as PolicyStatus } as const;
  }

  if (value === "active" || value === "paused" || value === "revoked") {
    return { ok: true, status: value } as const;
  }

  return {
    ok: false,
    error: "status must be active, paused, or revoked.",
  } as const;
}

export async function GET(request: NextRequest) {
  const ownerWallet = normalizeOwnerWallet(
    request.nextUrl.searchParams.get("ownerWallet"),
  );
  const circleSocialUuid =
    request.nextUrl.searchParams.get("circleSocialUuid") ?? undefined;

  if (!ownerWallet) {
    return jsonError("A valid owner wallet is required.", 400);
  }

  const canAccess = await assertRecurringAccess({
    circleSocialUuid,
    ownerWallet,
  });

  if (!canAccess) {
    return jsonError("Authorize this wallet before loading policies.", 401);
  }

  try {
    // The browser reports its time zone so "today" and the daily limit reset
    // at the owner's local midnight. Saved only when it changes.
    const timeZone = request.nextUrl.searchParams.get("timeZone");
    if (isValidTimeZone(timeZone) && timeZone !== (await loadPolicyTimeZone(ownerWallet))) {
      // Best effort: loading the policy must not fail on it.
      await savePolicyTimeZone(ownerWallet, timeZone).catch((error: unknown) =>
        console.warn("[policy] time zone not saved:", error instanceof Error ? error.message : error),
      );
    }

    const stored = await loadPolicyConfig(ownerWallet);
    const config = stored ?? (await loadPolicyConfigOrDefault(ownerWallet));
    const dailySpentUnits = await getDailySpentUnits(ownerWallet);

    return NextResponse.json({
      configured: Boolean(stored),
      dailySpentUnits: dailySpentUnits.toString(),
      policy: serializePolicyConfig(config),
    });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Payment policy could not be loaded.",
      500,
    );
  }
}

export async function PUT(request: NextRequest) {
  const body = await readJsonRecord<PolicyBody>(request);

  if (!body) {
    return jsonError("A valid JSON body is required.", 400);
  }

  const ownerWallet = normalizeOwnerWallet(body.ownerWallet);

  if (!ownerWallet) {
    return jsonError("A valid owner wallet is required.", 400);
  }

  const canAccess = await assertRecurringAccess({
    circleSocialUuid: body.circleSocialUuid,
    ownerWallet,
  });

  if (!canAccess) {
    return jsonError("Only the policy owner can update it.", 401);
  }

  const perTx = readUnits(body.perTxLimitUnits, "perTxLimitUnits");
  if (!perTx.ok) {
    return jsonError(perTx.error, 400);
  }

  const daily = readUnits(body.dailyLimitUnits, "dailyLimitUnits");
  if (!daily.ok) {
    return jsonError(daily.error, 400);
  }

  // 0 is valid here and means "always ask a human".
  const approvalAbove = readUnits(
    body.requiresApprovalAboveUnits ?? "0",
    "requiresApprovalAboveUnits",
  );
  if (!approvalAbove.ok) {
    return jsonError(approvalAbove.error, 400);
  }

  const recipients = readRecipients(body.approvedRecipients);
  if (!recipients.ok) {
    return jsonError(recipients.error, 400);
  }

  const assets = readAssets(body.approvedAssets);
  if (!assets.ok) {
    return jsonError(assets.error, 400);
  }

  const status = readStatus(body.status);
  if (!status.ok) {
    return jsonError(status.error, 400);
  }

  if (perTx.units > daily.units) {
    return jsonError(
      "Per-transaction limit cannot exceed the daily limit.",
      400,
    );
  }

  const config: PolicyConfig = {
    ownerWallet,
    perTxLimitUnits: perTx.units,
    dailyLimitUnits: daily.units,
    approvedRecipients: recipients.recipients,
    approvedAssets: assets.assets,
    requiresApprovalAboveUnits: approvalAbove.units,
    status: status.status,
  };

  try {
    await savePolicyConfig(config);
    return NextResponse.json({ policy: serializePolicyConfig(config) });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Payment policy could not be saved.",
      500,
    );
  }
}
