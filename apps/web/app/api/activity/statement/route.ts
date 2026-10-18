import { type NextRequest } from "next/server";

import { loadAccount } from "@/lib/account/auth";
import { loadBusinessProfile } from "@/lib/account/service";
import type { AccountActivityItem } from "@/lib/activity/merge";
import { loadActivityItems } from "@/lib/activity/report";
import { agentWalletOwners } from "@/lib/agent-wallet/config";
import { usernamesForWallets } from "@/lib/business/service";
import { jsonError, jsonOk } from "@/lib/http";
import { isArcMainnet } from "@/lib/network";
import { consumeRateLimit } from "@/lib/rate-limit";
import { assertRecurringAccess, normalizeOwnerWallet } from "@/lib/recurring-auth";
import { walletHistoryCoverage } from "@/lib/wallet-history";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

function readDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A statement of account: every activity in a date range the user picks
 * (the Activity page itself only shows the last 30 days). Returns the merged
 * rows and who they belong to; the browser renders the PDF or CSV.
 *
 * `from` and `to` are calendar days (YYYY-MM-DD, UTC), both inclusive.
 */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Money to or from a SaphraONE account reads as its @username, not the
 * wallet: each row's counterparty, full or shortened in the title, is
 * swapped for the name. Wallets without an account keep the address.
 */
async function withUsernames(items: AccountActivityItem[], ownerWallet: string) {
  const wallets = [
    ...new Set(
      items
        .map((item) => (item.transfer?.counterparty ?? item.counterparty ?? "").toLowerCase())
        .filter((wallet) => /^0x[0-9a-f]{40}$/.test(wallet)),
    ),
  ];
  // Topping up (or emptying) your own Agent Wallet reads as ALLIE, not an address.
  const owners = await agentWalletOwners(wallets).catch(() => ({}) as Record<string, string>);
  const own = new Set(
    Object.entries(owners)
      .filter(([, owner]) => owner.toLowerCase() === ownerWallet.toLowerCase())
      .map(([agent]) => agent.toLowerCase()),
  );
  items = items.map((item) => {
    const wallet = (item.transfer?.counterparty ?? item.counterparty ?? "").toLowerCase();
    if (!own.has(wallet) || (item.direction !== "out" && item.direction !== "in")) return item;
    return { ...item, title: item.direction === "out" ? "Deposited to ALLIE" : "Withdrawn from ALLIE" };
  });
  const usernames: Record<string, string> = {};
  // The lookup takes up to 100 wallets at a time.
  for (let index = 0; index < wallets.length; index += 100) {
    Object.assign(usernames, await usernamesForWallets(wallets.slice(index, index + 100)).catch(() => ({})));
  }
  if (Object.keys(usernames).length === 0) return items;

  return items.map((item) => {
    const wallet = (item.transfer?.counterparty ?? item.counterparty ?? "").toLowerCase();
    const username = usernames[wallet];
    if (!username || own.has(wallet)) return item;
    const handle = `${username}.one`;
    const short = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
    const title = item.title
      ? item.title
          .replace(new RegExp(escapeRegExp(wallet), "gi"), handle)
          .replace(new RegExp(escapeRegExp(short), "gi"), handle)
      : null;
    return {
      ...item,
      title: title ?? (item.direction === "in" ? `Received from ${handle}` : `Sent to ${handle}`),
    };
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ownerWallet = normalizeOwnerWallet(params.get("ownerWallet"));
  if (!ownerWallet) return jsonError("A valid owner wallet is required.", 400);

  const canAccess = await assertRecurringAccess({
    circleSocialUuid: params.get("circleSocialUuid"),
    ownerWallet,
  });
  if (!canAccess) return jsonError("Authorize this wallet before downloading a statement.", 401);

  const fromDay = readDay(params.get("from"));
  const toDay = readDay(params.get("to"));
  if (!fromDay || !toDay) return jsonError("Choose a start and end date.", 400);
  if (fromDay > toDay) return jsonError("The start date must be before the end date.", 400);
  if (fromDay.getTime() > Date.now()) return jsonError("The start date can't be in the future.", 400);
  const from = fromDay;
  const to = new Date(Math.min(toDay.getTime() + DAY_MS - 1, Date.now()));

  if (!(await consumeRateLimit(`statement:${ownerWallet}`, 10, 60))) {
    return jsonError("Too many statements at once. Try again in a minute.", 429);
  }

  try {
    const [items, account, business, coverage] = await Promise.all([
      loadActivityItems(ownerWallet, { from, to }),
      loadAccount(ownerWallet).catch(() => null),
      loadBusinessProfile(ownerWallet).catch(() => null),
      isArcMainnet() ? walletHistoryCoverage(ownerWallet) : Promise.resolve(null),
    ]);

    return jsonOk({
      account: {
        businessName: account?.account_type === "BUSINESS" ? (business?.business_name ?? null) : null,
        displayName: account?.display_name ?? null,
        username: account?.username ?? null,
        wallet: ownerWallet,
      },
      // On-chain transfers no SaphraONE feature recorded are complete from
      // this time; SaphraONE's own records cover the whole range.
      onchainCoverageFrom: coverage,
      generatedAt: new Date().toISOString(),
      items: await withUsernames(items, ownerWallet),
      period: { from: from.toISOString(), to: to.toISOString() },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "The statement couldn't be prepared.",
      500,
    );
  }
}
