/**
 * Decimal-safe helpers for Earn amounts.
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
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function bpsToPercentString(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined || Number.isNaN(bps)) {
    return null;
  }
  // bps are integer; display with 2 decimals without float math on money
  const sign = bps < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(bps));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}%`;
}

