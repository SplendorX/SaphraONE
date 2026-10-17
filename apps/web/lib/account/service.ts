import { randomBytes } from "node:crypto";
import { getAddress, isAddress } from "viem";

import { loadAccount, requireAuthenticatedAccount, requireBusinessAccount } from "@/lib/account/auth";
import { accountDb, accountTables, readAccountDbError } from "@/lib/account/db";
import { accountErrors } from "@/lib/account/errors";
import { moneyNumber, parseMoney, roundMoney } from "@/lib/account/money";
import { verifyInvoiceTransfer } from "@/lib/account/verify-invoice-payment";
import { businessVerificationStatus, readReviewStatus } from "@/lib/business/verification";
import { annualVolumeBands, employeeBands } from "@/lib/business-categories";
import { arcTokens } from "@/lib/tokens";
import type {
  AccountType,
  BusinessAccountProfile,
  BusinessAsset,
  InvoiceItemInput,
  InvoiceItemRecord,
  InvoiceRecord,
  InvoiceStatus,
  InvoiceSummary,
  InvoiceWithItems,
} from "@/lib/account/types";
import { checkoutEnabled } from "@/lib/checkout/flag";
import { chargeSummary } from "@/lib/checkout/summary";
import { sendInvoiceEmail } from "@/lib/email/invoice-email";
import { createSavingsNotificationResult } from "@/lib/save/notifications";
import {
  accountEmailLockedMessage,
  normalizeUsername,
  oneIdLockedMessage,
  validateUsername,
} from "@/lib/profile-utils";
import { checkUsernameAvailability } from "@/lib/account/username-availability";
import { findCountry } from "@/lib/countries";

function nowIso() {
  return new Date().toISOString();
}

function optionalText(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, max);
}

function isAsset(value: unknown): value is BusinessAsset {
  return value === "USDC" || value === "EURC";
}

async function writeHistory(input: {
  actorWallet: string;
  newType: AccountType;
  previousType: AccountType;
  reason: "USER_ONBOARDING" | "USER_UPGRADE";
  wallet: string;
}) {
  const supabase = accountDb();
  await supabase.from(accountTables.history).insert({
    actor_wallet: input.actorWallet,
    created_at: nowIso(),
    metadata: {},
    new_type: input.newType,
    previous_type: input.previousType,
    reason: input.reason,
    wallet_address: input.wallet,
  });
}

export async function getAccountState(input: {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
}) {
  const { account, actorWallet } = await requireAuthenticatedAccount(input);
  const profile =
    account.account_type === "BUSINESS"
      ? await syncBusinessVerification(await loadBusinessProfile(actorWallet))
      : null;
  return { account, profile };
}

/**
 * Keeps a stored status honest: a business verified under an older, looser
 * rule — or whose profile has since lost a field — is re-checked on load.
 */
export async function syncBusinessVerification(profile: BusinessAccountProfile | null) {
  if (!profile) return profile;
  const status = businessProfileVerificationStatus(profile);
  if (status === profile.verification_status) return profile;
  await accountDb()
    .from(accountTables.businessProfiles)
    .update({ verification_status: status })
    .eq("wallet_address", profile.wallet_address.toLowerCase());
  return { ...profile, verification_status: status };
}

/** A stored business profile's status: complete profile + approved review. */
export function businessProfileVerificationStatus(profile: BusinessAccountProfile) {
  return businessVerificationStatus(
    {
      businessName: profile.business_name,
      category: profile.category,
      contactEmail: profile.contact_email,
      country: profile.country,
      description: profile.description,
      logoUrl: profile.logo_url,
      phone: profile.phone,
      website: profile.website,
    },
    readReviewStatus(profile.review_status),
  );
}

export async function loadBusinessProfile(wallet: string) {
  const supabase = accountDb();
  const { data, error } = await supabase
    .from(accountTables.businessProfiles)
    .select("*")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();
  if (error) {
    throw new Error(readAccountDbError(error, "Could not load the business profile."));
  }
  return (data as BusinessAccountProfile | null) ?? null;
}

async function upsertBusinessProfile(
  wallet: string,
  input: {
    businessName: string;
    category?: string | null;
    contactEmail?: string | null;
    country?: string | null;
    currency?: BusinessAsset;
    description?: string | null;
    logoUrl?: string | null;
    phone?: string | null;
    website?: string | null;
  },
) {
  const name = input.businessName.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) {
    throw accountErrors.invalid("Enter a business name up to 80 characters.");
  }
  const current = await loadBusinessProfile(wallet);
  const existingPhone = input.phone === undefined ? current?.phone : input.phone;
  // An approval vouches for the name that was checked. Renaming the business
  // (or moving it to another country) means it has to be verified again.
  const storedReview = current?.review_status;
  const identityChanged = Boolean(
    current &&
      (current.business_name.trim().toLowerCase() !== name.toLowerCase() ||
        (current.country ?? "") !== (input.country ?? current.country ?? "")),
  );
  const review =
    storedReview !== undefined && identityChanged && readReviewStatus(storedReview) !== "NONE"
      ? "NONE"
      : readReviewStatus(storedReview);
  // Complete profile + approved review — see verification.ts.
  const verificationStatus = businessVerificationStatus(
    {
      businessName: name,
      category: input.category,
      contactEmail: input.contactEmail,
      country: input.country,
      description: input.description,
      logoUrl: input.logoUrl,
      phone: existingPhone,
      website: input.website,
    },
    review,
  );
  const payload = {
    // Only written when the column exists (business-verification-reviews.sql).
    ...(storedReview !== undefined && review !== readReviewStatus(storedReview)
      ? { review_status: review }
      : {}),
    business_name: name,
    category: input.category ?? null,
    contact_email: input.contactEmail ?? null,
    country: input.country ?? null,
    currency: input.currency ?? "USDC",
    description: input.description ?? null,
    logo_url: input.logoUrl ?? null,
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    updated_at: nowIso(),
    verification_status: verificationStatus,
    wallet_address: wallet.toLowerCase(),
    website: input.website ?? null,
  };
  const supabase = accountDb();
  const existing = await loadBusinessProfile(wallet);
  if (existing) {
    const mutation = await supabase
      .from(accountTables.businessProfiles)
      .update(payload)
      .eq("wallet_address", wallet.toLowerCase())
      .select("*")
      .single();
    if (mutation.error) {
      throw new Error(readAccountDbError(mutation.error, "Could not update the business profile."));
    }
    return mutation.data as BusinessAccountProfile;
  }
  const created = await supabase
    .from(accountTables.businessProfiles)
    .insert({ ...payload, created_at: nowIso() })
    .select("*")
    .single();
  if (created.error) {
    throw new Error(readAccountDbError(created.error, "Could not create the business profile."));
  }
  return created.data as BusinessAccountProfile;
}

