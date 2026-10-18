// Server-only. Personal KYC steps and the ramp gate. When KYC is not
// required, the gate is a no-op so the existing ramp is unchanged.
import { namesMatch as businessNamesMatch } from "@/lib/business/registry-check";
import { faceMatchMin, kycLimits, livenessMin } from "@/lib/kyc/config";
import {
  countAttempts,
  countHashFails,
  findVerifiedHash,
  listAttemptsFor,
  listReviewQueue,
  loadKycProfile,
  loadKybProfile,
  recordAttempt,
  sumRampVolume,
  upsertKycProfile,
  type KycProfileRow,
} from "@/lib/kyc/db";
import { kycErrors } from "@/lib/kyc/errors";
import { kycRequired } from "@/lib/kyc/flag";
import { effectiveKybLevel, exceedsCap, fitsAllowance, remainingAllowance } from "@/lib/kyc/gate";
import { hashId, hashSecretConfigured, last4 } from "@/lib/kyc/hash";
import { beneficiaryNameMatch, dobMatches, legalName, namesMatch, normalizeNgPhone } from "@/lib/kyc/match";
import { CONSENT_TTL_MS, checkBvnConsent, consentRequiredFor, sendBvnConsent } from "@/lib/kyc/otp";
import { checkLiveness, lookupBvn, lookupNin, matchFaceToId, premblyReady } from "@/lib/kyc/prembly";
import { resetRateLimit } from "@/lib/rate-limit";

const DAY_MS = 86_400_000;
/** How long a matched record waits for the user's "Is this you?" Confirm. */
const CONFIRM_TTL_MS = 30 * 60 * 1000;

type KybLevel = "NONE" | "BASIC" | "FULL";
type RampDirection = "ONRAMP" | "OFFRAMP";

function dayAgo() {
  return new Date(Date.now() - DAY_MS).toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

/** Attempts count from 24h ago, or from when a reviewer reopened the check. */
function attemptWindow(row: KycProfileRow | null) {
  const cleared = typeof row?.flags?.review_cleared_at === "string" ? row.flags.review_cleared_at : null;
  const since = dayAgo();
  return cleared && cleared > since ? cleared : since;
}

function maskPhone(phone: string | null) {
  return phone ? phone.replace(/(\+234)(\d{3})\d+(\d{2})$/, "$1$2***$3") : null;
}

/** Flags without the short-lived iGree and confirm bookkeeping. */
function settledFlags(flags: Record<string, unknown> | undefined) {
  const rest = { ...(flags ?? {}) };
  delete rest.consent_sent_at;
  delete rest.consent_ref;
  delete rest.consent_required;
  delete rest.consent_verified_at;
  delete rest.confirm_pending_at;
  return rest;
}

/** A matched record still waiting for Confirm, within its window. */
function awaitingConfirm(row: KycProfileRow | null) {
  if (!row || row.status !== "PENDING" || !row.id_hash) return false;
  const at = typeof row.flags?.confirm_pending_at === "string" ? Date.parse(row.flags.confirm_pending_at) : Number.NaN;
  return Number.isFinite(at) && Date.now() - at <= CONFIRM_TTL_MS;
}

function publicState(row: KycProfileRow | null, used: { onrampNgn: number; offrampUsdc: number }, kybLevel: KybLevel) {
  const limits = kycLimits();
  const tier = row?.status === "VERIFIED" ? row.tier : 0;
  const allowance = remainingAllowance(tier, used, limits, kybLevel);
  return {
    available: premblyReady() && hashSecretConfigured(),
    required: kycRequired(),
    tier,
    status: row?.status ?? "NONE",
    idType: row?.id_type ?? null,
    idLast4: row?.id_last4 ?? null,
    firstName: row?.first_name ?? null,
    lastName: row?.last_name ?? null,
    middleName: row?.middle_name ?? null,
    phone: maskPhone(row?.phone_e164 ?? null),
    limits: { onrampNgn: allowance.capOnrampNgn, offrampUsdc: allowance.capOfframpUsdc },
    remainingToday: { onrampNgn: allowance.onrampNgn, offrampUsdc: allowance.offrampUsdc },
    nextTier: allowance.nextTier,
    flags: row?.flags ?? {},
  };
}

async function loadState(wallet: string, options: { personalOnly?: boolean }) {
  const owner = wallet.toLowerCase();
  const { ready, row } = await loadKycProfile(owner);
  const used = await sumRampVolume(owner, dayAgo());
  const tier = row?.status === "VERIFIED" ? row.tier : 0;
  let kybLevel: KybLevel = "NONE";
  if (!options.personalOnly) {
    // An unreadable KYB row falls back to personal limits, never higher ones.
    const kyb = await loadKybProfile(owner).catch(() => ({ ready: false as const, row: null }));
    kybLevel = effectiveKybLevel(kyb.row, tier);
  }
  return { ready, row, used, tier, kybLevel };
}

/**
 * KYC state with today's allowance. `personalOnly` drops KYB limits, for
 * payouts to the owner's own account from a business wallet.
 */
export async function getKycState(wallet: string, options: { personalOnly?: boolean } = {}) {
  const { ready, row, used, kybLevel } = await loadState(wallet, options);
  return { ready, ...publicState(row, used, kybLevel) };
}

function elevenDigits(value: unknown) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return /^\d{11}$/.test(digits) ? digits : null;
}

