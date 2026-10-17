// Server-only. What Home announces: USDC campaigns once they're published
// (status "live") and ONE Points quests once they're active, each until it
// ends. New ones show up by themselves; people dismiss them one by one.
import { ENDING_NOTICE_DAYS } from "@/lib/partners/config";
import { loadMember, loadOfferById } from "@/lib/partners/db";
import { daysLeft, windowOpen } from "@/lib/partners/rules";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export type Announcement = {
  /** The pill on the card: the prize or the points. */
  badge: string;
  body: string;
  href: string;
  /** "campaign:<id>", "quest:<id>" or "welcome:<offer>", so a dismissal sticks to one item. */
  id: string;
  kind: "campaign" | "quest" | "welcome";
  publishedAt: string;
  title: string;
};

const limit = 6;

function firstSentence(text: string) {
  const clean = text.trim().replace(/\s+/g, " ");
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? clean.slice(0, end + 1) : clean;
  return sentence.length > 120 ? `${sentence.slice(0, 117).trimEnd()}…` : sentence;
}

function usdc(amount: number) {
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
}

/**
 * Live announcements. With `wallet` (the signed-in account), quests it has
 * already completed are left out, so a claimed "follow us" quest stops showing.
 */
export async function listAnnouncements(
  now = new Date(),
  wallet: string | null = null,
): Promise<Announcement[]> {
  const db = createSupabaseAdminClient();
  const nowIso = now.toISOString();

  // Each table may not exist yet on a fresh database: that just means none.
  const [campaigns, quests, completed] = await Promise.all([
    db
      .from("campaigns")
      .select("id,title,description,prize_pool_usdc,starts_at,ends_at,created_at")
      .eq("status", "live")
      .gt("ends_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(limit)
      .then(({ data }) => (data ?? []) as Array<Record<string, unknown>>, () => []),
    db
      .from("rewards_quests")
      .select("id,title,description,points,starts_at,ends_at")
      .eq("active", true)
      .lte("starts_at", nowIso)
      .order("starts_at", { ascending: false })
      .limit(limit * 2)
      .then(({ data }) => (data ?? []) as Array<Record<string, unknown>>, () => []),
    wallet
      ? db
          .from("rewards_quest_completions")
          .select("quest_id")
          .eq("wallet_address", wallet.toLowerCase())
          .then(
            ({ data }) => new Set(((data ?? []) as Array<{ quest_id: string }>).map((row) => row.quest_id)),
            () => new Set<string>(),
          )
      : Promise.resolve(new Set<string>()),
  ]);

  const fromCampaigns: Announcement[] = campaigns.map((row) => {
    const pool = Number(row.prize_pool_usdc ?? 0);
    const upcoming = Date.parse(String(row.starts_at)) > now.getTime();
    return {
      badge: pool > 0 ? `${usdc(pool)} to win` : "USDC prizes",
      body: firstSentence(String(row.description ?? "")) || "Pay with SaphraONE to climb the leaderboard.",
      href: "/rewards",
      id: `campaign:${row.id}`,
      kind: "campaign",
      publishedAt: String(row.created_at ?? row.starts_at),
      title: upcoming ? `Coming soon: ${row.title}` : String(row.title),
    };
  });

  const fromQuests: Announcement[] = quests
    .filter((row) => (!row.ends_at || String(row.ends_at) > nowIso) && !completed.has(String(row.id)))
    .map((row) => {
      const points = Number(row.points ?? 0);
      return {
        badge: points > 0 ? `+${points.toLocaleString("en-US")} ONE Points` : "ONE Points",
        body: firstSentence(String(row.description ?? "")) || "Complete it to collect ONE Points.",
        href: "/rewards",
        id: `quest:${row.id}`,
        kind: "quest",
        publishedAt: String(row.starts_at),
        title: String(row.title),
      };
    });

  // A creator partner's welcome package comes first: it's the member's own.
  const welcome = wallet ? await welcomeAnnouncement(wallet, now).catch(() => null) : null;
  return [
    ...(welcome ? [welcome] : []),
    ...[...fromCampaigns, ...fromQuests].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  ].slice(0, limit);
}

/**
 * For an account that joined through a creator's link: its welcome package,
 * then (a new card, so a dismissed one comes back) when it's about to end.
 */
async function welcomeAnnouncement(wallet: string, now: Date): Promise<Announcement | null> {
  const member = await loadMember(wallet);
  if (!member || member.perks_status !== "ACTIVE" || !windowOpen(member, now)) return null;
  const loaded = await loadOfferById(member.offer_id);
  if (!loaded) return null;
  const who = loaded.partner.handle ? `@${loaded.partner.handle}` : loaded.partner.display_name;
  const left = daysLeft(member.perks_end_at, now);
  const ending = left <= ENDING_NOTICE_DAYS;
  return {
    badge: ending ? `${left} day${left === 1 ? "" : "s"} left` : "Welcome perks",
    body: ending
      ? "Your welcome perks end soon. Claim any USDC back on the Rewards page."
      : "Fee rebates, bonus points and more while your welcome period lasts.",
    href: "/rewards",
    id: `${ending ? "welcome-ending" : "welcome"}:${member.offer_id}`,
    kind: "welcome",
    publishedAt: member.perks_start_at,
    title: `Welcome from ${who}`,
  };
}
