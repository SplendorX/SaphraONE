"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { CommandPaletteTrigger } from "@/components/command-palette";
import { SidebarBrand } from "@/components/layout/sidebar-brand";
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
        {/* The brand leads on every screen. Phones and tablets navigate with
            the tab bar; its More button opens this drawer as a sheet. */}
        <div className="flex items-center gap-2 sm:gap-3">
          <PlatformNavDrawer />
          <div className="app-topbar-brand flex">
            <SidebarBrand />
          </div>
        </div>

        <div className="ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
          <CommandPaletteTrigger />
          {/* Support lives in Settings on small screens, where the bar is full. */}
          <SupportLauncher className="hidden shrink-0 lg:inline-flex" />
          <NotificationsBell className="shrink-0" />
          {/* The theme switch lives in the profile menu. */}
          <TopBarPoints />
          <div className="flex shrink-0 flex-nowrap items-center gap-1.5 sm:gap-2">
            {actions}
          </div>
        </div>
      </div>
    </header>
  );
}