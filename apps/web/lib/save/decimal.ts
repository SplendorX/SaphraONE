/**
 * Decimal-safe helpers for Swift Save amounts.
 * Never use JS floating point for financial accounting.
 */

export function parseDecimalToUnits(value: string, decimals: number): bigint {
  const cleaned = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error("Invalid decimal amount.");
  }

  const [whole, fraction = ""] = cleaned.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function formatUnitsToDecimal(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const value = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

/** Multiply amountUnits by percentage (e.g. 5.00) with banker's-safe floor. */
export function calculateSaveAmountUnits(
  paymentAmountUnits: bigint,
  percentage: string | number,
): bigint {
  if (paymentAmountUnits <= 0n) {
    return 0n;
  }

  const pct =
    typeof percentage === "number"
      ? percentage.toFixed(2)
      : percentage.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(pct)) {
    throw new Error("Invalid percentage.");
  }

  // Convert percentage to basis points (2 decimal places): 5.25% → 525 bps of 10000 = 5.25%
  // Work in 1e4 scale for percentage points: 5.00 → 500 (hundredths of a percent)
  const [whole, frac = ""] = pct.split(".");
  const hundredths =
    BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));

  // save = payment * percentage / 100
  // hundredths is percentage * 100, so divide by 10000
  return (paymentAmountUnits * hundredths) / 10_000n;
}


export function progressPercent(
  currentUnits: bigint,
  targetUnits: bigint | null,
): number | null {
  if (targetUnits === null || targetUnits <= 0n) return null;
  if (currentUnits <= 0n) return 0;
  if (currentUnits >= targetUnits) return 100;
  // percent * 100 for one decimal: floor
  const bps = (currentUnits * 10_000n) / targetUnits;
  return Number(bps) / 100;
}

/** Total required = payment + savings + fees (all base units). */
export function totalRequiredUnits(input: {
  paymentUnits: bigint;
  saveUnits: bigint;
  networkFeeUnits?: bigint;
  platformFeeUnits?: bigint;
}): bigint {
  return (
    input.paymentUnits +
    input.saveUnits +
    (input.networkFeeUnits ?? 0n) +
    (input.platformFeeUnits ?? 0n)
  );
}
