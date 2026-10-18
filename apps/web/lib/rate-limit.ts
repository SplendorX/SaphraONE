import { createSupabaseAdminClient } from "@/lib/supabase-server";

/**
 * Shared rate limit: one atomic counter per key and fixed window in Postgres
 * (`consume_rate_limit`, packages/database/supabase/rate-limits.sql), so the
 * limit holds across every serverless instance.
 *
 * If the database can't be reached the call falls back to a per-instance
 * counter rather than failing open or blocking everyone.
 */

const localWindows = new Map<string, { count: number; resetAt: number }>();

function consumeLocally(key: string, max: number, windowSeconds: number) {
  const now = Date.now();
  const current = localWindows.get(key);
  if (!current || current.resetAt <= now) {
    localWindows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    if (localWindows.size > 10_000) {
      for (const [entry, window] of localWindows) {
        if (window.resetAt <= now) localWindows.delete(entry);
      }
    }
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

let warned = false;

/** Counts one hit for `key`; returns false once it exceeds `max` per window. */
export async function consumeRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc("consume_rate_limit", {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (cause) {
    if (!warned) {
      warned = true;
      console.warn(
        "[rate-limit] Shared limiter unavailable, using per-instance counts. Run rate-limits.sql.",
        cause instanceof Error ? cause.message : cause,
      );
    }
    return consumeLocally(key, max, windowSeconds);
  }
}

/**
 * Clears every window for these keys, e.g. when a reviewer reopens a check
 * the user was locked out of. Best effort: a failure leaves the old limit.
 */
export async function resetRateLimit(keys: string[]) {
  for (const key of keys) localWindows.delete(key);
  const { error } = await createSupabaseAdminClient().from("rate_limit_windows").delete().in("key", keys);
  if (error) console.warn("[rate-limit] reset failed", error.message);
}
