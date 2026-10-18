/**
 * The admin view of the Checkout API (/admin/merchant-api), built from raw
 * rows. Pure, so the grouping and totals are unit-tested.
 */
import { moneyNumber, roundMoney } from "@/lib/account/money";

export const ADMIN_WINDOW_DAYS = 7;

export type AdminKeyRow = {
  id: string;
  wallet_address: string;
  mode: "live" | "test";
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type AdminChargeRow = {
  wallet_address: string;
  status: string;
  amount_received: string;
  currency: string;
};

export type AdminEndpointRow = {
  id: string;
  wallet_address: string;
  url: string;
  disabled_at: string | null;
  failing_since: string | null;
};

export type AdminDeliveryRow = {
  wallet_address: string;
  endpoint_id: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  attempts: number;
};

export type AdminBusinessRow = {
  wallet_address: string;
  business_name: string | null;
  username: string | null;
  verification_status: string | null;
};

export type AdminEndpointView = {
  id: string;
  url: string;
  disabled: boolean;
  failingSince: string | null;
  /** Deliveries in the window that gave up after every retry. */
  failed: number;
  /** Deliveries in the window still being retried after a failed attempt. */
  retrying: number;
};

export type AdminMerchantView = {
  wallet: string;
  businessName: string | null;
  username: string | null;
  verified: boolean;
  keys: Omit<AdminKeyRow, "wallet_address">[];
  activeKeys: number;
  lastUsedAt: string | null;
  sessions: number;
  paidSessions: number;
  /** Received by currency in the window, e.g. { USDC: "120.5" }. */
  volume: Record<string, string>;
  endpoints: AdminEndpointView[];
  failingEndpoints: number;
};

export type AdminOverview = {
  windowDays: number;
  totals: {
    merchants: number;
    activeKeys: number;
    sessions: number;
    paidSessions: number;
    volume: Record<string, string>;
    failingEndpoints: number;
  };
  merchants: AdminMerchantView[];
};

function addVolume(volume: Record<string, number>, currency: string, amount: string) {
  const value = moneyNumber(amount);
  if (value > 0) volume[currency] = (volume[currency] ?? 0) + value;
}

function rounded(volume: Record<string, number>) {
  return Object.fromEntries(Object.entries(volume).map(([currency, value]) => [currency, roundMoney(value)]));
}

function latest(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** An endpoint needs a look when it is flagged, or has given up on a delivery. */
export function isFailingEndpoint(endpoint: AdminEndpointView) {
  return !endpoint.disabled && (endpoint.failingSince !== null || endpoint.failed > 0);
}

/**
 * One row per business that has ever had a key. Charges, endpoints and
 * deliveries are counted only for those businesses. Businesses needing a look
 * (failing endpoints) come first, then the busiest.
 */
export function summarizeMerchantApi(input: {
  keys: AdminKeyRow[];
  charges: AdminChargeRow[];
  endpoints: AdminEndpointRow[];
  deliveries: AdminDeliveryRow[];
  businesses: AdminBusinessRow[];
  windowDays?: number;
}): AdminOverview {
  const merchants = new Map<string, AdminMerchantView & { rawVolume: Record<string, number> }>();
  const businesses = new Map(input.businesses.map((row) => [row.wallet_address.toLowerCase(), row]));

  for (const key of input.keys) {
    const wallet = key.wallet_address.toLowerCase();
    let merchant = merchants.get(wallet);
    if (!merchant) {
      const business = businesses.get(wallet);
      merchant = {
        activeKeys: 0,
        businessName: business?.business_name?.trim() || null,
        endpoints: [],
        failingEndpoints: 0,
        keys: [],
        lastUsedAt: null,
        paidSessions: 0,
        rawVolume: {},
        sessions: 0,
        username: business?.username ?? null,
        verified: business?.verification_status === "VERIFIED",
        volume: {},
        wallet,
      };
      merchants.set(wallet, merchant);
    }
    const { wallet_address: _wallet, ...view } = key;
    merchant.keys.push(view);
    if (!key.revoked_at) merchant.activeKeys += 1;
    merchant.lastUsedAt = latest(merchant.lastUsedAt, key.last_used_at);
  }

  for (const charge of input.charges) {
    const merchant = merchants.get(charge.wallet_address.toLowerCase());
    if (!merchant) continue;
    merchant.sessions += 1;
    if (charge.status === "PAID") merchant.paidSessions += 1;
    addVolume(merchant.rawVolume, charge.currency, charge.amount_received);
  }

  const endpoints = new Map<string, AdminEndpointView>();
  for (const row of input.endpoints) {
    const merchant = merchants.get(row.wallet_address.toLowerCase());
    if (!merchant) continue;
    const endpoint: AdminEndpointView = {
      disabled: row.disabled_at !== null,
      failed: 0,
      failingSince: row.failing_since,
      id: row.id,
      retrying: 0,
      url: row.url,
    };
    endpoints.set(row.id, endpoint);
    merchant.endpoints.push(endpoint);
  }
  for (const delivery of input.deliveries) {
    const endpoint = endpoints.get(delivery.endpoint_id);
    if (!endpoint) continue;
    if (delivery.status === "FAILED") endpoint.failed += 1;
    else if (delivery.status === "PENDING" && delivery.attempts > 0) endpoint.retrying += 1;
  }

  const totalVolume: Record<string, number> = {};
  const list = [...merchants.values()].map(({ rawVolume, ...merchant }) => {
    for (const [currency, value] of Object.entries(rawVolume)) {
      totalVolume[currency] = (totalVolume[currency] ?? 0) + value;
    }
    return {
      ...merchant,
      failingEndpoints: merchant.endpoints.filter(isFailingEndpoint).length,
      volume: rounded(rawVolume),
    };
  });
  list.sort(
    (a, b) =>
      Number(b.failingEndpoints > 0) - Number(a.failingEndpoints > 0) ||
      b.sessions - a.sessions ||
      (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""),
  );

  return {
    merchants: list,
    totals: {
      activeKeys: list.reduce((sum, merchant) => sum + merchant.activeKeys, 0),
      failingEndpoints: list.reduce((sum, merchant) => sum + merchant.failingEndpoints, 0),
      merchants: list.filter((merchant) => merchant.activeKeys > 0).length,
      paidSessions: list.reduce((sum, merchant) => sum + merchant.paidSessions, 0),
      sessions: list.reduce((sum, merchant) => sum + merchant.sessions, 0),
      volume: rounded(totalVolume),
    },
    windowDays: input.windowDays ?? ADMIN_WINDOW_DAYS,
  };
}

/** The reason an admin gives for revoking a key: required, 3–200 characters. */
export function readRevokeReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (reason.length < 3) throw new Error("Give a reason; the business will see it.");
  return reason.slice(0, 200);
}
