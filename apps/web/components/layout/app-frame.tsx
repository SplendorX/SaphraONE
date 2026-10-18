"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useSidebar } from "@/components/layout/sidebar-context";
import { useT } from "@/components/locale-provider";
import { PlatformNav, PlatformNavFooter } from "@/components/platform-nav";
import { cn } from "@/lib/utils";

type AppFrameProps = {
  actions?: ReactNode;
  /** Route to step back to. Task pages reached from the dashboard set this. */
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
  hideHeader?: boolean;
  subtitle?: string;
  title: string;
};

export function AppFrame({
  backHref,
  backLabel,
  children,
  hideHeader,
  subtitle,
  title,
}: AppFrameProps) {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const t = useT();
  const isCircleRoom = /^\/circle\/[^/]+$/.test(pathname);

  return (
    <div className="app-frame w-full min-w-0">
      <aside className={cn("app-sidebar", collapsed && "app-sidebar-collapsed")}>
        <PlatformNav collapsed={collapsed} />
        <PlatformNavFooter collapsed={collapsed} />
      </aside>

      <div className={cn("app-main min-w-0 w-full", isCircleRoom && "app-main-circle-room")}>
        {backHref ? (
          <div className="app-page-back-row">
            <Link className="app-page-back" href={backHref}>
              <ArrowLeft className="h-4 w-4" />
              <span>{backLabel ?? t("common.backToDashboard")}</span>
            </Link>
          </div>
        ) : null}
        {!hideHeader ? (
          <div
            className={cn(
              "app-page-title",
              backHref && "app-page-title-after-back",
              isCircleRoom && "app-page-title-circle-room",
            )}
          >
            <h1 className="font-heading">{title}</h1>
            {subtitle ? (
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        ) : null}
        <motion.div
          // Clear filter/transform once settled: any value other than "none"
          // (even blur(0px)) makes this element the containing block for
          // position: fixed descendants, which pins every page's modals to
          // the content instead of the viewport.
          animate={{
            opacity: 1,
            filter: "blur(0px)",
            scale: 1,
            y: 0,
            transitionEnd: { filter: "none", transform: "none" },
          }}
          className="app-main-content min-w-0 w-full"
          initial={
            reduceMotion
              ? false
              : { opacity: 0, filter: "blur(6px)", scale: 0.985, y: 22 }
          }
          key={pathname}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}