async function markTier1(wallet: string, patch: Partial<KycProfileRow>) {
  try {
    await upsertKycProfile(wallet, { ...patch, status: "VERIFIED", tier: 1, tier1_verified_at: nowIso() });
  } catch (error) {
    if (error instanceof Error && /duplicate key|23505/.test(error.message)) {
      throw kycErrors.conflict("This number already verifies another SaphraONE account.");
    }
    throw error;
  }
}

/**
 * Tier 1: BVN or NIN, date of birth and name, matched against the record.
 * The phone comes from the record. A match is held PENDING until the user
 * taps Confirm on "Is this you?" (confirmIdentity). With iGree on, a BVN
 * check first needs the OTP sent to the BVN's own phone (confirmConsent).
 */
export async function submitId(
  wallet: string,
  input: { type: unknown; number: unknown; dob: unknown; firstName: unknown; lastName: unknown },
) {
  if (!premblyReady() || !hashSecretConfigured()) throw kycErrors.unavailable();
  const { ready, row } = await loadKycProfile(wallet);
  if (!ready) throw kycErrors.unavailable("KYC isn't set up yet.");
  if (row?.status === "VERIFIED" && (row.tier ?? 0) >= 1) {
    return {
      ...(await getKycState(wallet)),
      consentRequired: false,
      preview: { firstName: row.first_name, lastName: row.last_name, last4: row.id_last4 },
    };
  }
  if (row?.status === "MANUAL_REVIEW") throw kycErrors.manualReview();
  if (row?.status === "REJECTED") throw kycErrors.invalid("Your verification was declined. Contact support.");

  const idType = input.type === "NIN" ? "NIN" : input.type === "BVN" ? "BVN" : null;
  const number = elevenDigits(input.number);
  if (!idType || !number) throw kycErrors.invalid("Enter the 11-digit BVN or NIN.");
  if (typeof input.dob !== "string" || typeof input.firstName !== "string" || typeof input.lastName !== "string") {
    throw kycErrors.invalid("Enter your first name, last name and date of birth.");
  }

  const idHash = hashId(idType, number);
  if (!idHash) throw kycErrors.unavailable();

  const since = attemptWindow(row);
  const failsToday = await countAttempts(wallet, "ID_LOOKUP", "FAIL", since);
  if (failsToday >= 5) {
    await upsertKycProfile(wallet, { status: "MANUAL_REVIEW" });
    throw kycErrors.manualReview();
  }
  if ((await countHashFails(idHash, since)) >= 3) {
    throw kycErrors.invalid("Too many attempts for this number. Try again tomorrow.");
  }

  if (await findVerifiedHash(idHash, wallet)) {
    await recordAttempt({ wallet, step: "ID_LOOKUP", idHash, result: "FAIL", reasonCode: "reused" });
    throw kycErrors.conflict("This number already verifies another SaphraONE account.");
  }

  // Same details again while the last match waits for Confirm (e.g. after a
  // reload): show "Is this you?" again without paying for another lookup.
  if (
    row &&
    awaitingConfirm(row) &&
    !row.flags?.consent_required &&
    row.id_type === idType &&
    row.id_hash === idHash &&
    row.dob &&
    dobMatches(input.dob, row.dob) &&
    namesMatch(`${input.firstName} ${input.lastName}`, legalName(row.first_name, row.middle_name, row.last_name))
  ) {
    return {
      ...(await getKycState(wallet)),
      consentRequired: false,
      confirmRequired: true,
      preview: { firstName: row.first_name, lastName: row.last_name, last4: row.id_last4 },
    };
  }

  const lookup = idType === "BVN" ? await lookupBvn(number) : await lookupNin(number);
  if (!lookup.ok) {
    const counts = lookup.kind === "not_found" || lookup.kind === "blocked" || lookup.kind === "rejected";
    await recordAttempt({
      wallet,
      step: "ID_LOOKUP",
      idHash,
      result: counts ? "FAIL" : "ERROR",
      reasonCode: lookup.kind,
      providerCode: lookup.code,
    });
    if (lookup.kind === "not_found") {
      throw kycErrors.invalid(idType === "BVN" ? "We couldn't find that BVN. Check the 11 digits." : "We couldn't find that NIN. Check the 11 digits.");
    }
    if (lookup.kind === "blocked") throw kycErrors.invalid(lookup.message);
    throw kycErrors.unavailable(lookup.message);
  }

  const person = lookup.data;
  if (!person.dob || !dobMatches(input.dob, person.dob)) {
    await recordAttempt({ wallet, step: "ID_LOOKUP", idHash, result: "FAIL", reasonCode: "dob", providerRef: lookup.reference });
    throw kycErrors.invalid(`Date of birth doesn't match your ${idType} record.`);
  }
  const recordName = legalName(person.firstName, person.middleName, person.lastName);
  if (!namesMatch(`${input.firstName} ${input.lastName}`, recordName)) {
    await recordAttempt({ wallet, step: "ID_LOOKUP", idHash, result: "FAIL", reasonCode: "name", providerRef: lookup.reference });
    throw kycErrors.invalid("The name doesn't match this record. Check the spelling on your ID.");
  }
  await recordAttempt({ wallet, step: "ID_LOOKUP", idHash, result: "PASS", providerRef: lookup.reference, providerCode: lookup.code });

  const identity: Partial<KycProfileRow> = {
    id_type: idType,
    id_hash: idHash,
    id_last4: last4(number),
    first_name: person.firstName,
    last_name: person.lastName,
    middle_name: person.middleName,
    dob: person.dob,
    phone_e164: person.phone ? normalizeNgPhone(person.phone) : null,
    provider_ref: lookup.reference,
  };
  const preview = { firstName: person.firstName, lastName: person.lastName, last4: last4(number) };
  const flags = settledFlags(row?.flags);

  // A watch-listed BVN is held for a person to look at, never auto-verified.
  if (person.watchlisted) {
    await upsertKycProfile(wallet, { ...identity, status: "MANUAL_REVIEW", flags: { ...flags, watchlisted: true } });
    throw kycErrors.manualReview();
  }

  if (consentRequiredFor(idType)) {
    const sent = await sendBvnConsent(number);
    await upsertKycProfile(wallet, {
      ...identity,
      status: "PENDING",
      flags: { ...flags, consent_required: true, consent_sent_at: nowIso(), consent_ref: sent.reference },
    });
    await recordAttempt({ wallet, step: "PHONE_OTP", idHash, result: "PASS", reasonCode: "sent", providerRef: sent.reference, providerCode: sent.code });
    return {
      ...(await getKycState(wallet)),
      consentRequired: true,
      consentPhone: maskPhone(identity.phone_e164 ?? null),
      preview,
    };
  }

  await upsertKycProfile(wallet, { ...identity, status: "PENDING", flags: { ...flags, confirm_pending_at: nowIso() } });
  return { ...(await getKycState(wallet)), consentRequired: false, confirmRequired: true, preview };
}

