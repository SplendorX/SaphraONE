"use client";

import Link from "next/link";
import { ArrowRight, Clock, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/activity/merge";
import { useWalletUsernames } from "@/lib/activity/usernames";
import { BusinessActivityRow } from "./business-activity-row";
import type { BusinessActivityItem } from "./types";

type BusinessActivityCardProps = {
  activities: BusinessActivityItem[];
};

export function BusinessActivityCard({ activities }: BusinessActivityCardProps) {
  const usernameFor = useWalletUsernames(activities.map((item) => item.counterparty));

  // Show a SaphraONE counterparty by @username rather than their address.
  function withUsername(item: BusinessActivityItem): BusinessActivityItem {
    const username = usernameFor(item.counterparty);
    if (!item.counterparty || !username) return item;
    return {
      ...item,
      title: item.title.replace(shortAddress(item.counterparty), `${username}.one`),
    };
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-xs">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-border/70">
          <div>
            <h2 className="font-heading text-lg sm:text-xl font-bold tracking-tight text-foreground">
              Business Activity
            </h2>
            <p className="text-xs text-muted-foreground">
              Recent transactions across all business channels
            </p>
          </div>
          <Link
            href="/transactions"
            className="group flex items-center gap-1 text-xs font-semibold text-[#5B21B6] hover:text-[#4C1D95] dark:text-purple-400 dark:hover:text-purple-300 transition-colors shrink-0"
          >
            <span>View all</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* Activity list */}
        <div className="divide-y divide-border/60 pt-1">
          {activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60 mb-2.5">
                <Clock className="h-5 w-5 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-semibold text-foreground">No recent business activity.</p>
              <p className="text-xs text-muted-foreground max-w-xs mt-1">
                Real transfers, settled invoices, and payroll runs will be recorded here automatically.
              </p>
              <div className="flex items-center gap-2 mt-4">
                <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                  <Link href="/send">
                    <Send className="h-3 w-3 mr-1" />
                    Send Payment
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                  <Link href="/business/invoices">
                    <Plus className="h-3 w-3 mr-1" />
                    Create Invoice
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            activities.map((item) => (
              <BusinessActivityRow key={item.id} activity={withUsername(item)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
