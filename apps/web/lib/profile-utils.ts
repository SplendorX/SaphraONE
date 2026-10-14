import { getAddress, isAddress } from "viem";

const usernamePattern = /^[a-z][a-z0-9_]{2,19}$/;

const reservedUsernames = new Set([
  "admin",
  "api",
  "help",
  "root",
  "settings",
  "support",
  "saphra",
  "wallet",
]);

/**
 * A ONE ID is chosen once, at onboarding, and an account's email once it is
 * set: people pay and find each other by them. Only the team changes them
 * after that (on request through support).
 */
export const oneIdLockedMessage =
  "Your ONE ID is locked once your account is set up. To change it, contact support.";
export const accountEmailLockedMessage =
  "Your account email is locked once it's set. To change it, contact support.";

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function validateUsername(value: string) {
  const username = normalizeUsername(value);

  if (!usernamePattern.test(username)) {
    return "A ONE ID must be 3-20 characters, start with a letter, and use only lowercase letters, numbers, or underscores.";
  }

  if (reservedUsernames.has(username)) {
    return "That ONE ID is reserved.";
  }

  return null;
}

export function buildUsernameCandidate(walletAddress: string, attempt = 0) {
  const suffix = walletAddress.replace(/^0x/i, "").slice(-6).toLowerCase();

  if (attempt === 0) {
    return `swift_${suffix}`;
  }

  return `swift_${suffix}_${attempt}`;
}

export function usernameFromDisplayName(value?: string | null) {
  if (!value) {
    return null;
  }

  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);

  if (!slug || slug.length < 3 || !/^[a-z]/.test(slug)) {
    return null;
  }

  return slug;
}

export function formatUsernameLabel(username: string) {
  return `@${normalizeUsername(username)}`;
}

export type ParsedRecipientInput =
  | { kind: "address"; address: string }
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "username"; username: string };

export function parseRecipientInput(value: string): ParsedRecipientInput {
  const trimmed = value.trim();

  if (!trimmed) {
    return { kind: "empty" };
  }

  if (isAddress(trimmed)) {
    return { kind: "address", address: getAddress(trimmed).toLowerCase() };
  }

  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return { kind: "invalid", message: "Enter a valid wallet address." };
  }

  const username = normalizeUsername(trimmed.replace(/^@+/, ""));
  const validationError = validateUsername(username);

  if (validationError) {
    return { kind: "invalid", message: validationError };
  }

  return { kind: "username", username };
}