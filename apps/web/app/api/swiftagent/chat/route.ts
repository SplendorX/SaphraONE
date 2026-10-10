// PHASE G: add createGatewayMiddleware here.
//
// This handler is intentionally shaped as the future x402 payment gate entry
// point. When Phase G (x402 / Circle Gateway Nanopayments) lands, wrap the
// POST below with the Gateway middleware — everything downstream of the gate
// (tier selection, inference, policy evaluation) is unchanged, and the
// marketplace listing in docs/allie-marketplace-listing.md gets the live
// 402 `accepted[]` chains.

import { NextResponse, type NextRequest } from "next/server";

import { jsonError, readJsonRecord } from "@/lib/http";
import {
  assertRecurringAccess,
  resolveSessionActorWallet,
} from "@/lib/recurring-auth";

import { classifyMessage } from "@/lib/allie/classifier";
import { buildAllieContext, serializeAllieContext } from "@/lib/allie/context";
import {
  buildIntentKey,
  extractPaymentAction,
  isAllieLlmConfigured,
  readCachedAction,
  shouldEscalateToTierThree,
  writeCachedAction,
  type AllieAction,
  type AllieActionResult,
} from "@/lib/allie/llm";
import {
  allieOveragePoints,
  canPayAllieOverage,
  chargeAllieOverage,
  checkEscalationBudget,
  checkLlmBudget,
  getAllieTier,
  recordLlmCall,
} from "@/lib/allie/monetization";

import { loadAgentWalletConfig } from "@/lib/agent-wallet/config";
import {
  createAgentIntent,
  parseAmountUnits,
  type PaymentIntent,
} from "@/lib/payment-engine/intent";
import { insertIntent, updateIntentStatus } from "@/lib/payment-engine/ledger";
import {
  evaluatePolicy,
  getDailySpentUnits,
  loadPolicyConfigOrDefault,
} from "@/lib/payment-engine/policy";
import { computeAgentFees, serializeFees } from "@/lib/allie/agent-fees";
import { resolveAllieAction, type AllieOutcome } from "@/lib/allie/capabilities";
import { loadContacts } from "@/lib/payment-engine/contacts";
import { resolveRecipient } from "@/lib/payment-engine/recipients";
import { routeIntent, railEstimatedSeconds } from "@/lib/payment-engine/router";

export const runtime = "nodejs";

const maxMessageLength = 1_000;

type ChatBody = {
  circleSocialUuid?: unknown;
  message?: unknown;
  ownerWallet?: unknown;
  sessionId?: unknown;
};

type ChatResponse = {
  action: AllieAction;
  tier: 1 | 2 | 3;
  confidence: number;
  allowed: boolean;
  requiresApproval?: boolean;
  reason?: string;
  intentId?: string;
  upgradeRequired?: boolean;
  /** OnePoints charged for calls past today's included Pro budget. */
  overagePoints?: number;
  rail?: string;
  estimatedFeeUnits?: string;
  estimatedSeconds?: number;
  resolvedRecipient?: string;
  recipientLabel?: string;
  amountUnits?: string;
  context?: ReturnType<typeof serializeAllieContext>;
  feeCharged?: boolean;
  outcome?: AllieOutcome;
  legs?: { address: string; amountUnits: string; label: string }[];
  fees?: ReturnType<typeof serializeFees>;
  totalDebitUnits?: string;
  /** The plan the fees were priced on: Pro has no per-payment ALLIE fee. */
  plan?: "free" | "pro";
};

function upgradePrompt(): AllieAction {
  return {
    type: "Clarify",
    question:
      "That one needs ALLIE Pro — my language understanding tier. Upgrade to Pro and I can handle free-form instructions like this. For now, try a direct phrasing such as “send $10 to @alex”.",
  };
}

