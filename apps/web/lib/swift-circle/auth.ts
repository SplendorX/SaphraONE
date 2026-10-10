import { isValidUuid } from "@/lib/save/validation";
import {
  assertRecurringAccess,
  getSessionOwnerWallet,
  normalizeOwnerWallet,
} from "@/lib/recurring-auth";
import { circleErrors } from "@/lib/swift-circle/errors";
import { circleDb, circleTables, readCircleDbError } from "@/lib/swift-circle/db";
import type { CircleMemberRecord, CircleRecord } from "@/lib/swift-circle/types";

export {
  assertRecurringAccess,
  getSessionOwnerWallet,
  normalizeOwnerWallet,
};

export async function assertCircleAccess(input: {
  circleSocialUuid?: unknown;
  ownerWallet: string;
}) {
  const ok = await assertRecurringAccess(input);
  if (!ok) {
    throw circleErrors.unauthorized();
  }
}

export async function requireActorWallet(input: {
  circleSocialUuid?: unknown;
  ownerWallet: unknown;
}) {
  const ownerWallet = normalizeOwnerWallet(input.ownerWallet);
  if (!ownerWallet) {
    throw circleErrors.invalid("A valid owner wallet is required.");
  }
  await assertCircleAccess({
    circleSocialUuid: input.circleSocialUuid,
    ownerWallet,
  });
  return ownerWallet;
}

export async function loadCircle(circleId: string): Promise<CircleRecord> {
  if (!isValidUuid(circleId)) {
    throw circleErrors.invalid("Invalid Circle id.");
  }
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.circles)
    .select("*")
    .eq("id", circleId)
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load Circle."));
  }
  if (!data) {
    throw circleErrors.notFound("Circle");
  }
  return data as CircleRecord;
}

export async function loadMembership(
  circleId: string,
  userWallet: string,
): Promise<CircleMemberRecord | null> {
  const supabase = circleDb();
  const { data, error } = await supabase
    .from(circleTables.members)
    .select("*")
    .eq("circle_id", circleId)
    .eq("user_wallet", userWallet.toLowerCase())
    .maybeSingle();
  if (error) {
    throw new Error(readCircleDbError(error, "Could not load membership."));
  }
  return (data as CircleMemberRecord | null) ?? null;
}

export async function requireActiveMember(circleId: string, userWallet: string) {
  const member = await loadMembership(circleId, userWallet);
  if (!member || member.status !== "active") {
    throw circleErrors.forbidden("You must be an active Circle member.");
  }
  return member;
}


export function assertCircleActive(circle: CircleRecord) {
  if (circle.status !== "active") {
    throw circleErrors.forbidden("This Circle is archived.");
  }
}

export function assertNotFrozen(circle: CircleRecord) {
  if (circle.financial_frozen) {
    throw circleErrors.frozen();
  }
}