async function setAccountType(input: {
  actorWallet: string;
  newType: AccountType;
  previousType: AccountType;
  reason: "USER_ONBOARDING" | "USER_UPGRADE";
  wallet: string;
}) {
  if (input.previousType === "BUSINESS" && input.newType === "PERSONAL") {
    throw accountErrors.invalidTransition();
  }
  const supabase = accountDb();
  let mutation = await supabase
    .from(accountTables.profiles)
    .update({
      account_type: input.newType,
      account_type_selected: true,
      account_upgraded_at: input.newType === "BUSINESS" ? nowIso() : null,
      updated_at: nowIso(),
    })
    .eq("wallet_address", input.wallet);
  if (mutation.error && /account_type/i.test(mutation.error.message ?? "")) {
    mutation = await supabase
      .from(accountTables.profiles)
      .update({
        account_type_selected: true,
        updated_at: nowIso(),
      })
      .eq("wallet_address", input.wallet);
  }
  if (mutation.error) {
    throw new Error(readAccountDbError(mutation.error, "Could not update account type."));
  }
  if (input.previousType !== input.newType) {
    try {
      await writeHistory(input);
    } catch {
      // Ignore history write error if table is unmigrated
    }
  }
}

export async function completeAccountOnboarding(input: {
  accountKind: "personal" | "business";
  bio?: string | null;
  businessCategory?: string | null;
  businessDescription?: string | null;
  businessName?: string;
  circleSocialUuid?: unknown;
  /** The Google / email sign-in address, used as the starting contact email. */
  contactEmail?: unknown;
  /** Required: the account is set up for this country's region. */
  country?: string | null;
  fullName?: string | null;
  locale: string;
  logoUrl?: string | null;
  ownerWallet: string;
  username: string;
  website?: string | null;
}) {
  const { account, actorWallet } = await requireAuthenticatedAccount({
    circleSocialUuid: input.circleSocialUuid,
    ownerWallet: input.ownerWallet,
  });
  const username = normalizeUsername(input.username);
  // Onboarding sets the ONE ID once; running it again can't swap it.
  if (
    account.account_type_selected &&
    account.username &&
    username !== normalizeUsername(account.username)
  ) {
    throw accountErrors.invalid(oneIdLockedMessage);
  }
  const usernameError = validateUsername(username);
  if (usernameError) throw accountErrors.invalid(usernameError);
  const availability = await checkUsernameAvailability(username, actorWallet);
  if (!availability.available) throw accountErrors.invalid(availability.message);
  const country = findCountry(input.country);
  if (!country) throw accountErrors.invalid("Choose your country.");
  const targetType: AccountType = input.accountKind === "business" ? "BUSINESS" : "PERSONAL";
  // The full name is what the top bar shows for a personal account.
  const fullName =
    typeof input.fullName === "string"
      ? input.fullName.trim().replace(/\s+/g, " ").slice(0, 80)
      : "";
  const supabase = accountDb();

  const profileUpdates: Record<string, unknown> = {
    account_type: targetType,
    account_type_selected: true,
    account_upgraded_at: targetType === "BUSINESS" ? nowIso() : null,
    bio: typeof input.bio === "string" ? input.bio.trim().slice(0, 160) || null : account.bio,
    country: country.name,
    locale: input.locale || account.locale,
    onboarding_completed_at: nowIso(),
    updated_at: nowIso(),
    username,
    ...(fullName ? { display_name: fullName } : {}),
  };

  let profileMutation = await supabase
    .from(accountTables.profiles)
    .update(profileUpdates)
    .eq("wallet_address", actorWallet);

  if (profileMutation.error && /account_type/i.test(profileMutation.error.message ?? "")) {
    delete profileUpdates.account_type;
    delete profileUpdates.account_upgraded_at;
    profileMutation = await supabase
      .from(accountTables.profiles)
      .update(profileUpdates)
      .eq("wallet_address", actorWallet);
  }

  if (profileMutation.error) {
    throw new Error(readAccountDbError(profileMutation.error, "Could not finish onboarding."));
  }

  if (input.accountKind === "business") {
    await upsertBusinessProfile(actorWallet, {
      businessName: input.businessName ?? "",
      category: input.businessCategory ?? null,
      contactEmail: contactEmailFrom(input.contactEmail),
      country: country.name,
      description: input.businessDescription ?? null,
      logoUrl: input.logoUrl ?? null,
      website: input.website ?? null,
    });
  }

  if (account.account_type !== targetType) {
    try {
      await writeHistory({
        actorWallet,
        newType: targetType,
        previousType: account.account_type,
        reason: "USER_ONBOARDING",
        wallet: actorWallet,
      });
    } catch {
      // Ignore history write error if table is unmigrated
    }
  }

  return getAccountState({
    circleSocialUuid: input.circleSocialUuid,
    ownerWallet: actorWallet,
  });
}

/** A contact email from sign-in, when it is a plausible address. */
function contactEmailFrom(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160 ? email : null;
}

