"use client";

import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

import { OneWatermark } from "@/components/brand/one-watermark";
import { BalanceAssetBreakdown } from "./balance-asset-breakdown";
import { LiquiditySummary } from "./liquidity-summary";
import type { BusinessBalanceData } from "./types";

type BusinessBalanceCardProps = {
  data: BusinessBalanceData;
};

export function BusinessBalanceCard({ data }: BusinessBalanceCardProps) {
  const isTrendUp = data.trendDirection === "up";
  const isTrendDown = data.trendDirection === "down";

  return (
    <section className="one-watermark-host overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs">
      <OneWatermark className="one-watermark-behind" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8 lg:items-stretch min-h-[220px]">
        {/* Left Column: Total Balance & Assets (~65%) */}
        <div className="flex flex-col justify-between space-y-4 lg:col-span-7 xl:col-span-8">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Total Business Balance
              </span>
              <div
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  isTrendUp
                    ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : isTrendDown
                    ? "border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                    : "border border-border bg-muted text-muted-foreground"
                }`}
              >
                {isTrendUp && <ArrowUpRight className="h-3 w-3" />}
                {isTrendDown && <ArrowDownRight className="h-3 w-3" />}
                {!isTrendUp && !isTrendDown && <Minus className="h-3 w-3" />}
                <span>
                  {data.trendPercentage > 0 ? `${data.trendPercentage}%` : "0%"} from last month
                </span>
              </div>
            </div>

            {/* Dominant Balance display (42-48px bold font) */}
            <div className="mt-3 font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground">
              {data.totalBalanceFormatted}
            </div>
          </div>

          {/* Horizontal Asset Breakdown */}
          <div className="pt-2">
            <BalanceAssetBreakdown assets={data.assets} />
          </div>
        </div>

        {/* Right Column: Liquidity Summary (~35%) */}
        <div className="lg:col-span-5 xl:col-span-4">
          <LiquiditySummary data={data.liquidity} />
        </div>
      </div>
    </section>
  );
}
