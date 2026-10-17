import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAddress, isAddress } from "viem";

import { heldUsernameFor, isUsernameHeld } from "@/lib/account-deletion/retired-usernames";
import { isDeletedUsername } from "@/lib/account-deletion/rules";
import { isAppLocale } from "@/lib/locales";
import { readJsonRecord } from "@/lib/http";
import {
  accountEmailLockedMessage,
  buildUsernameCandidate,
  normalizeUsername,
  oneIdLockedMessage,
  usernameFromDisplayName,
  validateUsername,
} from "@/lib/profile-utils";
import { listWalletAddressesForUserToken } from "@/lib/circle-user-server";
import { sessionControlsWallet } from "@/lib/recurring-auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import {
  attachReferral,
  getOrCreateReferralProfile,
} from "@/lib/referral/attribution-service";
import { PARTNER_OFFER_COOKIE } from "@/lib/partners/config";
import { enrollPartnerMember, signupFingerprint } from "@/lib/partners/enroll";

export const runtime = "nodejs";

const profilesTable = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";

/**
 * What a save may no longer change: the ONE ID once onboarding is done, and
 * the contact email once set. The email column arrives with a migration, so a
 * database without it locks only the ONE ID.
 */
async function readLockedFields(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  walletAddress: string,
) {
  const withEmail = await supabase
    .from(profilesTable)
    .select("username, account_type_selected, contact_email")
    .eq("wallet_address", walletAddress)
    .maybeSingle();
  const row = (
    withEmail.error
      ? (
          await supabase
            .from(profilesTable)
            .select("username, account_type_selected")
            .eq("wallet_address", walletAddress)
            .maybeSingle()
        ).data
      : withEmail.data
  ) as { account_type_selected?: boolean | null; contact_email?: string | null; username?: string | null } | null;
  return {
    contactEmail: row?.contact_email?.trim() || null,
    onboarded: Boolean(row?.account_type_selected),
    username: row?.username ?? null,
  };
}
const maxUsernameAttempts = 20;

type EnsureProfileBody = {
  authProvider?: unknown;
  circleSocialUuid?: unknown;
  /** Circle user token proving control of `walletAddress` (Google / email users). */
  circleUserToken?: unknown;
  displayName?: unknown;
  walletAddress?: unknown;
  referralToken?: unknown;
};

type UpdateProfileBody = {
  avatarUrl?: unknown;
  bio?: unknown;
  circleSocialUuid?: unknown;
  /** Personal contact details (profiles-personal-contact.sql). */
  contactEmail?: unknown;
  country?: unknown;
  phone?: unknown;
  displayName?: unknown;
  locale?: unknown;
  username?: unknown;
  walletAddress?: unknown;
};

const profileSelect =
  "wallet_address,username,circle_social_uuid,display_name,avatar_url,bio,auth_provider,created_at,updated_at";
const maxAvatarDataUrlLength = 500_000;
const maxAvatarUrlLength = 500;
const allowedAvatarDataMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

function normalizeWallet(value: unknown) {
  if (typeof value !== "string" || !isAddress(value)) {
    return null;
  }

  return getAddress(value).toLowerCase();
}

function normalizeDisplayName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const displayName = value.trim().replace(/\s+/g, " ");

  if (!displayName || displayName.length > 80) {
    return null;
  }

  return displayName;
}

function normalizeAuthProvider(value: unknown) {
  if (value === "google" || value === "external" || value === "email") {
    return value;
  }

  return "external";
}

function normalizeCircleSocialUuid(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const socialUuid = value.trim();

  if (!socialUuid || socialUuid.length > 120) {
    return null;
  }

  return socialUuid;
}

function normalizeAvatarUrl(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Profile picture must be a valid image.");
  }

  const avatarUrl = value.trim();

  if (!avatarUrl) {
    return null;
  }

  if (avatarUrl.startsWith("data:")) {
    if (avatarUrl.length > maxAvatarDataUrlLength) {
      throw new Error("Profile picture is too large. Upload a smaller image.");
    }

    const match = avatarUrl.match(
      /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/,
    );

    if (!match || !allowedAvatarDataMimeTypes.has(match[1])) {
      throw new Error("Profile picture must be a JPG, PNG, or WebP image.");
    }

    return avatarUrl;
  }

  if (avatarUrl.length > maxAvatarUrlLength) {
    throw new Error("Profile picture URL must be 500 characters or fewer.");
  }

  let url: URL;

  try {
    url = new URL(avatarUrl);
  } catch {
    throw new Error("Profile picture must be a valid image.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Profile picture must use an http or https URL.");
  }

  return avatarUrl;
}

