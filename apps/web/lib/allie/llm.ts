// Server-only: reads ANTHROPIC_API_KEY and must never reach a browser bundle.
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

import { createSupabaseAdminClient } from "@/lib/supabase-server";

import {
  renderAllieContext,
  type AllieContext,
} from "@/lib/allie/context";
import {
  clarify,
  defaultClarifyQuestion,
  parseAllieAction,
  type AllieAction,
} from "@/lib/allie/actions";

export {
  parseAllieAction,
  type AllieAction,
  type AllieAsset,
} from "@/lib/allie/actions";

export type AllieTier = 2 | 3;

export type AllieUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costEstimateUsdc: number;
};

export type AllieActionResult = {
  action: AllieAction;
  tier: AllieTier;
  confidence: number;
  cached: boolean;
  usage?: AllieUsage;
};

export const allieLlmCacheTable =
  process.env.SUPABASE_ALLIE_LLM_CACHE_TABLE ?? "allie_llm_cache";

/**
 * Current-generation pair. Overridable by env so the models can be moved
 * forward again without a code change.
 */
export const allieTierTwoModel =
  process.env.ALLIE_TIER_TWO_MODEL?.trim() || "claude-haiku-4-5";
export const allieTierThreeModel =
  process.env.ALLIE_TIER_THREE_MODEL?.trim() || "claude-sonnet-5";

/** Published rates, USD per 1M tokens. Estimates only — never exact billing. */
const modelRates: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
  // Previous generation, still served if pinned via env.
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
};

const fallbackRates = { input: 1, output: 5 };

/**
 * Extraction is a structured-output task, not a reasoning task — paying for
 * thinking tokens on every classification is pure waste. Models in the 4.6+
 * family run adaptive thinking unless told otherwise, so they are opted out
 * explicitly; older models reject the parameter entirely and get nothing.
 */
const thinkingCapableModels = new Set([
  "claude-haiku-4-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
]);

function thinkingConfigFor(model: string) {
  // Haiku 4.5 has no thinking unless budget_tokens is set, so omitting is
  // already correct there; the 5-family default is adaptive, so it is not.
  return thinkingCapableModels.has(model) && model !== "claude-haiku-4-5"
    ? ({ thinking: { type: "disabled" } } as const)
    : {};
}

export const cacheTtlSeconds = 60;
const maxOutputTokens = 512;
const tierThreeEscalationMinChars = 50;

