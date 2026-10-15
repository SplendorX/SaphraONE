import type {
  AllieAction,
  AllieActivityPeriod,
  AllieAsset,
  AllieBatchLeg,
  AllieFrequency,
} from "@/lib/allie/actions";
import { classifyBusiness } from "@/lib/allie/business-classifier";

/**
 * Tier 1 — rule based, zero cost, zero latency.
 * Returns null when the message is not a high-confidence match, which is the
 * signal to escalate to Tier 2. Target: ~65% of real payment messages.
 */
export type AllieTierOneResult = {
  action: AllieAction;
  tier: 1;
  confidence: number;
};

const amountPattern = String.raw`\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)`;
const assetPattern = String.raw`(usdc|eurc|usd|dollars?|euros?)?`;
const recipientPattern = String.raw`(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40})`;

// "send $20 to @bob" / "pay 12.50 usdc to 0xABC…" / "transfer 5 EURC to alice"
const sendToPattern = new RegExp(
  String.raw`\b(?:send|pay|transfer|wire)\s+${amountPattern}\s*${assetPattern}\s+(?:to|for)\s+${recipientPattern}`,
  "i",
);

// "pay @bob $20" / "send alice 12 usdc"
const sendReversedPattern = new RegExp(
  String.raw`\b(?:send|pay|transfer|wire)\s+${recipientPattern}\s+${amountPattern}\s*${assetPattern}\b`,
  "i",
);

const balancePattern =
  /\b(?:what(?:'?s| is)\s+my\s+balance|show\s+(?:me\s+)?(?:my\s+)?balance|check\s+(?:my\s+)?balance|how\s+much\s+(?:do\s+i\s+have|have\s+i\s+got)|my\s+balance)\b/i;

const transactionsPattern =
  /\b(?:show\s+(?:me\s+)?my\s+transactions|recent\s+(?:transactions|payments)|payment\s+history|transaction\s+history|last\s+(?:few\s+)?(?:transactions|payments)|list\s+(?:my\s+)?(?:transactions|payments))\b/i;

const pausePattern =
  /\b(?:pause|freeze|suspend|stop)\s+(?:my\s+)?(?:agent\s+wallet|allie)\b/i;

const resumePattern =
  /\b(?:resume|unpause|reactivate|re-?enable|restart)\s+(?:my\s+)?(?:agent\s+wallet|allie)\b/i;

const invoiceNumberPattern = /\bpay\s+(?:the\s+)?invoice\s*#?\s*([A-Za-z0-9_-]{1,64})\b/i;
const invoiceLastPattern = /\bpay\s+(?:my\s+)?(?:last|latest|most\s+recent)\s+invoice\b/i;
const invoiceFromPattern =
  /\bpay\s+(?:the\s+)?invoice\s+from\s+([A-Za-z0-9 _.@-]{2,64})/i;

// ── Product capabilities ────────────────────────────────────────────────────

const savePattern =
  /\b(?:my\s+(?:savings?|pockets?)|savings?\s+(?:balance|total|pockets?|status)|show\s+(?:me\s+)?(?:my\s+)?savings?|how\s+much\s+(?:do\s+i\s+have\s+|is\s+)?(?:in\s+)?(?:my\s+)?savings?|how\s+much\s+(?:have\s+i|did\s+i)\s+saved?)\b/i;
const saveMovePattern =
  /\b(?:deposit|put|move|add)\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:usdc|eurc)?\s+(?:in)?to\s+(?:my\s+)?(?:savings?|save|pocket)\b/i;
const saveWithdrawPattern =
  /\b(?:withdraw|take\s+out|pull)\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)?\s*(?:usdc|eurc)?\s*(?:from\s+)?(?:my\s+)?(?:savings?|save|pocket)\b/i;

const earnStatusPattern =
  /\b(?:my\s+(?:earn|vault|yield)|(?:earn|vault)\s+(?:balance|position|status)|what(?:'?s|\s+is)\s+in\s+(?:my\s+)?vault|what(?:'?s|\s+is)\s+the\s+apy)\b/i;

const earnDepositPattern =
  /\b(?:deposit|put|move|add|stake)\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:usdc|eurc)?\s+(?:in)?to\s+(?:the\s+)?(?:earn|vault)\b/i;
