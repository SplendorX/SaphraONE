

export type EarnPerformanceSummary = {
  /** Sum of deposit assets (decimal string, USDC). */
  totalDeposited: string;
  /** Sum of withdrawal assets (decimal string). */
  totalWithdrawn: string;
  /**
   * Net principal still in vault from indexed flows:
   * max(0, totalDeposited - totalWithdrawn).
   */
  netPrincipal: string;
  /** Current vault position value (assets) as decimal string. */
  currentValue: string;
  /**
   * Estimated earned = max(0, currentValue - netPrincipal).
   * Not exact if fees, partial withdrawals, or incomplete indexing.
   */
  totalEarned: string;
  /** Estimated gross yield before performance fee (from net + fee rate). */
  estimatedGrossYield: string;
  /** Estimated SaphraONE fee share of yield (decimal string). */
  estimatedFee: string;
  /** Whether summary has enough indexed history to be meaningful. */
  hasHistory: boolean;
  /** Human note when numbers are estimates. */
  note: string;
};

export type PortfolioChartPoint = {
  /** ISO timestamp */
  at: string;
  /** Label for axis (e.g. Mon, or short date) */
  label: string;
  /** Decimal string USDC */
  value: string;
  /** Kind of point */
  kind: "deposit" | "withdrawal" | "current";
};

/** Format a decimal string as $X,XXX.XX for display (display only). */
export function formatUsdDisplay(decimal: string | undefined | null): string {
  if (decimal === undefined || decimal === null || decimal === "") return "—";
  const neg = decimal.startsWith("-");
  const raw = neg ? decimal.slice(1) : decimal;
  const [wholePart, fracPart = ""] = raw.split(".");
  const whole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracPart + "00").slice(0, 2);
  return `${neg ? "-" : ""}${whole}.${frac}`;
}