function readSupabaseError(error: { code?: string; message?: string } | null) {
  const message = error?.message ?? "";

  if (message.toLowerCase().includes("permission denied")) {
    return "Supabase rejected access to the profiles table. Run packages/database/supabase/profiles.sql in your Supabase SQL editor.";
  }

  if (message.toLowerCase().includes("does not exist")) {
    return "Create the profiles table with packages/database/supabase/profiles.sql before saving profile data.";
  }

  if (error?.code === "23505") {
    if (message.toLowerCase().includes("username")) {
      return "That ONE ID is already taken.";
    }

    return "A profile already exists for this wallet.";
  }

  return message || "Supabase could not save this profile.";
}

/**
 * A Circle identity is only linked to a wallet the caller has proven they
 * control: a signed wallet session for that address, or a live Circle user
 * token whose wallets include it. The link is what lets that identity pass
 * access checks for the wallet, so it can never be claimed by assertion alone.
 */
async function canLinkCircleIdentity(walletAddress: string, circleUserToken: unknown) {
  if (await sessionControlsWallet(walletAddress)) {
    return true;
  }
  if (typeof circleUserToken !== "string" || !circleUserToken.trim()) {
    return false;
  }
  try {
    const owned = await listWalletAddressesForUserToken(circleUserToken.trim());
    return owned.includes(walletAddress.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Only a signed wallet session for this address may edit its profile. Profiles
 * used to be editable with no session at all for external wallets, which let
 * anyone rename a user and take over their @username for incoming payments.
 */
async function assertProfileOwnership(input: { walletAddress: string }) {
  return sessionControlsWallet(input.walletAddress);
}

/**
 * The profile as the API returns it. `circle_social_uuid` identifies the
 * user's Circle login and never leaves the server.
 */
function publicProfile<T extends Record<string, unknown> | null>(profile: T) {
  if (!profile) return profile;
  const { circle_social_uuid: _hidden, ...rest } = profile;
  return rest;
}

async function releaseCircleSocialUuid(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  circleSocialUuid: string,
  keepWalletAddress?: string,
) {
  let query = supabase
    .from(profilesTable)
    .update({
      circle_social_uuid: null,
      updated_at: new Date().toISOString(),
    })
    .eq("circle_social_uuid", circleSocialUuid);

  if (keepWalletAddress) {
    query = query.neq("wallet_address", keepWalletAddress);
  }

  const mutation = await query;

  if (mutation.error) {
    throw new Error(readSupabaseError(mutation.error));
  }
}

async function findAvailableUsername(
  walletAddress: string,
  preferred?: string | null,
) {
  const fallbacks = Array.from({ length: maxUsernameAttempts }, (_, attempt) =>
    buildUsernameCandidate(walletAddress, attempt),
  );
  const candidates = preferred ? [preferred, ...fallbacks] : fallbacks;

  const supabase = createSupabaseAdminClient();

  for (const candidate of candidates) {
    const validationError = validateUsername(candidate);

    if (validationError) {
      continue;
    }

    const existing = await supabase
      .from(profilesTable)
      .select("wallet_address")
      .ilike("username", candidate)
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      throw new Error(readSupabaseError(existing.error));
    }

    // A deleted account's name stays held for anyone but its own wallet.
    if (!existing.data && !(await isUsernameHeld(candidate, walletAddress))) {
      return candidate;
    }
  }

  throw new Error("Could not generate a unique username.");
}

export async function GET(request: NextRequest) {
  const rawWallet = request.nextUrl.searchParams.get("wallet");
  const usernameParam = request.nextUrl.searchParams.get("username");

  if (!rawWallet && !usernameParam) {
    return jsonError(
      "A wallet or username query parameter is required.",
      400,
    );
  }

  if (rawWallet && usernameParam) {
    return jsonError("Provide either wallet or username, not both.", 400);
  }

  try {
    const supabase = createSupabaseAdminClient();

    if (usernameParam) {
      const username = normalizeUsername(usernameParam);
      const validationError = validateUsername(username);

      if (validationError) {
        return jsonError(validationError, 400);
      }

      const { data, error } = await supabase
        .from(profilesTable)
        .select(profileSelect)
        .ilike("username", username)
        .limit(1)
        .maybeSingle();

      if (error) {
        return jsonError(readSupabaseError(error), 500);
      }

      if (!data) {
        return jsonError("Profile not found.", 404);
      }

      return NextResponse.json({ profile: publicProfile(data) });
    }

    const walletAddress = normalizeWallet(rawWallet);
    if (!walletAddress) {
      return jsonError("A valid wallet address is required.", 400);
    }

    const { data, error } = await supabase
      .from(profilesTable)
      .select(profileSelect)
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (error) {
      return jsonError(readSupabaseError(error), 500);
    }

    // An erased account's row is kept for its records; it's not a profile.
    if (!data || isDeletedUsername(data.username)) {
      return jsonError("Profile not found.", 404);
    }

    return NextResponse.json({ profile: publicProfile(data) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Profile could not be loaded.";

    return jsonError(message, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRecord<EnsureProfileBody>(request);

    if (!body) {
      return jsonError("A valid JSON body is required.", 400);
    }

    const walletAddress = normalizeWallet(body.walletAddress);

    if (!walletAddress) {
      return jsonError("A valid wallet address is required.", 400);
    }

    const authProvider = normalizeAuthProvider(body.authProvider);
    const requestedCircleSocialUuid = normalizeCircleSocialUuid(body.circleSocialUuid);
    const displayName = normalizeDisplayName(body.displayName);

    const supabase = createSupabaseAdminClient();
    const existing = await supabase
      .from(profilesTable)
      .select(profileSelect)
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (existing.error) {
      return jsonError(readSupabaseError(existing.error), 500);
    }

    // Only verify (a Circle round trip) when the request would change a link.
    const circleSocialUuid =
      requestedCircleSocialUuid &&
      existing.data?.circle_social_uuid !== requestedCircleSocialUuid &&
      (await canLinkCircleIdentity(walletAddress, body.circleUserToken))
        ? requestedCircleSocialUuid
        : null;

    // The wallet's account was deleted: signing in again starts a new, empty
    // account on the kept row (payments and invoices still point at it).
    if (existing.data && isDeletedUsername(existing.data.username)) {
      if (!(await canLinkCircleIdentity(walletAddress, body.circleUserToken))) {
        return jsonError("Sign in with this wallet before creating a SaphraONE profile.", 401);
      }
      if (circleSocialUuid) {
        await releaseCircleSocialUuid(supabase, circleSocialUuid, walletAddress);
      }
      const revived = await supabase
        .from(profilesTable)
        .update({
          account_type_selected: false,
          auth_provider: authProvider,
          circle_social_uuid: circleSocialUuid,
          display_name: displayName,
          onboarding_completed_at: null,
          tour_completed_at: null,
          updated_at: new Date().toISOString(),
          // Their old @name back, when it's still held for this wallet.
          username: await findAvailableUsername(
            walletAddress,
            (await heldUsernameFor(walletAddress)) ?? usernameFromDisplayName(displayName),
          ),
        })
        .eq("wallet_address", walletAddress)
        .select(profileSelect)
        .single();

      if (revived.error) {
        return jsonError(readSupabaseError(revived.error), 500);
      }

      return NextResponse.json({ profile: publicProfile(revived.data) });
    }

    if (existing.data) {
      const updates: Record<string, string | null> = {};

      if (
        circleSocialUuid &&
        existing.data.circle_social_uuid !== circleSocialUuid
      ) {
        await releaseCircleSocialUuid(
          supabase,
          circleSocialUuid,
          walletAddress,
        );
        updates.circle_social_uuid = circleSocialUuid;
      }

      if (displayName && !existing.data.display_name) {
        updates.display_name = displayName;
      }

      if (authProvider !== "external" && existing.data.auth_provider !== authProvider) {
        updates.auth_provider = authProvider;
      }

      // Changing an existing profile needs the same proof as creating one:
      // naming a wallet is not enough to set its name or sign-in method.
      if (
        Object.keys(updates).length > 0 &&
        (circleSocialUuid ||
          (await canLinkCircleIdentity(walletAddress, body.circleUserToken)))
      ) {
        updates.updated_at = new Date().toISOString();
        const mutation = await supabase
          .from(profilesTable)
          .update(updates)
          .eq("wallet_address", walletAddress)
          .select(profileSelect)
          .single();

        if (mutation.error) {
          return jsonError(readSupabaseError(mutation.error), 500);
        }

        return NextResponse.json({ profile: publicProfile(mutation.data) });
      }

      return NextResponse.json({ profile: publicProfile(existing.data) });
    }

    // A new account is only ever made for someone who has proven they own
    // the wallet: a signed wallet session, or a Circle login that holds it.
    // Naming a wallet is not enough — otherwise connecting a wallet to pay an
    // invoice (or anyone who knows an address) could quietly register it, and
    // the owner would never meet SaphraONE as a new user.
    if (!(await canLinkCircleIdentity(walletAddress, body.circleUserToken))) {
      return jsonError("Sign in with this wallet before creating a SaphraONE profile.", 401);
    }

    if (circleSocialUuid) {
      await releaseCircleSocialUuid(supabase, circleSocialUuid, walletAddress);
    }

    const username = await findAvailableUsername(
      walletAddress,
      usernameFromDisplayName(displayName),
    );
    const profile = {
      auth_provider: authProvider,
      circle_social_uuid: circleSocialUuid,
      display_name: displayName,
      updated_at: new Date().toISOString(),
      username,
      wallet_address: walletAddress,
    };
    const mutation = await supabase
      .from(profilesTable)
      .insert(profile)
      .select(profileSelect)
      .single();

    // Several parts of the app ensure the profile on a first sign-in, so two
    // creates for the same wallet can race. The loser hits the wallet's unique
    // key; the profile it wanted now exists, so return it instead of an error.
    if (
      mutation.error?.code === "23505" &&
      !(mutation.error.message ?? "").toLowerCase().includes("username")
    ) {
      const created = await supabase
        .from(profilesTable)
        .select(profileSelect)
        .eq("wallet_address", walletAddress)
        .maybeSingle();

      if (created.data) {
        return NextResponse.json({ profile: publicProfile(created.data) });
      }
    }

    if (mutation.error) {
      return jsonError(readSupabaseError(mutation.error), 500);
    }

    // Automatically initialize referral profile and attribute referrer if invited
    try {
      await getOrCreateReferralProfile(walletAddress);

      const cookieStore = await cookies();
      const cookieReferralToken = cookieStore.get("saphra_referral_token")?.value;
      const referralToken =
        typeof body.referralToken === "string" && body.referralToken.trim()
          ? body.referralToken.trim()
          : cookieReferralToken;

      if (referralToken) {
        const referral = await attachReferral({
          referrerTokenOrUsername: referralToken,
          referredWallet: walletAddress,
          accountType: "PERSONAL",
          metadata: {
            source: "profile_creation",
            timestamp: new Date().toISOString(),
          },
        });

        // Signed up through a creator's link (/join/<code>): the welcome package.
        const offerCode = cookieStore.get(PARTNER_OFFER_COOKIE)?.value;
        if (offerCode) {
          await enrollPartnerMember({
            agentHash: signupFingerprint(request.headers.get("user-agent")),
            ipHash: signupFingerprint(
              request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip"),
            ),
            offerCode: decodeURIComponent(offerCode),
            referral,
            wallet: walletAddress,
          });
        }
      }
    } catch (referralErr) {
      // Log without failing profile creation
      console.warn("Referral bootstrap warning on profile create:", referralErr);
    }

    return NextResponse.json({ profile: publicProfile(mutation.data) }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Profile could not be created.";

    return jsonError(message, 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await readJsonRecord<UpdateProfileBody>(request);

    if (!body) {
      return jsonError("A valid JSON body is required.", 400);
    }

    const walletAddress = normalizeWallet(body.walletAddress);
    const hasUsername =
      typeof body.username === "string" && body.username.trim().length > 0;
    const username = hasUsername
      ? normalizeUsername(body.username as string)
      : "";
    const locale =
      typeof body.locale === "string" && isAppLocale(body.locale)
        ? body.locale
        : null;
    const validationError = hasUsername ? validateUsername(username) : null;
    let avatarUrl: string | null | undefined;

    try {
      avatarUrl = normalizeAvatarUrl(body.avatarUrl);
    } catch (error) {
      return jsonError(
        error instanceof Error
          ? error.message
          : "Profile picture must be a valid image.",
        400,
      );
    }

    if (!walletAddress) {
      return jsonError("A valid wallet address is required.", 400);
    }

    if (hasUsername && validationError) {
      return jsonError(validationError, 400);
    }

    const canEdit = await assertProfileOwnership({ walletAddress });

    if (!canEdit) {
      return jsonError(
        "Connect the active wallet profile before editing your profile.",
        401,
      );
    }

    const supabase = createSupabaseAdminClient();
    const updates: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    };

    // The ONE ID (once onboarding is done) and the account email (once set)
    // are locked: only the team changes them. Sending the same value again,
    // as Settings does on every save, is fine.
    const current = await readLockedFields(supabase, walletAddress);
    if (
      hasUsername &&
      current.onboarded &&
      current.username &&
      username !== normalizeUsername(current.username)
    ) {
      return jsonError(oneIdLockedMessage, 403);
    }
    if (typeof body.contactEmail === "string" || body.contactEmail === null) {
      const nextEmail =
        typeof body.contactEmail === "string" ? body.contactEmail.trim().toLowerCase() : "";
      if (current.contactEmail && nextEmail !== current.contactEmail.toLowerCase()) {
        return jsonError(accountEmailLockedMessage, 403);
      }
    }

    if (hasUsername) {
      if (await isUsernameHeld(username, walletAddress)) {
        return jsonError("That ONE ID isn't available. Try another.", 409);
      }
      updates.username = username;
    }

    if (locale) {
      updates.locale = locale;
    }

    if (avatarUrl !== undefined) {
      updates.avatar_url = avatarUrl;
    }

    if (typeof body.bio === "string") {
      updates.bio = body.bio.trim().slice(0, 160) || null;
    } else if (body.bio === null) {
      updates.bio = null;
    }

    // The full name is what the top bar shows, so clearing it is allowed.
    if (typeof body.displayName === "string") {
      const nextDisplayName = normalizeDisplayName(body.displayName);

      if (body.displayName.trim() && !nextDisplayName) {
        return jsonError("Full name must be 80 characters or fewer.", 400);
      }

      updates.display_name = nextDisplayName;
    } else if (body.displayName === null) {
      updates.display_name = null;
    }

    // Personal contact details. Email and phone stay private; country is
    // public. Sent only by Settings, so other callers never touch them.
    let touchesContact = false;
    for (const [field, column, max] of [
      ["contactEmail", "contact_email", 160],
      ["country", "country", 80],
      ["phone", "phone", 32],
    ] as const) {
      const value = body[field];
      if (value === undefined) continue;
      touchesContact = true;
      const text = typeof value === "string" ? value.trim() : "";
      if (text.length > max) {
        return jsonError(`That ${field === "contactEmail" ? "email" : field} is too long.`, 400);
      }
      if (field === "contactEmail" && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        return jsonError("Enter a valid contact email.", 400);
      }
      updates[column] = text ? (field === "contactEmail" ? text.toLowerCase() : text) : null;
    }

    const mutation = await supabase
      .from(profilesTable)
      .update(updates)
      .eq("wallet_address", walletAddress)
      .select(profileSelect)
      .single();

    if (mutation.error) {
      // The contact columns arrive with a migration; say so plainly.
      if (touchesContact && /contact_email|country|phone|column/i.test(mutation.error.message ?? "")) {
        return jsonError(
          "Contact details can't be saved yet: run packages/database/supabase/profiles-personal-contact.sql in Supabase first.",
          409,
        );
      }
      return jsonError(readSupabaseError(mutation.error), 500);
    }

    return NextResponse.json({ profile: publicProfile(mutation.data) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Profile could not be updated.";

    return jsonError(message, 500);
  }
}

