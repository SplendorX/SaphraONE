/**
 * Every action ALLIE can produce.
 *
 * She only ever returns one of these — the engine decides what happens next.
 * Three execution classes, which the capability layer enforces:
 *
 *   answer   — read-only, resolved from SaphraONE's own data
 *   execute  — ALLIE can complete it from the Agent Wallet, after confirmation
 *   prepare  — needs the user's own wallet signature, so ALLIE assembles the
 *              request and hands it to the product UI with everything filled in
 */

export type AllieAsset = "USDC" | "EURC";

export const allieFrequencies = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
] as const;

export type AllieFrequency = (typeof allieFrequencies)[number];

export type AllieBatchLeg = { recipient: string; amountUsdc: number };

/** Windows ALLIE summarizes activity over. */
export const allieActivityPeriods = ["24h", "7d", "30d", "all"] as const;
export type AllieActivityPeriod = (typeof allieActivityPeriods)[number];

export const alliePayrollActions = [
  "run",
  "team",
  "add",
  "approve",
  "retry",
  "schedules",
  "groups",
] as const;
export type AlliePayrollAction = (typeof alliePayrollActions)[number];

export const allieMemberTypes = ["EMPLOYEE", "CONTRACTOR"] as const;
export type AllieMemberType = (typeof allieMemberTypes)[number];

/** Payroll pays on these; "daily" and "quarterly" are not payroll cycles. */
export const alliePayrollFrequencies = ["weekly", "biweekly", "monthly"] as const;
export type AlliePayrollFrequency = (typeof alliePayrollFrequencies)[number];

export const allieInvoiceFilters = ["open", "overdue", "paid", "draft", "all"] as const;
export type AllieInvoiceFilter = (typeof allieInvoiceFilters)[number];

export const allieInvoiceActions = ["send", "remind", "cancel", "view"] as const;
export type AllieInvoiceAction = (typeof allieInvoiceActions)[number];

export type AllieAction =
  // ── execute ───────────────────────────────────────────────────────────────
  | {
      type: "PaymentIntent";
      recipient: string;
      amountUsdc: number;
      asset: AllieAsset;
      note?: string;
    }
  | { type: "BatchPay"; legs: AllieBatchLeg[]; asset: AllieAsset; note?: string }
  // ── answer ────────────────────────────────────────────────────────────────
  | { type: "QueryBalance" }
  | { type: "ListTransactions"; limit?: number }
  /** Money in, money out, volume and where it went, over a period. */
  | { type: "ActivitySummary"; period: AllieActivityPeriod }
  /** A live swap quote: rate, route, minimum received, costs. Nothing is signed. */
  | { type: "SwapQuote"; fromAsset: AllieAsset; toAsset: AllieAsset; amountUsdc: number }
  | { type: "SaveStatus" }
  | { type: "EarnStatus" }
  | { type: "PayrollStatus" }
  | { type: "RecurringStatus" }
  | { type: "AgentControl"; action: "pause" | "resume" | "revoke" }
  // ── prepare ───────────────────────────────────────────────────────────────
  | {
      type: "RequestPayment";
      amountUsdc?: number;
      asset: AllieAsset;
      /** Who the money is being asked of. */
      from?: string;
      note?: string;
    }
  | {
      type: "Recurring";
      recipient: string;
      amountUsdc: number;
      asset: AllieAsset;
      frequency: AllieFrequency;
      /** First payment (ISO). Omitted: RecurePay starts 30 minutes from opening. */
      startsAt?: string;
      /** No payments after this (ISO). */
      endsAt?: string;
      /** Stop after this many payments ("for 5 days" daily = 5). */
      maxRuns?: number;
    }
  | { type: "Swap"; fromAsset: AllieAsset; toAsset: AllieAsset; amountUsdc: number }
  | { type: "Save"; action: "deposit" | "withdraw"; amountUsdc?: number; pocket?: string }
  | { type: "Earn"; action: "deposit" | "withdraw"; amountUsdc?: number }
  | {
      type: "Payroll";
      action: AlliePayrollAction;
      /** run: the payroll group to pay ("engineering"). */
      group?: string;
      /** team: filter; add: what the new member is. */
      memberType?: AllieMemberType;
      /** add: the new member's name, as the user wrote it. */
      name?: string;
      /** add: where they're paid — @username or 0x address. */
      recipient?: string;
      /** add: their default pay per period. */
      amountUsdc?: number;
      /** add: how often they're paid. */
      frequency?: AlliePayrollFrequency;
      /** add: job title ("designer"). */
      role?: string;
    }
  /** Paying an invoice someone else sent you. */
  | { type: "PayInvoice"; ref: string }
  // ── invoices you issue (Business) ─────────────────────────────────────────
  | { type: "InvoiceStatus"; filter?: AllieInvoiceFilter; customer?: string }
  | {
      type: "CreateInvoice";
      /** @username, an email, or a customer/company name. */
      customer?: string;
      amountUsdc?: number;
      asset: AllieAsset;
      /** The line item: what the invoice is for. */
      description?: string;
      /** YYYY-MM-DD. */
      dueDate?: string;
      /** "due in 14 days", "net 30". Ignored when dueDate is set. */
      dueInDays?: number;
      note?: string;
    }
  | {
      type: "InvoiceAction";
      action: AllieInvoiceAction;
      /** An invoice number (INV-0004), a customer, or "last". */
      ref: string;
    }
  // ── fallback ──────────────────────────────────────────────────────────────
  | { type: "Clarify"; question: string };



