import crypto from "node:crypto";
import { promisify } from "node:util";

import { createSupabaseAdminClient } from "@/lib/supabase-server";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 };
/** Wrong PINs before a pause, and how long it lasts. */
const ATTEMPTS_BEFORE_PAUSE = 5;
const PAUSE_MS = 15 * 60_000;
/** Wrong PINs before the browser is signed out altogether. */
const ATTEMPTS_BEFORE_SIGN_OUT = 10;

export type AppLockRow = {
  owner_wallet: string;
  pin_hash: string;
  timeout_minutes: number;
  failed_attempts: number;
  locked_until: string | null;
};

export type AppLockPasskey = {
  credential_id: string;
  owner_wallet: string;
  public_key: string;
  counter: number;
  transports: string[] | null;
};

export function isValidPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export async function hashPin(pin: string) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pin, salt, SCRYPT.keylen, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

async function pinMatches(pin: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(pin, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** The lock for the first of `wallets` that has one (the owner first). */
export async function findAppLock(wallets: string[]) {
  const lower = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (lower.length === 0) return null;
  const { data, error } = await createSupabaseAdminClient()
    .from("app_locks")
    .select("owner_wallet, pin_hash, timeout_minutes, failed_attempts, locked_until")
    .in("owner_wallet", lower);
  if (error) throw error;
  const rows = (data ?? []) as AppLockRow[];
  return lower.map((w) => rows.find((row) => row.owner_wallet === w)).find(Boolean) ?? null;
}



export async function saveAppLock(wallet: string, pin: string, timeoutMinutes: number) {
  const { error } = await createSupabaseAdminClient()
    .from("app_locks")
    .upsert(
      {
        owner_wallet: wallet.toLowerCase(),
        pin_hash: await hashPin(pin),
        timeout_minutes: timeoutMinutes,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_wallet" },
    );
  if (error) throw error;
}

export async function deleteAppLock(wallet: string) {
  const supabase = createSupabaseAdminClient();
  const [lock, passkeys] = await Promise.all([
    supabase.from("app_locks").delete().eq("owner_wallet", wallet),
    supabase.from("app_lock_passkeys").delete().eq("owner_wallet", wallet),
  ]);
  if (lock.error) throw lock.error;
  if (passkeys.error) throw passkeys.error;
}

export type PinCheck =
  | { ok: true }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "paused"; until: string }
  | { ok: false; reason: "sign-out" };

/** What a paused PIN says, with how long is left. */
export function pinPausedMessage(until: string) {
  const minutes = Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 60_000));
  return `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** Check a PIN, counting wrong ones: a pause after 5, sign-out after 10. */
export async function checkPin(lock: AppLockRow, pin: string): Promise<PinCheck> {
  if (lock.locked_until && Date.parse(lock.locked_until) > Date.now()) {
    return { ok: false, reason: "paused", until: lock.locked_until };
  }

  const supabase = createSupabaseAdminClient();
  if (await pinMatches(pin, lock.pin_hash)) {
    if (lock.failed_attempts > 0 || lock.locked_until) {
      await supabase
        .from("app_locks")
        .update({ failed_attempts: 0, locked_until: null })
        .eq("owner_wallet", lock.owner_wallet);
    }
    return { ok: true };
  }

  const failures = lock.failed_attempts + 1;
  if (failures >= ATTEMPTS_BEFORE_SIGN_OUT) {
    await supabase
      .from("app_locks")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("owner_wallet", lock.owner_wallet);
    return { ok: false, reason: "sign-out" };
  }
  const pause = failures % ATTEMPTS_BEFORE_PAUSE === 0;
  const until = pause ? new Date(Date.now() + PAUSE_MS).toISOString() : null;
  await supabase
    .from("app_locks")
    .update({ failed_attempts: failures, locked_until: until })
    .eq("owner_wallet", lock.owner_wallet);
  return until
    ? { ok: false, reason: "paused", until }
    : {
        ok: false,
        reason: "wrong",
        attemptsLeft: ATTEMPTS_BEFORE_PAUSE - (failures % ATTEMPTS_BEFORE_PAUSE),
      };
}

export async function listPasskeys(wallet: string) {
  const { data, error } = await createSupabaseAdminClient()
    .from("app_lock_passkeys")
    .select("credential_id, owner_wallet, public_key, counter, transports")
    .eq("owner_wallet", wallet);
  if (error) throw error;
  return (data ?? []) as AppLockPasskey[];
}

export async function savePasskey(passkey: AppLockPasskey) {
  const { error } = await createSupabaseAdminClient()
    .from("app_lock_passkeys")
    .upsert(passkey, { onConflict: "credential_id" });
  if (error) throw error;
}

export async function recordPasskeyUse(credentialId: string, counter: number) {
  await createSupabaseAdminClient()
    .from("app_lock_passkeys")
    .update({ counter, last_used_at: new Date().toISOString() })
    .eq("credential_id", credentialId);
}

export async function deletePasskeys(wallet: string) {
  const { error } = await createSupabaseAdminClient()
    .from("app_lock_passkeys")
    .delete()
    .eq("owner_wallet", wallet);
  if (error) throw error;
}