export async function POST(request: NextRequest) {
  const body = await readJsonRecord<ChatBody>(request);

  if (!body) {
    return jsonError("A valid JSON body is required.", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!message) {
    return jsonError("A message is required.", 400);
  }

  if (message.length > maxMessageLength) {
    return jsonError(
      `Messages are limited to ${maxMessageLength} characters.`,
      400,
    );
  }

  if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
    return jsonError("A sessionId is required.", 400);
  }

  // 1. Owner wallet: the supplied wallet when the session covers it, else the
  //    session's own; either must still pass the authorization check.
  const ownerWallet = await resolveSessionActorWallet(body.ownerWallet);

  if (!ownerWallet) {
    return jsonError("Sign in before chatting with ALLIE.", 401);
  }

  const canAccess = await assertRecurringAccess({
    circleSocialUuid: body.circleSocialUuid,
    ownerWallet,
  });

  if (!canAccess) {
    return jsonError("Authorize this wallet before chatting with ALLIE.", 401);
  }

  try {
    // 2. Agent wallet + policy.
    const [agentWallet, policy] = await Promise.all([
      loadAgentWalletConfig(ownerWallet),
      loadPolicyConfigOrDefault(ownerWallet),
    ]);

    // 3. Tier. Free tier is Tier 1 only — LLM calls are blocked outright.
    const allieTier = await getAllieTier(ownerWallet);

    // 5. Bounded prompt context.
    const context = await buildAllieContext(ownerWallet);

    // 6. Tier 1 — rule based, zero cost.
    const tierOne = classifyMessage(message);

    let result: AllieActionResult | { action: AllieAction; tier: 1; confidence: number };
    let upgradeRequired = false;
    let overagePointsCharged = 0;

    if (tierOne) {
      result = tierOne;
    } else if (allieTier === "free") {
      // Free-tier users never trigger Tier 2 or Tier 3.
      upgradeRequired = true;
      result = { action: upgradePrompt(), tier: 1, confidence: 0 };
    } else if (!isAllieLlmConfigured()) {
      result = {
        action: {
          type: "Clarify",
          question:
            "My language tier is offline right now. Try a direct instruction such as “send $10 to @alex”.",
        },
        tier: 1,
        confidence: 0,
      };
    } else {
      // 4. Daily LLM budget (Pro only). Past it, each further model call
      //    costs 0.002 USDC in OnePoints so Pro keeps working all day.
      const budget = await checkLlmBudget(ownerWallet);
      // Calls still covered by today's budget; anything past this is paid.
      let includedCalls = budget.allowed ? budget.remaining : 0;
      const canRun =
        budget.allowed ||
        (budget.exhausted && (await canPayAllieOverage(ownerWallet)));

      if (!canRun) {
        result = {
          action: {
            type: "Clarify",
            question: budget.exhausted
              ? `You've used today's included ALLIE Pro requests. Extra requests cost ${allieOveragePoints()} OnePoints (0.002 USDC) each, and your OnePoints balance is too low. Direct instructions still work, and the free budget resets at 00:00 UTC.`
              : "ALLIE Pro can't check today's request budget right now. Direct instructions still work; try again in a moment.",
          },
          tier: 1,
          confidence: 0,
        };
      } else {
        // 7. Cache → Tier 2 → escalate to Tier 3.
        const intentKey = buildIntentKey(ownerWallet, message, context);
        const cached = await readCachedAction(intentKey);

        if (cached) {
          result = { action: cached, tier: 2, confidence: 0.85, cached: true };
        } else {
          // An escalated message is two billable calls, not one — keep both so
          // neither the cost ledger nor the daily budget under-counts.
          const attempts: AllieActionResult[] = [
            await extractPaymentAction(message, context, 2),
          ];

          // Tier 3 has its own, tighter daily ceiling. When it is spent the
          // message keeps the Tier 2 answer instead of failing.
          if (shouldEscalateToTierThree(message, attempts[0])) {
            const escalation = await checkEscalationBudget(ownerWallet);
            // Past the budget the escalation is a second paid call; only
            // make it when the points cover both.
            const paidCallsNeeded = Math.max(0, 2 - includedCalls);
            const affordable =
              paidCallsNeeded === 0 || (await canPayAllieOverage(ownerWallet, paidCallsNeeded));

            if (escalation.allowed && affordable) {
              attempts.push(await extractPaymentAction(message, context, 3));
            }
          }

          const inference = attempts[attempts.length - 1];

          // 8. Record usage for every call that actually reached the provider.
          for (const attempt of attempts) {
            if (attempt.usage) {
              await recordLlmCall(
                ownerWallet,
                attempt.tier,
                attempt.usage.inputTokens,
                attempt.usage.outputTokens,
                attempt.usage.model,
                attempt.usage.costEstimateUsdc,
              );
              if (includedCalls > 0) {
                includedCalls -= 1;
              } else if (
                await chargeAllieOverage(ownerWallet, {
                  tier: attempt.tier,
                  model: attempt.usage.model,
                })
              ) {
                overagePointsCharged += allieOveragePoints();
              }
            }
          }

          if (inference.action.type !== "Clarify") {
            await writeCachedAction(intentKey, inference.action);
          }

          result = inference;
        }
      }
    }

    const action = result.action;
    const tier = result.tier as 1 | 2 | 3;
    const response: ChatResponse = {
      action,
      tier,
      confidence: result.confidence,
      allowed: true,
      upgradeRequired: upgradeRequired || undefined,
      overagePoints: overagePointsCharged > 0 ? Number(overagePointsCharged.toFixed(2)) : undefined,
      context: serializeAllieContext(context),
    };

    // 9. Money-moving actions go through the policy engine and stop there —
    //    only /api/swiftagent/execute can execute, and only after the person
    //    explicitly confirms. Everything else resolves against SaphraONE's own
    //    data or is prepared for the product UI to finish.
    const movesMoney =
      action.type === "PaymentIntent" || action.type === "BatchPay";

    if (movesMoney) {
      if (!agentWallet) {
        return NextResponse.json({
          ...response,
          allowed: false,
          reason:
            "Set up your ALLIE Agent Wallet before asking me to send a payment.",
        } satisfies ChatResponse);
      }

      if (agentWallet.status !== "active") {
        return NextResponse.json({
          ...response,
          allowed: false,
          reason: `Your agent wallet is ${agentWallet.status}.`,
        } satisfies ChatResponse);
      }

      const asset = action.asset;

      // Resolve every recipient before anything is written down.
      const requested =
        action.type === "BatchPay"
          ? action.legs
          : [{ recipient: action.recipient, amountUsdc: action.amountUsdc }];

      const legs: {
        recipient: string;
        label: string;
        address: string;
        amountUnits: bigint;
      }[] = [];

      // Names can be the owner's saved contacts, not only @usernames.
      const contacts = await loadContacts(ownerWallet);

      for (const leg of requested) {
        const amountUnits = parseAmountUnits(leg.amountUsdc);

        if (!amountUnits) {
          return NextResponse.json({
            ...response,
            allowed: false,
            reason: `${leg.amountUsdc} isn't a valid payment amount.`,
          } satisfies ChatResponse);
        }

        const resolved = await resolveRecipient(leg.recipient, { contacts, message });

        if (!resolved) {
          return NextResponse.json({
            ...response,
            allowed: false,
            reason: `I couldn't find ${leg.recipient} in your contacts or as a SaphraONE username.`,
          } satisfies ChatResponse);
        }

        legs.push({
          address: resolved.address,
          amountUnits,
          label: resolved.label,
          recipient: leg.recipient,
        });
      }

      const totalUnits = legs.reduce((sum, leg) => sum + leg.amountUnits, 0n);

      let intent: PaymentIntent = createAgentIntent({
        initiatorId: ownerWallet,
        recipient:
          legs.length === 1
            ? legs[0].recipient
            : `${legs.length} recipients`,
        resolvedRecipient:
          legs.length === 1
            ? (legs[0].address as PaymentIntent["resolvedRecipient"])
            : undefined,
        asset,
        amountUnits: totalUnits,
        rail: "agent-direct",
        metadata: {
          source: "allie",
          sessionId: body.sessionId,
          tier,
          note: action.type === "PaymentIntent" ? action.note : action.note,
          agentWalletId: agentWallet.walletId,
          recipientLabel:
            legs.length === 1 ? legs[0].label : `${legs.length} recipients`,
          ...(action.type === "BatchPay"
            ? {
                kind: "allie-batch",
                legs: legs.map((leg) => ({
                  address: leg.address,
                  amountUnits: leg.amountUnits.toString(),
                  label: leg.label,
                })),
              }
            : {}),
        },
      });

      intent = await insertIntent(intent);
      intent = await updateIntentStatus(intent.intentId, "policy_check");

      const dailySpentUnits = await getDailySpentUnits(ownerWallet);

      // Every leg is checked against the per-transaction limit, the allowlist
      // and the asset rules on its own; the total is what the daily cap sees.
      let verdict = evaluatePolicy(
        { ...intent, amountUnits: totalUnits },
        policy,
        dailySpentUnits,
      );

      if (verdict.allowed) {
        for (const leg of legs) {
          const legVerdict = evaluatePolicy(
            {
              ...intent,
              amountUnits: leg.amountUnits,
              recipient: leg.recipient,
              resolvedRecipient: leg.address as PaymentIntent["resolvedRecipient"],
            },
            policy,
            // The daily cap is judged once on the total, above.
            0n,
          );

          if (!legVerdict.allowed) {
            verdict = {
              allowed: false,
              reason: `${leg.label}: ${legVerdict.reason}`,
            };
            break;
          }

          if (legVerdict.requiresApproval) {
            verdict = { ...verdict, requiresApproval: true };
          }
        }
      }

      const decision = routeIntent(intent, {
        initiatorType: "agent",
        walletMode: "agent",
        isBatch: legs.length > 1,
      });

      // What will actually leave the wallet — the router's own estimate only
      // covers the platform cut, and ALLIE settles outside the send router.
      const breakdown = computeAgentFees(totalUnits, allieTier);
      response.plan = allieTier;

      response.intentId = intent.intentId;
      response.rail = decision.rail;
      response.estimatedFeeUnits = breakdown.totalFeeUnits.toString();
      response.fees = serializeFees(breakdown);
      response.totalDebitUnits = breakdown.totalDebitUnits.toString();
      response.estimatedSeconds = railEstimatedSeconds[decision.rail];
      response.amountUnits = totalUnits.toString();
      response.resolvedRecipient = legs.length === 1 ? legs[0].address : undefined;
      response.recipientLabel =
        legs.length === 1 ? legs[0].label : `${legs.length} recipients`;
      response.legs = legs.map((leg) => ({
        address: leg.address,
        amountUnits: leg.amountUnits.toString(),
        label: leg.label,
      }));

      if (!verdict.allowed) {
        await updateIntentStatus(intent.intentId, "rejected", {
          metadata: { ...intent.metadata, rejectedReason: verdict.reason },
        });

        return NextResponse.json({
          ...response,
          allowed: false,
          reason: verdict.reason,
        } satisfies ChatResponse);
      }

      // 'approved' means "policy passed, awaiting the human". Nothing has been
      // submitted anywhere at this point.
      await updateIntentStatus(intent.intentId, "approved", {
        rail: decision.rail === "not-yet-available" ? undefined : decision.rail,
        ...(legs.length === 1 ? { resolvedRecipient: legs[0].address } : {}),
      });

      return NextResponse.json({
        ...response,
        allowed: true,
        requiresApproval: verdict.requiresApproval,
      } satisfies ChatResponse);
    }

    // 10. Everything else: read it, or prepare it for the product that owns it.
    const outcome = await resolveAllieAction(action, ownerWallet);

    return NextResponse.json({
      ...response,
      outcome: outcome ?? undefined,
    } satisfies ChatResponse);
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "ALLIE could not process that message.",
      500,
    );
  }
}