export const defaultClarifyQuestion =
  "I didn't understand that. Could you rephrase?";

export function clarify(question?: string): AllieAction {
  return { type: "Clarify", question: question?.trim() || defaultClarifyQuestion };
}

function readAsset(value: unknown): AllieAsset {
  return value === "EURC" ? "EURC" : "USDC";
}

function readAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function readText(value: unknown, max = 200) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

/** Most payments a schedule can be capped at from chat. */
export const maxRecurringRuns = 1000;

function readMaxRuns(value: unknown) {
  const runs = Number(value);
  return Number.isInteger(runs) && runs > 0 && runs <= maxRecurringRuns ? runs : undefined;
}

/**
 * An ISO time with an explicit offset that is not already in the past (1
 * minute of slack). Kept as written, so the user's own offset survives for
 * display.
 */
function readFutureIso(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return undefined;
  }
  const time = Date.parse(trimmed);
  return Number.isFinite(time) && time > Date.now() - 60_000 ? trimmed : undefined;
}

function readFrequency(value: unknown): AllieFrequency | null {
  return allieFrequencies.includes(value as AllieFrequency)
    ? (value as AllieFrequency)
    : null;
}

/** One of `allowed`, or undefined. */
function readEnum<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

/** A calendar date, YYYY-MM-DD, that actually exists. */
function readDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return undefined;
  }
  const date = value.trim();
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
    ? date
    : undefined;
}

function readDays(value: unknown) {
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= 365 ? days : undefined;
}

/** Drops undefined fields so an action carries only what was said. */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as T;
}

/** Longest batch ALLIE will assemble in one go. */
export const maxBatchLegs = 20;

function readLegs(value: unknown): AllieBatchLeg[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const legs: AllieBatchLeg[] = [];

  for (const entry of value.slice(0, maxBatchLegs)) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const candidate = entry as Record<string, unknown>;
    const recipient = readText(candidate.recipient, 64);
    const amountUsdc = readAmount(candidate.amountUsdc);

    if (!recipient || !amountUsdc) {
      return null;
    }

    legs.push({ recipient, amountUsdc });
  }

  return legs.length > 0 ? legs : null;
}

/**
 * Parses the model's JSON. Anything that is not a known, well-formed action is
 * rejected outright — a malformed payment is never guessed at.
 */
