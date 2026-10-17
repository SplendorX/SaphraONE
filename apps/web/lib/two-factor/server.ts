import "@/lib/env-compat";
import crypto from "node:crypto";

import {
  decryptSecret as decryptBoxSecret,
  encryptSecret as encryptBoxSecret,
  secretBoxAvailable,
} from "@/lib/security/secret-box";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { currentStep, verifyTotp } from "@/lib/two-factor/totp";
import { sessionWallets, type WalletTokenPayload } from "@/lib/wallet-session";

/** Wrong codes before a pause, and how long it lasts. */
const ATTEMPTS_BEFORE_PAUSE = 5;
const PAUSE_MS = 15 * 60_000;
export const BACKUP_CODE_COUNT = 10;

export type TwoFactorRow = {
  owner_wallet: string;
  secret_encrypted: string;
  last_step: number;
  backup_code_hashes: string[];
  failed_attempts: number;
  locked_until: string | null;
  updated_at: string;
};

/**
 * TOTP secrets are encrypted at rest with SAPHRA_MFA_KEY (lib/security/secret-box).
 * Its own key, so rotating the session secret doesn't make every
 * authenticator unreadable. Without it, 2FA can't be turned on.
 */
export function twoFactorAvailable() {
  return secretBoxAvailable("SAPHRA_MFA_KEY");
}

export function encryptSecret(secret: string) {
  return encryptBoxSecret(secret, "SAPHRA_MFA_KEY");
}

export function decryptSecret(value: string) {
  return decryptBoxSecret(value, "SAPHRA_MFA_KEY");
}

// Backup codes: 10 characters from an alphabet without look-alikes, shown
// as xxxxx-xxxxx. Stored only as sha256 hashes; each works once.
const BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function normalizeBackupCode(code: string) {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hashBackupCode(code: string) {
  return crypto.createHash("sha256").update(`saphra-2fa:${normalizeBackupCode(code)}`).digest("hex");
}

export function generateBackupCodes() {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const chars = Array.from(
      crypto.randomBytes(10),
      (byte) => BACKUP_ALPHABET[byte % BACKUP_ALPHABET.length],
    ).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function hashBackupCodes(codes: string[]) {
  return codes.map(hashBackupCode);
}

/** The 2FA row for the first of `wallets` that has one (the owner first). */
export async function findTwoFactor(wallets: string[]) {
  const lower = [...new Set(wallets.map((w) => w.toLowerCase()))];
  if (lower.length === 0) return null;
  const { data, error } = await createSupabaseAdminClient()
    .from("two_factor")
    .select(
      "owner_wallet, secret_encrypted, last_step, backup_code_hashes, failed_attempts, locked_until, updated_at",
    )
    .in("owner_wallet", lower);
  if (error) throw error;
  const rows = (data ?? []) as TwoFactorRow[];
  return lower.map((w) => rows.find((row) => row.owner_wallet === w)).find(Boolean) ?? null;
}

export async function saveTwoFactor(
  wallet: string,
  secretEncrypted: string,
  backupHashes: string[],
  lastStep: number,
) {
  const { error } = await createSupabaseAdminClient()
    .from("two_factor")
    .upsert(
      {
        backup_code_hashes: backupHashes,
        enabled_at: new Date().toISOString(),
        failed_attempts: 0,
        last_step: lastStep,
        locked_until: null,
        owner_wallet: wallet.toLowerCase(),
        secret_encrypted: secretEncrypted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_wallet" },
    );
  if (error) throw error;
}

export async function replaceBackupCodes(wallet: string, backupHashes: string[]) {
  const { error } = await createSupabaseAdminClient()
    .from("two_factor")
    .update({ backup_code_hashes: backupHashes, updated_at: new Date().toISOString() })
    .eq("owner_wallet", wallet);
  if (error) throw error;
}

export async function deleteTwoFactor(wallet: string) {
  const { error } = await createSupabaseAdminClient()
    .from("two_factor")
    .delete()
    .eq("owner_wallet", wallet);
  if (error) throw error;
}

export type CodeCheck =
  | { ok: true; usedBackupCode: boolean; backupCodesLeft: number }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "paused"; until: string };

/**
 * Check an authenticator code or a backup code. A backup code is used up;
 * an authenticator code can't be reused. 5 wrong in a row pause for 15 min.
 */
export async function checkCode(
  row: TwoFactorRow,
  input: { code?: string; backupCode?: string },
): Promise<CodeCheck> {
  if (row.locked_until && Date.parse(row.locked_until) > Date.now()) {
    return { ok: false, reason: "paused", until: row.locked_until };
  }
  const supabase = createSupabaseAdminClient();

  let matchedStep: number | null = null;
  let remainingHashes = row.backup_code_hashes;
  if (input.code) {
    matchedStep = verifyTotp(decryptSecret(row.secret_encrypted), input.code, Number(row.last_step));
  } else if (input.backupCode) {
    const hash = hashBackupCode(input.backupCode);
    if (row.backup_code_hashes.includes(hash)) {
      remainingHashes = row.backup_code_hashes.filter((value) => value !== hash);
    }
  }
  const usedBackupCode = remainingHashes.length !== row.backup_code_hashes.length;

  if (matchedStep !== null || usedBackupCode) {
    // Conditional on the row being unchanged since it was read, so two
    // requests racing with one code (or one backup code) can't both succeed.
    const { data, error } = await supabase
      .from("two_factor")
      .update({
        backup_code_hashes: remainingHashes,
        failed_attempts: 0,
        last_step: matchedStep ?? row.last_step,
        locked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_wallet", row.owner_wallet)
      .eq("updated_at", row.updated_at)
      .select("owner_wallet");
    if (error) throw error;
    if (data && data.length > 0) {
      return { ok: true, usedBackupCode, backupCodesLeft: remainingHashes.length };
    }
  }

  const failures = row.failed_attempts + 1;
  const until =
    failures % ATTEMPTS_BEFORE_PAUSE === 0 ? new Date(Date.now() + PAUSE_MS).toISOString() : null;
  await supabase
    .from("two_factor")
    .update({ failed_attempts: failures, locked_until: until })
    .eq("owner_wallet", row.owner_wallet);
  return until
    ? { ok: false, reason: "paused", until }
    : {
        ok: false,
        reason: "wrong",
        attemptsLeft: ATTEMPTS_BEFORE_PAUSE - (failures % ATTEMPTS_BEFORE_PAUSE),
      };
}

/** The step to record when 2FA is first turned on with `code`. */
export function stepForSetup(secret: string, code: string) {
  return verifyTotp(secret, code, currentStep() - 10);
}

/**
 * Whether a session being issued must ask for a 2FA code. A renewal that
 * adds no wallet keeps the previous session's state. A sign-in that brings in
 * a wallet with 2FA on needs a code, even on top of an already-verified
 * session, so signing in to one account can't carry past another's 2FA.
 */
export async function mfaPendingForSignIn(
  previous: WalletTokenPayload | null,
  signingInWallets: string[],
) {
  const known = new Set(
    previous ? [previous.ownerWallet.toLowerCase(), ...sessionWallets(previous)] : [],
  );
  const added = signingInWallets.map((w) => w.toLowerCase()).filter((w) => !known.has(w));
  const carried = Boolean(previous?.mfaPending);
  if (added.length === 0) return carried;
  try {
    return carried || Boolean(await findTwoFactor(added));
  } catch {
    // Table missing (before two-factor.sql): nothing to enforce.
    return carried;
  }
}