export async function upgradeToBusiness(input: {
  businessCategory?: string | null;
  businessDescription?: string | null;
  businessName: string;
  /** The Google / email sign-in address, used as the starting contact email. */
  contactEmail?: unknown;
  circleSocialUuid?: unknown;
  confirmed: boolean;
  logoUrl?: string | null;
  ownerWallet: string;
  website?: string | null;
}) {
  if (!input.confirmed) {
    throw accountErrors.invalid("Confirm that this upgrade cannot be reversed.");
  }
  const { account, actorWallet } = await requireAuthenticatedAccount(input);
  if (account.account_type === "BUSINESS") {
    throw accountErrors.alreadyBusiness();
  }
  await upsertBusinessProfile(actorWallet, {
    businessName: input.businessName,
    category: input.businessCategory ?? null,
    contactEmail: contactEmailFrom(input.contactEmail),
    description: input.businessDescription ?? null,
    logoUrl: input.logoUrl ?? null,
    website: input.website ?? null,
  });
  await setAccountType({
    actorWallet,
    newType: "BUSINESS",
    previousType: "PERSONAL",
    reason: "USER_UPGRADE",
    wallet: actorWallet,
  });
  return getAccountState({
    circleSocialUuid: input.circleSocialUuid,
    ownerWallet: actorWallet,
  });
}

export async function updateBusinessAccountProfile(input: {
  addressLine?: unknown;
  businessName?: unknown;
  category?: unknown;
  circleSocialUuid?: unknown;
  contactEmail?: unknown;
  country?: unknown;
  currency?: unknown;
  description?: unknown;
  industry?: unknown;
  logoUrl?: unknown;
  ownerWallet: unknown;
  phone?: unknown;
  website?: unknown;
  businessSize?: unknown;
  annualVolume?: unknown;
  yearFounded?: unknown;
}) {
  const { actorWallet } = await requireBusinessAccount(input);
  const current = await loadBusinessProfile(actorWallet);
  if (!current) throw accountErrors.profileRequired();
  // The account email is set once; only the team changes it after that.
  const nextEmail = optionalText(input.contactEmail, 160);
  if (
    current.contact_email &&
    nextEmail &&
    nextEmail.trim().toLowerCase() !== current.contact_email.trim().toLowerCase()
  ) {
    throw accountErrors.invalid(accountEmailLockedMessage);
  }
  const next = await upsertBusinessProfile(actorWallet, {
    businessName:
      typeof input.businessName === "string" && input.businessName.trim()
        ? input.businessName
        : current.business_name,
    category: optionalText(input.category, 80) ?? current.category,
    contactEmail: optionalText(input.contactEmail, 160) ?? current.contact_email,
    country: optionalText(input.country, 80) ?? current.country,
    currency: isAsset(input.currency) ? input.currency : current.currency,
    description: optionalText(input.description, 280) ?? current.description,
    logoUrl: optionalText(input.logoUrl, 500_000) ?? current.logo_url,
    // Saved with the rest, so it counts toward verification in the same write.
    phone: optionalText(input.phone, 40) ?? current.phone,
    website: optionalText(input.website, 160) ?? current.website,
  });
  const supabase = accountDb();
  await supabase
    .from(accountTables.businessProfiles)
    .update({
      address_line: optionalText(input.addressLine, 160) ?? current.address_line,
      industry: optionalText(input.industry, 80) ?? current.industry,
      updated_at: nowIso(),
    })
    .eq("wallet_address", actorWallet);

  // Optional details. Sent as "" to clear; left out to keep what's saved.
  const details: Record<string, unknown> = {};
  if (input.businessSize !== undefined) {
    details.business_size = readBand(input.businessSize, employeeBands, "employee band");
  }
  if (input.annualVolume !== undefined) {
    details.annual_volume = readBand(input.annualVolume, annualVolumeBands, "annual volume");
  }
  if (input.yearFounded !== undefined) {
    details.year_founded = readYearFounded(input.yearFounded);
  }
  if (Object.keys(details).length > 0) {
    const saved = await supabase
      .from(accountTables.businessProfiles)
      .update(details)
      .eq("wallet_address", actorWallet);
    if (saved.error) {
      if (/year_founded|annual_volume/.test(saved.error.message ?? "")) {
        throw accountErrors.invalid(
          "Year founded and annual volume can't be saved yet: run packages/database/supabase/business-profile-details.sql.",
        );
      }
      throw new Error(readAccountDbError(saved.error, "Could not save the business details."));
    }
  }
  return loadBusinessProfile(actorWallet) ?? next;
}

function moneyOrZero(value: unknown) {
  if (value == null || value === "") return parseMoney("0");
  return parseMoney(value);
}

function totalsFromItems(items: InvoiceItemInput[]) {
  if (items.length === 0) {
    throw accountErrors.invalid("Add at least one invoice item.");
  }
  const computedItems = items.map((item) => {
    const description = item.description.trim();
    if (!description) throw accountErrors.invalid("Each item needs a description.");
    const quantity = moneyNumber(parseMoney(item.quantity || "1"));
    const unitPrice = moneyNumber(moneyOrZero(item.unitPrice));
    const discount = moneyNumber(moneyOrZero(item.discount));
    const tax = moneyNumber(moneyOrZero(item.tax));
    if (quantity <= 0) throw accountErrors.invalid("Quantity must be greater than zero.");
    const line = quantity * unitPrice;
    if (discount > line + 0.0000001) {
      throw accountErrors.invalid("A line discount cannot exceed the line amount.");
    }
    const total = Math.max(0, line - discount + tax);
    return {
      description: description.slice(0, 160),
      discount: roundMoney(discount),
      quantity: roundMoney(quantity),
      tax: roundMoney(tax),
      total: roundMoney(total),
      unit_price: roundMoney(unitPrice),
    };
  });
  const subtotal = computedItems.reduce(
    (sum, item) => sum + moneyNumber(item.quantity) * moneyNumber(item.unit_price),
    0,
  );
  const discount = computedItems.reduce((sum, item) => sum + moneyNumber(item.discount), 0);
  const tax = computedItems.reduce((sum, item) => sum + moneyNumber(item.tax), 0);
  const total = Math.max(0, subtotal - discount + tax);
  return {
    discount: roundMoney(discount),
    items: computedItems,
    subtotal: roundMoney(subtotal),
    tax: roundMoney(tax),
    total: roundMoney(total),
  };
}

