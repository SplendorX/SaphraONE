const businessUsernamePattern = /^[a-z][a-z0-9_-]{2,29}$/;

const reservedUsernames = new Set([
  "admin",
  "api",
  "business",
  "company",
  "dashboard",
  "earn",
  "help",
  "pay",
  "payments",
  "request",
  "root",
  "save",
  "send",
  "settings",
  "support",
  "swap",
  "official",
  "security",
  "saphra",
  "system",
  "team",
  "wallet",
]);

export function normalizeHandle(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

export function validateBusinessUsername(value: string) {
  const username = normalizeHandle(value);

  if (!businessUsernamePattern.test(username)) {
    return "Business usernames must be 3–30 characters, start with a letter, and use lowercase letters, numbers, underscores, or hyphens.";
  }

  if (reservedUsernames.has(username)) {
    return "That username is reserved.";
  }

  return null;
}

export function slugFromName(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);

  if (!slug || slug.length < 3 || !/^[a-z]/.test(slug)) {
    return null;
  }

  return slug;
}

