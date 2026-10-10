import type { SavingsPocketRecord } from "@/lib/save/types";

export const savingsLockKinds = ["flexible", "fixed"] as const;
export type SavingsLockKind = (typeof savingsLockKinds)[number];

export const FIXED_LOCK_PRESETS = [
  { days: 7, label: "1 week", hint: "Short lock" },
  { days: 30, label: "1 month", hint: "Monthly goal" },
  { days: 90, label: "3 months", hint: "Quarter" },
  { days: 180, label: "6 months", hint: "Half year" },
  { days: 365, label: "1 year", hint: "Long haul" },
] as const;

export const MIN_LOCK_DAYS = 1;
export const MAX_LOCK_DAYS = 365 * 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type PocketLockState =
  | { kind: "flexible"; locked: false }
  | {
      kind: "fixed";
      locked: true;
      until: Date;
      remainingMs: number;
      durationDays: number | null;
    }
  | {
      kind: "fixed";
      locked: false;
      until: Date | null;
      remainingMs: 0;
      durationDays: number | null;
    };

export function isSavingsLockKind(value: unknown): value is SavingsLockKind {
  return value === "flexible" || value === "fixed";
}

export function lockUntilFromDays(days: number, from = new Date()) {
  const safeDays = Math.max(MIN_LOCK_DAYS, Math.min(MAX_LOCK_DAYS, days));
  return new Date(from.getTime() + safeDays * MS_PER_DAY);
}

export function daysBetween(from: Date, to: Date) {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY));
}

export function getPocketLockState(
  pocket: Pick<
    SavingsPocketRecord,
    "lock_kind" | "lock_until" | "lock_duration_days"
  >,
  now = new Date(),
): PocketLockState {
  const kind = pocket.lock_kind === "fixed" ? "fixed" : "flexible";
  if (kind === "flexible") {
    return { kind: "flexible", locked: false };
  }

  const until = pocket.lock_until ? new Date(pocket.lock_until) : null;
  const durationDays = pocket.lock_duration_days ?? null;

  if (!until || Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) {
    return {
      kind: "fixed",
      locked: false,
      until: until && !Number.isNaN(until.getTime()) ? until : null,
      remainingMs: 0,
      durationDays,
    };
  }

  return {
    kind: "fixed",
    locked: true,
    until,
    remainingMs: until.getTime() - now.getTime(),
    durationDays,
  };
}


export function pocketWithdrawBlockReason(
  pocket: Pick<
    SavingsPocketRecord,
    "name" | "lock_kind" | "lock_until" | "lock_duration_days"
  >,
  now = new Date(),
) {
  const state = getPocketLockState(pocket, now);
  if (!state.locked) return null;
  return `“${pocket.name}” is a fixed pocket and stays locked until ${formatUnlockDate(state.until)}. You can still add money.`;
}

export function assertPocketUnlocked(
  pocket: Pick<
    SavingsPocketRecord,
    "name" | "lock_kind" | "lock_until" | "lock_duration_days"
  >,
  now = new Date(),
) {
  const reason = pocketWithdrawBlockReason(pocket, now);
  if (reason) {
    throw new Error(reason);
  }
}

export function formatUnlockDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "the unlock date";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatLockRemaining(remainingMs: number) {
  if (remainingMs <= 0) return "Unlocked";
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 1) {
    return hours > 0 ? `${days}d ${hours}h left` : `${days}d left`;
  }
  if (hours >= 1) {
    return minutes > 0 ? `${hours}h ${minutes}m left` : `${hours}h left`;
  }
  return `${Math.max(1, minutes)}m left`;
}

export function parseLockRequest(body: {
  lockKind?: unknown;
  lockDays?: unknown;
  lockUntil?: unknown;
}):
  | { ok: true; value: null }
  | { ok: true; value: { kind: "flexible" } }
  | { ok: true; value: { kind: "fixed"; until: string; days: number } }
  | { ok: false; error: string } {
  const hasKind = body.lockKind !== undefined && body.lockKind !== null;
  const hasDays = body.lockDays !== undefined && body.lockDays !== null && body.lockDays !== "";
  const hasUntil =
    body.lockUntil !== undefined && body.lockUntil !== null && body.lockUntil !== "";

  if (!hasKind && !hasDays && !hasUntil) {
    return { ok: true, value: null };
  }

  const kind = hasKind
    ? body.lockKind
    : hasDays || hasUntil
      ? "fixed"
      : "flexible";

  if (!isSavingsLockKind(kind)) {
    return { ok: false, error: "Choose flexible or fixed savings." };
  }

  if (kind === "flexible") {
    return { ok: true, value: { kind: "flexible" } };
  }

  const now = new Date();
  let until: Date | null = null;
  let days: number | null = null;

  if (hasUntil && typeof body.lockUntil === "string") {
    const parsed = new Date(body.lockUntil);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Enter a valid unlock date." };
    }
    until = parsed;
    days = daysBetween(now, parsed);
  } else if (hasDays) {
    const raw =
      typeof body.lockDays === "number"
        ? body.lockDays
        : typeof body.lockDays === "string"
          ? Number(body.lockDays)
          : NaN;
    if (!Number.isInteger(raw) || raw < MIN_LOCK_DAYS || raw > MAX_LOCK_DAYS) {
      return {
        ok: false,
        error: `Fixed lock must be between ${MIN_LOCK_DAYS} and ${MAX_LOCK_DAYS} days.`,
      };
    }
    days = raw;
    until = lockUntilFromDays(raw, now);
  }

  if (!until || days == null) {
    return {
      ok: false,
      error: "Choose how long this fixed pocket should stay locked.",
    };
  }

  if (until.getTime() <= now.getTime() + 12 * 60 * 60 * 1000) {
    return {
      ok: false,
      error: "Fixed pockets must stay locked for at least one day.",
    };
  }

  if (days > MAX_LOCK_DAYS) {
    return {
      ok: false,
      error: `Fixed lock cannot exceed ${MAX_LOCK_DAYS} days.`,
    };
  }

  return {
    ok: true,
    value: { kind: "fixed", until: until.toISOString(), days },
  };
}

export function applyLockChange(
  existing: Pick<
    SavingsPocketRecord,
    "lock_kind" | "lock_until" | "lock_duration_days"
  >,
  next: { kind: "flexible" } | { kind: "fixed"; until: string; days: number },
  now = new Date(),
):
  | {
      patch: {
        lock_kind: SavingsLockKind;
        lock_until: string | null;
        lock_duration_days: number | null;
      };
    }
  | { error: string } {
  const current = getPocketLockState(existing, now);

  if (current.locked) {
    return {
      error: `This pocket is locked until ${formatUnlockDate(current.until)}. The term cannot be shortened or removed.`,
    };
  }

  if (next.kind === "flexible") {
    return {
      patch: {
        lock_kind: "flexible",
        lock_until: null,
        lock_duration_days: null,
      },
    };
  }

  return {
    patch: {
      lock_kind: "fixed",
      lock_until: next.until,
      lock_duration_days: next.days,
    },
  };
}
