"use client";

import type { DeletionStatus } from "@/lib/account-deletion/rules";

export class DeletionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: { attemptsLeft?: number; field?: string; pausedUntil?: string } = {},
  ) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new DeletionError(
      typeof payload.message === "string" ? payload.message : "Something went wrong.",
      response.status,
      {
        attemptsLeft: typeof payload.attemptsLeft === "number" ? payload.attemptsLeft : undefined,
        field: typeof payload.field === "string" ? payload.field : undefined,
        pausedUntil: typeof payload.pausedUntil === "string" ? payload.pausedUntil : undefined,
      },
    );
  }
  return payload as T;
}

export async function fetchDeletionStatus(ownerWallet: string) {
  const url = `/api/account/deletion?ownerWallet=${encodeURIComponent(ownerWallet)}`;
  return parse<DeletionStatus>(await fetch(url, { cache: "no-store", credentials: "include" }));
}

export async function postDeletion<T = Record<string, unknown>>(
  ownerWallet: string,
  action: "send-code" | "schedule" | "cancel",
  body: Record<string, unknown> = {},
) {
  return parse<T>(
    await fetch("/api/account/deletion", {
      body: JSON.stringify({ action, ownerWallet, ...body }),
      cache: "no-store",
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

export function deletionErrorMessage(cause: unknown) {
  if (cause instanceof DeletionError) {
    if (cause.details.pausedUntil) {
      const minutes = Math.max(1, Math.ceil((Date.parse(cause.details.pausedUntil) - Date.now()) / 60_000));
      return `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    if (cause.details.attemptsLeft != null) {
      return `${cause.message} ${cause.details.attemptsLeft} ${cause.details.attemptsLeft === 1 ? "try" : "tries"} left before a pause.`;
    }
    return cause.message;
  }
  return "Couldn't reach SaphraONE. Check your connection and try again.";
}
