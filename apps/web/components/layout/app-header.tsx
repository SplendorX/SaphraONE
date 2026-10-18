"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { CommandPaletteTrigger } from "@/components/command-palette";
import { SidebarBrand } from "@/components/layout/sidebar-brand";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { NotificationsBell } from "@/components/notifications-bell";
import { SupportLauncher } from "@/components/support/support-launcher";
import { PlatformNavDrawer } from "@/components/platform-nav-drawer";
import { TopBarPoints } from "@/components/layout/top-bar-points";
import { cn } from "@/lib/utils";

type AppHeaderProps = {
  actions?: ReactNode;
  className?: string;
};

export function AppHeader({ actions, className }: AppHeaderProps) {
  // Phones: only the dashboard keeps the top bar. Every other page draws its
  // own header with a back button, so it gets the full screen.
  const onDashboard = usePathname() === "/dashboard";
  return (
    <header className={cn("app-topbar w-full min-w-0", !onDashboard && "max-md:hidden", className)}>
      <div className="app-topbar-inner">
        {/* Tablets and desktop: the brand leads. Phones and tablets navigate
            with the tab bar; its More button opens this drawer as a sheet. */}
        <div className="flex items-center gap-2 sm:gap-3">
          <PlatformNavDrawer />
          {/* Desktop: the sidebar's fold button leads the title bar, as the
              navigation button does in Windows' own apps. */}
          <SidebarToggle className="app-topbar-navtoggle hidden lg:inline-flex" />
          <div className="app-topbar-brand flex">
            <SidebarBrand />
          </div>
        </div>

        {/* Desktop (components/layout/windows-shell.css): search sits in the
            middle of the title bar, as in Windows' own apps. Phones: it joins
            the bell on the right. */}
        <div className="app-topbar-center">
          <CommandPaletteTrigger className="app-topbar-search" />
        </div>

        {/* Phones (components/layout/mobile-app.css): the avatar leads on the
            left, search and the bell sit on the right, points move into Home. */}
        <div className="app-topbar-tools ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
          {/* Support lives in Settings on small screens, where the bar is full. */}
          <SupportLauncher className="hidden shrink-0 lg:inline-flex" />
          <NotificationsBell className="app-topbar-bell shrink-0" href="/notifications" />
          {/* The theme switch lives in the profile menu. */}
          <TopBarPoints className="app-topbar-points" />
          <div className="app-topbar-profile flex shrink-0 flex-nowrap items-center gap-1.5 sm:gap-2">
            {actions}
          </div>
        </div>
      </div>
    </header>
  );
}