/** Finishes a BVN check with the iGree code. The client resends the BVN. */
export async function confirmConsent(wallet: string, input: { number: unknown; code: unknown }) {
  if (!premblyReady() || !hashSecretConfigured()) throw kycErrors.unavailable();
  const { row } = await loadKycProfile(wallet);
  if (row?.status === "VERIFIED" && row.tier >= 1) return getKycState(wallet);
  const sentAt = typeof row?.flags?.consent_sent_at === "string" ? Date.parse(row.flags.consent_sent_at) : Number.NaN;
  if (!row || row.status !== "PENDING" || row.id_type !== "BVN" || !row.id_hash || !Number.isFinite(sentAt)) {
    throw kycErrors.invalid("Start again with your BVN.");
  }
  if (Date.now() - sentAt > CONSENT_TTL_MS) {
    throw kycErrors.invalid("That code has expired. Check your BVN again to get a new one.");
  }
  const number = elevenDigits(input.number);
  if (!number || hashId("BVN", number) !== row.id_hash) throw kycErrors.invalid("Enter the same BVN you checked.");
  if (typeof input.code !== "string") throw kycErrors.invalid("Enter the code sent to the phone on your BVN.");

  if ((await countAttempts(wallet, "PHONE_OTP", "FAIL", attemptWindow(row))) >= 5) {
    throw kycErrors.invalid("Too many wrong codes. Try again tomorrow.");
  }
  const checked = await checkBvnConsent(number, input.code);
  if (!checked.ok) {
    await recordAttempt({ wallet, step: "PHONE_OTP", idHash: row.id_hash, result: "FAIL", reasonCode: "code", providerCode: checked.code });
    throw kycErrors.invalid("That code doesn't match. Try again.");
  }
  await upsertKycProfile(wallet, {
    phone_verified_at: nowIso(),
    otp_provider: "prembly_igree",
    flags: { ...settledFlags(row.flags), consent_required: true, consent_verified_at: nowIso(), confirm_pending_at: nowIso() },
  });
  await recordAttempt({ wallet, step: "PHONE_OTP", idHash: row.id_hash, result: "PASS", reasonCode: "verified", providerRef: checked.reference });
  return {
    ...(await getKycState(wallet)),
    confirmRequired: true,
    preview: { firstName: row.first_name, lastName: row.last_name, last4: row.id_last4 },
  };
}

