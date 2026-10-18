/**
 * The tools of the admin platform (/admin). A team member is given some of
 * them by id (admin_members.tools); the owner has all of them. Shared by the
 * server checks and the sidebar, so a tool can't be shown but refused, or
 * refused but shown.
 */
export const adminTools = [
  {
    description: "Look up any account; change a ONE ID or email on request.",
    href: "/admin/users",
    id: "users",
    label: "Users",
  },
  {
    description: "Every payment recorded on Arc, with large and unusual ones flagged.",
    href: "/admin/transactions",
    id: "transactions",
    label: "Transactions",
  },
  {
    description: "Customer requests and replies.",
    href: "/admin/support",
    id: "support",
    label: "Support",
  },
  {
    description: "Review businesses asking to be verified.",
    href: "/admin/business-verifications",
    id: "verifications",
    label: "Business verification",
  },
  {
    description: "ONE Points, referrals and adjustments.",
    href: "/admin/rewards",
    id: "rewards",
    label: "Rewards",
  },
  {
    description: "Post important news to everyone, as a card on Home.",
    href: "/admin/announcements",
    id: "announcements",
    label: "Announcements",
  },
  {
    description: "USDC campaigns and leaderboards.",
    href: "/admin/campaigns",
    id: "campaigns",
    label: "Campaigns",
  },
  {
    description: "Creator partners, their offers, members and payouts.",
    href: "/admin/partners",
    id: "partners",
    label: "Partners",
  },
  {
    description: "Businesses using the Checkout API: keys, volume, failing webhooks.",
    href: "/admin/merchant-api",
    id: "merchant-api",
    label: "Checkout API",
  },
  {
    description: "The vaults members can invest in, and their auto-invest rules.",
    href: "/admin/earn",
    id: "earn",
    label: "Invest",
  },
  {
    description: "Growth and usage numbers.",
    href: "/admin/traction",
    id: "traction",
    label: "Traction",
  },
  {
    description: "Who on the team can open which tool.",
    href: "/admin/team",
    id: "team",
    label: "Team & access",
    ownerOnly: true,
  },
  {
    description: "Every change made from the admin platform.",
    href: "/admin/audit",
    id: "audit",
    label: "Audit log",
    ownerOnly: true,
  },
] as const;

export type AdminToolId = (typeof adminTools)[number]["id"];

/** Tools a team member can be given (the owner-only ones never are). */
export const assignableTools = adminTools.filter(
  (tool) => !("ownerOnly" in tool && tool.ownerOnly),
);

export function isAdminToolId(value: unknown): value is AdminToolId {
  return adminTools.some((tool) => tool.id === value);
}

/** The tool a path belongs to (/admin/users/… → users), or null for the overview. */
export function adminToolForPath(pathname: string): AdminToolId | null {
  if (pathname === "/admin/kyc" || pathname.startsWith("/admin/kyc/")) return "verifications";
  const tool = adminTools.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return tool?.id ?? null;
}

export type AdminActor = {
  /** "owner-key", or the member's wallet. */
  id: string;
  label: string;
  role: "member" | "owner";
  tools: AdminToolId[];
  /** How they got in: the owner key, or their SaphraONE account. */
  via: "account" | "key";
};

export function actorCan(actor: AdminActor, tool: AdminToolId) {
  return actor.role === "owner" || actor.tools.includes(tool);
}
