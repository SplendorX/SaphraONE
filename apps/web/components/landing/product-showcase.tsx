"use client";

import { arcChain } from "@/lib/chains";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  ArrowDownUp,
  Bell,
  CalendarClock,
  LayoutDashboard,
  PiggyBank,
  ReceiptText,
  RefreshCw,
  Send,
  Sun,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { PlatformBrand } from "@/components/brand/platform-brand";
import { HeroBrandDisplay } from "@/components/landing/hero-brand-display";
import { FadeUp } from "@/components/design/motion";
import { TokenIcon } from "@/components/token-icon";
import { useT } from "@/components/locale-provider";

const slideIds = ["swap", "send", "request"] as const;
const sidebarDefs = [
  { icon: LayoutDashboard, id: "dashboard" },
  { icon: RefreshCw, id: "swap" },
  { icon: Send, id: "send" },
  { icon: ReceiptText, id: "request" },
  { icon: Users, id: "batch" },
  { icon: PiggyBank, id: "save" },
  { icon: CalendarClock, id: "recure" },
] as const;

function ScreenShell({
  action,
  children,
  copy,
  title,
}: {
  action: string;
  children: ReactNode;
  copy: string;
  title: string;
}) {
  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-3">
      <div>
        <h3 className="font-heading text-lg font-semibold tracking-tight sm:text-xl">
          {title}
        </h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {copy}
        </p>
      </div>
      <div className="grid min-h-0 grid-rows-[1fr_auto] gap-2.5 rounded-2xl border border-border bg-card p-3">
        <div className="grid min-h-0 content-start gap-2.5">{children}</div>
        {/* Primary action button — solid brand color, not rainbow */}
        <div className="inline-flex h-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {action}
        </div>
      </div>
    </div>
  );
}


function SwapScreen() {
  const t = useT();
  return (
    <ScreenShell
      action={t("landing.showcaseGetQuote")}
      copy={t("landing.showcaseSwapCopy", { network: arcChain.name })}
      title={t("nav.swap")}
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("landing.showcaseYouPay")}
          </p>
          <p className="font-heading text-xl font-semibold">1.00</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs font-bold">
          <TokenIcon className="h-4 w-4 rounded-full" symbol="USDC" />
          USDC
        </span>
      </div>
      <div className="-my-1 flex justify-center">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
          <ArrowDownUp className="h-3 w-3" />
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t("landing.showcaseYouReceive")}
          </p>
          <motion.p
            animate={{ opacity: [0.75, 1, 0.75] }}
            className="font-heading text-xl font-semibold"
            transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }}
          >
            0.8592
          </motion.p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs font-bold">
          <TokenIcon className="h-4 w-4 rounded-full" symbol="EURC" />
          EURC
        </span>
      </div>
    </ScreenShell>
  );
}

function SendScreen() {
  const t = useT();
  return (
    <ScreenShell
      action={t("landing.showcaseSendPayment")}
      copy={t("landing.showcaseSendCopy")}
      title={t("common.send")}
    >
      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("common.recipient")}
        </p>
        <p className="mt-1 text-sm font-semibold">ada.one</p>
      </div>
      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("common.amount")}
        </p>
        <p className="mt-1 inline-flex items-center gap-2 text-sm font-semibold">
          <TokenIcon className="h-4 w-4 rounded-full" symbol="USDC" />
          250.00 USDC
        </p>
      </div>
      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("landing.showcaseNetwork")}
        </p>
        <p className="mt-1 text-sm font-semibold">{arcChain.name}</p>
      </div>
    </ScreenShell>
  );
}

function RequestScreen() {
  const t = useT();
  return (
    <ScreenShell
      action={t("landing.showcaseSendRequest")}
      copy={t("landing.showcaseRequestCopy")}
      title={t("nav.request")}
    >
      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("landing.showcaseAskFor")}
        </p>
        <p className="mt-1 inline-flex items-center gap-2 text-sm font-semibold">
          <TokenIcon className="h-4 w-4 rounded-full" symbol="EURC" />
          80.00 EURC
        </p>
      </div>
      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("landing.showcaseSendRequestTo")}
        </p>
        <p className="mt-1 text-sm font-semibold">studiowest.one</p>
      </div>
      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {t("landing.showcaseExpires")}
        </p>
        <p className="mt-1 text-sm font-semibold">{t("landing.showcaseExpiresValue")}</p>
      </div>
    </ScreenShell>
  );
}

