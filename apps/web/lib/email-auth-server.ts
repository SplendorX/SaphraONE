import crypto from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  circleRequest,
  listWalletAddressesForUserToken,
} from "@/lib/circle-user-server";
import { isDeletedUsername } from "@/lib/account-deletion/rules";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { createSignedToken, readSignedToken } from "@/lib/wallet-session";

export const emailSessionCookieName = "saphra_email_session";
/** Long enough to finish PIN setup; the wallet session takes over after. */
export const emailSessionTtlMs = 30 * 60 * 1000;

export type EmailSession = {
  circleUserId: string;
  email: string;
  expiresAt: string;
  type: "email";
};

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null;
}

/** Supabase Auth client for email OTP. The anon key is enough; fall back to service role. */
function supabaseAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Email sign-in needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

/** Email a one-time sign-in code. Creates the Supabase user on first use. */
export async function sendEmailCode(email: string) {
  const { error } = await supabaseAuth().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    throw new Error(
      error.status === 429
        ? "Too many codes requested. Wait a minute and try again."
        : error.message || "The sign-in code could not be sent.",
    );
  }
}

/** Check the code and return the verified Supabase user id. */
export async function verifyEmailCode(email: string, code: string) {
  const { data, error } = await supabaseAuth().auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  if (error || !data.user?.id) {
    throw new Error("That code is invalid or has expired. Request a new one.");
  }
  return data.user.id;
}

/**
 * One account per email, whichever way someone signs in. With the flag on, a
 * new Google sign-in opens the same `sp-email-<id>` wallet as an emailed code
 * for that verified address; a Google login that already has a Circle wallet
 * (made before the change) keeps it. Off: every Google sign-in makes its own
 * Circle Google wallet, as before.
 */
export function unifiedGoogleSignInEnabled() {
  return process.env.NEXT_PUBLIC_UNIFIED_GOOGLE_SIGN_IN?.trim() === "true";
}

type GoogleTokenInfo = {
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  exp?: string;
  iss?: string;
  nonce?: string;
};

/**
 * The verified email in a Google ID token issued to SaphraONE's own Google
 * client (the one Circle's Google login uses). Checked with Google itself,
 * so a browser can't name an address it hasn't proven.
 */
export async function verifyGoogleIdToken(idToken: string, nonce?: string | null) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Google sign-in isn't configured.");
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    { cache: "no-store" },
  );
  const info = (await response.json().catch(() => ({}))) as GoogleTokenInfo;
  const email = normalizeEmail(info.email);
  const verified = info.email_verified === true || info.email_verified === "true";
  if (
    !response.ok ||
    info.aud !== clientId ||
    !["accounts.google.com", "https://accounts.google.com"].includes(info.iss ?? "") ||
    Number(info.exp ?? 0) * 1000 <= Date.now() ||
    // The browser that started the sign-in holds the nonce Google signed.
    (info.nonce && info.nonce !== nonce) ||
    !email ||
    !verified
  ) {
    throw new Error("Your Google sign-in couldn't be verified. Try again.");
  }
  return email;
}

/**
 * Whether a Circle Google login already has a wallet: an account made with
 * the old Google sign-in, which keeps opening its own wallet. Throws when
 * Circle can't say, so an existing user is never mistaken for a new one.
 */
export async function circleGoogleUserHasWallet(userToken: string) {
  const result = await circleRequest("/v1/w3s/wallets", { method: "GET", userToken });
  if (result.status >= 400) {
    throw new Error("Your Google account couldn't be checked. Try again.");
  }
  const wallets = (result.body.data as { wallets?: unknown[] } | undefined)?.wallets ?? [];
  return wallets.length > 0;
}

/**
 * The Supabase user for an email, created (already confirmed) when there is
 * none, so a Google sign-in and a later emailed code share one user, one
 * Circle user and one wallet. Needs unified-sign-in.sql.
 */
export async function supabaseUserIdForEmail(email: string) {
  const supabase = createSupabaseAdminClient();
  const lookup = async () => {
    const { data, error } = await supabase.rpc("auth_user_id_for_email", { p_email: email });
    if (error) throw new Error(error.message);
    return typeof data === "string" && data ? data : null;
  };
  const existing = await lookup();
  if (existing) return existing;
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (data.user?.id) return data.user.id;
  // Created meanwhile (two tabs, or an emailed code in flight).
  const raced = await lookup();
  if (raced) return raced;
  throw new Error(error?.message || "Your account couldn't be opened.");
}

