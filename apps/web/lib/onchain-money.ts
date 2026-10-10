import { formatUnitsToDecimal, parseDecimalToUnits } from "@/lib/earn/decimal";
import { arcTokens } from "@/lib/tokens";

const USDC_DECIMALS = arcTokens.USDC.decimals;

const USDC_AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,6})?$/;

export class UsdcAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsdcAmountError";
  }
}

function normalizeUsdcInput(value: string): string {
  return value.trim().replace(/,/g, "");
}

/**
 * Parse a human-readable USDC amount into base units.
 * Never use viem `parseUnits` for USDC — Arc native gas USDC is 18 decimals;
 * ERC-20 USDC is 6. This helper always uses the ERC-20 USDC decimals.
 */
export function parseUsdc(value: string): bigint {
  const cleaned = normalizeUsdcInput(value);
  if (!cleaned) {
    throw new UsdcAmountError("Enter a USDC amount.");
  }
  if (cleaned.startsWith(".") || cleaned.startsWith("00")) {
    throw new UsdcAmountError(
      "Enter a valid USDC amount without a leading dot or extra leading zeros.",
    );
  }
  if (!USDC_AMOUNT_PATTERN.test(cleaned)) {
    throw new UsdcAmountError(
      "Enter a positive USDC amount with at most 6 decimal places.",
    );
  }
  const units = parseDecimalToUnits(cleaned, USDC_DECIMALS);
  if (units <= 0n) {
    throw new UsdcAmountError("Enter a USDC amount greater than zero.");
  }
  return units;
}

/**
 * Format USDC base units as a decimal string. Trailing zeros are trimmed,
 * except a single `0` for a zero balance.
 */
export function formatUsdc(units: bigint | string | number): string {
  const value =
    typeof units === "bigint"
      ? units
      : typeof units === "number"
        ? BigInt(Math.trunc(units))
        : parseDecimalToUnits(units, USDC_DECIMALS);
  return formatUnitsToDecimal(value, USDC_DECIMALS);
}

export function tryParseUsdc(value: string): bigint | null {
  try {
    const cleaned = normalizeUsdcInput(value);
    if (!cleaned || cleaned === "0" || /^0\.0+$/.test(cleaned)) {
      return 0n;
    }
    return parseUsdc(cleaned);
  } catch {
    return null;
  }
}

export function isValidUsdcAmount(value: string): boolean {
  try {
    parseUsdc(value);
    return true;
  } catch {
    return false;
  }
}


/** Display helper for UI amounts such as `100.00`. */
export function formatUsdcDisplay(value: string | bigint): string {
  const decimal =
    typeof value === "bigint" ? formatUsdc(value) : value.trim() || "0";
  const negative = decimal.startsWith("-");
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const padded = `${fraction}00`.slice(0, 2);
  return `${negative ? "-" : ""}${whole}.${padded}`;
}