const earnWithdrawPattern =
  /\b(?:withdraw|redeem|take\s+out)\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)?\s*(?:usdc|eurc)?\s*(?:from\s+)?(?:the\s+)?(?:earn|vault)\b/i;

// "quote 100 usdc to eurc", "how much eurc for 50 usdc", "eurc price",
// "usdc to eurc rate". Read before the swap pattern: a question is never a swap.
const swapQuotePattern =
  /\b(?:quote|price|rate|how\s+much)\b[^\n]*?(?:\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*)?(usdc|eurc)\b(?:[^\n]*?\b(?:to|for|into|in)\s+(usdc|eurc)\b)?/i;
const swapQuoteReversedPattern =
  /\bhow\s+much\s+(usdc|eurc)\s+(?:would\s+i\s+get\s+|do\s+i\s+get\s+|is\s+|for\s+)?(?:for\s+)?\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)\b/i;
const priceOnlyPattern = /\b(usdc|eurc)\s+(?:price|rate)\b|\b(?:price|rate)\s+of\s+(usdc|eurc)\b/i;

// "how much did I spend this week", "activity summary for 30 days",
// "my portfolio today", "volume all time", "pnl this month".
const activitySummaryPattern =
  /\b(?:summary|summari[sz]e|breakdown|overview|portfolio|p\s*&?\s*n?\s*l|pnl|profit|volume|how\s+much\s+(?:did|have)\s+i\s+(?:spen[dt]|sen[dt]|receiv(?:e|ed)|earn(?:ed)?|ma[dk]e)|money\s+(?:in|out)|spending|spent|received|cash\s*flow)\b/i;
const periodAllPattern = /\b(?:all[\s-]*time|ever|since\s+(?:i\s+)?(?:joined|started|the\s+start)|lifetime|overall|in\s+total|all)\b/i;
const period24hPattern = /\b(?:24\s*h(?:ours?|rs?)?|today|last\s+day|past\s+day)\b/i;
const period7dPattern = /\b(?:7\s*d(?:ays?)?|this\s+week|last\s+week|past\s+week|weekly|seven\s+days)\b/i;
const period30dPattern = /\b(?:30\s*d(?:ays?)?|this\s+month|last\s+month|past\s+month|monthly|thirty\s+days)\b/i;

function readPeriod(text: string): AllieActivityPeriod {
  if (period24hPattern.test(text)) return "24h";
  if (period7dPattern.test(text)) return "7d";
  if (period30dPattern.test(text)) return "30d";
  if (periodAllPattern.test(text)) return "all";
  return "30d";
}

const swapPattern =
  /\bswap\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?\s*(?:for|to|into)\s+(usdc|eurc)\b/i;

// Requests, in the orders people actually write them:
//   "request $30", "request 5 usdc from @sam", "bill @sam $20",
//   "send a 5 usdc request to @sam", "ask @sam for $12"
const requestAmountFirstPattern =
  /\b(?:request|bill|charge)\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?(?:\s+(?:from|of)\s+(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40}))?/i;
const requestPersonFirstPattern =
  /\b(?:request|bill|charge)\s+(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40})\s+(?:for\s+)?\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?/i;
const requestObjectPattern =
  /\b(?:send|create|make|raise)\s+(?:an?\s+)?\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?\s*(?:payment\s+)?request(?:\s+(?:to|for)\s+(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40}))?/i;
const requestAskPattern =
  /\bask\s+(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40})\s+for\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?/i;
const requestBarePattern = /\b(?:request|invoice)\s+(?:a\s+)?payment\b/i;

// "split $30 between @a and @b" — one amount, divided equally.
const splitPattern =
  /\bsplit\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?\s+(?:between|among|amongst|across|with)\s+(.+)$/i;
const splitNamePattern = /(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40})/gi;

// "send 2 usdc to @ada every day", "a recurring payment of 2 usdc to ada
// every week", "pay 5 to bob monthly" — then an optional tail such as
// "for 5 days" or "6 times" (group 6).
const recurringPattern = new RegExp(
  String.raw`\b(?:send|pay|transfer|(?:\w+\s+)?payment\s+of)\s+\$?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?\s+to\s+(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40})\s+(?:(?:every|each)\s+(day|week|fortnight|two weeks|month|quarter)|(daily|weekly|biweekly|monthly|quarterly))\b(.*)$`,
  "i",
);
// "for 5 days", "for the next 3 weeks", "for 6 payments"
const recurringDurationPattern =
  /^\s*,?\s*for\s+(?:the\s+next\s+)?(\d{1,4})\s+(days?|weeks?|months?|quarters?|times|payments?|runs?)\s*[.!]?\s*$/i;