/**
 * The wallet of an account made with the old Circle Google login for this
 * email, if any, found by the Google address saved at onboarding. An emailed
 * code can't see Google's own records, so this is how it avoids opening a
 * second, empty account for that address. Accounts on the shared email
 * wallet carry an `sp-email-` id and are never "old".
 */
export async function legacyGoogleWalletForEmail(email: string) {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from(process.env.SUPABASE_PROFILES_TABLE ?? "profiles")
      .select("wallet_address, username, circle_social_uuid")
      .eq("auth_provider", "google")
      // Case-insensitive, with _ and % matched literally (both appear in emails).
      .ilike("contact_email", email.replace(/[\\%_]/g, (char) => "\\" + char))
      .limit(5);
    if (error) return null;
    const row = ((data ?? []) as Array<{
      circle_social_uuid: string | null;
      username: string | null;
      wallet_address: string;
    }>).find(
      (profile) =>
        !isDeletedUsername(profile.username) && !profile.circle_social_uuid?.startsWith("sp-email-"),
    );
    return row?.wallet_address ?? null;
  } catch {
    return null;
  }
}

/**
 * One Circle user per verified Supabase account. Circle caps user ids at
 * 5–50 characters: "sp-email-" (9) + a UUID (36) = 45. The earlier
 * "swiftpay-email-" prefix made 51 and Circle rejected it ("API parameter
 * invalid"). Never change this format once users exist: it is how a
 * returning email user finds their wallet again.
 */
export function circleUserIdForSupabaseUser(supabaseUserId: string) {
  const id = `sp-email-${supabaseUserId}`;
  if (id.length > 50) {
    throw new Error("Circle user id would exceed 50 characters.");
  }
  return id;
}

/**
 * Create the Circle user if needed and issue a fresh user token. The PIN the
 * user sets in Circle's own screen protects every transaction; SaphraONE never
 * sees it.
 */
export async function issueCircleUserToken(circleUserId: string) {
  const created = await circleRequest("/v1/w3s/users", {
    body: { userId: circleUserId },
    method: "POST",
  });
  // 409 / 155101: the user already exists, which is the returning-user case.
  if (created.status >= 400 && created.status !== 409 && created.body.code !== 155101) {
    throw new Error(
      String(created.body.message ?? "Circle wallet account could not be created."),
    );
  }

  const token = await circleRequest("/v1/w3s/users/token", {
    body: { userId: circleUserId },
    method: "POST",
  });
  const data = token.body.data as { encryptionKey?: string; userToken?: string } | undefined;
  if (token.status >= 400 || !data?.userToken || !data.encryptionKey) {
    throw new Error(String(token.body.message ?? "Circle wallet session could not be started."));
  }
  return { encryptionKey: data.encryptionKey, userToken: data.userToken };
}

/** Wallet addresses owned by a Circle user, checked with a token SaphraONE issued itself. */
export async function listCircleUserWalletAddresses(circleUserId: string) {
  const { userToken } = await issueCircleUserToken(circleUserId);
  return listWalletAddressesForUserToken(userToken);
}

export function createEmailSessionToken(input: { circleUserId: string; email: string }) {
  const session: EmailSession = {
    circleUserId: input.circleUserId,
    email: input.email,
    expiresAt: new Date(Date.now() + emailSessionTtlMs).toISOString(),
    type: "email",
  };
  // A nonce keeps two sessions for the same user from sharing a token.
  return createSignedToken({ ...session, nonce: crypto.randomBytes(12).toString("hex") });
}

export function readEmailSession(token: string | undefined): EmailSession | null {
  const payload = readSignedToken(token) as Partial<EmailSession> | null;
  if (
    !payload ||
    payload.type !== "email" ||
    typeof payload.circleUserId !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.expiresAt !== "string" ||
    Date.parse(payload.expiresAt) <= Date.now()
  ) {
    return null;
  }
  return payload as EmailSession;
}
