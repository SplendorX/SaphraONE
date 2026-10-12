/**
 * Account deletion, the parts both sides share. No imports: the browser and
 * the tests load this file as it is.
 *
 * The flow: Settings → Delete account checks what's still open, asks why,
 * confirms it's really the owner (an emailed code, plus the authenticator
 * code when two-factor is on) and the typed word DELETE. The account is then
 * scheduled for deletion and this device signs out. For GRACE_DAYS, signing
 * back in shows "Restore account". After that the daily cron erases it.
 */

export const GRACE_DAYS = 30;
/**
 * How long an erased account's @username is held before someone else can
 * claim it, so payments saved under the old name can't reach a stranger.
 */
export const USERNAME_HOLD_DAYS = 365;
export const CONFIRM_PHRASE = "DELETE";
export const FEEDBACK_MAX = 500;

export const deletionReasons = [
  { id: "not-using", label: "I don't use SaphraONE any more" },
  { id: "other-account", label: "I have another SaphraONE account" },
  { id: "privacy", label: "Privacy or data concerns" },
  { id: "missing-feature", label: "It's missing something I need" },
  { id: "fees", label: "Fees or costs" },
  { id: "support", label: "A problem support didn't solve" },
  { id: "other", label: "Something else" },
] as const;

export type DeletionReason = (typeof deletionReasons)[number]["id"];

export function readDeletionReason(value: unknown): DeletionReason | null {
  return deletionReasons.some((reason) => reason.id === value) ? (value as DeletionReason) : null;
}

export function readFeedback(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ").slice(0, FEEDBACK_MAX);
  return text || null;
}

/** The typed confirmation, forgiving case and stray spaces. */
export function confirmPhraseMatches(value: unknown) {
  return typeof value === "string" && value.trim().toUpperCase() === CONFIRM_PHRASE;
}

export function scheduledDeletionDate(from: Date = new Date()) {
  return new Date(from.getTime() + GRACE_DAYS * 24 * 60 * 60_000);
}

/** When a username retired at `from` may be claimed by someone else. */
export function usernameReleaseDate(from: Date = new Date()) {
  return new Date(from.getTime() + USERNAME_HOLD_DAYS * 24 * 60 * 60_000);
}

/** Whether a retired name blocks `wallet` from claiming it right now. */
export function usernameHeldFrom(
  hold: { available_at: string; owner_wallet: string } | null,
  wallet: string | null | undefined,
  now: number = Date.now(),
) {
  if (!hold) return false;
  if (wallet && hold.owner_wallet.toLowerCase() === wallet.toLowerCase()) return false;
  return Date.parse(hold.available_at) > now;
}

/**
 * An erased account keeps its profiles row (payments and invoices point at
 * it) under this username. The colon fails username validation, so it can't
 * be looked up, sent to, or claimed.
 */
const deletedUsernamePrefix = "deleted:";

export function deletedUsername(requestId: string) {
  return `${deletedUsernamePrefix}${requestId}`;
}

export function isDeletedUsername(username: unknown) {
  return typeof username === "string" && username.startsWith(deletedUsernamePrefix);
}

/** Something that must be sorted out first, or that deleting will change. */
export type DeletionCheck = {
  id: string;
  /** "blocker" stops the request; "notice" is shown and acknowledged. */
  kind: "blocker" | "notice";
  title: string;
  detail: string;
  /** Where to go to sort it out. */
  href?: string;
};

export type DeletionStatus = {
  /** The live request, when the account is already scheduled for deletion. */
  scheduled: { requestedAt: string; scheduledFor: string } | null;
  checks: DeletionCheck[];
  /** What the confirm step will ask for. */
  verify: {
    /** j•••e@gmail.com: the security email the code goes to, or null to ask for one. */
    email: string | null;
    emailAvailable: boolean;
    twoFactor: boolean;
  };
  graceDays: number;
};

/** "12 November 2026" */
export function formatDeletionDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** Whole days left until `iso`, never below 0. */
export function daysUntil(iso: string, now: number = Date.now()) {
  const ms = Date.parse(iso) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / (24 * 60 * 60_000))) : 0;
}
