"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";

import { useOptionalAccount } from "@/components/account/account-provider";
import { openShortcutsEvent } from "@/components/layout/shortcuts-events";
import { useSidebar } from "@/components/layout/sidebar-context";
import { useT } from "@/components/locale-provider";
import { platformNavItems } from "@/components/platform-nav";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { navLabelKeys } from "@/lib/i18n";

/** "Ctrl" on Windows and Linux, "⌘" on a Mac. Known only once mounted. */
export function useModKey() {
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    const platform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      "";
    if (/mac|iphone|ipad/i.test(platform)) setMod("⌘");
  }, []);
  return mod;
}

/** Single-key shortcuts, as in Gmail or Outlook: only outside a text field. */
const letterRoutes: Record<string, { href: string; label: string }> = {
  s: { href: "/send", label: "Send money" },
  r: { href: "/pay", label: "Request money" },
  d: { href: "/deposit", label: "Add money" },
};

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
    Boolean(element.closest("[contenteditable='true']"))
  );
}

/** A dialog, sheet or the Circle confirmation window is open: keys are theirs. */
function overlayOpen() {
  return Boolean(
    document.querySelector(
      "[data-slot='dialog-content'], [data-slot='sheet-content'], .nav-drawer-root[data-open], #sdkIframe",
    ),
  );
}

/**
 * The keyboard layer of the desktop app. Alt+1…9 opens each sidebar place in
 * order, Ctrl+B folds the sidebar to a rail, S / R / D start a payment, a
 * request or a deposit, and ? lists them all. Search (Ctrl+K and /) lives in
 * the command palette. Mounted inside PlatformChrome, so it only runs on app
 * pages.
 */
export function DesktopShortcuts() {
  const router = useRouter();
  const t = useT();
  const mod = useModKey();
  const { toggleCollapsed } = useSidebar();
  const isBusiness = useOptionalAccount()?.isBusiness ?? false;
  const [open, setOpen] = useState(false);

  const places = useMemo(
    () =>
      platformNavItems
        .filter((item) => !item.businessOnly || isBusiness)
        .slice(0, 9)
        .map((item) => {
          const labelKey = navLabelKeys[item.href as keyof typeof navLabelKeys];
          return { href: item.href, label: labelKey ? t(labelKey) : item.label };
        }),
    [isBusiness, t],
  );

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(openShortcutsEvent, show);
    return () => window.removeEventListener(openShortcutsEvent, show);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;

      // Alt+1…9: the sidebar's places. event.code, so it works on any layout.
      if (event.altKey && !event.ctrlKey && !event.metaKey && /^Digit[1-9]$/.test(event.code)) {
        const place = places[Number(event.code.slice(5)) - 1];
        if (place) {
          event.preventDefault();
          router.push(place.href);
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "b") {
        if (isTyping(event.target)) return;
        event.preventDefault();
        toggleCollapsed();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || overlayOpen()) return;

      if (event.key === "?") {
        event.preventDefault();
        setOpen(true);
        return;
      }

      const route = letterRoutes[event.key.toLowerCase()];
      if (route && !event.shiftKey) {
        event.preventDefault();
        router.push(route.href);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [places, router, toggleCollapsed]);

  const groups: Array<{ title: string; rows: Array<{ keys: string[]; label: string }> }> = [
    {
      title: "General",
      rows: [
        { keys: [mod, "K"], label: "Search people and pages" },
        { keys: ["/"], label: "Search" },
        { keys: [mod, "B"], label: "Collapse or expand the sidebar" },
        { keys: ["?"], label: "Show keyboard shortcuts" },
        { keys: ["Esc"], label: "Close a window or panel" },
      ],
    },
    {
      title: "Money",
      rows: Object.entries(letterRoutes).map(([key, route]) => ({ keys: [key.toUpperCase()], label: route.label })),
    },
    {
      title: "Go to",
      rows: places.map((place, index) => ({ keys: ["Alt", String(index + 1)], label: place.label })),
    },
  ];

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="ks-dialog gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move around SaphraONE without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="ks-grid">
          {groups.map((group) => (
            <section className="ks-group" key={group.title}>
              <h3 className="ks-group-title">{group.title}</h3>
              <dl className="ks-list">
                {group.rows.map((row) => (
                  <Fragment key={row.label}>
                    <dt className="ks-label">{row.label}</dt>
                    <dd className="ks-keys">
                      {row.keys.map((key, index) => (
                        <Fragment key={key + index}>
                          {index > 0 ? <span className="ks-plus">+</span> : null}
                          <kbd className="ks-key">{key}</kbd>
                        </Fragment>
                      ))}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