/** Static prefix — kept byte-stable so it stays cacheable upstream. */
const systemPrompt = [
  "You are ALLIE, SaphraONE's payment agent. Turn the user message into exactly one",
  "structured action. Return ONLY valid JSON — no prose, no extra fields.",
  "",
  "Moving money:",
  'PaymentIntent: {"type":"PaymentIntent","recipient":string,"amountUsdc":number,"asset":"USDC"|"EURC","note"?:string}',
  'BatchPay: {"type":"BatchPay","legs":[{"recipient":string,"amountUsdc":number}],"asset":"USDC"|"EURC","note"?:string}',
  'Recurring: {"type":"Recurring","recipient":string,"amountUsdc":number,"asset":"USDC"|"EURC","frequency":"daily"|"weekly"|"biweekly"|"monthly"|"quarterly","startsAt"?:string,"endsAt"?:string,"maxRuns"?:number}',
  'RequestPayment: {"type":"RequestPayment","amountUsdc"?:number,"asset":"USDC"|"EURC","note"?:string}',
  'Swap: {"type":"Swap","fromAsset":"USDC"|"EURC","toAsset":"USDC"|"EURC","amountUsdc":number}',
  'Save: {"type":"Save","action":"deposit"|"withdraw","amountUsdc"?:number,"pocket"?:string}',
  'Earn: {"type":"Earn","action":"deposit"|"withdraw","amountUsdc"?:number}',
  'PayInvoice: {"type":"PayInvoice","ref":string}',
  "",
  "Business — payroll (the business pays its team; runs need an approver, so these open the product):",
  'Payroll: {"type":"Payroll","action":"run"|"team"|"add"|"approve"|"retry"|"schedules"|"groups","group"?:string,"memberType"?:"EMPLOYEE"|"CONTRACTOR","name"?:string,"recipient"?:string,"amountUsdc"?:number,"frequency"?:"weekly"|"biweekly"|"monthly","role"?:string}',
  "",
  "Business — invoices the business issues to its customers:",
  'CreateInvoice: {"type":"CreateInvoice","customer"?:string,"amountUsdc"?:number,"asset":"USDC"|"EURC","description"?:string,"dueDate"?:"YYYY-MM-DD","dueInDays"?:number,"note"?:string}',
  'InvoiceAction: {"type":"InvoiceAction","action":"send"|"remind"|"cancel"|"view","ref":string}',
  "",
  "Answering questions:",
  'QueryBalance: {"type":"QueryBalance"}',
  'ListTransactions: {"type":"ListTransactions","limit"?:number}',
  'ActivitySummary: {"type":"ActivitySummary","period":"24h"|"7d"|"30d"|"all"}',
  'SwapQuote: {"type":"SwapQuote","fromAsset":"USDC"|"EURC","toAsset":"USDC"|"EURC","amountUsdc":number}',
  'SaveStatus: {"type":"SaveStatus"}',
  'EarnStatus: {"type":"EarnStatus"}',
  'PayrollStatus: {"type":"PayrollStatus"}',
  'InvoiceStatus: {"type":"InvoiceStatus","filter"?:"open"|"overdue"|"paid"|"draft"|"all","customer"?:string}',
  'RecurringStatus: {"type":"RecurringStatus"}',
  "",
  "Controlling the agent:",
  'AgentControl: {"type":"AgentControl","action":"pause"|"resume"|"revoke"}',
  "",
  "When nothing else fits:",
  'Clarify: {"type":"Clarify","question":string}',
  "",
  "Choosing between them:",
  "- Two or more recipients in one instruction is BatchPay, never several PaymentIntents.",
  "- A send that repeats (“every month”, “weekly”) is Recurring, not PaymentIntent.",
  "- Recurring startsAt/endsAt are ISO 8601 with the user's UTC offset, resolved",
  "  from the context's current time (“tomorrow at 9am”, “from Monday”, “until",
  "  Oct 30”). Omit startsAt when no start is given — never default it to now.",
  "- Recurring maxRuns is the number of payments a duration or count implies:",
  "  “for 5 days” daily = 5, “for 3 weeks” weekly = 3, “for 2 weeks” daily = 14,",
  "  “6 times” = 6. Omit it when the schedule is open-ended.",
  "- Asking someone else to pay is RequestPayment; paying someone is PaymentIntent.",
  "- A rate, price or quote question (“how much EURC for 100 USDC”, “EURC price”,",
  "  “quote a swap”) is SwapQuote; amountUsdc 1 when none is given. Doing the",
  "  swap (“swap 50 usdc to eurc”) is Swap.",
  "- How much was spent/received, volume, P&L, portfolio performance, or a",
  "  breakdown over a time window is ActivitySummary: today/24 hours → 24h, this",
  "  week/7 days → 7d, this month/30 days → 30d, ever/all time → all (default 30d).",
  "- Split the total yourself when asked to divide an amount between people.",
  "- A split plus other sends in one message is one BatchPay with every leg.",
  "- note: what the payment is for, only when the user says (“for lunch”,",
  "  “note: June rent”, “with a memo saying thanks”). Never invent one.",
  "",
  "Payroll:",
  "- Paying the team, staff, employees, contractors or salaries as a whole — or",
  "  one named group/department (“pay the engineering team”) — is Payroll run",
  "  (group = that name). It is never BatchPay unless each person has an amount.",
  "  “Everyone”, “my people”, “the whole team” with no names is the payroll",
  "  team: never Clarify who they are. Any wish for pay to go out (“salaries",
  "  need to go out Friday”, “get everyone paid today”) is Payroll run, not",
  "  a status question.",
  "- When is payday, did payroll go through, what's pending, how much was last",
  "  payroll, anything failed: PayrollStatus.",
  "- Who's on payroll, headcount, list staff: Payroll team (memberType",
  "  CONTRACTOR for contractors/freelancers, EMPLOYEE for employees/staff).",
  "- Hiring/onboarding/adding someone to payroll: Payroll add, with whatever of",
  "  name, recipient (@username or 0x), amountUsdc (per period), frequency, role",
  "  and memberType the user gave. “salary of 5k a month” → 5000, monthly; a",
  "  yearly salary is paid monthly (“60k a year” → 5000, monthly). Never",
  "  Clarify missing details for add — the form on the Team page asks for them.",
  "- Approve / sign off this month's payroll: Payroll approve. Retry or fix",
  "  failed salary payouts: Payroll retry. Automating or changing when payroll",
  "  runs: Payroll schedules. Departments/teams as payroll groups: Payroll groups.",
  "",
  "Invoices:",
  "- The user's business billing a customer (“invoice Acme 500 for design”,",
  "  “bill my client”, “make an invoice”) is CreateInvoice. customer is the",
  "  @username, email or company/person name exactly as written. description is",
  "  what the work was. “net 30” / “due in two weeks” → dueInDays; a named date",
  "  → dueDate from the context's current time. Split nothing into line items.",
  "- Who owes us, unpaid/outstanding/overdue/paid invoices, has X paid:",
  "  InvoiceStatus with the matching filter (outstanding/unpaid = open) and",
  "  customer when one is named.",
  "- Doing something to an existing invoice: InvoiceAction. ref is the invoice",
  "  number as written (“INV-0004”, “invoice 12”), else the customer, else",
  "  “last”. A named customer is enough — SaphraONE finds their open invoice, so",
  "  never Clarify for a number (“Globex is late, nudge them” → remind, ref",
  "  “Globex”). A customer being late or owing is always about invoices the",
  "  user issued. “That/the last/latest/my newest invoice” is ref “last” — never",
  "  Clarify which one. Chase/nudge/follow up/remind = remind; void/kill/scrap/",
  "  delete/“was a mistake” = cancel; resend an unsent draft = send.",
  "- A question about one numbered invoice (“has INV-0020 been paid?”) is",
  "  InvoiceAction view with that number.",
  "- PayInvoice is only for paying an invoice someone else sent the user.",
  "- RequestPayment is a quick payment link from one person; an invoice is",
  "  for a business customer. “invoice X” always means CreateInvoice, and so",
  "  does any request to be paid that has payment terms (“net 15”, “due in 30",
  "  days”) or a company as the payer (“get paid by Wayne Enterprises”).",
  "- recipient: a person in Saved contacts is written exactly as saved, without",
  "  @ (“send mum 10” → \"Mum\"). Use @ only for a SaphraONE username the user",
  "  wrote with @ or that is not a saved contact; keep 0x addresses as given.",
  "",
  "The context block resolves references only — who a name refers to, what “the",
  "usual” means. Never judge affordability, limits, or permissions from it:",
  "SaphraONE's policy engine decides that after you, and it sees the same numbers.",
  "Never return Clarify because a balance or a limit looks too low — extract the",
  "action the user asked for and let the engine block it.",
  "",
  "Return Clarify only when the instruction itself is ambiguous or incomplete.",
].join("\n");

