"use client";

import {
  Banknote,
  Briefcase,
  FileText,
  Gift,
  ChartPie,
  Keyboard,
  LayoutDashboard,
  LifeBuoy,
  PiggyBank,
  Send,
  Settings,
  Trophy,
  Store,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useOptionalAccount } from "@/components/account/account-provider";
import { openShortcutsSheet } from "@/components/layout/shortcuts-events";
import { useT } from "@/components/locale-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { arcChain } from "@/lib/chains";
import { checkoutEnabled } from "@/lib/checkout/flag";
import { rewardsV2Enabled } from "@/lib/rewards/config";
import { navLabelKeys } from "@/lib/i18n";
import { openSupport } from "@/lib/support/client";
import { cn } from "@/lib/utils";

import "./platform-nav.css";

type NavGroup = "business" | "money" | "perks" | "footer";

/**
 * The sidebar carries the places you live in. Business accounts also get
 * Overview and Invoices. Request, Swap, BulkPay and RecurePay are task pages
 * reached from Services and Send instead. `group` places each one in the
 * desktop sidebar's sections; Settings sits at its foot.
 */
export const platformNavItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  { href: "/business", label: "Overview", icon: Briefcase, businessOnly: true, group: "business" },
  { href: "/business/invoices", label: "Invoices", icon: FileText, businessOnly: true, group: "business" },
  // Checkout appears once NEXT_PUBLIC_CHECKOUT_ENABLED is on.
  ...(checkoutEnabled
    ? [{ href: "/business/checkout", label: "Checkout", icon: Store, businessOnly: true, group: "business" as const }]
    : []),
  {
    href: "/business/payroll",
    label: "Payroll",
    icon: Banknote,
    businessOnly: true,
    group: "business",
  },
  { href: "/circle", label: "Circle", icon: UsersRound, group: "money" },
  { href: "/save", label: "Save", icon: PiggyBank, group: "money" },
  { href: "/earn", label: "Invest", icon: TrendingUp, group: "money" },
  { href: "/insights", label: "Insights", icon: ChartPie, group: "money" },
  // Rewards (ONE Points) is hidden only when NEXT_PUBLIC_REWARDS_V2=false.
  ...(rewardsV2Enabled() ? [{ href: "/rewards", label: "Rewards", icon: Trophy, group: "perks" as const }] : []),
  { href: "/referral", label: "Invite & Earn", icon: Gift, group: "perks" },
  { href: "/settings", label: "Settings", icon: Settings, group: "footer" },
] satisfies Array<{
  businessOnly?: boolean;
  group?: NavGroup;
  href: string;
  icon: LucideIcon;
  label: string;
}>;

/** Desktop sidebar sections, in order. The first has no heading. */
const navSections: Array<{ group: NavGroup | undefined; heading?: string }> = [
  { group: undefined },
  { group: "business", heading: "Business" },
  { group: "money", heading: "Money" },
  { group: "perks", heading: "Perks" },
];

const shouldPrefetchPlatformRoutes = process.env.NODE_ENV === "production";

/** Places that are a sidebar destination: on desktop they have no way "back". */
export function isPlatformNavRoot(pathname: string) {
  return platformNavItems.some((item) => item.href === pathname);
}

function isActiveHref(pathname: string, href: string) {
  return pathname === href || (href !== "/business" && pathname.startsWith(`${href}/`));
}

/** A collapsed sidebar shows icons only; each names itself on hover. */
function RailTip({ children, collapsed, label }: { children: ReactNode; collapsed: boolean; label: string }) {
  if (!collapsed) return children;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavRow({
  collapsed,
  href,
  icon: Icon,
  label,
  pathname,
}: {
  collapsed: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  pathname: string;
}) {
  const isActive = isActiveHref(pathname, href);
  return (
    <RailTip collapsed={collapsed} label={label}>
      <Link
        aria-current={isActive ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn("app-nav-link", isActive && "app-nav-link-active")}
        href={href}
        prefetch={shouldPrefetchPlatformRoutes}
      >
        <Icon className="h-[1.125rem] w-[1.125rem] shrink-0" strokeWidth={2.1} />
        <span className="truncate">{label}</span>
      </Link>
    </RailTip>
  );
}

export function PlatformNav({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  const pathname = usePathname();
  const t = useT();
  const accountContext = useOptionalAccount();

  const hasBusinessAccess = Boolean(accountContext?.isBusiness);

  const items = platformNavItems.filter(
    (item) => item.group !== "footer" && (!item.businessOnly || hasBusinessAccess),
  );
  const labelFor = (item: (typeof items)[number]) => {
    const labelKey = navLabelKeys[item.href as keyof typeof navLabelKeys];
    return labelKey ? t(labelKey) : item.label;
  };

  return (
    <nav aria-label={t("common.platformNav")} className={cn("app-nav", className)}>
      {/* The everyday action leads, like New mail in Outlook. */}
      <RailTip collapsed={collapsed} label={t("common.send")}>
        <Link
          aria-current={isActiveHref(pathname, "/send") ? "page" : undefined}
          aria-label={collapsed ? t("common.send") : undefined}
          className="app-nav-cta"
          href="/send"
        >
          <Send className="h-[1.05rem] w-[1.05rem] shrink-0" strokeWidth={2.3} />
          <span className="truncate">{t("common.send")}</span>
        </Link>
      </RailTip>

      {navSections.map((section) => {
        const inSection = items.filter((item) => ("group" in item ? item.group : undefined) === section.group);
        if (inSection.length === 0) return null;
        return (
          <div className="app-nav-section" key={section.group ?? "home"}>
            {section.heading ? <p className="app-nav-heading">{section.heading}</p> : null}
            {inSection.map((item) => (
              <NavRow
                collapsed={collapsed}
                href={item.href}
                icon={item.icon}
                key={item.href}
                label={labelFor(item)}
                pathname={pathname}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The foot of the desktop sidebar, as in Windows' own apps: Settings, help,
 * the keyboard shortcuts, and the network every payment settles on.
 */
export function PlatformNavFooter({ collapsed = false }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const t = useT();

  return (
    <div className="app-nav-footer">
      <NavRow collapsed={collapsed} href="/settings" icon={Settings} label={t("nav.settings")} pathname={pathname} />
      <RailTip collapsed={collapsed} label="Help & Support">
        <button aria-label={collapsed ? "Help & Support" : undefined} className="app-nav-link" onClick={() => openSupport()} type="button">
          <LifeBuoy className="h-[1.125rem] w-[1.125rem] shrink-0" strokeWidth={2.1} />
          <span className="truncate">Help &amp; Support</span>
        </button>
      </RailTip>
      <RailTip collapsed={collapsed} label="Keyboard shortcuts">
        <button
          aria-label={collapsed ? "Keyboard shortcuts" : undefined}
          className="app-nav-link"
          onClick={openShortcutsSheet}
          type="button"
        >
          <Keyboard className="h-[1.125rem] w-[1.125rem] shrink-0" strokeWidth={2.1} />
          <span className="truncate">Keyboard shortcuts</span>
          <kbd className="app-nav-kbd">?</kbd>
        </button>
      </RailTip>
      <RailTip collapsed={collapsed} label={`Settles on ${arcChain.name}`}>
        <p className="app-nav-network">
          <span aria-hidden className="app-nav-network-dot" />
          <span className="truncate">{arcChain.name}</span>
        </p>
      </RailTip>
    </div>
  );
}
