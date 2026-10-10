"use client";

import { arcExplorerUrl } from "@/lib/chains";
import {
  Server,
  FileText,
  Users,
  Building2,
  ArrowUpRight,
  ArrowDownLeft,
  ExternalLink,
} from "lucide-react";
import type { BusinessActivityItem, BusinessActivityCategory } from "./types";

type BusinessActivityRowProps = {
  activity: BusinessActivityItem;
};

function getCategoryIcon(category: BusinessActivityCategory, isIncoming: boolean) {
  switch (category) {
    case "software":
      return <Server className="h-4 w-4" />;
    case "invoice":
      return <FileText className="h-4 w-4" />;
    case "payroll":
      return <Users className="h-4 w-4" />;
    case "vendor":
      return <Building2 className="h-4 w-4" />;
    case "transfer":
      return isIncoming ? (
        <ArrowDownLeft className="h-4 w-4" />
      ) : (
        <ArrowUpRight className="h-4 w-4" />
      );
    default:
      return <FileText className="h-4 w-4" />;
  }
}

export function BusinessActivityRow({ activity }: BusinessActivityRowProps) {
  const isIncoming = activity.isIncoming;

  return (
    <div className="flex items-center justify-between gap-3 py-3.5 transition-colors hover:bg-muted/30 px-2 rounded-lg -mx-2 group">
      {/* Icon and details */}
      <div className="flex items-center gap-3.5 min-w-0">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
            isIncoming
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-border bg-muted/50 text-muted-foreground"
          }`}
        >
          {getCategoryIcon(activity.category, isIncoming)}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">
              {activity.title}
            </span>
            {activity.txHash && (
              <a
                href={`${arcExplorerUrl}/tx/${activity.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground/50 hover:text-foreground inline-flex items-center transition-colors"
                title="View on ArcScan"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {activity.description}
          </div>
        </div>
      </div>

      {/* Amount and status */}
      <div className="flex flex-col items-end shrink-0 pl-2">
        <div
          className={`text-sm font-bold tracking-tight ${
            isIncoming
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-foreground"
          }`}
        >
          {isIncoming ? "+" : "−"} {activity.amountFormatted}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.2 text-[10px] font-medium ${
              activity.status === "Completed"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : activity.status === "Failed"
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            }`}
          >
            {activity.status}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {activity.dateFormatted}
          </span>
        </div>
      </div>
    </div>
  );
}