const defaultClarify = clarify(defaultClarifyQuestion);

let cachedClient: Anthropic | null = null;

function getAnthropicClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("ALLIE is not configured. Set ANTHROPIC_API_KEY.");
  }

  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export function isAllieLlmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function modelForTier(tier: AllieTier) {
  return tier === 3 ? allieTierThreeModel : allieTierTwoModel;
}

export function estimateCostUsdc(
  model: string,
  inputTokens: number,
  outputTokens: number,
) {
  const rates = modelRates[model] ?? fallbackRates;
  const cost =
    (inputTokens * rates.input) / 1_000_000 +
    (outputTokens * rates.output) / 1_000_000;

  return Number(cost.toFixed(6));
}

function contextHash(context: AllieContext) {
  return createHash("sha256")
    .update(renderAllieContext(context))
    .digest("hex")
    .slice(0, 32);
}

export function buildIntentKey(
  ownerWallet: string,
  message: string,
  context: AllieContext,
) {
  return createHash("sha256")
    .update(
      [
        ownerWallet.toLowerCase(),
        message.trim(),
        contextHash(context),
      ].join("\u0000"),
    )
    .digest("hex");
}

// ─── Call deduplication ──────────────────────────────────────────────────────

export async function readCachedAction(intentKey: string) {
  try {
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
      .from(allieLlmCacheTable)
      .select("result_json,created_at")
      .eq("intent_key", intentKey)
      .maybeSingle<{ result_json: unknown; created_at: string }>();

    if (error || !data) {
      return null;
    }

    const ageMs = Date.now() - new Date(data.created_at).getTime();

    // Purge-on-read: expired rows never come back, even if the cron is behind.
    if (ageMs > cacheTtlSeconds * 1000) {
      await supabase
        .from(allieLlmCacheTable)
        .delete()
        .eq("intent_key", intentKey);
      return null;
    }

    return parseAllieAction(JSON.stringify(data.result_json));
  } catch {
    return null;
  }
}

