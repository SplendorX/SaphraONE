"use client";

import { ArrowLeftRight, ChevronRight, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useOptionalAccount } from "@/components/account/account-provider";
import { PlatformWordmark } from "@/components/brand/platform-wordmark";
import { useT } from "@/components/locale-provider";
import { platformNavItems } from "@/components/platform-nav";
import { navLabelKeys } from "@/lib/i18n";
import { rampEntryEnabled } from "@/lib/ramp/flag";
import { openSupport } from "@/lib/support/client";
import { cn } from "@/lib/utils";

import "./layout/mobile-app.css";

const shouldPrefetchPlatformRoutes = process.env.NODE_ENV === "production";

const openNavEvent = "saphra:open-nav";

/** Opens the navigation sheet. The tab bar's More button calls this. */
export function openPlatformNav() {
  window.dispatchEvent(new Event(openNavEvent));
}

/**
 * The phone and tablet navigation: every place in SaphraONE, opened from the
 * tab bar's More button as a sheet that rises from the bottom. The panel is
 * portalled to the page body — the top bar's backdrop blur would otherwise
 * make it the containing block for `position: fixed`, trapping it inside.
 */
export function PlatformNavDrawer() {
  const pathname = usePathname();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const accountContext = useOptionalAccount();

  const navItems = platformNavItems.filter((item) => !item.businessOnly || Boolean(accountContext?.isBusiness));
  // With the Naira ramp on, Withdraw takes Swap's tile on Home, so Swap
  // lives here instead, after Dashboard.
  const items = rampEntryEnabled
    ? [navItems[0], { href: "/swap", icon: ArrowLeftRight, label: "Swap" }, ...navItems.slice(1)]
    : navItems;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener(openNavEvent, open);
    return () => window.removeEventListener(openNavEvent, open);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The page behind stays put while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = previous;
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  const drawer = (
    <div className="nav-drawer-root lg:hidden" data-open={open ? "" : undefined}>
      <div aria-hidden className="nav-drawer-backdrop" onClick={() => setOpen(false)} />
      <aside
        aria-hidden={!open}
        aria-label={t("common.platformNav")}
        aria-modal="true"
        className="nav-drawer-panel"
        inert={!open}
        role="dialog"
      >
        <div className="nav-drawer-head flex items-center justify-between gap-3 px-4 pb-3 pt-4">
          <Link aria-label="SaphraONE home" className="rounded-lg" href="/dashboard" onClick={() => setOpen(false)}>
            <PlatformWordmark />
          </Link>
          <button
            aria-label={t("common.closeNav")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background/70 text-muted-foreground transition hover:text-foreground"
            onClick={() => setOpen(false)}
            ref={closeRef}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="nav-drawer-rule mx-4 h-px bg-border" />

        <nav aria-label={t("common.slideNav")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {/* A clear line between each row; on phones, a grid of tiles. */}
          <ul className="nav-drawer-list grid divide-y divide-foreground/10">
            {items.map((item, index) => {
              const isActive =
                pathname === item.href || (item.href !== "/business" && pathname.startsWith(`${item.href}/`));
              const Icon = item.icon;
              const labelKey = navLabelKeys[item.href as keyof typeof navLabelKeys];

              return (
                <li
                  className="nav-drawer-item py-0.5"
                  key={item.href}
                  style={{ transitionDelay: open ? `${Math.min(index, 10) * 18}ms` : "0ms" }}
                >
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "nav-drawer-link group flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition active:scale-[0.985]",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    prefetch={shouldPrefetchPlatformRoutes}
                  >
                    <span className="nav-drawer-link-main inline-flex min-w-0 items-center gap-3">
                      <span className="nav-drawer-icon">
                        <Icon className="h-4 w-4 shrink-0" />
                      </span>
                      <span className="nav-drawer-label truncate">{labelKey ? t(labelKey) : item.label}</span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "nav-drawer-chevron h-4 w-4 shrink-0 transition group-hover:translate-x-0.5",
                        isActive ? "text-primary-foreground/70" : "text-muted-foreground/60",
                      )}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="nav-drawer-footer border-t border-border p-3">
          {/* Opens the Support panel (a bottom sheet on phones), not a page. */}
          <button
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={() => {
              setOpen(false);
              openSupport();
            }}
            type="button"
          >
            <MessageCircle className="h-4 w-4" />
            Help &amp; Support
          </button>
        </div>
      </aside>
    </div>
  );

  return mounted ? createPortal(drawer, document.body) : null;
}
