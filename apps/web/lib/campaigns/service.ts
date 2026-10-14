// Server-only. USDC campaigns: public leaderboards, admin set-up, and the
// reviewed payout of winners from the treasury.
import { usernamesForWallets } from "@/lib/business/service";
import {
  CampaignError,
  campaignPhase,
  computePayouts,
  readCampaignInput,
  type CampaignRow,
  type Standing,
} from "@/lib/campaigns/rules";
import { payUsdcFromTreasury, TreasuryError } from "@/lib/referral/treasury";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const campaigns = "campaigns";
const winners = "campaign_winners";
/** Ended campaigns stay on the Rewards page this long, to show who won. */
const showEndedForMs = 14 * 24 * 3_600_000;

type StandingRow = {
  wallet_address: string;
  score: number | string;
  payments: number | string;
  volume_usd: number | string;
  fees_usd: number | string;
  unique_payees: number | string;
  rank: number | string;
};

type WinnerRow = {
  id: string;
  campaign_id: string;
  wallet_address: string;
  rank: number;
  score: number | string;
  amount_usdc: number | string;
  status: "REVIEW" | "PENDING" | "PAID" | "REJECTED";
  payout_tx_hash: string | null;
  last_error: string | null;
  reason: string | null;
  created_at: string;
  updated_at: string;
};

function db() {
  return createSupabaseAdminClient();
}

function toCampaign(row: Record<string, unknown>): CampaignRow {
  return {
    ...(row as unknown as CampaignRow),
    excluded_wallets: (row.excluded_wallets as string[] | null) ?? [],
    min_amount_usd: Number(row.min_amount_usd),
    min_score: Number(row.min_score),
    payout_splits: ((row.payout_splits as Array<number | string> | null) ?? []).map(Number),
    prize_pool_usdc: Number(row.prize_pool_usdc),
    sources: (row.sources as string[] | null) ?? [],
    threshold_prize_usdc: Number(row.threshold_prize_usdc),
  };
}

function toStanding(row: StandingRow) {
  return {
    fees: Number(row.fees_usd),
    payments: Number(row.payments),
    rank: Number(row.rank),
    score: Number(row.score),
    uniquePayees: Number(row.unique_payees),
    volume: Number(row.volume_usd),
    wallet: row.wallet_address,
  };
}

async function loadCampaign(id: string) {
  const { data, error } = await db().from(campaigns).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CampaignError("That campaign doesn't exist.", 404);
  return toCampaign(data);
}

/** The campaign's ranking: the first `limit` places, or one wallet's place. */
async function standings(campaignId: string, options: { limit?: number; wallet?: string } = {}) {
  let query = db().rpc("campaign_standings", { p_campaign: campaignId });
  if (options.wallet) query = query.eq("wallet_address", options.wallet.toLowerCase());
  query = query.order("rank", { ascending: true });
  if (options.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as StandingRow[]).map(toStanding);
}

