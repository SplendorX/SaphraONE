import { type NextRequest } from "next/server";

import { logAdminAction, requireAdminTool } from "@/lib/admin/access";
import {
  AnnouncementError,
  createTeamAnnouncement,
  deleteTeamAnnouncement,
  listTeamAnnouncements,
  setTeamAnnouncementStatus,
  updateTeamAnnouncement,
} from "@/lib/announcements/team";
import { jsonError, jsonOk, readJsonRecord } from "@/lib/http";

export const runtime = "nodejs";

/** Every team announcement, newest first. */
export async function GET(request: NextRequest) {
  const access = await requireAdminTool(request, "announcements");
  if (!access.ok) return access.response;
  try {
    return jsonOk({ announcements: await listTeamAnnouncements() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Couldn't load announcements.", 500);
  }
}

/**
 * `{ action: "create", ...fields, publish? }`, `{ action: "update", id, ...fields }`,
 * `{ action: "publish" | "end" | "unpublish" | "delete", id }`.
 */
export async function POST(request: NextRequest) {
  const access = await requireAdminTool(request, "announcements");
  if (!access.ok) return access.response;
  const body = await readJsonRecord(request);
  if (!body) return jsonError("A valid JSON body is required.", 400);

  try {
    switch (body.action) {
      case "create": {
        const row = await createTeamAnnouncement(body, access.actor.label);
        await logAdminAction(access.actor, "announcements", row.status === "live" ? "publish-announcement" : "create-announcement", row.id, {
          title: row.title,
        });
        return jsonOk({ announcement: row });
      }
      case "update": {
        const row = await updateTeamAnnouncement(body.id, body);
        await logAdminAction(access.actor, "announcements", "update-announcement", row.id, { title: row.title });
        return jsonOk({ announcement: row });
      }
      case "publish":
      case "end":
      case "unpublish": {
        const status = body.action === "publish" ? "live" : body.action === "end" ? "ended" : "draft";
        const row = await setTeamAnnouncementStatus(body.id, status);
        await logAdminAction(access.actor, "announcements", `${body.action}-announcement`, row.id, { title: row.title });
        return jsonOk({ announcement: row });
      }
      case "delete": {
        const row = await deleteTeamAnnouncement(body.id);
        await logAdminAction(access.actor, "announcements", "delete-announcement", row.id, { title: row.title });
        return jsonOk({ ok: true });
      }
      default:
        return jsonError("Unknown action.", 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't save the announcement.";
    return jsonError(message, error instanceof AnnouncementError ? 400 : 500);
  }
}