export function parseAllieAction(raw: string): AllieAction | null {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const c = parsed as Record<string, unknown>;

  switch (c.type) {
    case "PaymentIntent": {
      const recipient = readText(c.recipient, 64);
      const amountUsdc = readAmount(c.amountUsdc);

      if (!recipient || !amountUsdc) {
        return null;
      }

      return {
        type: "PaymentIntent",
        recipient,
        amountUsdc,
        asset: readAsset(c.asset),
        note: readText(c.note),
      };
    }

    case "BatchPay": {
      const legs = readLegs(c.legs);
      return legs
        ? { type: "BatchPay", legs, asset: readAsset(c.asset), note: readText(c.note) }
        : null;
    }

    case "QueryBalance":
      return { type: "QueryBalance" };

    case "ListTransactions": {
      const limit = Number(c.limit);
      return {
        type: "ListTransactions",
        limit:
          Number.isFinite(limit) && limit > 0
            ? Math.min(Math.floor(limit), 50)
            : undefined,
      };
    }

    case "ActivitySummary":
      return {
        type: "ActivitySummary",
        period: readEnum(allieActivityPeriods, c.period) ?? "30d",
      };

    case "SwapQuote": {
      const amountUsdc = readAmount(c.amountUsdc) ?? 1;
      const fromAsset = readAsset(c.fromAsset);
      const toAsset = c.toAsset === undefined ? (fromAsset === "USDC" ? "EURC" : "USDC") : readAsset(c.toAsset);
      return fromAsset === toAsset ? null : { type: "SwapQuote", fromAsset, toAsset, amountUsdc };
    }

    case "SaveStatus":
      return { type: "SaveStatus" };
    case "EarnStatus":
      return { type: "EarnStatus" };
    case "PayrollStatus":
      return { type: "PayrollStatus" };
    case "RecurringStatus":
      return { type: "RecurringStatus" };

    case "AgentControl": {
      if (c.action === "pause" || c.action === "resume" || c.action === "revoke") {
        return { type: "AgentControl", action: c.action };
      }
      return null;
    }

    case "RequestPayment":
      return {
        type: "RequestPayment",
        amountUsdc: readAmount(c.amountUsdc) ?? undefined,
        asset: readAsset(c.asset),
        from: readText(c.from, 64),
        note: readText(c.note),
      };

    case "Recurring": {
      const recipient = readText(c.recipient, 64);
      const amountUsdc = readAmount(c.amountUsdc);
      const frequency = readFrequency(c.frequency);

      if (!recipient || !amountUsdc || !frequency) {
        return null;
      }

      const startsAt = readFutureIso(c.startsAt);
      const endsAt = readFutureIso(c.endsAt);

      return {
        type: "Recurring",
        recipient,
        amountUsdc,
        asset: readAsset(c.asset),
        frequency,
        startsAt,
        // An end before the start would reject the whole schedule; drop it.
        endsAt:
          endsAt && (!startsAt || Date.parse(endsAt) > Date.parse(startsAt))
            ? endsAt
            : undefined,
        maxRuns: readMaxRuns(c.maxRuns),
      };
    }

    case "Swap": {
      const amountUsdc = readAmount(c.amountUsdc);
      const fromAsset = readAsset(c.fromAsset);
      const toAsset = readAsset(c.toAsset);

      if (!amountUsdc || fromAsset === toAsset) {
        return null;
      }

      return { type: "Swap", fromAsset, toAsset, amountUsdc };
    }

    case "Save": {
      if (c.action !== "deposit" && c.action !== "withdraw") {
        return null;
      }

      return {
        type: "Save",
        action: c.action,
        amountUsdc: readAmount(c.amountUsdc) ?? undefined,
        pocket: readText(c.pocket, 64),
      };
    }

    case "Earn": {
      if (c.action !== "deposit" && c.action !== "withdraw") {
        return null;
      }

      return {
        type: "Earn",
        action: c.action,
        amountUsdc: readAmount(c.amountUsdc) ?? undefined,
      };
    }

    case "Payroll": {
      const action = readEnum(alliePayrollActions, c.action);
      if (!action) {
        return null;
      }
      return compact({
        type: "Payroll" as const,
        action,
        group: readText(c.group, 64),
        memberType: readEnum(allieMemberTypes, c.memberType),
        name: readText(c.name, 80),
        recipient: readText(c.recipient, 64),
        amountUsdc: readAmount(c.amountUsdc) ?? undefined,
        frequency: readEnum(alliePayrollFrequencies, c.frequency),
        role: readText(c.role, 64),
      });
    }

    case "PayInvoice": {
      const ref = readText(c.ref, 64);
      return ref ? { type: "PayInvoice", ref } : null;
    }

    case "InvoiceStatus":
      return compact({
        type: "InvoiceStatus" as const,
        filter: readEnum(allieInvoiceFilters, c.filter),
        customer: readText(c.customer, 80),
      });

    case "CreateInvoice":
      return compact({
        type: "CreateInvoice" as const,
        customer: readText(c.customer, 120),
        amountUsdc: readAmount(c.amountUsdc) ?? undefined,
        asset: readAsset(c.asset),
        description: readText(c.description, 200),
        dueDate: readDate(c.dueDate),
        dueInDays: readDays(c.dueInDays),
        note: readText(c.note, 280),
      });

    case "InvoiceAction": {
      const action = readEnum(allieInvoiceActions, c.action);
      const ref = readText(c.ref, 80);
      return action && ref ? { type: "InvoiceAction", action, ref } : null;
    }

    case "Clarify":
      return clarify(typeof c.question === "string" ? c.question : undefined);

    default:
      return null;
  }
}
