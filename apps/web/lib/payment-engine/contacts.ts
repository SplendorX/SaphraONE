import { getAddress, isAddress, type Address } from "viem";

import { createSupabaseAdminClient } from "@/lib/supabase-server";

const beneficiariesTable =
  process.env.SUPABASE_BENEFICIARIES_TABLE ?? "beneficiaries";

/** Contacts read per request; far above what anyone keeps by hand. */
const maxContacts = 500;

export type SavedContact = { name: string; wallet: Address };

/** The owner's saved contacts (Dashboard → Contacts). Empty on any error. */
export async function loadContacts(ownerWallet: string): Promise<SavedContact[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from(beneficiariesTable)
    .select("name,beneficiary_wallet")
    .eq("owner_wallet", ownerWallet.toLowerCase())
    .limit(maxContacts)
    .returns<{ name: string | null; beneficiary_wallet: string | null }[]>();

  if (error) return [];

  return (data ?? []).flatMap((row) => {
    const name = row.name?.trim();
    const wallet = row.beneficiary_wallet?.trim();
    return name && wallet && isAddress(wallet)
      ? [{ name, wallet: getAddress(wallet).toLowerCase() as Address }]
      : [];
  });
}

const fold = (value: string) => value.trim().replace(/^@/, "").replace(/\.one$/i, "").replace(/\s+/g, " ").toLowerCase();

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The contact a recipient refers to, or null.
 *
 * Matches a saved name case-insensitively. When `message` is given, a
 * multi-word name that starts with the recipient and appears in the message
 * wins: Tier 1 reads one word, so "send 5 to John Doe" arrives as "John", and
 * without this it could pay a different "@john".
 */
export function matchContact(
  contacts: SavedContact[],
  recipient: string,
  message?: string,
): SavedContact | null {
  const wanted = fold(recipient);
  if (!wanted) return null;

  if (message) {
    const longer = contacts
      .filter((contact) => fold(contact.name).startsWith(`${wanted} `))
      .filter((contact) =>
        new RegExp(`(^|[^a-z0-9_])${escapeRegExp(fold(contact.name))}($|[^a-z0-9_])`, "i").test(
          message.replace(/\s+/g, " "),
        ),
      )
      .sort((left, right) => right.name.length - left.name.length);
    if (longer[0]) return longer[0];
  }

  return contacts.find((contact) => fold(contact.name) === wanted) ?? null;
}