function PreviewBoard() {
  const t = useT();
  const [index, setIndex] = useState(0);
  const slides = slideIds.map((id) => ({
    id,
    label:
      id === "swap"
        ? t("nav.swap")
        : id === "send"
          ? t("common.send")
          : t("nav.request"),
  }));
  const sidebarItems = sidebarDefs.map((item) => ({
    ...item,
    label:
      item.id === "dashboard"
        ? t("nav.dashboard")
        : item.id === "swap"
          ? t("nav.swap")
          : item.id === "send"
            ? t("common.send")
            : item.id === "request"
              ? t("nav.request")
              : item.id === "batch"
                ? t("nav.batchPay")
                : item.id === "save"
                  ? t("nav.save")
                  : t("nav.recurePay"),
  }));
  const active = slides[index];

  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [glarePos, setGlarePos] = useState({ x: 0, y: 0 });

  // Spatial mouse motion values
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springConfig = { damping: 22, stiffness: 180 };
  const rotateX = useSpring(
    useTransform(mouseY, [-0.5, 0.5], [6, -6]),
    springConfig,
  );
  const rotateY = useSpring(
    useTransform(mouseX, [-0.5, 0.5], [-6, 6]),
    springConfig,
  );

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    mouseX.set(x);
    mouseY.set(y);
    setGlarePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleMouseEnter() {
    setIsHovered(true);
  }

  function handleMouseLeave() {
    setIsHovered(false);
    mouseX.set(0);
    mouseY.set(0);
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  return (
    <div
      className="flex w-full flex-col items-center gap-3"
      style={{ perspective: 1100 }}
    >
      <motion.div
        className="landing-device relative w-full overflow-hidden rounded-[1.6rem] border border-border bg-card shadow-[0_0_48px_-12px_rgba(34,211,238,0.35),0_28px_70px_-28px_rgba(109,40,217,0.4)] transition-shadow duration-300 hover:shadow-[0_0_60px_-8px_rgba(34,211,238,0.45),0_32px_80px_-24px_rgba(109,40,217,0.5)]"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        ref={cardRef}
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
      >
        {/* Spatial cursor spotlight */}
        {isHovered && (
          <div
            className="pointer-events-none absolute -inset-px z-30 transition-opacity duration-300"
            style={{
              background: `radial-gradient(450px circle at ${glarePos.x}px ${glarePos.y}px, rgba(34, 211, 238, 0.16), rgba(124, 58, 237, 0.09) 40%, transparent 80%)`,
            }}
          />
        )}

        <div
          className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2.5"
          style={{ transform: "translateZ(20px)" }}
        >
          <PlatformBrand showName="always" />
          <span className="hidden rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-muted-foreground sm:inline">
            {arcChain.name}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              <Bell className="h-3.5 w-3.5" />
            </span>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
              <Sun className="h-3.5 w-3.5" />
            </span>
            <span className="hidden rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 font-mono text-[10px] font-bold sm:inline">
              0xA71C…9cE1
            </span>
          </div>
        </div>

        <div
          className="grid h-[24.5rem] bg-background md:grid-cols-[10.5rem_minmax(0,1fr)]"
          style={{ transform: "translateZ(24px)" }}
        >
          <aside className="hidden flex-col gap-1 border-r border-border bg-muted/30 p-2.5 md:flex">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === active.id;
              return (
                <span
                  className={`inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold ${
                    isActive
                      ? "bg-primary/15 text-foreground ring-1 ring-primary/25"
                      : "text-muted-foreground"
                  }`}
                  key={item.id}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {item.label}
                </span>
              );
            })}
          </aside>

          <div className="relative min-h-0 min-w-0 overflow-hidden">
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="absolute inset-0 p-4 sm:p-5"
                exit={{ opacity: 0, y: -8 }}
                initial={{ opacity: 0, y: 8 }}
                key={active.id}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                {active.id === "swap" ? (
                  <SwapScreen />
                ) : active.id === "send" ? (
                  <SendScreen />
                ) : (
                  <RequestScreen />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      <div className="flex items-center justify-center gap-1.5">
        {slides.map((slide, slideIndex) => (
          <button
            aria-label={`Show ${slide.label}`}
            className={`h-1.5 rounded-full border-0 transition-all ${
              slideIndex === index
                ? "w-5 bg-primary"
                : "w-1.5 bg-muted-foreground/40"
            }`}
            key={slide.id}
            onClick={() => setIndex(slideIndex)}
            type="button"
          />
        ))}
      </div>
      <p className="text-sm font-semibold text-muted-foreground">
        Swap, send, or request
      </p>
    </div>
  );
}

export function ProductShowcase({
  placement = "section",
}: {
  placement?: "hero" | "section";
}) {
  const isHeroPlacement = placement === "hero";

  if (isHeroPlacement) {
    return (
      <section
        aria-label="SaphraONE product preview"
        className="landing-hero-showcase"
      >
        <FadeUp className="landing-hero-preview">
          <div className="landing-hero-brand-strip">
            <HeroBrandDisplay />
          </div>
          <PreviewBoard />
        </FadeUp>
      </section>
    );
  }

  return (
    <section
      aria-label="SaphraONE product preview"
      className="grid items-center gap-8 py-2 pb-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)] lg:gap-10"
    >
      <FadeUp className="lg:pr-2">
        <HeroBrandDisplay />
      </FadeUp>
      <FadeUp delay={0.08}>
        <PreviewBoard />
      </FadeUp>
    </section>
  );
}
