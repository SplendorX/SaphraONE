/** Rows of the Creator Partners tables (packages/database/supabase/creator-partners.sql). */
import type { PerkKind } from "@/lib/partners/config";

export type PartnerStatus = "ACTIVE" | "PAUSED" | "ENDED";
export type CommissionMode = "FIXED" | "AT_LEAST_TIER";
export type OfferStatus = "DRAFT" | "LIVE" | "PAUSED" | "ENDED";
export type MemberPerksStatus = "ACTIVE" | "NO_PERKS" | "HELD" | "REVOKED" | "ENDED";
export type PerkEventStatus = "PENDING" | "CLAIMABLE" | "CLAIMED" | "CREDITED" | "GRANTED" | "REVERSED";

export type PartnerRow = {
  id: string;
  wallet_address: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  status: PartnerStatus;
  commission_bps: number | null;
  commission_mode: CommissionMode;
  contract_starts_at: string | null;
  contract_ends_at: string | null;
  bounty_usdc: number;
  bounty_monthly_cap: number;
  kyc_status: "NONE" | "PENDING" | "VERIFIED";
  notes: string;
  created_at: string;
  updated_at: string;
};

export type OfferRow = {
  id: string;
  partner_id: string;
  code: string;
  title: string;
  headline: string;
  terms_md: string;
  status: OfferStatus;
  starts_at: string;
  ends_at: string | null;
  perk_days: number;
  max_members: number | null;
  budget_usdc: number;
  spent_usdc: number;
  members_count: number;
  created_at: string;
  updated_at: string;
};

export type PerkRow = {
  id: string;
  offer_id: string;
  kind: PerkKind;
  config: Record<string, unknown>;
};

export type MemberRow = {
  wallet_address: string;
  offer_id: string;
  partner_id: string;
  referral_id: string | null;
  perks_start_at: string;
  perks_end_at: string;
  perks_status: MemberPerksStatus;
  no_perks_reason: string | null;
  signup_ip_hash: string | null;
  signup_agent_hash: string | null;
  trial_granted_at: string | null;
  bounty_paid_at: string | null;
  ending_notice_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PerkEventRow = {
  id: string;
  wallet_address: string;
  offer_id: string;
  kind: PerkKind;
  use_key: string;
  amount_usdc: number;
  points: number;
  budget_usd: number;
  status: PerkEventStatus;
  claimable_at: string;
  claim_id: string | null;
  ledger_entry_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

/** What a member sees: GET /api/partners/me. */
export type WelcomePerks = {
  partner: { avatarUrl: string | null; displayName: string; handle: string | null };
  offer: { code: string; title: string };
  status: MemberPerksStatus;
  /** Why there are no perks (offer full, business account…), in plain words. */
  note: string | null;
  startsAt: string;
  endsAt: string;
  daysLeft: number;
  perks: Array<{
    kind: PerkKind;
    name: string;
    /** One line: "100% of fees back, up to $10". */
    summary: string;
    /** "$2.40 of $10 used", or null when there's nothing to count. */
    usage: string | null;
  }>;
  rebates: {
    claimableUsdc: number;
    pendingUsdc: number;
    claimedUsdc: number;
    minClaimUsdc: number;
    nextClaimableAt: string | null;
  };
  pendingPoints: number;
};
