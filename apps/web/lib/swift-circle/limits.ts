import { circleDb, circleTables, readCircleDbError } from "@/lib/swift-circle/db";
import { parseUnits } from "@/lib/swift-circle/money";
import type { CirclePlatformLimits } from "@/lib/swift-circle/types";

/** Authoritative default. Store/override in circle_platform_limits; do not scatter copies. */
export const MAX_CIRCLE_MEMBERS = 500;
export const MAX_CIRCLE_SAVE_POCKETS = 20;

const fallbackLimits: CirclePlatformLimits = {
  id: "default",
  max_members: MAX_CIRCLE_MEMBERS,
  max_circles_per_user: 20,
  max_invitations_per_day: 50,
  max_payment_amount_units: "100000000000",
  max_request_amount_units: "100000000000",
  max_save_contribution_units: "100000000000",
  max_earn_contribution_units: "100000000000",
  max_withdrawal_amount_units: "100000000000",
  max_pending_withdrawals: 5,
  invitation_ttl_hours: 168,
};

export async function loadPlatformLimits(): Promise<CirclePlatformLimits> {
  try {
    const supabase = circleDb();
    const { data, error } = await supabase
      .from(circleTables.limits)
      .select("*")
      .eq("id", "default")
      .maybeSingle();
    if (error) {
      console.warn(
        "[swift-circle-limits]",
        readCircleDbError(error, "limits unavailable"),
      );
      return fallbackLimits;
    }
    const row = (data as CirclePlatformLimits | null) ?? fallbackLimits;
    const stored =
      row.max_members && row.max_members > 0
        ? row.max_members
        : MAX_CIRCLE_MEMBERS;
    return {
      ...row,
      max_members: Math.min(
        stored === 50 ? MAX_CIRCLE_MEMBERS : stored,
        MAX_CIRCLE_MEMBERS,
      ),
    };
  } catch {
    return fallbackLimits;
  }
}


export function assertUnderLimit(units: bigint, maxUnits: string, label: string) {
  const max = parseUnits(maxUnits);
  if (max > 0n && units > max) {
    throw new Error(`${label} exceeds the Circle limit.`);
  }
}
