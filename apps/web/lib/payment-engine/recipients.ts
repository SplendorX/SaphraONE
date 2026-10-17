import { getAddress, isAddress, type Address } from "viem";

import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { matchContact, type SavedContact } from "@/lib/payment-engine/contacts";
import { normalizeUsername } from "@/lib/profile-utils";

const profilesTable = process.env.SUPABASE_PROFILES_TABLE ?? "profiles";

export type ResolvedRecipient = {
  address: Address;
  username: string | null;
  label: string;
};

/**
 * Server-side recipient resolution for the payment engine.
 * Accepts an EVM address, a saved contact's name, or an @username backed by a
 * SaphraONE profile.
 *
 * When a name could be either, how it was written decides: "@gentle" is a
 * username first (falling back to a contact), a bare "gentle" is the owner's
 * own contact first (falling back to a username). Pass `contacts` to enable
 * contact matching, and `message` to catch multi-word contact names.
 */
export async function resolveRecipient(
  input: string,
  options: { contacts?: SavedContact[]; message?: string } = {},
): Promise<ResolvedRecipient | null> {
  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  if (isAddress(trimmed)) {
    const address = getAddress(trimmed).toLowerCase() as Address;
    return { address, username: null, label: address };
  }

  const contact = options.contacts
    ? matchContact(options.contacts, trimmed, options.message)
    : null;
  const fromContact: ResolvedRecipient | null = contact
    ? { address: contact.wallet, username: null, label: `${contact.name} (contact)` }
    : null;

  // "amara.one" (or "@amara") names an account; a bare name may be a contact.
  if (fromContact && !trimmed.startsWith("@") && !/\.one$/i.test(trimmed)) {
    return fromContact;
  }

  const fromUsername = await resolveUsername(trimmed);
  return fromUsername ?? fromContact;
}

async function resolveUsername(input: string): Promise<ResolvedRecipient | null> {
  const username = normalizeUsername(input.replace(/^@/, ""));

  if (!username) {
    return null;
  }

  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from(profilesTable)
    .select("username,wallet_address")
    .eq("username", username)
    .maybeSingle<{ username: string; wallet_address: string }>();

  if (error || !data?.wallet_address || !isAddress(data.wallet_address)) {
    return null;
  }

  return {
    address: getAddress(data.wallet_address).toLowerCase() as Address,
    username: data.username,
    label: `${data.username}.one`,
  };
}