async function findWalletByUsername(username: string) {
  const handle = username.trim().replace(/^@+/, "").replace(/\.one$/i, "").toLowerCase();
  if (!handle) return null;
  const supabase = accountDb();
  const { data, error } = await supabase
    .from(accountTables.profiles)
    .select("wallet_address,username")
    .ilike("username", handle)
    .maybeSingle();
  if (error) {
    throw new Error(readAccountDbError(error, "Could not look up that ONE ID."));
  }
  return (data as { username: string; wallet_address: string } | null) ?? null;
}

async function allocatePublicId(invoiceNumber: string) {
  const supabase = accountDb();
  const existing = await supabase
    .from(accountTables.invoices)
    .select("id")
    .eq("public_id", invoiceNumber)
    .maybeSingle();
  if (existing.error) {
    throw new Error(readAccountDbError(existing.error, "Could not allocate an invoice link."));
  }
  if (!existing.data) return invoiceNumber;
  return `${invoiceNumber}-${randomBytes(3).toString("hex")}`;
}

/**
 * The next automatic number: one past the highest INV-<digits> this business
 * has used. The highest, not the latest, so a custom number in between (say
 * INV-SPRING) never restarts the sequence at INV-0001.
 */
async function nextInvoiceNumber(wallet: string) {
  const supabase = accountDb();
  const { data, error } = await supabase
    .from(accountTables.invoices)
    .select("invoice_number")
    .eq("wallet_address", wallet)
    .like("invoice_number", "INV-%")
    .limit(5000);
  if (error) {
    throw new Error(readAccountDbError(error, "Could not allocate an invoice number."));
  }
  const highest = ((data ?? []) as { invoice_number?: string }[]).reduce((max, row) => {
    const match = row.invoice_number?.match(/^INV-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `INV-${String(highest + 1).padStart(4, "0")}`;
}

function isDuplicateInvoiceNumber(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === "23505" || /duplicate key/i.test(error.message ?? "")) &&
      /number_unique|invoice_number/i.test(error.message ?? ""),
  );
}

async function loadInvoiceForOwner(wallet: string, invoiceId: string) {
  const supabase = accountDb();
  const invoice = await supabase
    .from(accountTables.invoices)
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoice.error) {
    throw new Error(readAccountDbError(invoice.error, "Could not load invoice."));
  }
  if (!invoice.data) throw accountErrors.invoiceNotFound();
  const row = invoice.data as InvoiceRecord;
  if (row.wallet_address !== wallet.toLowerCase()) {
    throw accountErrors.invoiceNotOwned();
  }
  const items = await supabase
    .from(accountTables.invoiceItems)
    .select("*")
    .eq("invoice_id", row.id);
  return {
    ...row,
    items: (items.data ?? []) as InvoiceItemRecord[],
  } satisfies InvoiceWithItems;
}

export async function getInvoice(input: {
  circleSocialUuid?: unknown;
  invoiceId: string;
  ownerWallet: unknown;
  workspaceId?: unknown;
}) {
  const { actorWallet, businessWallet } = await requireBusinessAccount(input);
  const targetWallet = businessWallet || actorWallet;
  return loadInvoiceForOwner(targetWallet, input.invoiceId);
}

export async function listInvoices(input: {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  page?: number;
  workspaceId?: unknown;
}) {
  const { actorWallet, businessWallet } = await requireBusinessAccount(input);
  const targetWallet = businessWallet || actorWallet;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = 20;
  const from = (page - 1) * pageSize;
  const supabase = accountDb();
  const query = await supabase
    .from(accountTables.invoices)
    .select("*", { count: "exact" })
    .eq("wallet_address", targetWallet)
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (query.error) {
    throw new Error(readAccountDbError(query.error, "Could not load invoices."));
  }
  return {
    invoices: (query.data ?? []) as InvoiceRecord[],
    page,
    pageSize,
    total: query.count ?? 0,
  };
}

export async function invoiceSummary(wallet: string): Promise<InvoiceSummary> {
  const supabase = accountDb();
  const query = await supabase
    .from(accountTables.invoices)
    .select("status,total,amount_received")
    .eq("wallet_address", wallet.toLowerCase());
  if (query.error) {
    throw new Error(readAccountDbError(query.error, "Could not load invoice totals."));
  }
  const rows = (query.data ?? []) as Array<{
    amount_received?: string;
    status: InvoiceStatus;
    total: string;
  }>;
  return rows.reduce(
    (summary, row) => {
      const amount = moneyNumber(row.total);
      const received = moneyNumber(row.amount_received ?? "0");
      if (row.status !== "CANCELLED" && row.status !== "DRAFT") {
        summary.totalInvoiced += amount;
      }
      if (row.status === "PAID") summary.paid += amount;
      if (row.status === "PARTIALLY_PAID") {
        summary.pending += Math.max(0, amount - received);
      }
      if (row.status === "SENT" || row.status === "VIEWED" || row.status === "PENDING") {
        summary.pending += amount;
      }
      if (row.status === "OVERDUE") summary.overdue += amount;
      return summary;
    },
    { overdue: 0, paid: 0, pending: 0, totalInvoiced: 0 },
  );
}

