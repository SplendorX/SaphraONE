"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AllieMark } from "@/components/allie/AllieMark";
import { ChatWindow } from "@/components/allie/ChatWindow";
import { useAllieStatus } from "@/lib/allie/use-allie-status";
import { openAllieEventName } from "@/lib/allie/open";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

const openStateKey = "saphra.allie.launcherOpen";
const expandedStateKey = "saphra.allie.launcherExpanded";
const phraseIntervalMs = 3_200;

/**
 * What ALLIE can do, in the user's own words. Kept short — the rail is a
 * fixed width, and the longest phrase sets how wide the bubble has to be.
 */
const capabilities = [
  "Send $20 to alex.one",
  "Split $60 three ways",
  "What's my balance?",
  "Pay two people at once",
  "Swap 25 USDC to EURC",
  "My savings balance",
  "Request $40 from sam.one",
  "Pay rent.one $500 monthly",
  "Recent payments",
  "Pause ALLIE",
];

/**
 * Routes that render their own ALLIE surface, or that a signed-out visitor
 * can reach. The launcher stays out of both.
 */
const hiddenExactPaths = new Set(["/", "/onboarding", "/roadmap"]);
const hiddenPathPrefixes = ["/invoice/", "/u/", "/r/", "/admin"];

function isHiddenPath(pathname: string) {
  if (hiddenExactPaths.has(pathname)) {
    return true;
  }

  return hiddenPathPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function AllieLauncher() {
  const pathname = usePathname() ?? "/";
  const { address } = usePlatformWallet();
  const { status } = useAllieStatus();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [phrase, setPhrase] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);

    try {
      setOpen(window.localStorage.getItem(openStateKey) === "1");
      setExpanded(window.localStorage.getItem(expandedStateKey) === "1");
    } catch {
      // Private mode or blocked storage — default to closed.
    }
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    try {
      window.localStorage.setItem(openStateKey, open ? "1" : "0");
      window.localStorage.setItem(expandedStateKey, expanded ? "1" : "0");
    } catch {
      // Non-fatal: the widget works, it just won't be remembered.
    }
  }, [expanded, mounted, open]);

  // Only cycle while the launcher is actually on screen and at rest.
  useEffect(() => {
    if (open || !mounted) {
      return;
    }

    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;

    if (reduced) {
      return;
    }

    const timer = window.setInterval(() => {
      setPhrase((current) => (current + 1) % capabilities.length);
    }, phraseIntervalMs);

    return () => window.clearInterval(timer);
  }, [mounted, open]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Other surfaces (e.g. the ALLIE tag in Activity) open the bubble directly.
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(openAllieEventName, handleOpen);
    return () => window.removeEventListener(openAllieEventName, handleOpen);
  }, []);

  // The pill is hidden while the panel is up, so focus can only return to it
  // once it is back in the tree — an effect, not the click handler.
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !open) {
      buttonRef.current?.focus();
    }

    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  if (!mounted || !address || isHiddenPath(pathname)) {
    return null;
  }

  return (
    <>
      {open ? (
        <div
          aria-label="ALLIE"
          className={cn(
            // Same corner as the pill it replaces: bottom-5 / right-4, with
            // transform-origin at bottom right, so it unfolds from where the
            // launcher was rather than appearing above it.
            "allie-panel fixed right-4 bottom-5 z-40 flex flex-col overflow-hidden rounded-[1.75rem] border border-border bg-card outline-none max-[30rem]:right-3 max-[30rem]:left-3 max-[30rem]:w-auto",
            expanded
              ? "h-[min(46rem,calc(100dvh-2.5rem))] w-[min(38rem,calc(100vw-2rem))]"
              : "h-[min(34rem,calc(100dvh-4.5rem))] w-[min(25rem,calc(100vw-2rem))]",
          )}
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
        >
          <ChatWindow
            className="h-full border-0"
            expanded={expanded}
            onClose={close}
            onToggleExpand={() => setExpanded((value) => !value)}
          />
        </div>
      ) : null}

      <div
        className="allie-dock fixed right-4 bottom-5 z-40"
        data-allie-status={status}
        hidden={open}
      >
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Pay with ALLIE"
          className="allie-trigger"
          onClick={() => setOpen(true)}
          ref={buttonRef}
          type="button"
        >
          <span className="allie-trigger-mark">
            <AllieMark size={22} />
          </span>

          <span className="allie-trigger-copy">
            <span className="allie-trigger-title">Pay with ALLIE</span>
            <span className="allie-trigger-rail">
              <span className="allie-trigger-phrase" key={phrase}>
                {capabilities[phrase]}
              </span>
            </span>
          </span>
        </button>
      </div>
    </>
  );
}
