import type { ArcTokenSymbol } from "@/lib/tokens";

const tokenIconPaths = {
  EURC: "/tokens/eurc.svg",
  USDC: "/tokens/usdc.svg",
} as const satisfies Record<ArcTokenSymbol, string>;

export function TokenIcon({
  className = "h-5 w-5",
  symbol,
}: {
  className?: string;
  symbol: ArcTokenSymbol;
}) {
  return (
    <img
      alt={`${symbol} token`}
      className={className}
      height={40}
      src={tokenIconPaths[symbol]}
      width={40}
    />
  );
}

