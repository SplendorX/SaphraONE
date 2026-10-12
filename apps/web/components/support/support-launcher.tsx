"use client";

import { MessageCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useBusinessActor } from "@/components/business/use-business-actor";
import { usePlatformAccess } from "@/components/platform-access-gate";
import { SupportCenter } from "@/components/support/support-center";
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import {
  listSupportTickets,
  openSupportEvent,
  readStoredTickets,
  supportChangedEvent,
} from "@/lib/support/client";
import { bottomSheetClassName, useSheetSide } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

/**
 * The header's help button: opens SaphraONE Support; a dot means a reply is
 * waiting. It also owns the panel for the rest of the app: the mobile menu
 * (where this button is hidden) opens it with `openSupport()`. A bottom
 * sheet on phones and tablets, a side panel on desktop.
 */
export function SupportLauncher({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const side = useSheetSide();
  const [unread, setUnread] = useState(0);
  const access = usePlatformAccess();
  const { circleSocialUuid, ownerWallet } = useBusinessActor();
  const signedIn = access === "allowed" && Boolean(ownerWallet);

  const refresh = useCallback(async () => {
    // Only ask the server when there's anything to find.
    if (!signedIn && readStoredTickets().length === 0) return;
    try {
      const tickets = await listSupportTickets(signedIn ? { circleSocialUuid, ownerWallet } : {});
      setUnread(tickets.filter((ticket) => ticket.unread).length);
    } catch {
      setUnread(0);
    }
  }, [circleSocialUuid, ownerWallet, signedIn]);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(openSupportEvent, show);
    return () => window.removeEventListener(openSupportEvent, show);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 120_000);
    window.addEventListener(supportChangedEvent, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(supportChangedEvent, refresh);
    };
  }, [refresh]);

  return (
    <>
      <button
        aria-label={unread > 0 ? `Help and support, ${unread} new ${unread === 1 ? "reply" : "replies"}` : "Help and support"}
        className={cn(
          "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background/70 text-muted-foreground shadow-sm transition hover:border-primary/30 hover:bg-background hover:text-foreground",
          className,
        )}
        onClick={() => setOpen(true)}
        title="Help & support"
        type="button"
      >
        <MessageCircle className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {unread}
          </span>
        ) : null}
      </button>

      <Sheet
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) void refresh();
        }}
        open={open}
      >
        <SheetContent
          className={cn(
            "w-full gap-0 overflow-hidden p-0 sm:max-w-md",
            side === "bottom" && `${bottomSheetClassName} sm:max-w-none`,
          )}
          showCloseButton={false}
          side={side}
        >
          {side === "bottom" ? <SheetGrabber className="bg-white/40" /> : null}
          <SheetTitle className="sr-only">SaphraONE Support</SheetTitle>
          <SheetDescription className="sr-only">Answers to common questions, and a way to reach the SaphraONE team.</SheetDescription>
          <SupportCenter onClose={() => setOpen(false)} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