/**
 * The user's answer to "Is this you?". Confirm is the only step that sets
 * Tier 1. "That's not me" clears the matched record and counts as a failed
 * attempt, since someone else's details passed the lookup.
 */
export async function confirmIdentity(wallet: string, accept: unknown) {
  if (typeof accept !== "boolean") throw kycErrors.invalid("Confirm or decline the match.");
  const { row } = await loadKycProfile(wallet);
  if (row?.status === "VERIFIED" && row.tier >= 1) return getKycState(wallet);
  if (!row || row.status !== "PENDING" || !row.id_hash || typeof row.flags?.confirm_pending_at !== "string") {
    throw kycErrors.invalid("Check your BVN or NIN first.");
  }
  if (!awaitingConfirm(row)) throw kycErrors.invalid("That check has expired. Enter your BVN or NIN again.");
  if (row.flags.consent_required && !row.flags.consent_verified_at) {
    throw kycErrors.invalid("Enter the code sent to the phone on your BVN first.");
  }

  if (!accept) {
    await upsertKycProfile(wallet, {
      status: "NONE",
      tier: 0,
      id_type: null,
      id_hash: null,
      id_last4: null,
      first_name: null,
      last_name: null,
      middle_name: null,
      dob: null,
      phone_e164: null,
      phone_verified_at: null,
      otp_provider: null,
      provider_ref: null,
      flags: settledFlags(row.flags),
    });
    await recordAttempt({ wallet, step: "ID_LOOKUP", idHash: row.id_hash, result: "FAIL", reasonCode: "not_me" });
    return getKycState(wallet);
  }

  await markTier1(wallet, { flags: settledFlags(row.flags) });
  await recordAttempt({ wallet, step: "ID_LOOKUP", idHash: row.id_hash, result: "PASS", reasonCode: "confirmed" });
  return getKycState(wallet);
}