// "6 times"
const recurringTimesPattern = /^\s*,?\s*(\d{1,4})\s+(?:times|payments?)\s*[.!]?\s*$/i;
const recurringStatusPattern =
  /\b(?:my\s+)?(?:recurring\s+payments?|recurepay|subscriptions?|standing\s+orders?|schedules?)\b/i;


// "send $10 to @a and $20 to @b" / "pay @a $5, @b $6". A comma followed by
// three digits is a thousands separator ("1,250 to @a"), not a new clause.
const batchSplitPattern = /\s*(?:,(?!\d{3}\b)|;|\band\b|\bthen\b)\s*/i;
const legVerb = String.raw`(?:(?:send|pay|transfer|wire|give)\s+)?`;
// "<amount> to <recipient>" — or, inside a batch, "2usdc cypher" with the
// "to" left out — then whatever follows (group 4).
const legForwardPattern = new RegExp(
  String.raw`^\s*${legVerb}\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?\s+(?:to\s+)?(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40})(.*)$`,
  "i",
);
// "<recipient> <amount>" — "send arc_studio 2usdc" — then the rest (group 4).
const legReversedPattern = new RegExp(
  String.raw`^\s*${legVerb}(@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40})\s+\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(usdc|eurc)?(?![a-zA-Z0-9])(.*)$`,
  "i",
);

