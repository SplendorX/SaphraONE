import { NextResponse, type NextRequest } from "next/server";

import { getAddress, isAddress } from "viem";

import {
  readPaymentRequestIdFromLink,
  withPaymentRequestId,
} from "@/lib/payment-request-url";
import { normalizeUsername, validateUsername } from "@/lib/profile-utils";
import {
  createPaymentRequestNotification,
  hasNotificationForPaymentId,
  readPaymentRequestLifecycle,
} from "@/lib/save/notifications";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";

export const runtime = "nodejs";

const profilesTable = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";
const maxRequestLinkLength = 1_000;
const maxNoteLength = 140;

type NotifyPaymentRequestBody = {
  amount?: unknown;
  expiresInHours?: unknown;
  fromLabel?: unknown;
  fromUsername?: unknown;
  fromWallet?: unknown;
  note?: unknown;
  recipientUsername?: unknown;
  requestId?: unknown;
  requestLink?: unknown;
  token?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeAmount(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const amount = String(value).trim();
  const numeric = Number(amount);

  if (!amount || !Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return amount.slice(0, 32);
}

function normalizeToken(value: unknown): ArcTokenSymbol | null {
  if (typeof value !== "string") {
    return null;
  }

  return value in arcTokens ? (value as ArcTokenSymbol) : null;
}

function normalizeRequestLink(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const requestLink = value.trim();

  if (!requestLink || requestLink.length > maxRequestLinkLength) {
    return null;
  }

  try {
    const url = new URL(requestLink);
    return `${url.pathname}${url.search}`;
  } catch {
    return requestLink.startsWith("/send?") || requestLink.startsWith("/dashboard?")
      ? requestLink
      : null;
  }
}

function normalizeRequestId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const requestId = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    requestId,
  )
    ? requestId
    : null;
}

function normalizeExpiresInHours(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export async function POST(request: NextRequest) {
  let body: NotifyPaymentRequestBody;

  try {
    body = (await request.json()) as NotifyPaymentRequestBody;
  } catch {
    return jsonError("A valid JSON body is required.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("A valid JSON body is required.", 400);
  }

  const recipientUsername = normalizeUsername(
    typeof body.recipientUsername === "string" ? body.recipientUsername : "",
  );
  const usernameError = validateUsername(recipientUsername);
  const amount = normalizeAmount(body.amount);
  const token = normalizeToken(body.token);
  const requestLinkRaw = normalizeRequestLink(body.requestLink);
  const fromWalletRaw =
    typeof body.fromWallet === "string" ? body.fromWallet.trim() : "";
  const fromWallet = isAddress(fromWalletRaw)
    ? getAddress(fromWalletRaw).toLowerCase()
    : null;
  const fromUsername = normalizeUsername(
    typeof body.fromUsername === "string" ? body.fromUsername : "",
  );

  if (usernameError) {
    return jsonError(usernameError, 400);
  }

  if (!amount) {
    return jsonError("Enter a valid payment request amount.", 400);
  }

  if (!token) {
    return jsonError("Select a supported request token.", 400);
  }

  const requestId =
    normalizeRequestId(body.requestId) ??
    (requestLinkRaw
      ? normalizeRequestId(readPaymentRequestIdFromLink(requestLinkRaw))
      : null) ??
    crypto.randomUUID();
  const requestLink = requestLinkRaw
    ? withPaymentRequestId(requestLinkRaw, requestId)
    : null;

  if (!requestLink) {
    return jsonError("Generate a valid payment request link first.", 400);
  }

  if (!fromWallet) {
    return jsonError("Connect a wallet before sending a payment request.", 400);
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: recipient, error } = await supabase
      .from(profilesTable)
      .select("wallet_address,username")
      .ilike("username", recipientUsername)
      .limit(1)
      .maybeSingle();

    if (error) {
      return jsonError(error.message, 500);
    }

    if (!recipient?.wallet_address) {
      return jsonError("That ONE ID was not found.", 404);
    }

    if (recipient.wallet_address.toLowerCase() === fromWallet) {
      return jsonError("You cannot send a payment request to yourself.", 400);
    }

    const existingLifecycle = await readPaymentRequestLifecycle(requestId);
    if (
      existingLifecycle === "paid" ||
      existingLifecycle === "declined" ||
      existingLifecycle === "expired"
    ) {
      return jsonError(
        "This payment request is no longer open. Generate a new link.",
        409,
      );
    }

    const fromLabel =
      normalizeText(body.fromLabel, 80) ||
      (fromUsername ? `${fromUsername}.one` : "A SaphraONE user");
    const note = normalizeText(body.note, maxNoteLength);
    const duplicate = await hasNotificationForPaymentId(
      recipient.wallet_address,
      requestId,
    );

    if (duplicate) {
      return NextResponse.json({
        alreadyExists: true,
        ok: true,
        recipientUsername,
      });
    }

    const result = await createPaymentRequestNotification({
      amount,
      expiresInHours: normalizeExpiresInHours(body.expiresInHours),
      fromLabel,
      fromUsername: fromUsername || null,
      fromWallet,
      note,
      ownerWallet: recipient.wallet_address,
      requestId,
      requestLink,
      token,
    });

    if (!result.record && !result.alreadyExists) {
      return jsonError(result.error ?? "Payment request notification failed.", 500);
    }

    return NextResponse.json({
      notificationId: result.record?.id ?? null,
      ok: true,
      recipientUsername,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Payment request notification failed.";
    return jsonError(message, 500);
  }
}