export async function getBusinessOverview(input: {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
  workspaceId?: unknown;
}) {
  const { account, actorWallet, businessWallet } = await requireBusinessAccount(input);
  const targetWallet = businessWallet || actorWallet;
  const [profile, invoices, summary, checkout] = await Promise.all([
    loadBusinessProfile(targetWallet),
    listInvoices({ ...input, page: 1 }),
    invoiceSummary(targetWallet),
    // Never fails the overview: the Checkout tables may not exist yet.
    checkoutEnabled ? chargeSummary(targetWallet).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    account,
    checkout,
    invoices: invoices.invoices.slice(0, 8),
    profile,
    summary,
  };
}

export async function createInvoice(input: {
  allowPartialPayment?: unknown;
  circleSocialUuid?: unknown;
  currency?: unknown;
  customerCompany?: unknown;
  customerEmail?: unknown;
  customerName?: unknown;
  customerUsername?: unknown;
  customerWallet?: unknown;
  dueDate?: unknown;
  invoiceNumber?: unknown;
  issueDate?: unknown;
  items: InvoiceItemInput[];
  notes?: unknown;
  origin?: string;
  ownerWallet: unknown;
  paymentTerms?: unknown;
  workspaceId?: unknown;
}) {
  const { actorWallet, businessWallet } = await requireBusinessAccount(input);
  const targetWallet = businessWallet || actorWallet;
  const totals = totalsFromItems(input.items);
  const currency = isAsset(input.currency) ? input.currency : "USDC";
  const requestedNumber =
    typeof input.invoiceNumber === "string" ? input.invoiceNumber.trim().toUpperCase() : "";
  if (requestedNumber && !/^INV-[A-Z0-9-]{1,24}$/.test(requestedNumber)) {
    throw accountErrors.invalid("Invoice numbers must look like INV-1042.");
  }
  const customerUsername = optionalText(
    typeof input.customerUsername === "string"
      ? input.customerUsername.replace(/^@+/, "").replace(/\.one$/i, "")
      : input.customerUsername,
    32,
  );
  if (customerUsername) {
    const found = await findWalletByUsername(customerUsername);
    if (!found) {
      throw accountErrors.invalid("That ONE ID was not found.");
    }
  }
  const origin = input.origin?.replace(/\/$/, "") ?? "";
  const issueDate =
    typeof input.issueDate === "string" && input.issueDate
      ? input.issueDate.slice(0, 10)
      : nowIso().slice(0, 10);
  const supabase = accountDb();

  // An automatic number can collide when two invoices are created at once;
  // take the next one and try again. A number the business typed is theirs,
  // so a clash there is reported instead of silently renumbered.
  let created;
  let invoiceNumber = "";
  let publicId = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    invoiceNumber = requestedNumber || (await nextInvoiceNumber(targetWallet));
    publicId = await allocatePublicId(invoiceNumber);
    created = await supabase
    .from(accountTables.invoices)
    .insert({
      allow_partial_payment: Boolean(input.allowPartialPayment),
      amount_received: "0",
      created_at: nowIso(),
      currency,
      customer_company: optionalText(input.customerCompany, 80) ?? null,
      customer_email: optionalText(input.customerEmail, 160) ?? null,
      customer_name: optionalText(input.customerName, 80) ?? null,
      customer_username: customerUsername ?? null,
      customer_wallet:
        typeof input.customerWallet === "string" && isAddress(input.customerWallet)
          ? getAddress(input.customerWallet).toLowerCase()
          : null,
      discount: totals.discount,
      due_date: typeof input.dueDate === "string" && input.dueDate ? input.dueDate : null,
      invoice_number: invoiceNumber,
      issue_date: issueDate,
      notes: optionalText(input.notes, 280) ?? null,
      overpayment: "0",
      payment_link: origin ? `${origin}/invoice/${publicId}` : null,
      payment_terms: optionalText(input.paymentTerms, 280) ?? null,
      public_id: publicId,
      status: "SENT",
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      updated_at: nowIso(),
      wallet_address: targetWallet,
    })
    .select("*")
    .single();
    if (!isDuplicateInvoiceNumber(created.error)) break;
    if (requestedNumber) {
      throw accountErrors.invalid(`${requestedNumber} is already used. Pick another number or leave it blank.`);
    }
  }
  if (!created || created.error) {
    throw new Error(
      readAccountDbError(created?.error ?? null, "Could not create the invoice."),
    );
  }
  const invoice = created.data as InvoiceRecord;
  const items = await supabase.from(accountTables.invoiceItems).insert(
    totals.items.map((item) => ({
      ...item,
      invoice_id: invoice.id,
    })),
  );
  if (items.error) {
    throw new Error(readAccountDbError(items.error, "Could not save invoice items."));
  }
  const issued = await loadInvoiceForOwner(targetWallet, invoice.id);
  await notifyInvoiceRecipient(issued);
  // Email the customer when an address was given. A failed send never undoes
  // the invoice; the result goes back so the business knows.
  let emailDelivery: InvoiceWithItems["email_delivery"] = null;
  if (issued.customer_email) {
    const profile = await loadBusinessProfile(targetWallet).catch(() => null);
    emailDelivery = await sendInvoiceEmail({
      businessName: profile?.business_name?.trim() || "A SaphraONE business",
      invoice: issued,
      replyTo: profile?.contact_email,
    });
  }
  return { ...issued, email_delivery: emailDelivery };
}

async function notifyInvoiceRecipient(invoice: InvoiceWithItems) {
  if (!invoice.customer_username) return;
  const recipient = await findWalletByUsername(invoice.customer_username);
  if (!recipient) return;
  void createSavingsNotificationResult({
    body: `${invoice.invoice_number} for ${invoice.total} ${invoice.currency} is ready to pay${
      invoice.payment_link ? `: ${invoice.payment_link}` : "."
    }`,
    fallbackKind: "payment_request",
    kind: "payment_request",
    metadata: {
      invoiceId: invoice.id,
      publicId: invoice.public_id,
    },
    ownerWallet: recipient.wallet_address,
    title: `Invoice ${invoice.invoice_number}`,
  });
}

