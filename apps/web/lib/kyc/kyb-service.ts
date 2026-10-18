// Server-only. Business KYB on top of personal KYC. No-op for personal wallets.
import { accountDb, accountTables } from "@/lib/account/db";
import { loadBusinessProfile } from "@/lib/account/service";
import { namesMatch as businessNamesMatch } from "@/lib/business/registry-check";
import { kycLimits } from "@/lib/kyc/config";
import {
  findVerifiedCompany,
  listAttemptsFor,
  listKybReviewQueue,
  loadKybProfile,
  recordAttempt,
  upsertKybProfile,
  type KybLevel,
} from "@/lib/kyc/db";
import { kycErrors } from "@/lib/kyc/errors";
import { effectiveKybLevel, remainingAllowance } from "@/lib/kyc/gate";
import { hashId, last4 } from "@/lib/kyc/hash";
import { signedKybDocuments } from "@/lib/kyc/kyb-documents";
import { canActForCompany, namesMatch } from "@/lib/kyc/match";
import { lookupCac, lookupTin, premblyReady } from "@/lib/kyc/prembly";
import { getVerifiedPerson } from "@/lib/kyc/service";

function nowIso() {
  return new Date().toISOString();
}

function cacActive(status: string | null) {
  if (!status) return false;
  const value = status.toLowerCase();
  return value === "active" || value === "true" || value === "a";
}

async function linkBusinessBadge(wallet: string, companyName: string, rcNumber: string) {
  const profile = await loadBusinessProfile(wallet).catch(() => null);
  if (!profile) return;
  await accountDb()
    .from("business_verification_submissions")
    .insert({
      wallet_address: wallet.toLowerCase(),
      business_name: companyName,
      country_code: "NG",
      id_type: "REGISTRATION",
      id_number: rcNumber,
      method: "AUTOMATIC",
      source: "CAC via Prembly",
      registry_name: companyName,
      registry_status: "active",
      status: "APPROVED",
      reviewed_at: nowIso(),
      reviewed_by: "CAC via Prembly",
    })
    .then(({ error }) => {
      if (error && error.code !== "23505") console.warn("[kyb] badge", error.message);
    });
  await accountDb()
    .from(accountTables.businessProfiles)
    .update({ review_status: "APPROVED", verification_status: "VERIFIED", updated_at: nowIso() })
    .eq("wallet_address", wallet.toLowerCase());
}

export async function getKybState(wallet: string) {
  const { ready, row } = await loadKybProfile(wallet);
  const limits = kycLimits();
  const person = await getVerifiedPerson(wallet);
  const level: KybLevel = effectiveKybLevel(row, person?.tier ?? 0);
  const allowance = remainingAllowance(1, { onrampNgn: 0, offrampUsdc: 0 }, limits, level);
  return {
    ready,
    available: premblyReady(),
    level,
    status: row?.status ?? "NONE",
    companyType: row?.company_type ?? null,
    rcNumber: row?.rc_number ?? null,
    companyName: row?.company_name ?? null,
    tinLast4: row?.tin_last4 ?? null,
    flags: row?.flags ?? {},
    limits: { onrampNgn: allowance.capOnrampNgn, offrampUsdc: allowance.capOfframpUsdc },
  };
}

export async function submitCac(
  wallet: string,
  input: { companyType: unknown; rcNumber: unknown; companyName?: unknown },
) {
  if (!premblyReady()) throw kycErrors.unavailable();
  const person = await getVerifiedPerson(wallet);
  if (!person) throw kycErrors.required(1);
  const companyType = input.companyType === "BN" || input.companyType === "IT" ? input.companyType : input.companyType === "RC" ? "RC" : null;
  const rcNumber = typeof input.rcNumber === "string" ? input.rcNumber.replace(/\s/g, "").toUpperCase().replace(/^(RC|BN|IT)/, "") : "";
  if (!companyType || rcNumber.length < 4) throw kycErrors.invalid("Enter the company type and registration number.");

  const profile = await loadBusinessProfile(wallet).catch(() => null);
  const businessName =
    (typeof input.companyName === "string" && input.companyName.trim()) || profile?.business_name || "";
  if (!businessName) throw kycErrors.invalid("Save your business name first.");

  if (await findVerifiedCompany(companyType, rcNumber, wallet)) {
    throw kycErrors.conflict("This company already verifies another SaphraONE business.");
  }

  const result = await lookupCac({ companyName: businessName, companyType, rcNumber });
  if (!result.ok) {
    await recordAttempt({ wallet, subject: "BUSINESS", step: "CAC_LOOKUP", result: result.kind === "unavailable" ? "ERROR" : "FAIL", reasonCode: result.kind, providerCode: result.code });
    if (result.kind === "unavailable") throw kycErrors.unavailable(result.message);
    throw kycErrors.invalid("We couldn't find that company. Check the number.");
  }
  const company = result.data;
  if (!cacActive(company.status)) {
    await recordAttempt({ wallet, subject: "BUSINESS", step: "CAC_LOOKUP", result: "FAIL", reasonCode: "inactive", providerRef: result.reference });
    throw kycErrors.invalid("CAC lists this company as inactive. Only active businesses can be verified.");
  }
  if (!company.name || !businessNamesMatch(businessName, company.name)) {
    await recordAttempt({ wallet, subject: "BUSINESS", step: "CAC_LOOKUP", result: "FAIL", reasonCode: "name", providerRef: result.reference });
    throw kycErrors.invalid("The registered name doesn't match your business profile.");
  }

  const ownerName = [person.first_name, person.middle_name, person.last_name].filter(Boolean).join(" ");
  const matched = company.people.find(
    (entry) => canActForCompany(entry.role) && (namesMatch(ownerName, entry.name) || namesMatch(entry.name, ownerName)),
  );
  const flags: Record<string, unknown> = {};
  let status: "VERIFIED" | "MANUAL_REVIEW" = "VERIFIED";
  let level: KybLevel = "BASIC";
  if (!matched) {
    status = "MANUAL_REVIEW";
    flags.no_director_match = true;
  }

  await upsertKybProfile(wallet, {
    company_type: companyType,
    rc_number: rcNumber,
    company_name: company.name,
    registration_date: company.registrationDate,
    cac_status: company.status,
    director_match: matched ? { name: matched.name, role: matched.role } : null,
    flags,
    provider_ref_cac: result.reference,
    status,
    level: status === "VERIFIED" ? level : "NONE",
  });
  await recordAttempt({
    wallet,
    subject: "BUSINESS",
    step: matched ? "DIRECTOR_MATCH" : "CAC_LOOKUP",
    result: matched ? "PASS" : "FAIL",
    reasonCode: matched ? "director" : "no_director",
    providerRef: result.reference,
  });
  if (status === "VERIFIED") await linkBusinessBadge(wallet, company.name, rcNumber);
  return getKybState(wallet);
}