// ── Notes ───────────────────────────────────────────────────────────────────
// "…, note: June rent" / "… memo: invoice 12" anywhere before the end.
const noteColonPattern = /(?:^|[\s,(])(?:note|memo)\s*:\s*(.+)$/i;
// "… with a note saying thanks" / "…, memo dinner" / "… - note rent"
const notePhrasePattern =
  /(?:[,(]\s*|\s[-–—]\s*|\b(?:with|add)\s+(?:a\s+|the\s+)?)(?:note|memo)\s+(?:saying\s+|that\s+says\s+|of\s+)?(.+)$/i;
// What trails a payment: "for lunch", "re: the flat".
const noteTailPattern = /^\s*[,-]?\s*(?:for|re:?)\s+(.+?)\s*$/i;
// "for 3 weeks", "for the next 5 days": a schedule, not a reason.
const durationNotePattern =
  /^(?:the\s+next\s+)?\d+\s+(?:days?|weeks?|months?|quarters?|years?|times|payments?|runs?)\b/i;
const scheduleWordPattern =
  /\b(?:every|each|daily|weekly|biweekly|fortnightly|monthly|quarterly|yearly|annually)\b/i;

const frequencyAliases: Record<string, AllieFrequency> = {
  day: "daily",
  daily: "daily",
  week: "weekly",
  weekly: "weekly",
  fortnight: "biweekly",
  "two weeks": "biweekly",
  biweekly: "biweekly",
  month: "monthly",
  monthly: "monthly",
  quarter: "quarterly",
  quarterly: "quarterly",
};

/** Words that read like a recipient but never are. */
const recipientStopWords = new Set([
  "me",
  "my",
  "the",
  "a",
  "an",
  "it",
  "this",
  "that",
  "usdc",
  "eurc",
  "usd",
  "eur",
  "invoice",
  "balance",
  "someone",
  "anyone",
  "and",
  "or",
  "each",
  "them",
  "us",
  "between",
  "among",
  "with",
  "everyone",
  "all",
  "of",
  "to",
  "for",
  "send",
  "pay",
  "then",
  // "and 6 more", "5 now", "2 later": amounts, not payees.
  "more",
  "extra",
  "now",
  "later",
  "today",
  "tomorrow",
  "back",
  "please",
]);

function parseAmount(raw: string) {
  const amount = Number.parseFloat(raw.replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseAsset(raw: string | undefined): AllieAsset {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return normalized === "eurc" || normalized.startsWith("euro")
    ? "EURC"
    : "USDC";
}

function normalizeRecipient(raw: string) {
  const trimmed = raw.trim().replace(/[.,;:!?]+$/, "");

  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return trimmed;
  }

  // "gentle.one" (a One ID) and "@gentle" (the older way) both name an account.
  const isOneId = /\.one$/i.test(trimmed);
  const handle = trimmed.replace(/^@/, "").replace(/\.one$/i, "");

  if (!handle || recipientStopWords.has(handle.toLowerCase())) {
    return null;
  }

  if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(handle)) {
    return null;
  }

  // An "@" marks a One ID from here on: "gentle.one" or "@gentle" asks for
  // that account, a bare "gentle" is looked up in their contacts first.
  return trimmed.startsWith("@") || isOneId ? `@${handle}` : handle;
}

/**
 * For payment requests: always a username. Requests hand off to a form that
 * looks up SaphraONE usernames, not the owner's contacts.
 */
function normalizeRequestee(raw: string) {
  const name = normalizeRecipient(raw);
  return name && !name.startsWith("@") && !name.startsWith("0x") ? `@${name}` : name;
}

function matched(action: AllieAction): AllieTierOneResult {
  return { action, tier: 1, confidence: 1 };
}

/** Only sets `note` when there is one, so actions stay minimal. */
function withNote(note: string | undefined) {
  return note ? { note } : {};
}

function cleanNote(raw: string) {
  let note = raw.trim();
  // "(note: rent)" leaves a closing bracket with no opener.
  if (note.endsWith(")") && !note.includes("(")) note = note.slice(0, -1).trim();
  note = note.replace(/^["'“‘](.*)["'”’]$/, "$1").trim();
  return note ? note.slice(0, 200) : undefined;
}

/**
 * Pulls an explicit note ("note: rent", "with a note saying thanks") off the
 * end of the message, so the payment itself parses as if it weren't there.
 */
function extractNote(text: string): { text: string; note?: string } {
  const match = noteColonPattern.exec(text) ?? notePhrasePattern.exec(text);
  const note = match ? cleanNote(match[1]) : undefined;

  if (!match || !note) {
    return { text };
  }

  // Drop the joiner that introduced the note: "…, and add a", "… with the".
  const rest = text
    .slice(0, match.index)
    .replace(/(?:[\s,(\-–—]|\b(?:and|with|add|a|the)\b)+$/i, "");
  return { text: rest, note };
}

/**
 * What trails a payment. A reason ("for lunch") is its note; a schedule
 * ("for 3 weeks", "every friday") returns null, because a one-off send of a
 * payment the user meant to repeat is worse than escalating.
 */
function readNoteTail(tail: string): string | undefined | null {
  if (scheduleWordPattern.test(tail)) return null;

  const match = noteTailPattern.exec(tail);
  if (!match) return undefined;
  if (durationNotePattern.test(match[1])) return null;
  return cleanNote(match[1]);
}

const recipientMentionPattern =
  /\bto\s+(?:@?[a-zA-Z0-9_.-]{2,64}|0x[a-fA-F0-9]{40})/gi;
const paymentVerbPattern = /\b(?:send|pay|transfer|wire|give)\b/gi;
// A standalone amount: "$5", "2usdc", "1,250" — not the digits of "0x…" or "@a1".
// "invoice 12" and "number 4" are references, not money.
const amountMentionPattern =
  /(?:^|[\s$])(?<!(?:invoice|inv|number|no\.?)\s)[0-9][0-9,]*(?:\.[0-9]+)?(?=\s|$|usdc|eurc|usd|[,;.!?])/gi;

/** True when the message names more than one payee, however loosely. */
function looksLikeMultiRecipient(text: string) {
  if (!/\b(?:send|pay|transfer|wire|split)\b/i.test(text)) {
    return false;
  }

  // A split is always several payees, and two payment verbs are two payments
  // ("split … and send arc_studio 2"): neither may shrink to a single send.
  if (/\bsplit\b/i.test(text)) {
    return true;
  }

  if ((text.match(paymentVerbPattern)?.length ?? 0) >= 2) {
    return true;
  }

  // Two amounts are two payments: "2usdc to gentle and 2usdc cypher".
  if ((text.match(amountMentionPattern)?.length ?? 0) >= 2) {
    return true;
  }

  const mentions = text.match(recipientMentionPattern);
  return (mentions?.length ?? 0) >= 2;
}

/** Reads a request however it was worded, or null. */
function parseRequest(text: string, explicitNote?: string): AllieAction | null {
  // The note is whatever follows the matched request: "… for dinner".
  const noteAfter = (match: RegExpExecArray) => {
    const tail = readNoteTail(text.slice(match.index + match[0].length));
    return tail === null ? null : (explicitNote ?? tail);
  };

  const object = requestObjectPattern.exec(text);
  if (object) {
    const amountUsdc = parseAmount(object[1]);
    const note = noteAfter(object);
    if (amountUsdc && note !== null) {
      return {
        type: "RequestPayment",
        amountUsdc,
        asset: parseAsset(object[2]),
        from: object[3] ? (normalizeRequestee(object[3]) ?? undefined) : undefined,
        ...withNote(note),
      };
    }
  }

  const ask = requestAskPattern.exec(text);
  if (ask) {
    const amountUsdc = parseAmount(ask[2]);
    const from = normalizeRequestee(ask[1]);
    const note = noteAfter(ask);
    if (amountUsdc && from && note !== null) {
      return {
        type: "RequestPayment",
        amountUsdc,
        asset: parseAsset(ask[3]),
        from,
        ...withNote(note),
      };
    }
  }

  const personFirst = requestPersonFirstPattern.exec(text);
  if (personFirst) {
    const from = normalizeRequestee(personFirst[1]);
    const amountUsdc = parseAmount(personFirst[2]);
    const note = noteAfter(personFirst);
    if (amountUsdc && from && note !== null) {
      return {
        type: "RequestPayment",
        amountUsdc,
        asset: parseAsset(personFirst[3]),
        from,
        ...withNote(note),
      };
    }
  }

  const amountFirst = requestAmountFirstPattern.exec(text);
  if (amountFirst) {
    const amountUsdc = parseAmount(amountFirst[1]);
    const note = noteAfter(amountFirst);
    if (amountUsdc && note !== null) {
      return {
        type: "RequestPayment",
        amountUsdc,
        asset: parseAsset(amountFirst[2]),
        from: amountFirst[3]
          ? (normalizeRequestee(amountFirst[3]) ?? undefined)
          : undefined,
        ...withNote(note),
      };
    }
  }

  if (requestBarePattern.test(text)) {
    return { type: "RequestPayment", asset: "USDC", ...withNote(explicitNote) };
  }

  return null;
}

type ParsedLeg = { leg: AllieBatchLeg; asset?: AllieAsset; note?: string };
type ParsedBatch = { legs: AllieBatchLeg[]; asset: AllieAsset; note?: string };

/**
 * One payment clause, in either order: "2 usdc to @c" or "@c 2 usdc". Null
 * when it isn't a plain payment, or when it trails a schedule.
 */
function parseLeg(clause: string): ParsedLeg | null {
  const forward = legForwardPattern.exec(clause);
  const reversed = forward ? null : legReversedPattern.exec(clause);
  const [amountRaw, assetRaw, recipientRaw, rest] = forward
    ? [forward[1], forward[2], forward[3], forward[4]]
    : reversed
      ? [reversed[2], reversed[3], reversed[1], reversed[4]]
      : [];

  const amountUsdc = amountRaw ? parseAmount(amountRaw) : null;
  const recipient = recipientRaw ? normalizeRecipient(recipientRaw) : null;
  const note = readNoteTail(rest ?? "");

  if (!amountUsdc || !recipient || note === null) {
    return null;
  }

  return {
    leg: { amountUsdc, recipient },
    asset: assetRaw ? parseAsset(assetRaw) : undefined,
    note,
  };
}

/** A batch moves one asset: legs naming different ones escalate. */
function combineLegs(parsed: ParsedLeg[], note?: string): ParsedBatch | null {
  const assets = new Set(parsed.flatMap((entry) => (entry.asset ? [entry.asset] : [])));

  if (assets.size > 1) {
    return null;
  }

  return {
    legs: parsed.map((entry) => entry.leg),
    asset: [...assets][0] ?? "USDC",
    note: note ?? parsed.find((entry) => entry.note)?.note,
  };
}

/**
 * "split $30 between @a and @b" — divides equally, giving any remainder to the
 * first recipient so the legs always sum to exactly the amount asked for.
 */
function parseSplit(text: string): ParsedBatch | null {
  const match = splitPattern.exec(text);

  if (!match) {
    return null;
  }

  const total = parseAmount(match[1]);

  // The name list ends where the next instruction begins: "split 5 among
  // @a and @b and send $2 to @c" is a split plus a separate payment. Names
  // themselves are joined by commas and "and", so only a verb marks the end.
  const tail = match[3];
  const nextVerb = /\b(?:send|pay|transfer|wire|give)\b/i.exec(tail);
  let nameText = (nextVerb ? tail.slice(0, nextVerb.index) : tail).replace(
    /(?:[\s,]|\b(?:and|then)\b)+$/i,
    "",
  );
  const extraLegs = nextVerb ? parseLegClauses(tail.slice(nextVerb.index)) : [];
  if (extraLegs === null) {
    return null;
  }

  // "split 30 between @a and @b for dinner": the reason is the note.
  let note: string | undefined;
  const reason = /\sfor\s/i.exec(nameText);
  if (reason) {
    const tailNote = readNoteTail(nameText.slice(reason.index));
    if (tailNote === null) {
      return null;
    }
    note = tailNote;
    nameText = nameText.slice(0, reason.index);
  }

  const names = nameText.match(splitNamePattern) ?? [];
  const recipients = names
    .map((name) => normalizeRecipient(name))
    .filter((name): name is string => Boolean(name));

  if (!total || recipients.length < 2) {
    return null;
  }

  // Work in cents so the split never produces float dust.
  const totalCents = Math.round(total * 100);
  const share = Math.floor(totalCents / recipients.length);
  const remainder = totalCents - share * recipients.length;

  if (share <= 0) {
    return null;
  }

  const splitAsset = match[2] ? parseAsset(match[2]) : undefined;

  return combineLegs(
    [
      ...recipients.map((recipient, index) => ({
        leg: {
          amountUsdc: (share + (index === 0 ? remainder : 0)) / 100,
          recipient,
        },
        asset: splitAsset,
      })),
      ...extraLegs,
    ],
    note,
  );
}

/**
 * "send $2 to @c and $3 to @d" → legs. Null unless every clause is a plain
 * payment, in either word order.
 */
function parseLegClauses(text: string): ParsedLeg[] | null {
  const clauses = text.split(batchSplitPattern).filter((clause) => clause.trim());
  const legs: ParsedLeg[] = [];

  for (const clause of clauses) {
    const leg = parseLeg(clause);
    if (!leg) {
      return null;
    }
    legs.push(leg);
  }

  return legs.length > 0 ? legs : null;
}

function parseFrequency(raw: string): AllieFrequency | null {
  return frequencyAliases[raw.trim().toLowerCase()] ?? null;
}

/** The unit each frequency steps in, and how many units per payment. */
const frequencyStep: Record<AllieFrequency, { unit: string; per: number }> = {
  daily: { unit: "day", per: 1 },
  weekly: { unit: "week", per: 1 },
  biweekly: { unit: "week", per: 2 },
  monthly: { unit: "month", per: 1 },
  quarterly: { unit: "quarter", per: 1 },
};

/**
 * What follows the frequency: nothing (open-ended), "for N <unit>" or
 * "N times". Returns the payment cap, undefined for open-ended, or null when
 * the tail says something Tier 1 can't read ("starting Monday", "for 10 days"
 * weekly) — those escalate rather than set up a different schedule.
 */
function parseRecurringTail(
  tail: string,
  frequency: AllieFrequency,
): number | undefined | null {
  if (!tail.replace(/[.!\s]/g, "")) return undefined;

  const times = recurringTimesPattern.exec(tail);
  if (times) return Number(times[1]) || null;

  const duration = recurringDurationPattern.exec(tail);
  if (!duration) return null;

  const count = Number(duration[1]);
  const unit = duration[2].toLowerCase().replace(/s$/, "");
  if (!count) return null;
  if (unit === "time" || unit === "payment" || unit === "run") return count;

  const step = frequencyStep[frequency];
  // Same unit: 3 weeks weekly = 3, 4 weeks biweekly = 2.
  if (unit === step.unit) return count % step.per === 0 ? count / step.per : null;
  // 2 weeks daily = 14; 2 quarters monthly = 6. Months into weeks or days
  // vary in length, so those escalate.
  if (unit === "week" && step.unit === "day") return count * 7;
  if (unit === "quarter" && step.unit === "month") return count * 3;
  return null;
}

/**
 * Tries to read a multi-recipient instruction. Only returns legs when every
 * clause parses — a half-understood batch is worse than escalating.
 */
function parseBatch(text: string): ParsedBatch | null {
  if (!/\b(?:send|pay|transfer|wire|split)\b/i.test(text)) {
    return null;
  }

  const clauses = text.split(batchSplitPattern).filter((part) => part.trim());

  if (clauses.length < 2) {
    return null;
  }

  const legs = parseLegClauses(text);
  return legs && legs.length >= 2 ? combineLegs(legs) : null;
}

export function classifyMessage(message: string): AllieTierOneResult | null {
  // A note is read off first, so every pattern below sees just the payment.
  const { text, note: explicitNote } = extractNote(message.trim());

  if (!text) {
    return null;
  }

  // Order is deliberate: a specific money movement always beats a broad
  // status phrase, and a recurring or batch send beats a single send.

  // ── Agent control ────────────────────────────────────────────────────────
  if (pausePattern.test(text)) {
    return matched({ type: "AgentControl", action: "pause" });
  }

  if (resumePattern.test(text)) {
    return matched({ type: "AgentControl", action: "resume" });
  }

  // ── Business: payroll, and invoices the user issues ──────────────────────
  // Before every payment pattern: "pay the engineering team" is a payroll
  // run, not a send to someone called "engineering"; "did acme pay invoice
  // 12" is a question, not the user paying it.
  const business = classifyBusiness(text, explicitNote);
  if (business === false) return null;
  if (business) return matched(business);

  // ── Paying an invoice someone sent you ───────────────────────────────────
  if (invoiceLastPattern.test(text)) {
    return matched({ type: "PayInvoice", ref: "last" });
  }

  const invoiceFrom = invoiceFromPattern.exec(text);
  if (invoiceFrom?.[1]) {
    return matched({ type: "PayInvoice", ref: invoiceFrom[1].trim() });
  }

  const invoiceNumber = invoiceNumberPattern.exec(text);
  if (invoiceNumber?.[1]) {
    return matched({ type: "PayInvoice", ref: invoiceNumber[1] });
  }

  // ── Recurring (before single send: it is also a "send ... to ...") ───────
  const recurring = recurringPattern.exec(text);
  if (recurring) {
    const amountUsdc = parseAmount(recurring[1]);
    const recipient = normalizeRecipient(recurring[3]);
    const frequency = parseFrequency(recurring[4] ?? recurring[5] ?? "");

    if (amountUsdc && recipient && frequency) {
      const maxRuns = parseRecurringTail(recurring[6] ?? "", frequency);
      // A schedule detail Tier 1 can't read must escalate, never fall through
      // to a one-off send of the same amount.
      if (maxRuns === null) return null;

      return matched({
        type: "Recurring",
        recipient,
        amountUsdc,
        asset: parseAsset(recurring[2]),
        frequency,
        maxRuns,
      });
    }
  }

  // ── Swap quote (a question, so before the swap itself) ───────────────────
  const reversedQuote = swapQuoteReversedPattern.exec(text);
  if (reversedQuote) {
    const amountUsdc = parseAmount(reversedQuote[2]);
    const toAsset = parseAsset(reversedQuote[1]);
    const fromAsset = parseAsset(reversedQuote[3]);
    if (amountUsdc && fromAsset !== toAsset) {
      return matched({ type: "SwapQuote", amountUsdc, fromAsset, toAsset });
    }
  }

  const priceOnly = priceOnlyPattern.exec(text);
  if (priceOnly && !/\bswap\b/i.test(text)) {
    const asset = parseAsset(priceOnly[1] ?? priceOnly[2]);
    return matched({
      type: "SwapQuote",
      amountUsdc: 1,
      fromAsset: asset,
      toAsset: asset === "USDC" ? "EURC" : "USDC",
    });
  }

  const quote = swapQuotePattern.exec(text);
  if (quote && /\b(?:quote|rate|price)\b/i.test(text)) {
    const amountUsdc = quote[1] ? parseAmount(quote[1]) : 1;
    const fromAsset = parseAsset(quote[2]);
    const toAsset = quote[3] ? parseAsset(quote[3]) : fromAsset === "USDC" ? "EURC" : "USDC";
    if (amountUsdc && fromAsset !== toAsset) {
      return matched({ type: "SwapQuote", amountUsdc, fromAsset, toAsset });
    }
  }

  // ── Swap ─────────────────────────────────────────────────────────────────
  const swap = swapPattern.exec(text);
  if (swap) {
    const amountUsdc = parseAmount(swap[1]);
    const fromAsset = parseAsset(swap[2] ?? "usdc");
    const toAsset = parseAsset(swap[3]);

    if (amountUsdc && fromAsset !== toAsset) {
      return matched({ type: "Swap", amountUsdc, fromAsset, toAsset });
    }
  }

  // ── Save / Earn movement ─────────────────────────────────────────────────
  const earnDeposit = earnDepositPattern.exec(text);
  if (earnDeposit) {
    const amountUsdc = parseAmount(earnDeposit[1]);
    if (amountUsdc) {
      return matched({ type: "Earn", action: "deposit", amountUsdc });
    }
  }

  const earnWithdraw = earnWithdrawPattern.exec(text);
  if (earnWithdraw) {
    return matched({
      type: "Earn",
      action: "withdraw",
      amountUsdc: parseAmount(earnWithdraw[1] ?? "") ?? undefined,
    });
  }

  const saveMove = saveMovePattern.exec(text);
  if (saveMove) {
    const amountUsdc = parseAmount(saveMove[1]);
    if (amountUsdc) {
      return matched({ type: "Save", action: "deposit", amountUsdc });
    }
  }

  const saveWithdraw = saveWithdrawPattern.exec(text);
  if (saveWithdraw) {
    return matched({
      type: "Save",
      action: "withdraw",
      amountUsdc: parseAmount(saveWithdraw[1] ?? "") ?? undefined,
    });
  }

  // ── Batch (before single send) ───────────────────────────────────────────
  const batch = parseSplit(text) ?? parseBatch(text);
  if (batch) {
    return matched({
      type: "BatchPay",
      legs: batch.legs,
      asset: batch.asset,
      ...withNote(explicitNote ?? batch.note),
    });
  }

  // A multi-recipient instruction that did not fully parse must escalate, not
  // fall through to the single-send patterns — paying one leg of a batch the
  // user asked for is worse than asking them to rephrase.
  if (looksLikeMultiRecipient(text)) {
    return null;
  }

  // ── Requests (before sends: "send a $5 request to @sam" is a request) ────
  const request = parseRequest(text, explicitNote);
  if (request) {
    return matched(request);
  }

  // ── Single send ──────────────────────────────────────────────────────────
  const sendTo = sendToPattern.exec(text);
  if (sendTo) {
    const amountUsdc = parseAmount(sendTo[1]);
    const recipient = normalizeRecipient(sendTo[3]);
    const tailNote = readNoteTail(text.slice(sendTo.index + sendTo[0].length));

    if (tailNote === null) return null;

    if (amountUsdc && recipient) {
      return matched({
        type: "PaymentIntent",
        recipient,
        amountUsdc,
        asset: parseAsset(sendTo[2]),
        ...withNote(explicitNote ?? tailNote),
      });
    }
  }

  const sendReversed = sendReversedPattern.exec(text);
  if (sendReversed) {
    const recipient = normalizeRecipient(sendReversed[1]);
    const amountUsdc = parseAmount(sendReversed[2]);
    const tailNote = readNoteTail(
      text.slice(sendReversed.index + sendReversed[0].length),
    );

    if (tailNote === null) return null;

    if (amountUsdc && recipient) {
      return matched({
        type: "PaymentIntent",
        recipient,
        amountUsdc,
        asset: parseAsset(sendReversed[3]),
        ...withNote(explicitNote ?? tailNote),
      });
    }
  }

  // ── Status reads ─────────────────────────────────────────────────────────
  // Savings and vault questions first: they are more specific than the
  // generic "how much do I have".
  if (savePattern.test(text)) {
    return matched({ type: "SaveStatus" });
  }

  if (earnStatusPattern.test(text)) {
    return matched({ type: "EarnStatus" });
  }

  // Before the balance question: "how much did I spend" is a summary.
  if (activitySummaryPattern.test(text)) {
    return matched({ type: "ActivitySummary", period: readPeriod(text) });
  }

  if (balancePattern.test(text)) {
    return matched({ type: "QueryBalance" });
  }

  if (transactionsPattern.test(text)) {
    return matched({ type: "ListTransactions" });
  }

  if (recurringStatusPattern.test(text)) {
    return matched({ type: "RecurringStatus" });
  }

  return null;
}