export async function updateInvoice(input: {
  allowPartialPayment?: unknown;
  circleSocialUuid?: unknown;
  currency?: unknown;
  customerCompany?: unknown;
  customerEmail?: unknown;
  customerName?: unknown;
  customerUsername?: unknown;
  dueDate?: unknown;
  invoiceId: string;
  issueDate?: unknown;
  items?: InvoiceItemInput[];
  notes?: unknown;
  ownerWallet: unknown;
  paymentTerms?: unknown;
  workspaceId?: unknown;
}) {
  const { actorWallet, businessWallet } = await requireBusinessAccount(input);
  const targetWallet = businessWallet || actorWallet;
  const current = await loadInvoiceForOwner(targetWallet, input.invoiceId);
  if (current.status !== "DRAFT") {
    throw accountErrors.invalidInvoiceStatus("Only draft invoices can be edited.");
  }
  const items = input.items?.length
    ? input.items
    : current.items.map((item) => ({
        description: item.description,
        discount: item.discount,
        quantity: item.quantity,
        tax: item.tax,
        unitPrice: item.unit_price,
      }));
  const totals = totalsFromItems(items);
  const customerUsername =
    optionalText(
      typeof input.customerUsername === "string"
        ? input.customerUsername.replace(/^@+/, "").replace(/\.one$/i, "")
        : input.customerUsername,
      32,
    ) ?? current.customer_username;
  if (customerUsername) {
    const found = await findWalletByUsername(customerUsername);
    if (!found) {
      throw accountErrors.invalid("That ONE ID was not found.");
    }
  }
  const supabase = accountDb();
  await supabase.from(accountTables.invoiceItems).delete().eq("invoice_id", current.id);
  await supabase.from(accountTables.invoiceItems).insert(
    totals.items.map((item) => ({ ...item, invoice_id: current.id })),
  );
  const mutation = await supabase
    .from(accountTables.invoices)
    .update({
      allow_partial_payment:
        typeof input.allowPartialPayment === "boolean"
          ? input.allowPartialPayment
          : current.allow_partial_payment,
      currency: isAsset(input.currency) ? input.currency : current.currency,
      customer_company: optionalText(input.customerCompany, 80) ?? current.customer_company,
      customer_email: optionalText(input.customerEmail, 160) ?? current.customer_email,
      customer_name: optionalText(input.customerName, 80) ?? current.customer_name,
      customer_username: customerUsername ?? null,
      discount: totals.discount,
      due_date: typeof input.dueDate === "string" ? input.dueDate || null : current.due_date,
      issue_date:
        typeof input.issueDate === "string" && input.issueDate
          ? input.issueDate.slice(0, 10)
          : current.issue_date,
      notes: optionalText(input.notes, 280) ?? current.notes,
      payment_terms: optionalText(input.paymentTerms, 280) ?? current.payment_terms,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      updated_at: nowIso(),
    })
    .eq("id", current.id)
    .eq("wallet_address", targetWallet);
  if (mutation.error) {
    throw new Error(readAccountDbError(mutation.error, "Could not update the invoice."));
  }
  return loadInvoiceForOwner(targetWallet, current.id);
}

/** Invoices still awaiting payment: the ones worth (re)emailing. */
const emailableStatuses = new Set(["SENT", "VIEWED", "PENDING", "PARTIALLY_PAID", "OVERDUE"]);

/**
 * Email an existing invoice to its customer: a re-send after a failed or
 * missing email. `toEmail` fills in (and saves) an address when the invoice
 * has none. Throws when the email is not sent, so the caller can say why.
 */
export async function emailInvoice(input: {
  circleSocialUuid?: unknown;
  invoiceId: string;
  ownerWallet: unknown;
  toEmail?: unknown;
  workspaceId?: unknown;
}) {
  const { actorWallet, businessWallet } = await requireBusinessAccount(input);
  const targetWallet = businessWallet || actorWallet;
  let invoice = await loadInvoiceForOwner(targetWallet, input.invoiceId);
  if (!emailableStatuses.has(invoice.status)) {
    throw accountErrors.invalidInvoiceStatus(
      invoice.status === "PAID"
        ? "This invoice is already paid."
        : "Only an open invoice can be emailed. Send the draft first.",
    );
  }

  const given =
    typeof input.toEmail === "string" ? input.toEmail.trim().toLowerCase() : "";
  if (given && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(given) || given.length > 160)) {
    throw accountErrors.invalid("Enter a valid email address.");
  }
  if (given && given !== invoice.customer_email) {
    const saved = await accountDb()
      .from(accountTables.invoices)
      .update({ customer_email: given, updated_at: nowIso() })
      .eq("id", invoice.id)
      .eq("wallet_address", targetWallet);
    if (saved.error) {
      throw new Error(readAccountDbError(saved.error, "Could not save the customer email."));
    }
    invoice = { ...invoice, customer_email: given };
  }
  if (!invoice.customer_email) {
    throw accountErrors.invalid("Add the customer's email address to send this invoice.");
  }

  const profile = await loadBusinessProfile(targetWallet).catch(() => null);
  const status = await sendInvoiceEmail({
    businessName: profile?.business_name?.trim() || "A SaphraONE business",
    invoice,
    replyTo: profile?.contact_email,
    // One re-send per invoice per minute: a double click is one email.
    idempotencyKey: `invoice-${invoice.id}-resend-${Math.floor(Date.now() / 60_000)}`,
  });
  if (status === "not_configured") {
    throw accountErrors.invalid("Invoice emails aren't set up yet. Share the payment link instead.");
  }
  if (status !== "sent") {
    throw new Error(`The email to ${invoice.customer_email} didn't go through. Try again, or share the payment link.`);
  }
  return { ...invoice, email_delivery: status };
}

