// Server-only. Quests: measured from verified records, paid once per wallet
// per quest (Rewards v2, REWARDS-PLAN.md). Checked after each rewarded
// payment, after each verified ledger transaction, after Checkout and invoice
// payments, and whenever the person opens Rewards.
import { recordLedgerEntry } from "@/lib/referral/ledger-service";
import { referralDb } from "@/lib/referral/db";
import {
  describeQuestRule,
  evaluateQuest,
  isAutomaticQuest,
  isQuestDone,
  questFitsAccount,
  questRewardPoints,
  readQuestReward,
  readQuestRule,
  type QuestFacts,
  type QuestProgress,
  type QuestRule,
} from "@/lib/rewards/quest-rules";
import { createSavingsNotificationResult } from "@/lib/save/notifications";

export {
  describeQuestRule,
  readQuestRule,
  readSocialUrl,
  SOCIAL_PLATFORMS,
  type QuestProgress,
  type QuestRule,
  type SocialPlatform,
} from "@/lib/rewards/quest-rules";

export type QuestRow = {
  active: boolean;
  /** Needs rewards-quests-v2.sql; absent on older databases ("all"). */
  audience?: string | null;
  description: string;
  ends_at: string | null;
  id: string;
  /** Needs rewards-quests-v2.sql: only the first N people can complete it. */
  max_completions?: number | null;
  points: number;
  rule: unknown;
  slug: string;
  starts_at: string;
  title: string;
};

type AccountType = "PERSONAL" | "BUSINESS";

type QuestAccount = { account_type: AccountType; avatar_url: string | null };

/**
 * The account fields quests need, read directly: this module is reached from
 * the browser bundle (cashback → earning), so it can't import account/auth.
 */
