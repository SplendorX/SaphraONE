import { progressPercent } from "@/lib/save/decimal";
import { getPocketEmoji, type SavingsPocketRecord } from "@/lib/save/types";
import { type ArcTokenSymbol } from "@/lib/tokens";

export function formatMoney(
  amount: string | null | undefined,
  currency: ArcTokenSymbol = "USDC",
) {
  if (!amount) return `$0.00`;
  const [w, f = ""] = amount.split(".");
  const frac = (f + "00").slice(0, 2);
  return `$${w}.${frac} ${currency}`;
}

export function formatMoneyShort(amount: string | null | undefined) {
  if (!amount) return "$0.00";
  const [w, f = ""] = amount.split(".");
  return `$${w}.${(f + "00").slice(0, 2)}`;
}

export function pocketProgress(pocket: SavingsPocketRecord) {
  const current = BigInt(pocket.current_balance_units || "0");
  const target = pocket.target_amount_units
    ? BigInt(pocket.target_amount_units)
    : null;
  return progressPercent(current, target);
}

export function pocketLabel(pocket: SavingsPocketRecord) {
  return `${getPocketEmoji(pocket.icon)} ${pocket.name}`;
}

