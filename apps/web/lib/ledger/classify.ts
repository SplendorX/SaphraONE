/**
 * Whether a verified transaction counts toward USDC campaigns. Pure, so the
 * tests and the writer run exactly this.
 *
 * Every row is recorded either way; this only decides `eligible` and says why
 * not. Campaigns add their own rules on top (minimums, which features count).
 */

/** Features that move the account's own money rather than pay someone. */
export const nonPaymentSources = ["swap", "save", "earn", "deposit", "points"] as const;

export type IneligibleReason =
  /** A swap, savings or vault move: no one was paid. */
  | "not-a-payment"
  /** Nothing reached a payee once fees and savings legs are taken out. */
  | "no-payee"
  /** Every payee is one of the account's own wallets. */
  | "own-wallets";

export function classifyLedgerEntry(input: {
  source: string;
  amount: number;
  /** Payee address → amount. */
  payees: Record<string, number>;
  /** The account's own wallets (owner, Agent Wallet), any case. */
  ownWallets: string[];
}): { eligible: true; reason: null } | { eligible: false; reason: IneligibleReason } {
  if ((nonPaymentSources as readonly string[]).includes(input.source)) {
    return { eligible: false, reason: "not-a-payment" };
  }

  const paid = Object.entries(input.payees).filter(([, amount]) => amount > 0);
  if (!(input.amount > 0) || paid.length === 0) {
    return { eligible: false, reason: "no-payee" };
  }

  const own = new Set(input.ownWallets.map((wallet) => wallet.toLowerCase()));
  if (paid.every(([address]) => own.has(address.toLowerCase()))) {
    return { eligible: false, reason: "own-wallets" };
  }

  return { eligible: true, reason: null };
}