/** "@gentle", or a shortened address for wallets without a username. */
async function namesFor(wallets: string[]) {
  const usernames = await usernamesForWallets(wallets).catch(() => ({} as Record<string, string>));
  return (wallet: string) =>
    usernames[wallet.toLowerCase()] ? `${usernames[wallet.toLowerCase()]}.one` : `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

async function audit(action: string, targetId: string, reason: string, changes: object = {}) {
  await db()
    .from("referral_audit_logs")
    .insert({ action, admin_id: "admin", changes, reason: reason || "—", target_id: targetId, target_type: "campaign" })
    .then(() => undefined, () => undefined);
}

// ── Public ──────────────────────────────────────────────────────────────────

/**
 * Live and recently ended campaigns for the Rewards page: the top ten, the
 * viewer's own place, and — once a campaign is finalized — who won what.
 */
export async function listPublicCampaigns(viewer?: string | null) {
  const since = new Date(Date.now() - showEndedForMs).toISOString();
  const { data, error } = await db()
    .from(campaigns)
    .select("*")
    .in("status", ["live", "finalized", "paid"])
    .gte("ends_at", since)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(error.message);

  return Promise.all(
    (data ?? []).map(async (raw) => {
      const campaign = toCampaign(raw);
      const [top, mine, won] = await Promise.all([
        standings(campaign.id, { limit: 10 }),
        viewer ? standings(campaign.id, { wallet: viewer }) : Promise.resolve([]),
        campaign.status === "live"
          ? Promise.resolve([] as WinnerRow[])
          : db()
              .from(winners)
              .select("*")
              .eq("campaign_id", campaign.id)
              .neq("status", "REJECTED")
              .order("rank")
              .then(({ data: rows }) => (rows ?? []) as WinnerRow[]),
      ]);
      const name = await namesFor([...top.map((row) => row.wallet), ...won.map((row) => row.wallet_address)]);
      const prizeFor = (wallet: string) =>
        won.find((row) => row.wallet_address === wallet.toLowerCase());
      // While live, what each place would win if it ended now.
      const projected = campaign.status === "live" ? computePayouts(campaign, top.map((row) => ({ rank: row.rank, score: row.score, wallet_address: row.wallet })) as Standing[]) : [];
      const me = mine[0] ?? null;
      const myPrize = viewer ? prizeFor(viewer) : undefined;

      return {
        description: campaign.description,
        endsAt: campaign.ends_at,
        id: campaign.id,
        leaderboard: top.map((row) => ({
          name: name(row.wallet),
          prizeUsdc:
            Number(prizeFor(row.wallet)?.amount_usdc ?? 0) ||
            projected.find((payout) => payout.wallet === row.wallet)?.amountUsdc ||
            0,
          rank: row.rank,
          score: row.score,
        })),
        me: me
          ? {
              prizeStatus: myPrize?.status ?? null,
              prizeUsdc: myPrize ? Number(myPrize.amount_usdc) : null,
              rank: me.rank,
              score: me.score,
            }
          : null,
        metric: campaign.metric,
        minAmountUsd: campaign.min_amount_usd,
        minScore: campaign.min_score,
        payout:
          campaign.payout_type === "top"
            ? { splits: campaign.payout_splits, type: "top" as const }
            : { prizeUsdc: campaign.threshold_prize_usdc, type: "threshold" as const },
        phase: campaignPhase(campaign),
        prizePoolUsdc: campaign.prize_pool_usdc,
        sources: campaign.sources,
        startsAt: campaign.starts_at,
        status: campaign.status,
        title: campaign.title,
      };
    }),
  );
}

// ── Admin: set-up ───────────────────────────────────────────────────────────

export async function loadAdminCampaigns() {
  const { data, error } = await db().from(campaigns).select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map(toCampaign);
  if (rows.length === 0) return [];
  const { data: winnerRows } = await db()
    .from(winners)
    .select("*")
    .in("campaign_id", rows.map((row) => row.id))
    .order("rank");
  const name = await namesFor((winnerRows ?? []).map((row) => row.wallet_address as string));

  return rows.map((campaign) => ({
    ...campaign,
    phase: campaignPhase(campaign),
    winners: ((winnerRows ?? []) as WinnerRow[])
      .filter((row) => row.campaign_id === campaign.id)
      .map((row) => ({ ...row, amount_usdc: Number(row.amount_usdc), name: name(row.wallet_address), score: Number(row.score) })),
  }));
}

export async function adminLeaderboard(id: string, limit = 50) {
  const top = await standings(id, { limit });
  const name = await namesFor(top.map((row) => row.wallet));
  return top.map((row) => ({ ...row, name: name(row.wallet) }));
}

export async function createCampaign(body: Record<string, unknown>) {
  const row = readCampaignInput(body);
  const { data, error } = await db().from(campaigns).insert({ ...row, status: "draft" }).select("*").single();
  if (error) {
    if (error.code === "23505") throw new CampaignError("A campaign with that name already exists; change the title or slug.");
    throw new Error(error.message);
  }
  await audit("create_campaign", data.id as string, "", row);
  return toCampaign(data);
}

/** Drafts change freely. A live campaign is locked: its rules are a promise. */
export async function updateCampaign(id: string, body: Record<string, unknown>) {
  const current = await loadCampaign(id);
  if (current.status !== "draft") {
    throw new CampaignError("Only drafts can be edited. Cancel this one and create a new campaign.", 409);
  }
  const row = readCampaignInput(body);
  const { error } = await db().from(campaigns).update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "draft");
  if (error) throw new Error(error.message);
  await audit("update_campaign", id, "", row);
}

export async function publishCampaign(id: string) {
  const current = await loadCampaign(id);
  if (current.status !== "draft") throw new CampaignError("Only a draft can go live.", 409);
  if (Date.parse(current.ends_at) <= Date.now()) throw new CampaignError("That campaign has already ended; change its dates first.");
  await moveCampaign(id, ["draft"], { status: "live" });
  await audit("publish_campaign", id, "");
}

export async function cancelCampaign(id: string, reason: unknown) {
  const why = requireReason(reason);
  await moveCampaign(id, ["draft", "live"], { status: "cancelled" });
  await audit("cancel_campaign", id, why);
}

async function moveCampaign(id: string, from: string[], patch: Record<string, unknown>) {
  const { data, error } = await db()
    .from(campaigns)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", from)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CampaignError("Someone already changed this campaign. Refresh.", 409);
  return toCampaign(data);
}

function requireReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 3) throw new CampaignError("Give a short reason.");
  return reason.slice(0, 500);
}

// ── Admin: results and payouts ─────────────────────────────────────────────

/**
 * Freeze an ended campaign's result: compute every prize from the final
 * ranking and queue each winner for review. Nothing is paid here.
 */
export async function finalizeCampaign(id: string) {
  const campaign = await loadCampaign(id);
  if (campaign.status !== "live") throw new CampaignError("Only a live campaign can be finalized.", 409);
  if (campaignPhase(campaign) !== "ended") throw new CampaignError("It hasn't ended yet.", 409);

  const ranking = await standings(id);
  const payouts = computePayouts(
    campaign,
    ranking.map((row) => ({ rank: row.rank, score: row.score, wallet_address: row.wallet })),
  );

  if (payouts.length) {
    const { error } = await db()
      .from(winners)
      .upsert(
        payouts.map((payout) => ({
          amount_usdc: payout.amountUsdc,
          campaign_id: id,
          rank: payout.rank,
          score: payout.score,
          status: "REVIEW",
          wallet_address: payout.wallet,
        })),
        { ignoreDuplicates: true, onConflict: "campaign_id,wallet_address" },
      );
    if (error) throw new Error(error.message);
  }

  await moveCampaign(id, ["live"], {
    finalized_at: new Date().toISOString(),
    status: payouts.length ? "finalized" : "paid",
  });
  await audit("finalize_campaign", id, "", {
    totalUsdc: payouts.reduce((sum, payout) => sum + payout.amountUsdc, 0),
    winners: payouts.length,
  });
  return { totalUsdc: payouts.reduce((sum, payout) => sum + payout.amountUsdc, 0), winners: payouts.length };
}

async function moveWinner(id: string, from: string[], patch: Record<string, unknown>) {
  const { data, error } = await db()
    .from(winners)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", from)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new CampaignError("Someone already handled this winner, or it changed. Refresh.", 409);
  return data as WinnerRow;
}

/** When nothing is left to review or send, the campaign is done. */
async function settleCampaignIfDone(campaignId: string) {
  const { count } = await db()
    .from(winners)
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["REVIEW", "PENDING"]);
  if (count === 0) {
    await db().from(campaigns).update({ status: "paid", updated_at: new Date().toISOString() }).eq("id", campaignId).eq("status", "finalized");
  }
}

/**
 * Pay one reviewed winner from the treasury. REVIEW → PENDING first, so a
 * second click finds nothing to move; a failure that sent nothing goes back
 * to review, an unknown outcome stays PENDING for a person to check.
 */
export async function payWinner(id: string, reason: string) {
  const winner = await moveWinner(id, ["REVIEW"], { last_error: null, status: "PENDING" });
  const amount = Number(winner.amount_usdc);
  try {
    const txHash = await payUsdcFromTreasury({ adminApproved: true, to: winner.wallet_address, usdcAmount: amount });
    await db().from(winners).update({ payout_tx_hash: txHash, status: "PAID", updated_at: new Date().toISOString() }).eq("id", id);
    await audit("pay_campaign_winner", winner.campaign_id, reason, { amountUsdc: amount, txHash, wallet: winner.wallet_address });
    await settleCampaignIfDone(winner.campaign_id);
    return { txHash };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The payout failed.";
    await db()
      .from(winners)
      .update({ last_error: message, status: cause instanceof TreasuryError ? "REVIEW" : "PENDING", updated_at: new Date().toISOString() })
      .eq("id", id);
    throw new CampaignError(message, 502);
  }
}

/** Pay every winner still in review, one at a time, best rank first. */
export async function payAllWinners(campaignId: string, reason: string) {
  const { data, error } = await db()
    .from(winners)
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status", "REVIEW")
    .order("rank");
  if (error) throw new Error(error.message);
  const results: Array<{ id: string; txHash?: string; error?: string }> = [];
  for (const row of data ?? []) {
    try {
      results.push({ id: row.id as string, ...(await payWinner(row.id as string, reason)) });
    } catch (cause) {
      results.push({ error: cause instanceof Error ? cause.message : "Failed.", id: row.id as string });
      // A treasury problem will fail every payout the same way: stop.
      break;
    }
  }
  return { paid: results.filter((row) => row.txHash).length, results };
}

/** Not paid: fraud or a rule broken. The prize is not re-awarded to anyone else. */
export async function rejectWinner(id: string, reason: unknown) {
  const why = requireReason(reason);
  const winner = await moveWinner(id, ["REVIEW", "PENDING"], { reason: why, status: "REJECTED" });
  await audit("reject_campaign_winner", winner.campaign_id, why, { wallet: winner.wallet_address });
  await settleCampaignIfDone(winner.campaign_id);
}

/** A stuck payout that did go out (checked on the explorer). */
export async function markWinnerPaid(id: string, txHash: unknown, reason: string) {
  const hash = typeof txHash === "string" ? txHash.trim().toLowerCase() : "";
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new CampaignError("Paste the payout's transaction hash.");
  const winner = await moveWinner(id, ["PENDING"], { last_error: null, payout_tx_hash: hash, status: "PAID" });
  await audit("mark_campaign_winner_paid", winner.campaign_id, reason, { txHash: hash, wallet: winner.wallet_address });
  await settleCampaignIfDone(winner.campaign_id);
}