export async function submitTin(wallet: string, input: { number: unknown }) {
  if (!premblyReady()) throw kycErrors.unavailable();
  const { row } = await loadKybProfile(wallet);
  if (!row || row.status !== "VERIFIED" || !row.company_name) {
    throw kycErrors.invalid("Verify the company registration first.");
  }
  if (row.company_type === "BN") {
    await upsertKybProfile(wallet, { flags: { ...row.flags, TIN_MISSING: true }, level: "BASIC" });
    return getKybState(wallet);
  }
  const number = typeof input.number === "string" ? input.number.replace(/\s/g, "") : "";
  if (number.length < 6) throw kycErrors.invalid("Enter the tax identification number.");
  const tinHash = hashId("TIN", number);
  if (!tinHash) throw kycErrors.unavailable();

  const result = await lookupTin(number);
  if (!result.ok) {
    await recordAttempt({ wallet, subject: "BUSINESS", step: "TIN_LOOKUP", result: result.kind === "unavailable" ? "ERROR" : "FAIL", reasonCode: result.kind, providerCode: result.code });
    if (result.kind === "unavailable") throw kycErrors.unavailable(result.message);
    throw kycErrors.invalid("We couldn't find that tax ID.");
  }
  if (result.data.name && !businessNamesMatch(row.company_name, result.data.name) && !namesMatch(row.company_name, result.data.name)) {
    await recordAttempt({ wallet, subject: "BUSINESS", step: "TIN_LOOKUP", result: "FAIL", reasonCode: "name", providerRef: result.reference });
    throw kycErrors.invalid("The tax ID name doesn't match the company.");
  }
  const person = await getVerifiedPerson(wallet);
  const level: KybLevel = person && person.tier >= 2 ? "FULL" : "BASIC";
  await upsertKybProfile(wallet, {
    tin_hash: tinHash,
    tin_last4: last4(number),
    tin_name: result.data.name,
    provider_ref_tin: result.reference,
    level,
  });
  await recordAttempt({ wallet, subject: "BUSINESS", step: "TIN_LOOKUP", result: "PASS", providerRef: result.reference });
  return getKybState(wallet);
}

export function companyNameOf(row: { company_name: string | null } | null) {
  return row?.company_name ?? null;
}

export async function listKybReviews(status: "MANUAL_REVIEW" | "ALL") {
  const rows = await listKybReviewQueue(status);
  return Promise.all(
    rows.map(async (row) => ({
      wallet: row.wallet_address,
      status: row.status,
      level: row.level,
      companyType: row.company_type,
      rcNumber: row.rc_number,
      companyName: row.company_name,
      cacStatus: row.cac_status,
      tinLast4: row.tin_last4,
      directorMatch: row.director_match,
      flags: row.flags,
      documents: await signedKybDocuments(row.documents),
      updatedAt: row.updated_at,
      attempts: await listAttemptsFor(row.wallet_address),
    })),
  );
}

/**
 * A business reaches review when no director matched the owner. The
 * reviewer checks the CAC record by hand; approval grants KYB basic and
 * the verified badge, the same as an automatic match.
 */
export async function decideKyb(input: { wallet: string; decision: unknown; reason: unknown; reviewer: string }) {
  if (input.decision !== "APPROVED" && input.decision !== "REJECTED") {
    throw kycErrors.invalid("Decision must be APPROVED or REJECTED.");
  }
  const { row } = await loadKybProfile(input.wallet);
  if (!row) throw kycErrors.invalid("Submission not found.");
  if (row.status !== "MANUAL_REVIEW") throw kycErrors.invalid("This record was already decided.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (input.decision === "REJECTED" && !reason) throw kycErrors.invalid("Give a reason when rejecting.");
  const approved = input.decision === "APPROVED";
  if (approved && (!row.company_name || !row.rc_number)) throw kycErrors.invalid("This record has no company to approve.");
  await upsertKybProfile(input.wallet, {
    status: approved ? "VERIFIED" : "REJECTED",
    level: approved ? "BASIC" : "NONE",
    reviewed_by: input.reviewer,
    reviewed_at: nowIso(),
    flags: { ...row.flags, review_reason: reason || undefined },
  });
  if (approved) await linkBusinessBadge(input.wallet, row.company_name!, row.rc_number!);
  return { ok: true, outcome: input.decision };
}
