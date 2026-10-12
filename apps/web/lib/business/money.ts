const assetDecimals = 6;

export function parseDisplayAmount(value: string) {
  const cleaned = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) {
    throw new Error("Enter a valid amount.");
  }
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  return cleaned;
}

export function displayToUnits(value: string, decimals = assetDecimals) {
  const cleaned = parseDisplayAmount(value);
  const [whole, fraction = ""] = cleaned.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

export function formatUsd(value: number | string) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(amount)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatAssetAmount(value: string, asset: "USDC" | "EURC") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `0.00 ${asset}`;
  const prefix = asset === "EURC" ? "€" : "$";
  return `${prefix}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

