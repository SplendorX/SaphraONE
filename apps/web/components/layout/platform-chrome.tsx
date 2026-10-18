"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { OnboardingRedirect } from "@/components/business/workspace-provider";
import { AppFrame } from "@/components/layout/app-frame";
import { AppHeader } from "@/components/layout/app-header";
import { DesktopShortcuts } from "@/components/layout/desktop-shortcuts";
import { isTabRoot, MobileTabBar, showsMobileTabBar } from "@/components/layout/mobile-tab-bar";
import { MobileTitleBar } from "@/components/layout/mobile-title-bar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { useT } from "@/components/locale-provider";
import { isPlatformNavRoot } from "@/components/platform-nav";
import { pageCopyForPath } from "@/lib/i18n";

import "./ios-skin.css";
import "./windows-shell.css";

/** Pages that keep their own design instead of the iPhone-app look. */
const ownDesign = /^\/(?:referral|rewards|swap)(?:\/|$)/;

type PlatformChromeProps = {
  actions?: ReactNode;
  /** Renders a back link above the title. Task pages point it at /dashboard. */
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
  hideHeader?: boolean;
  subtitle?: string;
  title: string;
};

export function PlatformChrome({
  actions,
  backHref,
  backLabel,
  children,
  hideHeader,
  subtitle,
  title,
}: PlatformChromeProps) {
  const pathname = usePathname();
  const t = useT();
  const copy = pageCopyForPath(pathname);
  const resolvedTitle = copy ? t(copy.title) : title;
  const resolvedSubtitle = copy?.subtitle ? t(copy.subtitle) : subtitle;
  const tabBar = showsMobileTabBar(pathname);
  const iosLook = !ownDesign.test(pathname);

  return (
    <>
      <OnboardingRedirect />
      <SidebarProvider>
        <div
          className="platform-shell w-full min-w-0 bg-background"
          data-ios={iosLook ? "" : undefined}
          data-nav-root={isPlatformNavRoot(pathname) ? "" : undefined}
          data-tab-root={tabBar && isTabRoot(pathname) ? "" : undefined}
          data-tabbar={tabBar ? "" : undefined}
        >
          <AppHeader actions={actions} />
          <AppFrame
            backHref={backHref}
            backLabel={backLabel}
            hideHeader={hideHeader}
            subtitle={resolvedSubtitle}
            title={resolvedTitle}
          >
            {children}
          </AppFrame>
          {iosLook && pathname !== "/dashboard" ? <MobileTitleBar /> : null}
          {tabBar ? <MobileTabBar /> : null}
          <DesktopShortcuts />
        </div>
      </SidebarProvider>
    </>
  );
}