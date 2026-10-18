// Server-only. Team announcements: what the SaphraONE team posts from the
// admin platform, shown to everyone on Home (lib/announcements/service.ts).
// Table: team_announcements (packages/database/supabase/team-announcements.sql).
import { createSupabaseAdminClient } from "@/lib/supabase-server";

import {
  announcementLimits,
  announcementState,
  announcementTones,
  type AnnouncementTone,
  type TeamAnnouncement,
} from "@/lib/announcements/rules";

export { announcementLimits, announcementState, announcementTones };
export type { AnnouncementTone, TeamAnnouncement };

export class AnnouncementError extends Error {}

function text(value: unknown, label: string, max: number, required = false) {
  const clean = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (required && !clean) throw new AnnouncementError(`${label} is required.`);
  if (clean.length > max) throw new AnnouncementError(`${label} can be at most ${max} characters.`);
  return clean;
}

function time(value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new AnnouncementError(`${label} isn't a valid date.`);
  return new Date(parsed).toISOString();
}

/** The fields an admin sends, checked; the same rules as the table's. */
export function readAnnouncementInput(body: Record<string, unknown>) {
  const href = text(body.href, "Link", 500);
  if (href && !href.startsWith("/") && !href.startsWith("https://")) {
    throw new AnnouncementError("Link must be an app path (/rewards) or an https:// address.");
  }
  if (href.startsWith("//")) throw new AnnouncementError("Link must be an app path (/rewards) or an https:// address.");
  const tone = announcementTones.includes(body.tone as AnnouncementTone) ? (body.tone as AnnouncementTone) : null;
  if (!tone) throw new AnnouncementError("Choose a style.");
  const startsAt = time(body.startsAt, "Start");
  const endsAt = time(body.endsAt, "End");
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new AnnouncementError("End must be after the start.");
  }
  return {
    badge: text(body.badge, "Badge", announcementLimits.badge),
    body: text(body.body, "Message", announcementLimits.body),
    dismissible: body.dismissible !== false,
    ends_at: endsAt,
    href,
    pinned: body.pinned === true,
    starts_at: startsAt,
    title: text(body.title, "Title", announcementLimits.title, true),
    tone,
  };
}

function db() {
  return createSupabaseAdminClient();
}

function must<T>(result: { data: T | null; error: { message: string } | null }, fallback: string): T {
  if (result.error) {
    // A fresh database without the table: say what to run.
    if (/team_announcements/.test(result.error.message) && /does not exist|schema cache/.test(result.error.message)) {
      throw new AnnouncementError("Run packages/database/supabase/team-announcements.sql in Supabase first.");
    }
    throw new AnnouncementError(result.error.message || fallback);
  }
  if (result.data === null) throw new AnnouncementError(fallback);
  return result.data;
}

export async function listTeamAnnouncements() {
  return must(
    await db().from("team_announcements").select("*").order("created_at", { ascending: false }).limit(200),
    "Couldn't load announcements.",
  ) as TeamAnnouncement[];
}

export async function createTeamAnnouncement(body: Record<string, unknown>, createdBy: string) {
  const input = readAnnouncementInput(body);
  const publish = body.publish === true;
  return must(
    await db()
      .from("team_announcements")
      .insert({
        ...input,
        created_by: createdBy,
        published_at: publish ? new Date().toISOString() : null,
        status: publish ? "live" : "draft",
      })
      .select("*")
      .single(),
    "Couldn't save the announcement.",
  ) as TeamAnnouncement;
}

export async function updateTeamAnnouncement(id: unknown, body: Record<string, unknown>) {
  if (typeof id !== "string" || !id) throw new AnnouncementError("Which announcement?");
  return must(
    await db()
      .from("team_announcements")
      .update({ ...readAnnouncementInput(body), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single(),
    "That announcement wasn't found.",
  ) as TeamAnnouncement;
}

/** Publish (live), end, or take back to a draft. */
export async function setTeamAnnouncementStatus(id: unknown, status: TeamAnnouncement["status"]) {
  if (typeof id !== "string" || !id) throw new AnnouncementError("Which announcement?");
  const now = new Date().toISOString();
  return must(
    await db()
      .from("team_announcements")
      .update({ status, updated_at: now, ...(status === "live" ? { published_at: now } : {}) })
      .eq("id", id)
      .select("*")
      .single(),
    "That announcement wasn't found.",
  ) as TeamAnnouncement;
}

export async function deleteTeamAnnouncement(id: unknown) {
  if (typeof id !== "string" || !id) throw new AnnouncementError("Which announcement?");
  return must(
    await db().from("team_announcements").delete().eq("id", id).select("id,title").single(),
    "That announcement wasn't found.",
  ) as Pick<TeamAnnouncement, "id" | "title">;
}

/** Live now, pinned first then newest; none when the table doesn't exist yet. */
export async function liveTeamAnnouncements(now = new Date(), limit = 4): Promise<TeamAnnouncement[]> {
  const { data, error } = await db()
    .from("team_announcements")
    .select("*")
    .eq("status", "live")
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(50);
  if (error) return [];
  // The schedule window is checked here, the same way the admin list reads it.
  return ((data ?? []) as TeamAnnouncement[]).filter((row) => announcementState(row, now) === "live").slice(0, limit);
}
