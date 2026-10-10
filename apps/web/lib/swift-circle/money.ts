import {
  formatUnitsToDecimal,
  parseDecimalToUnits,
} from "@/lib/save/decimal";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";

/** USDC/EURC on Arc use 6 decimals. Never use floating-point for money. */
export function tokenDecimals(asset: ArcTokenSymbol) {
  return arcTokens[asset]?.decimals ?? 6;
}

export function parseAmountUnits(
  value: unknown,
  asset: ArcTokenSymbol,
): { amount: string; amount_units: string; units: bigint } | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const text = typeof value === "number" ? value.toString() : value.trim();
  if (!text || text.startsWith("-")) {
    return null;
  }
  try {
    const decimals = tokenDecimals(asset);
    const units = parseDecimalToUnits(text, decimals);
    if (units <= 0n) return null;
    return {
      amount: formatUnitsToDecimal(units, decimals),
      amount_units: units.toString(),
      units,
    };
  } catch {
    return null;
  }
}

export function unitsToAmount(units: bigint, asset: ArcTokenSymbol) {
  return formatUnitsToDecimal(units, tokenDecimals(asset));
}

export function parseUnits(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    const parsed = BigInt(value);
    return parsed < 0n ? 0n : parsed;
  } catch {
    return 0n;
  }
}



export function sumUnits(values: readonly bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
}

/**
 * Split `total` equally across `count` recipients.
 * Remainder units go to the first recipients (1 unit each) so the sum is exact.
 */
export function equalSplitUnits(total: bigint, count: number): bigint[] {
  if (count <= 0) {
    throw new Error("At least one recipient is required.");
  }
  if (total <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  const n = BigInt(count);
  const each = total / n;
  if (each <= 0n) {
    throw new Error("Amount is too small to split across the selected members.");
  }
  const remainder = total % n;
  return Array.from({ length: count }, (_, index) =>
    index < Number(remainder) ? each + 1n : each,
  );
}

export function assertCustomSplit(
  total: bigint,
  parts: readonly bigint[],
) {
  if (parts.length === 0) {
    throw new Error("At least one recipient is required.");
  }
  for (const part of parts) {
    if (part <= 0n) {
      throw new Error("Each recipient amount must be greater than zero.");
    }
  }
  const sum = sumUnits(parts);
  if (sum !== total) {
    throw new Error("Recipient amounts must add up to the total.");
  }
}

export function formatUsd(amount: string | number | null | undefined) {
  const cleaned = String(amount ?? "").trim();
  if (!cleaned || cleaned === "null" || cleaned === "undefined") return "$0.00";
  const [whole, fraction = ""] = cleaned.split(".");
  if (!/^-?\d+$/.test(whole)) return "$0.00";
  return `$${whole}.${(fraction + "00").slice(0, 2)}`;
}

export function progressPercent(current: bigint, target: bigint | null) {
  if (target === null || target <= 0n) return null;
  if (current <= 0n) return 0;
  if (current >= target) return 100;
  const bps = (current * 10_000n) / target;
  return Number(bps) / 100;
}
