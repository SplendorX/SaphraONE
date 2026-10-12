"use client";

import {
  Banknote,
  Briefcase,
  FileText,
  Gift,
  ChartPie,
  LayoutDashboard,
  PiggyBank,
  Settings,
  Trophy,
  Store,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useOptionalAccount } from "@/components/account/account-provider";
import { useT } from "@/components/locale-provider";
import { checkoutEnabled } from "@/lib/checkout/flag";
import { rewardsV2Enabled } from "@/lib/rewards/config";
import { navLabelKeys } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import "./platform-nav.css";

/**
 * The sidebar carries the places you live in. Business accounts also get
 * Overview and Invoices. Request, Swap, BulkPay and RecurePay are task pages
 * reached from Services and Send instead.
 */
export const platformNavItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  { href: "/business", label: "Overview", icon: Briefcase, businessOnly: true },
  { href: "/business/invoices", label: "Invoices", icon: FileText, businessOnly: true },
  // Checkout appears once NEXT_PUBLIC_CHECKOUT_ENABLED is on.
  ...(checkoutEnabled
    ? [{ href: "/business/checkout", label: "Checkout", icon: Store, businessOnly: true }]
    : []),
  {
    href: "/business/payroll",
    label: "Payroll",
    icon: Banknote,
    businessOnly: true,
  },
  { href: "/circle", label: "Circle", icon: UsersRound },
  { href: "/save", label: "Save", icon: PiggyBank },
  { href: "/earn", label: "Invest", icon: TrendingUp },
  { href: "/insights", label: "Insights", icon: ChartPie },
  // Rewards (ONE Points) is hidden only when NEXT_PUBLIC_REWARDS_V2=false.
  ...(rewardsV2Enabled() ? [{ href: "/rewards", label: "Rewards", icon: Trophy }] : []),
  { href: "/referral", label: "Invite & Earn", icon: Gift },
  { href: "/settings", label: "Settings", icon: Settings },
] satisfies Array<{
  businessOnly?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
}>;


const shouldPrefetchPlatformRoutes = process.env.NODE_ENV === "production";

export function PlatformNav({ className }: { className?: string }) {
  const pathname = usePathname();
  const t = useT();
  const accountContext = useOptionalAccount();

  const hasBusinessAccess = Boolean(accountContext?.isBusiness);

  const items = platformNavItems.filter((item) => !item.businessOnly || hasBusinessAccess);

  return (
    <nav aria-label={t("common.platformNav")} className={cn("app-nav", className)}>
      {items.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/business" && pathname.startsWith(`${item.href}/`));
        const Icon = item.icon;
        const labelKey = navLabelKeys[item.href as keyof typeof navLabelKeys];

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "app-nav-link",
              isActive && "app-nav-link-active",
            )}
            href={item.href}
            key={item.href}
            prefetch={shouldPrefetchPlatformRoutes}
          >
            <Icon className="h-[1.125rem] w-[1.125rem] shrink-0" strokeWidth={2.25} />
            <span className="truncate">{labelKey ? t(labelKey) : item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