export async function sendInvoice(input: {
  circleSocialUuid?: unknown;
  invoiceId: string;
  origin?: string;
  ownerWallet: unknown;
  workspaceId?: unknown;
}) {
  const { actorWallet, businessWallet } = await requireBusinessAccount(input);
  const targetWallet = businessWallet || actorWallet;
  const current = await loadInvoiceForOwner(targetWallet, input.invoiceId);
  if (current.status !== "DRAFT" && current.status !== "CANCELLED") {
    throw accountErrors.invalidInvoiceStatus("This invoice has already been sent.");
  }
  const origin = input.origin?.replace(/\/$/, "") ?? "";
  const supabase = accountDb();
  const mutation = await supabase
    .from(accountTables.invoices)
    .update({
      payment_link: origin ? `${origin}/invoice/${current.public_id}` : current.payment_link,
      status: "SENT",
      updated_at: nowIso(),
    })
    .eq("id", current.id)
    .eq("wallet_address", targetWallet);
  if (mutation.error) {
    throw new Error(readAccountDbError(mutation.error, "Could not send the invoice."));
  }
  const sent = await loadInvoiceForOwner(targetWallet, current.id);
  await notifyInvoiceRecipient(sent);
  return sent;
}

export async function cancelInvoice(input: {
  circleSocialUuid?: unknown;
  invoiceId: string;
  ownerWallet: unknown;
  workspaceId?: unknown;
}) {
  const { actorWallet, businessWallet } = await requireBusinessAccount(input);
  const targetWallet = businessWallet || actorWallet;
  const current = await loadInvoiceForOwner(targetWallet, input.invoiceId);
  if (current.status === "PAID") throw accountErrors.invoiceAlreadyPaid();
  if (current.status === "CANCELLED") return current;
  const supabase = accountDb();
  const mutation = await supabase
    .from(accountTables.invoices)
    .update({ status: "CANCELLED", updated_at: nowIso() })
    .eq("id", current.id)
    .eq("wallet_address", targetWallet);
  if (mutation.error) {
    throw new Error(readAccountDbError(mutation.error, "Could not cancel the invoice."));
  }
  return loadInvoiceForOwner(targetWallet, current.id);
}

export async function getPublicInvoice(publicId: string, options?: { markViewed?: boolean }) {
  const supabase = accountDb();
  const decodedId = decodeURIComponent(publicId);
  let invoice = await supabase
    .from(accountTables.invoices)
    .select("*")
    .eq("public_id", decodedId)
    .maybeSingle();
  if (invoice.error) {
    throw new Error(readAccountDbError(invoice.error, "Could not load invoice."));
  }
  if (!invoice.data && /^INV-[A-Z0-9-]+$/i.test(decodedId)) {
    const byNumber = await supabase
      .from(accountTables.invoices)
      .select("*")
      .ilike("invoice_number", decodedId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byNumber.error) {
      throw new Error(readAccountDbError(byNumber.error, "Could not load invoice."));
    }
    invoice = byNumber;
  }
  if (!invoice.data) throw accountErrors.invoiceNotFound();
  const row = invoice.data as InvoiceRecord;
  const [items, profile, account] = await Promise.all([
    supabase.from(accountTables.invoiceItems).select("*").eq("invoice_id", row.id),
    loadBusinessProfile(row.wallet_address),
    loadAccount(row.wallet_address),
  ]);
  if (options?.markViewed && (row.status === "DRAFT" || row.status === "SENT")) {
    await supabase
      .from(accountTables.invoices)
      .update({ status: "VIEWED", updated_at: nowIso() })
      .eq("id", row.id)
      .in("status", ["DRAFT", "SENT"]);
    void createSavingsNotificationResult({
      body: `Invoice ${row.invoice_number} was viewed.`,
      fallbackKind: "payment_request",
      kind: "payment_request",
      // An update for the business, not a request to pay: the type keeps the
      // bell from offering Pay / Decline on it. (Stored under the
      // payment_request kind only because the table's kinds are fixed.)
      metadata: { invoiceId: row.id, publicId, type: "invoice_viewed" },
      ownerWallet: row.wallet_address,
      title: "Your invoice was viewed",
    });
  }
  return {
    business: {
      description: profile?.description ?? null,
      logoUrl: profile?.logo_url ?? null,
      name: profile?.business_name ?? account?.username ?? "Business",
      username: account?.username ?? null,
      website: profile?.website ?? null,
    },
    destinationWallet: row.wallet_address,
    invoice: {
      ...row,
      customer_email: null,
      items: (items.data ?? []) as InvoiceItemRecord[],
      status:
        options?.markViewed && (row.status === "SENT" || row.status === "DRAFT")
          ? "VIEWED"
          : row.status,
    },
  };
}

