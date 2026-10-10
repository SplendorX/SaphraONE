import { type NextRequest } from "next/server";

import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";
import { ReferralAuthError, requireReferralActorWallet } from "@/lib/referral/auth";
import {
  grantPaidEntitlement,
  listEntitlements,
  unlockFeature,
} from "@/lib/referral/entitlement-service";
import {
  FEATURE_UNLOCK_COST,
  FEATURE_UNLOCK_TERM_LABEL,
} from "@/lib/referral/types";
import { rewardsV2Enabled } from "@/lib/rewards/config";
import {
  featureUnlockPriceUsdc,
  premiumProductLabels,
  recordPremiumPayment,
  releasePremiumPayment,
} from "@/lib/rewards/premium";
import { platformFeeRecipient } from "@/lib/fees";

export const runtime = "nodejs";

/** Missing credentials are a caller error; only a real rejection is 401. */
function isAuthMessage(message: string) {
  return (
    message.includes("Unauthorized") || message.includes("wallet address is required")
  );
}

function authStatus(message: string) {
  if (message.includes("wallet address is required")) return 400;
  if (message.includes("Unauthorized")) return 401;
  return 500;
}


type UnlockBody = {
  circleSocialUuid?: unknown;
  feature?: unknown;
  ownerWallet?: unknown;
  renew?: unknown;
  /** Rewards v2: the USDC payment for this term. */
  txHash?: unknown;
  walletAddress?: unknown;
};

export async function GET(request: NextRequest) {
  try {
    const actorWallet = await requireReferralActorWallet({
      circleSocialUuid: request.nextUrl.searchParams.get("circleSocialUuid"),
      ownerWallet: request.nextUrl.searchParams.get("wallet"),
    });

    return jsonOk({
      costs: FEATURE_UNLOCK_COST,
      entitlements: await listEntitlements(actorWallet),
      // Rewards v2: features are paid in USDC to the platform fee wallet.
      ...(rewardsV2Enabled()
        ? {
            feeRecipient: platformFeeRecipient() || null,
            pricesUsdc: {
              EARN_AUTO_DEPOSIT: featureUnlockPriceUsdc("EARN_AUTO_DEPOSIT"),
              PAYROLL_AUTO_SCHEDULE: featureUnlockPriceUsdc("PAYROLL_AUTO_SCHEDULE"),
            },
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof ReferralAuthError) {
      return jsonError(error.message, error.status);
    }
    const message =
      error instanceof Error ? error.message : "Could not load entitlements.";
    return jsonError(message, authStatus(message));
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonRecord<UnlockBody>(request);
    if (!body) {
      return jsonError("A valid JSON body is required.", 400);
    }

    const actorWallet = await requireReferralActorWallet({
      circleSocialUuid: body.circleSocialUuid,
      ownerWallet: body.ownerWallet || body.walletAddress,
    });

    if (
      body.feature !== "EARN_AUTO_DEPOSIT" &&
      body.feature !== "PAYROLL_AUTO_SCHEDULE"
    ) {
      return jsonError("Unknown feature.", 400);
    }

    // Rewards v2: one term per verified USDC payment, recorded as a premium
    // purchase (which points discounts are later claimed against).
    if (rewardsV2Enabled()) {
      const feature = body.feature;
      const paid = await recordPremiumPayment({
        amountUsdc: featureUnlockPriceUsdc(feature),
        description: `${premiumProductLabels[feature]}, ${FEATURE_UNLOCK_TERM_LABEL[feature]}`,
        ownerWallet: actorWallet,
        product: feature,
        txHash: typeof body.txHash === "string" ? body.txHash : "",
      });
      if (!paid.ok) return jsonError(paid.reason, paid.status);
      try {
        const entitlement = await grantPaidEntitlement({
          feature,
          purchaseId: paid.purchase.id,
          walletAddress: actorWallet,
        });
        return jsonOk({ alreadyUnlocked: false, entitlement, purchase: paid.purchase });
      } catch (grantError) {
        await releasePremiumPayment(paid.purchase.id).catch(() => undefined);
        throw grantError;
      }
    }

    const result = await unlockFeature({
      feature: body.feature,
      renew: body.renew === true,
      walletAddress: actorWallet,
    });

    return jsonOk(result);
  } catch (error) {
    if (error instanceof ReferralAuthError) {
      return jsonError(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Could not unlock.";
    const status = isAuthMessage(message)
      ? authStatus(message)
      : /OnePoints\. You have|needs \d+ OnePoints/i.test(message)
        ? 400
        : 500;
    return jsonError(message, status);
  }
}
