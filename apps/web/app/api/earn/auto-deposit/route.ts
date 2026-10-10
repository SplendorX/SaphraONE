import { type NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import {
  deleteAutoDepositRule,
  getAutoDepositRule,
  isAutoDepositFrequency,
  isAutoDepositMode,
  markRuleRan,
  upsertAutoDepositRule,
} from "@/lib/earn/auto-deposit";
import { earnAutoSaveExecutorAddress, earnAutoSaveExecutors } from "@/lib/earn/auto-save";
import { isListedEarnVault } from "@/server/earn";
import { ReferralAuthError, requireReferralActorWallet } from "@/lib/referral/auth";
import {
  getEntitlement,
  isEntitlementActive,
} from "@/lib/referral/entitlement-service";
import {
  FEATURE_UNLOCK_COST,
  FEATURE_UNLOCK_TERM_LABEL,
} from "@/lib/referral/types";

export const runtime = "nodejs";

/** Missing credentials are a caller error; only a real rejection is 401. */
function authStatus(message: string) {
  if (message.includes("wallet address is required")) return 400;
  if (message.includes("Unauthorized")) return 401;
  return 500;
}

type RuleBody = {
  amountUsdc?: unknown;
  circleSocialUuid?: unknown;
  enabled?: unknown;
  frequency?: unknown;
  markRan?: unknown;
  minBalanceFloor?: unknown;
  mode?: unknown;
  ownerWallet?: unknown;
  vaultAddress?: unknown;
  walletAddress?: unknown;
};

export async function GET(request: NextRequest) {
  try {
    const actorWallet = await requireReferralActorWallet({
      circleSocialUuid: request.nextUrl.searchParams.get("circleSocialUuid"),
      ownerWallet: request.nextUrl.searchParams.get("wallet"),
    });

    const entitlement = await getEntitlement(actorWallet, "EARN_AUTO_DEPOSIT");

    const rule = await getAutoDepositRule(actorWallet);

    return jsonOk({
      executorAddress: earnAutoSaveExecutorAddress(rule?.vault_address),
      // Unattended deposits run through the executor bound to each vault.
      executors: earnAutoSaveExecutors(),
      // Present but lapsed, so the UI can say "renew" rather than "unlock".
      expiresAt: entitlement?.expires_at ?? null,
      hadEntitlement: Boolean(entitlement),
      rule,
      unlockCost: FEATURE_UNLOCK_COST.EARN_AUTO_DEPOSIT,
      unlocked: isEntitlementActive(entitlement),
    });
  } catch (error) {
    if (error instanceof ReferralAuthError) {
      return jsonError(error.message, error.status);
    }
    const message =
      error instanceof Error ? error.message : "Could not load the rule.";
    return jsonError(message, authStatus(message));
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRecord<RuleBody>(request);
    if (!body) {
      return jsonError("A valid JSON body is required.", 400);
    }

    const actorWallet = await requireReferralActorWallet({
      circleSocialUuid: body.circleSocialUuid,
      ownerWallet: body.ownerWallet || body.walletAddress,
    });

    // Gated server-side as well as in the UI: the entitlement is what was paid
    // for, so the check belongs where it cannot be skipped.
    if (
      !isEntitlementActive(
        await getEntitlement(actorWallet, "EARN_AUTO_DEPOSIT"),
      )
    ) {
      return jsonError(
        `Auto-deposit is a premium feature. ${FEATURE_UNLOCK_COST.EARN_AUTO_DEPOSIT} OnePoints covers ${FEATURE_UNLOCK_TERM_LABEL.EARN_AUTO_DEPOSIT}.`,
        402,
      );
    }

    // Marking a completed sweep does not re-validate the whole rule.
    if (body.markRan === true) {
      const rule = await getAutoDepositRule(actorWallet);
      if (!rule) return jsonError("No auto-deposit rule to advance.", 404);
      await markRuleRan({
        frequency: rule.frequency,
        walletAddress: actorWallet,
      });
      return jsonOk({ rule: await getAutoDepositRule(actorWallet) });
    }

    if (!isAutoDepositMode(body.mode)) {
      return jsonError("Mode must be SWEEP or UNATTENDED.", 400);
    }

    if (!isAutoDepositFrequency(body.frequency)) {
      return jsonError("Frequency must be daily, weekly or monthly.", 400);
    }

    const amountUsdc = Number(body.amountUsdc);
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      return jsonError("Enter an amount greater than zero.", 400);
    }

    const minBalanceFloor = Number(body.minBalanceFloor ?? 0);
    if (!Number.isFinite(minBalanceFloor) || minBalanceFloor < 0) {
      return jsonError("The minimum balance cannot be negative.", 400);
    }

    if (typeof body.vaultAddress !== "string" || !body.vaultAddress.trim()) {
      return jsonError("Choose a vault.", 400);
    }
    if (!(await isListedEarnVault(body.vaultAddress))) {
      return jsonError("That vault is not offered on Invest.", 400);
    }

    // Unattended mode is inert without the executor: accepting the rule would
    // promise a schedule nothing can run.
    if (body.mode === "UNATTENDED" && !earnAutoSaveExecutorAddress(body.vaultAddress)) {
      return jsonError(
        "Unattended deposits are not available for this vault. Choose another vault or use Sweep on visit.",
        409,
      );
    }

    const rule = await upsertAutoDepositRule({
      amountUsdc,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      frequency: body.frequency,
      minBalanceFloor,
      mode: body.mode,
      vaultAddress: body.vaultAddress.trim(),
      walletAddress: actorWallet,
    });

    return jsonOk({ rule });
  } catch (error) {
    if (error instanceof ReferralAuthError) {
      return jsonError(error.message, error.status);
    }
    const message =
      error instanceof Error ? error.message : "Could not save the rule.";
    return jsonError(message, authStatus(message));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actorWallet = await requireReferralActorWallet({
      circleSocialUuid: request.nextUrl.searchParams.get("circleSocialUuid"),
      ownerWallet: request.nextUrl.searchParams.get("wallet"),
    });
    await deleteAutoDepositRule(actorWallet);
    return jsonOk({ removed: true });
  } catch (error) {
    if (error instanceof ReferralAuthError) {
      return jsonError(error.message, error.status);
    }
    const message =
      error instanceof Error ? error.message : "Could not remove the rule.";
    return jsonError(message, authStatus(message));
  }
}