export async function confirmInvoicePayment(input: {
  amount: string;
  asset: unknown;
  publicId: string;
  txHash: string;
}) {
  const publicInvoice = await getPublicInvoice(input.publicId, { markViewed: false });
  const invoice = publicInvoice.invoice as InvoiceRecord & { items: InvoiceItemRecord[] };
  const txHash = input.txHash.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(txHash)) {
    throw accountErrors.invalidPayment("Enter a valid transaction hash.");
  }
  const supabase = accountDb();
  const existingTx = await supabase
    .from(accountTables.invoicePayments)
    .select("id,invoice_id")
    .eq("tx_hash", txHash)
    .maybeSingle();
  if (existingTx.data) {
    if ((existingTx.data as { invoice_id: string }).invoice_id === invoice.id) {
      return getPublicInvoice(input.publicId, { markViewed: false });
    }
    throw accountErrors.invalidPayment("This transaction was already applied.");
  }
  if (invoice.status === "PAID") throw accountErrors.invoiceAlreadyPaid();
  if (invoice.status === "CANCELLED") {
    throw accountErrors.invalidInvoiceStatus("This invoice was cancelled.");
  }
  if (!isAsset(input.asset) || input.asset !== invoice.currency) {
    throw accountErrors.invalidPayment("Pay with the invoice asset.");
  }
  // The amount is what the chain says reached the business — never what the
  // payer's browser claims. A made-up hash, a failed transfer or one sent
  // somewhere else credits nothing.
  const onchainReceived = await verifyInvoiceTransfer({
    destination: publicInvoice.destinationWallet,
    token: arcTokens[invoice.currency],
    txHash: txHash as `0x${string}`,
  });
  if (onchainReceived === null) {
    throw accountErrors.invalidPayment(
      "This transaction isn't confirmed yet, or it didn't pay this invoice's wallet. Try again in a moment.",
    );
  }
  const paid = moneyNumber(roundMoney(onchainReceived));
  if (paid <= 0) {
    throw accountErrors.invalidPayment("Payment amount must be greater than zero.");
  }
  const due = moneyNumber(invoice.total);
  const alreadyReceived = moneyNumber(invoice.amount_received ?? "0");
  const remaining = Math.max(0, due - alreadyReceived);
  const allowPartial = Boolean(invoice.allow_partial_payment);
  if (paid + 0.000001 < remaining && !allowPartial) {
    throw accountErrors.invalidPayment(
      "This invoice does not accept partial payments. Pay the remaining balance.",
    );
  }

  const payment = await supabase.from(accountTables.invoicePayments).insert({
    amount: roundMoney(paid),
    asset: input.asset,
    created_at: nowIso(),
    invoice_id: invoice.id,
    paid_at: nowIso(),
    status: "CONFIRMED",
    tx_hash: txHash,
  });
  if (payment.error) {
    if (payment.error.code === "23505") {
      return getPublicInvoice(input.publicId, { markViewed: false });
    }
    throw new Error(readAccountDbError(payment.error, "Could not record the payment."));
  }

  const recorded = await supabase
    .from(accountTables.invoicePayments)
    .select("amount")
    .eq("invoice_id", invoice.id);
  if (recorded.error) {
    throw new Error(readAccountDbError(recorded.error, "Could not load invoice payments."));
  }
  const received = ((recorded.data ?? []) as Array<{ amount: string }>).reduce(
    (sum, row) => sum + moneyNumber(row.amount),
    0,
  );
  const overpayment = Math.max(0, received - due);
  const nextStatus: InvoiceStatus =
    received + 0.000001 >= due ? "PAID" : "PARTIALLY_PAID";
  const paidAt = nextStatus === "PAID" ? nowIso() : invoice.paid_at;

  const totalsUpdate = await supabase
    .from(accountTables.invoices)
    .update({
      amount_received: roundMoney(received),
      overpayment: roundMoney(overpayment),
      updated_at: nowIso(),
    })
    .eq("id", invoice.id)
    .neq("status", "CANCELLED");
  if (totalsUpdate.error) {
    throw new Error(readAccountDbError(totalsUpdate.error, "Could not update invoice totals."));
  }
  if (nextStatus === "PAID") {
    const paidUpdate = await supabase
      .from(accountTables.invoices)
      .update({
        paid_at: paidAt,
        status: "PAID",
        updated_at: nowIso(),
      })
      .eq("id", invoice.id)
      .neq("status", "PAID")
      .neq("status", "CANCELLED");
    if (paidUpdate.error) {
      throw new Error(readAccountDbError(paidUpdate.error, "Could not mark the invoice paid."));
    }
  } else {
    const partialUpdate = await supabase
      .from(accountTables.invoices)
      .update({
        status: "PARTIALLY_PAID",
        updated_at: nowIso(),
      })
      .eq("id", invoice.id)
      .in("status", ["DRAFT", "SENT", "VIEWED", "PENDING", "PARTIALLY_PAID", "OVERDUE"]);
    if (partialUpdate.error) {
      throw new Error(readAccountDbError(partialUpdate.error, "Could not record the partial payment."));
    }
  }

  const title =
    nextStatus === "PAID" && overpayment > 0
      ? `Invoice ${invoice.invoice_number} paid with overpayment`
      : nextStatus === "PAID"
        ? `Invoice ${invoice.invoice_number} has been paid`
        : `Partial payment on ${invoice.invoice_number}`;
  const body =
    nextStatus === "PAID" && overpayment > 0
      ? `Received ${roundMoney(received)} ${invoice.currency} against ${invoice.total}. Overpayment ${roundMoney(overpayment)}.`
      : nextStatus === "PAID"
        ? `Invoice ${invoice.invoice_number} has been paid.`
        : `Received ${roundMoney(paid)} ${invoice.currency}. ${roundMoney(Math.max(0, due - received))} remaining.`;
  void createSavingsNotificationResult({
    body,
    fallbackKind: "payment_received",
    kind: "payment_received",
    metadata: {
      amountReceived: roundMoney(received),
      invoiceId: invoice.id,
      invoiceTotal: invoice.total,
      overpayment: roundMoney(overpayment),
      txHash,
    },
    ownerWallet: publicInvoice.destinationWallet,
    relatedTxHash: txHash,
    title,
  });
  if (nextStatus === "PAID") {
    // "Get invoices paid" quests (a business has no other trigger for them).
    void import("@/lib/rewards/quests").then(({ checkQuestsSoon }) =>
      checkQuestsSoon(publicInvoice.destinationWallet),
    );
  }
  return getPublicInvoice(input.publicId, { markViewed: false });
}



/** One of `bands`, null when cleared; anything else is rejected. */
function readBand(value: unknown, bands: readonly string[], label: string) {
  if (value === null || value === "") return null;
  if (typeof value === "string" && bands.includes(value.trim())) return value.trim();
  throw accountErrors.invalid(`Choose a valid ${label}.`);
}

function readYearFounded(value: unknown) {
  if (value === null || value === "") return null;
  const year = Number(value);
  const thisYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 1800 || year > thisYear) {
    throw accountErrors.invalid(`Enter a year founded between 1800 and ${thisYear}.`);
  }
  return year;
}