function jpegBase64(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/^data:image\/jpeg;base64,/i, "").replace(/\s/g, "");
  if (!trimmed || trimmed.length > 2_800_000) return null;
  try {
    const bytes = Buffer.from(trimmed, "base64");
    if (bytes.length < 4 || bytes.length > 2_000_000) return null;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Tier 2. The user types their BVN or NIN again: it is never kept on the
 * server or in a cookie, only checked against the stored id_hash.
 */
export async function submitSelfie(wallet: string, image: unknown, number: unknown) {
  if (!premblyReady() || !hashSecretConfigured()) throw kycErrors.unavailable();
  const { ready, row } = await loadKycProfile(wallet);
  if (!ready || !row || row.status !== "VERIFIED" || row.tier < 1 || !row.id_type) {
    throw kycErrors.invalid("Verify your identity first.");
  }
  if (row.tier >= 2) return getKycState(wallet);

  const jpeg = jpegBase64(image);
  if (!jpeg) throw kycErrors.invalid("Take a JPEG selfie under 2 MB.");

  const digits = elevenDigits(number);
  if (!digits || !row.id_hash || hashId(row.id_type, digits) !== row.id_hash) {
    throw kycErrors.invalid(`Enter the same ${row.id_type} you verified.`);
  }

  const liveFails = await countAttempts(wallet, "LIVENESS", "FAIL", dayAgo());
  if (liveFails >= 5) throw kycErrors.manualReview();

  const liveness = await checkLiveness(jpeg);
  if (!liveness.ok) {
    await recordAttempt({ wallet, step: "LIVENESS", result: liveness.kind === "unavailable" ? "ERROR" : "FAIL", reasonCode: liveness.kind, providerCode: liveness.code });
    if (liveness.kind === "unavailable") throw kycErrors.unavailable(liveness.message);
    throw kycErrors.invalid("We couldn't confirm this is a live photo. Try again in good light.");
  }
  if (liveness.data.score < livenessMin()) {
    await recordAttempt({ wallet, step: "LIVENESS", result: "FAIL", reasonCode: "score", providerRef: liveness.reference });
    throw kycErrors.invalid("We couldn't confirm this is a live photo. Try again in good light.");
  }

  const face = await matchFaceToId(row.id_type, digits, jpeg);
  if (!face.ok) {
    await recordAttempt({ wallet, step: "FACE_MATCH", result: face.kind === "unavailable" ? "ERROR" : "FAIL", reasonCode: face.kind, providerCode: face.code });
    if (face.kind === "unavailable") throw kycErrors.unavailable(face.message);
    throw kycErrors.invalid(face.message);
  }
  if (face.data.score < faceMatchMin()) {
    await recordAttempt({ wallet, step: "FACE_MATCH", result: "FAIL", reasonCode: "score", providerRef: face.reference });
    throw kycErrors.invalid("The selfie didn't match your ID photo. Try again in good light.");
  }

  await upsertKycProfile(wallet, {
    tier: 2,
    tier2_verified_at: nowIso(),
    liveness_score: liveness.data.score,
    face_match_score: face.data.score,
    provider_ref: face.reference ?? row.provider_ref,
  });
  await recordAttempt({ wallet, step: "FACE_MATCH", result: "PASS", providerRef: face.reference, providerCode: face.code });
  return getKycState(wallet);
}

/** Which verified name a payout goes to. OWNER payouts get personal limits only. */
export type PayoutMatch = "OWNER" | "COMPANY";

/**
 * Blocks a new ramp order when KYC is required. Existing orders are not
 * passed through here. No-op when the flag is off, so today's ramp is unchanged.
 */
export async function assertRampAllowed(
  wallet: string,
  direction: RampDirection,
  amount: string,
  options: { payout?: PayoutMatch | null } = {},
) {
  if (!kycRequired()) return;
  if (!premblyReady() || !hashSecretConfigured()) {
    throw kycErrors.unavailable();
  }
  const state = await getKycState(wallet, { personalOnly: options.payout === "OWNER" });
  if (!state.ready) throw kycErrors.unavailable("KYC isn't set up yet.");
  if (state.status === "MANUAL_REVIEW") throw kycErrors.manualReview();
  if (state.tier < 1) throw kycErrors.required(1);
  const remaining = direction === "ONRAMP" ? state.remainingToday.onrampNgn : state.remainingToday.offrampUsdc;
  const value = Number(amount);
  if (!fitsAllowance(remaining, value)) {
    throw kycErrors.limitExceeded(remaining.toString(), state.nextTier, direction === "ONRAMP" ? "NGN" : "USDC");
  }
}

/**
 * Run after a new order row is saved. Two orders placed at once can both
 * pass assertRampAllowed; the saved rows settle it. Over the cap, `fail`
 * marks the order just saved as failed and the limit error is thrown.
 */
export async function settleDailyCap(
  wallet: string,
  direction: RampDirection,
  fail: () => Promise<void>,
  options: { payout?: PayoutMatch | null } = {},
) {
  if (!kycRequired()) return;
  const { used, tier, kybLevel } = await loadState(wallet, { personalOnly: options.payout === "OWNER" });
  const allowance = remainingAllowance(tier, used, kycLimits(), kybLevel);
  const over =
    direction === "ONRAMP"
      ? exceedsCap(used.onrampNgn, allowance.capOnrampNgn)
      : exceedsCap(used.offrampUsdc, allowance.capOfframpUsdc);
  if (!over) return;
  await fail();
  throw kycErrors.limitExceeded("0", allowance.nextTier, direction === "ONRAMP" ? "NGN" : "USDC");
}

export async function getVerifiedPerson(wallet: string) {
  const { row } = await loadKycProfile(wallet);
  if (!row || row.status !== "VERIFIED" || row.tier < 1) return null;
  return row;
}

/**
 * Payouts go only to accounts in the owner's verified name, or, for a
 * KYB-verified business, the company's CAC name. Null when KYC is off.
 */
export async function assertBeneficiaryMatchesKyc(wallet: string, accountName: string): Promise<PayoutMatch | null> {
  if (!kycRequired()) return null;
  const person = await getVerifiedPerson(wallet);
  if (!person) throw kycErrors.required(1);
  const kyb = await loadKybProfile(wallet).catch(() => ({ ready: false as const, row: null }));
  const companyName = kyb.row?.status === "VERIFIED" ? kyb.row.company_name : null;
  const match = beneficiaryNameMatch(
    accountName,
    legalName(person.first_name, person.middle_name, person.last_name),
    companyName,
    businessNamesMatch,
  );
  if (!match) throw kycErrors.beneficiaryNameMismatch();
  return match;
}

export async function listKycReviews(status: "MANUAL_REVIEW" | "ALL") {
  const rows = await listReviewQueue(status);
  return Promise.all(
    rows.map(async (row) => ({
      wallet: row.wallet_address,
      status: row.status,
      tier: row.tier,
      idType: row.id_type,
      idLast4: row.id_last4,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: maskPhone(row.phone_e164),
      hasIdentity: Boolean(row.id_hash && row.first_name && row.last_name && row.dob),
      flags: row.flags,
      updatedAt: row.updated_at,
      attempts: await listAttemptsFor(row.wallet_address),
    })),
  );
}

/**
 * A record reaches review after repeated failed lookups, before any
 * identity was confirmed. Approving one with no confirmed identity
 * reopens the self-serve check instead of granting Tier 1 with no name.
 */
export async function decideKyc(input: { wallet: string; decision: unknown; reason: unknown; reviewer: string }) {
  if (input.decision !== "APPROVED" && input.decision !== "REJECTED") {
    throw kycErrors.invalid("Decision must be APPROVED or REJECTED.");
  }
  const { row } = await loadKycProfile(input.wallet);
  if (!row) throw kycErrors.invalid("Submission not found.");
  if (row.status !== "MANUAL_REVIEW") throw kycErrors.invalid("This record was already decided.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (input.decision === "REJECTED" && !reason) throw kycErrors.invalid("Give a reason when rejecting.");
  const review = { reviewed_by: input.reviewer, reviewed_at: nowIso() };

  if (input.decision === "REJECTED") {
    await upsertKycProfile(input.wallet, { ...review, status: "REJECTED", tier: 0, flags: { ...row.flags, review_reason: reason } });
    return { ok: true, outcome: "REJECTED" as const };
  }
  const confirmed = Boolean(row.id_hash && row.first_name && row.last_name && row.dob);
  if (!confirmed) {
    await upsertKycProfile(input.wallet, {
      ...review,
      status: "NONE",
      tier: 0,
      flags: { ...settledFlags(row.flags), review_reason: reason || undefined, review_cleared_at: nowIso() },
    });
    // The route's 5-a-day limit would otherwise keep them out until it rolls over.
    const owner = input.wallet.toLowerCase();
    await resetRateLimit([...new Set([`kyc-identity:${input.wallet}`, `kyc-identity:${owner}`])]);
    return { ok: true, outcome: "REOPENED" as const };
  }
  await upsertKycProfile(input.wallet, {
    ...review,
    status: "VERIFIED",
    tier: Math.max(row.tier, 1),
    flags: { ...settledFlags(row.flags), review_reason: reason || undefined },
    tier1_verified_at: row.tier1_verified_at ?? nowIso(),
  });
  return { ok: true, outcome: "APPROVED" as const };
}

export { kycRequired };
