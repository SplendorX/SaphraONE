// Team announcements: the rules both the admin page and the server use.
// No server imports, so the admin page can load it.

export const announcementTones = ["news", "important", "update", "maintenance"] as const;
export type AnnouncementTone = (typeof announcementTones)[number];

export const announcementLimits = { badge: 32, body: 240, title: 80 } as const;

export type TeamAnnouncement = {
  badge: string;
  body: string;
  created_at: string;
  created_by: string;
  dismissible: boolean;
  ends_at: string | null;
  href: string;
  id: string;
  pinned: boolean;
  published_at: string | null;
  starts_at: string | null;
  status: "draft" | "live" | "ended";
  title: string;
  tone: AnnouncementTone;
  updated_at: string;
};

/** Where an announcement stands right now, for the admin list. */
export function announcementState(row: TeamAnnouncement, now = new Date()) {
  if (row.status === "draft") return "draft" as const;
  if (row.status === "ended") return "ended" as const;
  if (row.ends_at && Date.parse(row.ends_at) <= now.getTime()) return "ended" as const;
  if (row.starts_at && Date.parse(row.starts_at) > now.getTime()) return "scheduled" as const;
  return "live" as const;
}
