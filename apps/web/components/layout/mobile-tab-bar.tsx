"use client";

import { House, LayoutGrid, PiggyBank, TrendingUp, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/components/locale-provider";
import { openPlatformNav } from "@/components/platform-nav-drawer";
import type { MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import "./mobile-app.css";

const tabs: Array<{ href: string; icon: LucideIcon; label: MessageKey }> = [
  { href: "/dashboard", icon: House, label: "nav.home" },
  { href: "/save", icon: PiggyBank, label: "nav.save" },
  { href: "/circle", icon: UsersRound, label: "nav.circle" },
  { href: "/earn", icon: TrendingUp, label: "nav.earn" },
];

/**
 * Pages that are a step in a task (sending, a Circle room's chat, a payroll
 * run): they take the whole screen and lead back with their own back button,
 * like a pushed screen in a phone app.
 */
const taskPage =
  /^\/(?:send|pay|swap|deposit|withdraw|bulkpay|recurepay)(?:\/|$)|^\/circle\/[^/]+|^\/save\/[^/]+|^\/business\/payroll\/.+/;

export function showsMobileTabBar(pathname: string) {
  return !taskPage.test(pathname);
}

/** A tab's own first screen: the tab bar replaces its back-to-dashboard link. */
export function isTabRoot(pathname: string) {
  return tabs.some((tab) => tab.href === pathname);
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Phones and tablets: the app's tab bar, a floating Liquid Glass pill at the
 * bottom of the screen. Four places you live in, then More, which opens the
 * full navigation as a sheet. Desktop keeps the sidebar.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const t = useT();
  const onTab = tabs.some((tab) => isActive(pathname, tab.href));

  return (
    <nav aria-label={t("common.navigation")} className="mtb">
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn("mtb-tab", active && "is-active")}
            href={tab.href}
            key={tab.href}
          >
            <span className="mtb-icon">
              <tab.icon aria-hidden className="h-[1.35rem] w-[1.35rem]" strokeWidth={active ? 2.3 : 2} />
            </span>
            <span className="mtb-label">{t(tab.label)}</span>
          </Link>
        );
      })}
      <button
        aria-haspopup="dialog"
        className={cn("mtb-tab", !onTab && "is-active")}
        onClick={openPlatformNav}
        type="button"
      >
        <span className="mtb-icon">
          <LayoutGrid aria-hidden className="h-[1.35rem] w-[1.35rem]" strokeWidth={!onTab ? 2.3 : 2} />
        </span>
        <span className="mtb-label">{t("nav.more")}</span>
      </button>
    </nav>
  );
}