async function loadQuestAccount(wallet: string): Promise<QuestAccount | null> {
  const { data, error } = await referralDb()
    .from(process.env.SUPABASE_PROFILES_TABLE ?? "profiles")
    .select("account_type,avatar_url")
    .eq("wallet_address", wallet.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { account_type?: string | null; avatar_url?: string | null };
  return { account_type: row.account_type === "BUSINESS" ? "BUSINESS" : "PERSONAL", avatar_url: row.avatar_url ?? null };
}

const ledgerTable = process.env.SUPABASE_TRANSACTION_LEDGER_TABLE ?? "transaction_ledger";

function isLive(quest: QuestRow, now = Date.now()) {
  return (
    quest.active &&
    new Date(quest.starts_at).getTime() <= now &&
    (!quest.ends_at || new Date(quest.ends_at).getTime() > now)
  );
}

function times(rows: unknown, key: string) {
  return ((rows ?? []) as Array<Record<string, unknown>>)
    .map((row) => row[key])
    .filter((value): value is string => typeof value === "string");
}

/** Runs a read; a missing table or column leaves the fact unknown instead of failing. */
async function fact<T>(label: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (cause) {
    console.warn(`[quests] ${label}:`, cause instanceof Error ? cause.message : cause);
    return undefined;
  }
}

function must<T>(result: { data: T; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * Reads only what the given rules need, from records SaphraONE verified:
 * outgoing payments from the transaction ledger (read back from Arc),
 * incoming ones from the Arc scan behind "payment received" notifications,
 * and each feature's own server-written tables.
 */
export async function measureQuestFacts(
  walletAddress: string,
  rules: Array<{ rule: QuestRule; starts_at: string }>,
  account?: { avatar_url: string | null } | null,
): Promise<QuestFacts> {
  const wallet = walletAddress.toLowerCase();
  const db = referralDb();
  const need = new Set(rules.map((entry) => entry.rule.type));
  const has = (...types: QuestRule["type"][]) => types.some((type) => need.has(type));
  const since = rules.reduce(
    (min, entry) => (entry.starts_at < min ? entry.starts_at : min),
    new Date().toISOString(),
  );

  const facts: QuestFacts = {};
  const reads: Array<Promise<void>> = [];

  if (has("payments", "volume", "single_payment", "unique_payees", "swap", "bulkpay")) {
    reads.push(
      fact("payments", async () => {
        const ledger = await db
          .from(ledgerTable)
          .select("source,amount_usd,payees,eligible,occurred_at")
          .eq("wallet_address", wallet)
          .gte("occurred_at", since)
          .order("occurred_at", { ascending: true })
          .limit(5_000);
        if (!ledger.error) {
          facts.payments = (
            (ledger.data ?? []) as Array<{
              amount_usd: number | string;
              eligible: boolean;
              occurred_at: string;
              payees: Record<string, unknown> | null;
              source: string;
            }>
          ).map((row) => ({
            at: row.occurred_at,
            eligible: row.eligible,
            payees: Object.keys(row.payees ?? {}),
            source: row.source,
            usd: Number(row.amount_usd),
          }));
          return;
        }
        // Before transaction-ledger.sql: rewarded payments still count.
        const events = must(
          await db
            .from("rewards_cashback_events")
            .select("volume_usd,created_at")
            .eq("wallet_address", wallet)
            .gte("created_at", since),
        ) as Array<{ created_at: string; volume_usd: number }>;
        facts.payments = events.map((row) => ({
          at: row.created_at,
          eligible: true,
          payees: [],
          source: "send",
          usd: Number(row.volume_usd),
        }));
      }).then(() => undefined),
    );
  }

  if (has("receive")) {
    reads.push(
      fact("received", async () => {
        const rows = must(
          await db
            .from("savings_notifications")
            .select("created_at,metadata")
            .eq("owner_wallet", wallet)
            .eq("kind", "payment_received")
            .not("related_tx_hash", "is", null)
            .gte("created_at", since)
            .limit(2_000),
        ) as Array<{ created_at: string; metadata: Record<string, unknown> | null }>;
        facts.received = rows.map((row) => ({
          at: row.created_at,
          usd: Number(String(row.metadata?.amount ?? row.metadata?.amountReceived ?? "0").replace(/,/g, "")) || 0,
        }));
      }).then(() => undefined),
    );
  }

  if (has("streak")) {
    reads.push(
      fact("streak", async () => {
        const row = must(
          await db.from("rewards_streaks").select("current_streak,last_day").eq("wallet_address", wallet).maybeSingle(),
        ) as { current_streak?: number; last_day?: string | null } | null;
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        const lastDay = row?.last_day ?? null;
        facts.streak = lastDay === today || lastDay === yesterday ? Number(row?.current_streak ?? 0) : 0;
      }).then(() => undefined),
    );
  }

  if (has("referrals")) {
    reads.push(
      fact("referrals", async () => {
        const rows = must(
          await db
            .from("referrals")
            .select("signed_up_at,created_at,status")
            .eq("referrer_wallet", wallet)
            .not("status", "in", "(CLICKED,REJECTED,REVERSED,FRAUD_REVIEW)"),
        ) as Array<{ created_at: string; signed_up_at: string | null }>;
        facts.referrals = rows.map((row) => row.signed_up_at ?? row.created_at);
      }).then(() => undefined),
    );
  }

  if (has("save")) {
    reads.push(
      fact("save", async () => {
        facts.save = times(
          must(
            await db
              .from("savings_transactions")
              .select("created_at")
              .eq("owner_wallet", wallet)
              .in("type", ["DEPOSIT", "SPEND_SAVE"])
              .in("status", ["SAVINGS_CONFIRMED", "COMPLETED"])
              .gte("created_at", since),
          ),
          "created_at",
        );
      }).then(() => undefined),
    );
  }

  if (has("earn")) {
    reads.push(
      fact("earn", async () => {
        facts.earn = times(
          must(await db.from("earn_deposits").select("created_at").eq("wallet_address", wallet).gte("created_at", since)),
          "created_at",
        );
      }).then(() => undefined),
    );
  }

  if (has("recurepay")) {
    reads.push(
      fact("recurepay", async () => {
        facts.recurepay = times(
          must(
            await db.from("recurring_schedules").select("created_at").eq("owner_wallet", wallet).gte("created_at", since),
          ),
          "created_at",
        );
      }).then(() => undefined),
    );
  }

  if (has("invoices_sent")) {
    reads.push(
      fact("invoices sent", async () => {
        facts.invoicesSent = times(
          must(
            await db
              .from("business_invoices")
              .select("created_at")
              .eq("wallet_address", wallet)
              .not("status", "in", "(DRAFT,CANCELLED)")
              .gte("created_at", since),
          ),
          "created_at",
        );
      }).then(() => undefined),
    );
  }

  if (has("invoices_paid")) {
    reads.push(
      fact("invoices paid", async () => {
        facts.invoicesPaid = times(
          must(
            await db
              .from("business_invoices")
              .select("paid_at")
              .eq("wallet_address", wallet)
              .eq("status", "PAID")
              .gte("paid_at", since),
          ),
          "paid_at",
        );
      }).then(() => undefined),
    );
  }

  if (has("checkout_payments")) {
    reads.push(
      fact("checkout", async () => {
        facts.checkout = times(
          must(
            await db
              .from("business_charges")
              .select("paid_at")
              .eq("wallet_address", wallet)
              .eq("status", "PAID")
              .gte("paid_at", since),
          ),
          "paid_at",
        );
      }).then(() => undefined),
    );
  }

  if (has("payroll_runs")) {
    reads.push(
      fact("payroll", async () => {
        facts.payroll = times(
          must(
            await db
              .from("payroll_runs")
              .select("completed_at")
              .eq("account_id", wallet)
              .in("status", ["COMPLETED", "PARTIALLY_COMPLETED"])
              .gte("completed_at", since),
          ),
          "completed_at",
        );
      }).then(() => undefined),
    );
  }

  if (has("two_factor")) {
    reads.push(
      fact("two-factor", async () => {
        const row = must(
          await db.from("two_factor").select("enabled_at").eq("owner_wallet", wallet).maybeSingle(),
        ) as { enabled_at: string | null } | null;
        facts.twoFactor = Boolean(row?.enabled_at);
      }).then(() => undefined),
    );
  }

  if (has("business_verified")) {
    reads.push(
      fact("verification", async () => {
        const row = must(
          await db
            .from("business_account_profiles")
            .select("verification_status")
            .eq("wallet_address", wallet)
            .maybeSingle(),
        ) as { verification_status: string } | null;
        facts.businessVerified = row?.verification_status === "VERIFIED";
      }).then(() => undefined),
    );
  }

  if (has("profile_photo") && account !== undefined) {
    facts.profilePhoto = Boolean(account?.avatar_url);
  }

  await Promise.all(reads);
  return facts;
}

/** How far a wallet is on each quest (null for ones it finishes by claiming or by hand). */
export async function questProgress(
  walletAddress: string,
  quests: QuestRow[],
  account?: { avatar_url: string | null } | null,
) {
  const rules = quests.map((quest) => ({ quest, rule: readQuestRule(quest.rule) }));
  const automatic = rules.filter((entry) => isAutomaticQuest(entry.rule));
  const progress = new Map<string, QuestProgress | null>();
  if (automatic.length === 0) return progress;
  const facts = await measureQuestFacts(
    walletAddress,
    automatic.map((entry) => ({ rule: entry.rule, starts_at: entry.quest.starts_at })),
    account,
  );
  for (const { quest, rule } of rules) {
    progress.set(quest.id, isAutomaticQuest(rule) ? evaluateQuest(rule, quest, facts) : null);
  }
  return progress;
}

export type AwardResult = "awarded" | "already" | "full";

/**
 * Pay a quest's points to a wallet, once. The database function takes the
 * place (never twice per wallet, never past the quest's limit); the ledger's
 * idempotency key stops a second payment on a retry.
 */
export async function awardQuest(input: {
  awardedBy?: string;
  /** What a percentage reward is paid on. */
  basisUsd?: number;
  quest: QuestRow;
  walletAddress: string;
}): Promise<AwardResult> {
  const wallet = input.walletAddress.toLowerCase();
  const db = referralDb();
  const reward = readQuestReward(input.quest.rule, Number(input.quest.points));
  const points = questRewardPoints(reward, input.basisUsd ?? 0);

  const claim = await db.rpc("rewards_complete_quest", {
    p_points: points,
    p_quest: input.quest.id,
    p_wallet: wallet,
  });
  let status: string;
  if (!claim.error) {
    status = String(claim.data);
  } else if (/rewards_complete_quest|function/i.test(claim.error.message ?? "")) {
    // Before rewards-quests-v2.sql: the primary key still allows one per wallet.
    const { error } = await db.from("rewards_quest_completions").insert({ quest_id: input.quest.id, wallet_address: wallet });
    if (error && error.code !== "23505") throw new Error(error.message);
    status = error ? "already" : "awarded";
  } else {
    throw new Error(claim.error.message);
  }
  if (status === "full") return "full";
  if (status !== "awarded") return "already";

  const { entry } = await recordLedgerEntry({
    campaignId: input.quest.id,
    createdBy: input.awardedBy ?? "system",
    description: `Quest: ${input.quest.title}`,
    entryType: "QUEST_REWARD",
    idempotencyKey: `quest_${input.quest.id}_${wallet}`,
    metadata: {
      basisUsd: reward.kind === "percent" ? input.basisUsd ?? 0 : undefined,
      questId: input.quest.id,
      slug: input.quest.slug,
      source: "rewards_v2_quest",
    },
    points,
    walletAddress: wallet,
  });
  await db
    .from("rewards_quest_completions")
    .update({ ledger_entry_id: entry.id })
    .eq("quest_id", input.quest.id)
    .eq("wallet_address", wallet);

  void createSavingsNotificationResult({
    body: `You earned ${points.toLocaleString("en-US")} ONE Points for “${input.quest.title}”.`,
    fallbackKind: "reconciliation_alert",
    kind: "target_reached",
    metadata: { points, questId: input.quest.id, type: "quest_completed" },
    ownerWallet: wallet,
    title: "Quest complete",
  }).catch(() => undefined);
  return "awarded";
}

/**
 * Award every live, automatic quest the wallet has now finished. Returns the
 * progress it measured too, so the Rewards page reads the facts once.
 */
export async function checkQuestsForWallet(
  walletAddress: string,
  options?: { account?: QuestAccount | null },
) {
  const wallet = walletAddress.toLowerCase();
  const db = referralDb();
  const [quests, done, account] = await Promise.all([
    db.from("rewards_quests").select("*").eq("active", true),
    db.from("rewards_quest_completions").select("quest_id").eq("wallet_address", wallet),
    options?.account !== undefined ? Promise.resolve(options.account) : loadQuestAccount(wallet),
  ]);
  if (quests.error) throw new Error(quests.error.message);
  const completed = new Set(((done.data ?? []) as Array<{ quest_id: string }>).map((row) => row.quest_id));
  const accountType: AccountType = account?.account_type === "BUSINESS" ? "BUSINESS" : "PERSONAL";
  const open = ((quests.data ?? []) as QuestRow[]).filter(
    (quest) =>
      isLive(quest) &&
      !completed.has(quest.id) &&
      isAutomaticQuest(readQuestRule(quest.rule)) &&
      questFitsAccount(quest.audience, accountType),
  );
  const awarded: string[] = [];
  if (open.length === 0) return { awarded, progress: new Map<string, QuestProgress | null>() };

  const progress = await questProgress(wallet, open, account ?? null);
  for (const quest of open) {
    const state = progress.get(quest.id) ?? null;
    if (!isQuestDone(state)) continue;
    const result = await awardQuest({ basisUsd: state?.basisUsd, quest, walletAddress: wallet }).catch((cause) => {
      console.warn("[quests] award", quest.id, cause instanceof Error ? cause.message : cause);
      return "failed" as const;
    });
    if (result === "awarded") awarded.push(quest.id);
  }
  return { awarded, progress };
}

/** Fire-and-forget form for payment flows: a quest check never fails a payment. */
export function checkQuestsSoon(walletAddress: string) {
  return checkQuestsForWallet(walletAddress).catch((cause) => {
    console.warn("[quests]", cause instanceof Error ? cause.message : cause);
  });
}

export class QuestClaimError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * A person claims a live "follow us" quest after opening its link. Paid once
 * per wallet (awardQuest). Returns false when they already had it.
 */
export async function claimSocialQuest(walletAddress: string, questId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(questId)) throw new QuestClaimError("That quest wasn't found.", 404);
  const { data, error } = await referralDb().from("rewards_quests").select("*").eq("id", questId).maybeSingle();
  if (error) throw new Error(error.message);
  const quest = data as QuestRow | null;
  if (!quest || readQuestRule(quest.rule).type !== "social") {
    throw new QuestClaimError("That quest wasn't found.", 404);
  }
  if (!isLive(quest)) throw new QuestClaimError("This quest has ended.", 409);
  const account = await loadQuestAccount(walletAddress);
  if (!questFitsAccount(quest.audience, account?.account_type === "BUSINESS" ? "BUSINESS" : "PERSONAL")) {
    throw new QuestClaimError("This quest isn't for your account type.", 403);
  }
  const result = await awardQuest({ quest, walletAddress });
  if (result === "full") throw new QuestClaimError("All the places on this quest have been taken.", 409);
  return result === "awarded";
}