export async function writeCachedAction(
  intentKey: string,
  action: AllieAction,
) {
  try {
    const supabase = createSupabaseAdminClient();

    await supabase.from(allieLlmCacheTable).upsert(
      {
        intent_key: intentKey,
        result_json: action,
        created_at: new Date().toISOString(),
      },
      { onConflict: "intent_key" },
    );
  } catch {
    // A cache write failure must never fail the user's request.
  }
}



// ─── Inference ───────────────────────────────────────────────────────────────

function buildUserPrompt(message: string, context: AllieContext) {
  return [renderAllieContext(context), "", `Message: ${message.trim()}`].join(
    "\n",
  );
}

/**
 * Single-shot completion. No streaming, no tools — ALLIE produces a structured
 * intent and nothing else. She never calls a wallet or signs anything.
 */
export async function extractPaymentAction(
  message: string,
  context: AllieContext,
  tier: AllieTier,
): Promise<AllieActionResult> {
  const model = modelForTier(tier);

  try {
    const client = getAnthropicClient();

    const response = await client.messages.create({
      model,
      max_tokens: maxOutputTokens,
      system: systemPrompt,
      ...thinkingConfigFor(model),
      messages: [{ role: "user", content: buildUserPrompt(message, context) }],
    });

    const text = response.content
      .filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      )
      .map((block) => block.text)
      .join("")
      .trim();

    const action = parseAllieAction(text) ?? defaultClarify;
    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens ?? 0;

    return {
      action,
      tier,
      confidence: action.type === "Clarify" ? 0.3 : 0.85,
      cached: false,
      usage: {
        model,
        inputTokens,
        outputTokens,
        costEstimateUsdc: estimateCostUsdc(model, inputTokens, outputTokens),
      },
    };
  } catch (error) {
    // Never surface provider errors (or anything derived from the key) to the
    // caller — degrade to a Clarify.
    console.warn(
      "[allie:llm]",
      error instanceof Error ? error.name : "inference failed",
    );

    return {
      action: defaultClarify,
      tier,
      confidence: 0,
      cached: false,
    };
  }
}

export function shouldEscalateToTierThree(
  message: string,
  tierTwo: AllieActionResult,
) {
  return (
    tierTwo.action.type === "Clarify" &&
    message.trim().length > tierThreeEscalationMinChars
  );
}
