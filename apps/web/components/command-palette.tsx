"use client";

import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Bell,
  CalendarClock,
  Command,
  CornerDownLeft,
  Gift,
  ChartPie,
  Keyboard,
  LayoutDashboard,
  PiggyBank,
  QrCode,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Settings,
  TrendingUp,
  Users,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { useOptionalAccount } from "@/components/account/account-provider";
import { useModKey } from "@/components/layout/desktop-shortcuts";
import { openShortcutsSheet } from "@/components/layout/shortcuts-events";
import { useT } from "@/components/locale-provider";
import { platformNavItems } from "@/components/platform-nav";
import { navLabelKeys } from "@/lib/i18n";
import { searchPeople } from "@/lib/business/client";
import type { DirectoryHit } from "@/lib/business/types";
import { rampEntryEnabled } from "@/lib/ramp/flag";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const navIcons: Record<string, typeof Command> = {
  "/dashboard": LayoutDashboard,
  "/business": LayoutDashboard,
  "/business/invoices": Send,
  "/save": PiggyBank,
  "/earn": TrendingUp,
  "/referral": Gift,
  "/swap": RefreshCw,
  "/bulkpay": Users,
  "/circle": UsersRound,
  "/recurepay": CalendarClock,
  "/pay": Send,
  "/insights": ChartPie,
  "/settings": Settings,
};

/** Things to do, not places: the palette's first group with no query. */
const actions: Array<{ href?: string; icon: typeof Command; keywords: string; label: string; run?: () => void }> = [
  { href: "/send", icon: Send, keywords: "send pay transfer", label: "Send money" },
  { href: "/pay", icon: QrCode, keywords: "request invoice get paid qr", label: "Request money" },
  { href: "/deposit", icon: ArrowDownToLine, keywords: "add money deposit top up fund", label: "Add money" },
  ...(rampEntryEnabled
    ? [{ href: "/withdraw", icon: ArrowUpFromLine, keywords: "withdraw cash out bank naira", label: "Withdraw to bank" }]
    : []),
  { href: "/swap", icon: ArrowLeftRight, keywords: "swap convert exchange usdc eurc", label: "Swap" },
  { href: "/transactions", icon: ReceiptText, keywords: "transactions history activity receipts", label: "Transactions" },
  { href: "/notifications", icon: Bell, keywords: "notifications alerts inbox", label: "Notifications" },
  { icon: Keyboard, keywords: "keyboard shortcuts keys help", label: "Keyboard shortcuts", run: openShortcutsSheet },
];

export function CommandPaletteTrigger({ className }: { className?: string }) {
  const t = useT();
  const mod = useModKey();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (!typing && event.key === "/" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setOpen(true);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        aria-keyshortcuts="Control+K Meta+K /"
        aria-label={t("search.peopleAndPagesAria")}
        className={cn(
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background/70 text-muted-foreground shadow-sm transition hover:border-primary/30 hover:bg-background hover:text-foreground sm:h-11 sm:w-auto sm:gap-2 sm:px-3 sm:text-xs sm:font-medium",
          className,
        )}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="cmdk-trigger-label hidden sm:inline">{t("search.peopleAndPages")}</span>
        <kbd className="cmdk-trigger-kbd hidden rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] sm:inline">
          {mod === "⌘" ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <CommandPalette onOpenChange={setOpen} open={open} />
    </>
  );
}

type PaletteEntry = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
};

export function CommandPalette({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const isBusiness = useOptionalAccount()?.isBusiness ?? false;
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<DirectoryHit[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = query.trim().replace(/^@+/, "").replace(/\.one$/i, "");
    if (handle.length < 1) {
      setPeople([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      void searchPeople(handle)
        .then((payload) => setPeople(payload.results))
        .catch(() => setPeople([]));
    }, 160);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
  }, [onOpenChange]);

  const navigate = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  // One flat list, in display order, so the arrow keys walk every group.
  const entries = useMemo<PaletteEntry[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

    const personEntries: PaletteEntry[] = people.map((person) => ({
      group: t("search.peopleBusinesses"),
      hint: `@${person.username}${person.kind === "business" ? ` · ${t("common.business")}` : ""}`,
      icon: person.avatarUrl ? (
        <img alt="" className="h-7 w-7 rounded-full object-cover" src={person.avatarUrl} />
      ) : (
        <Search className="h-4 w-4 text-muted-foreground" />
      ),
      id: `person-${person.kind}-${person.username}`,
      label: person.displayName,
      run: () => navigate(`/u/${person.username}`),
    }));

    const actionEntries: PaletteEntry[] = actions
      .filter((action) => matches(`${action.label} ${action.keywords}`))
      .map((action) => ({
        group: "Actions",
        icon: <action.icon className="h-4 w-4 text-muted-foreground" />,
        id: `action-${action.label}`,
        label: action.label,
        run: () => {
          if (action.href) {
            navigate(action.href);
          } else {
            close();
            // After the palette has closed, so the two dialogs don't overlap.
            window.setTimeout(() => action.run?.(), 120);
          }
        },
      }));

    const pageEntries: PaletteEntry[] = platformNavItems
      .filter((item) => !item.businessOnly || isBusiness)
      .map((item) => {
        const labelKey = navLabelKeys[item.href as keyof typeof navLabelKeys];
        return { ...item, translatedLabel: labelKey ? t(labelKey) : item.label };
      })
      .filter((item) => matches(item.translatedLabel))
      .map((item) => {
        const Icon = navIcons[item.href] ?? Command;
        return {
          group: "Pages",
          icon: <Icon className="h-4 w-4 text-muted-foreground" />,
          id: `page-${item.href}`,
          label: item.translatedLabel,
          run: () => navigate(item.href),
        };
      });

    return [...personEntries, ...actionEntries, ...pageEntries];
  }, [close, isBusiness, navigate, people, query, t]);

  useEffect(() => setActiveIndex(0), [query, people]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (entries.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % entries.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      entries[activeIndex]?.run();
    }
  }

  return (
    <Dialog onOpenChange={(next) => (next ? onOpenChange(true) : close())} open={open}>
      <DialogContent className="cmdk-dialog gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton>
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">{t("search.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("search.description")}
          </DialogDescription>
          <div className="relative mt-2">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-activedescendant={entries[activeIndex] ? `cmdk-${entries[activeIndex].id}` : undefined}
              aria-controls="cmdk-list"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("search.placeholder")}
              role="combobox"
              aria-expanded
              value={query}
            />
          </div>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto p-2" id="cmdk-list" ref={listRef} role="listbox">
          {entries.map((entry, index) => (
            <div key={entry.id}>
              {index === 0 || entries[index - 1].group !== entry.group ? (
                <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {entry.group}
                </p>
              ) : null}
              <button
                aria-selected={index === activeIndex}
                className={cn(
                  "cmdk-item flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition hover:bg-muted",
                  index === activeIndex && "bg-muted",
                )}
                data-index={index}
                id={`cmdk-${entry.id}`}
                onClick={entry.run}
                onMouseMove={() => setActiveIndex(index)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {entry.icon}
                <span className="min-w-0 truncate">{entry.label}</span>
                {entry.hint ? <span className="text-xs text-muted-foreground">{entry.hint}</span> : null}
                {index === activeIndex ? (
                  <CornerDownLeft aria-hidden className="ml-auto hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
                ) : null}
              </button>
            </div>
          ))}
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("search.noMatchingPages")}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
