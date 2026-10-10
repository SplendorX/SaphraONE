import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase-server";

const locksTable =
  process.env.SUPABASE_RECURRING_LOCKS_TABLE ?? "recurring_locks";

const DEFAULT_TTL_MS = 45_000;

export type RecurringLock = {
  key: string;
  token: string;
  expiresAt: Date;
};

export function recurringPaymentLockKey(scheduleId: string) {
  return `recurring-payment:${scheduleId}:lock`;
}

export function recurringOccurrenceLockKey(occurrenceId: string) {
  return `recurring-payment-occurrence:${occurrenceId}:lock`;
}

async function acquirePostgresLock(
  key: string,
  ttlMs: number,
): Promise<RecurringLock | null> {
  const supabase = createSupabaseAdminClient();
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  await supabase.from(locksTable).delete().lt("expires_at", now.toISOString());

  const inserted = await supabase
    .from(locksTable)
    .insert({
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      lock_key: key,
      owner_token: token,
    })
    .select("lock_key,owner_token,expires_at")
    .maybeSingle();

  if (!inserted.error && inserted.data) {
    return { expiresAt, key, token };
  }

  const existing = await supabase
    .from(locksTable)
    .select("lock_key,owner_token,expires_at")
    .eq("lock_key", key)
    .maybeSingle();

  if (existing.error || !existing.data) {
    return null;
  }

  if (new Date(existing.data.expires_at).getTime() > now.getTime()) {
    return null;
  }

  const stolen = await supabase
    .from(locksTable)
    .update({
      expires_at: expiresAt.toISOString(),
      owner_token: token,
    })
    .eq("lock_key", key)
    .eq("owner_token", existing.data.owner_token)
    .lt("expires_at", now.toISOString())
    .select("lock_key,owner_token,expires_at")
    .maybeSingle();

  if (stolen.error || !stolen.data) {
    return null;
  }

  return { expiresAt, key, token };
}

async function releasePostgresLock(lock: RecurringLock) {
  const supabase = createSupabaseAdminClient();
  await supabase
    .from(locksTable)
    .delete()
    .eq("lock_key", lock.key)
    .eq("owner_token", lock.token);
}

/**
 * Distributed lock. Uses Postgres as the durable store (source of truth).
 * Optional REDIS_URL can be added later without changing callers.
 * TTL-safe: only the owning token can release; expired locks can be stolen.
 */
export async function acquireRecurringLock(
  key: string,
  ttlMs = DEFAULT_TTL_MS,
) {
  return acquirePostgresLock(key, ttlMs);
}

export async function releaseRecurringLock(lock: RecurringLock | null) {
  if (!lock) {
    return;
  }
  await releasePostgresLock(lock);
}

