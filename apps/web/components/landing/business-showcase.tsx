"use client";

import { arcChain } from "@/lib/chains";
import { usesLegacySendFee } from "@/lib/fees";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Receipt,
  Send,
  ShieldCheck,
  TrendingUp,
  Users,
  UsersRound,
  Wallet,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FadeUp, Stagger, StaggerItem } from "@/components/design/motion";
import { LandingVideoBackground } from "@/components/landing/landing-video-background";
import { LaunchAppLink } from "@/components/landing/launch-app-link";
import { Badge } from "@/components/ui/badge";

function SpatialBusinessDeck() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [glarePos, setGlarePos] = useState({ x: 0, y: 0 });
  const [period, setPeriod] = useState<"7D" | "30D" | "90D">("30D");
  const [streamIndex, setStreamIndex] = useState(0);

  const liveEvents = [
    {
      amount: "+$12,500.00 USDC",
      detail: "INV-2026-08 · Arc instant settlement",
      id: "1",
      time: "Just now",
      title: "Acme Web3 Labs",
      tone: "in" as const,
    },
    {
      amount: "-$38,500.00 USDC",
      detail: "14 contractors · BulkPay stream",
      id: "2",
      time: "4m ago",
      title: "Engineering Payroll Run",
      tone: "out" as const,
    },
    {
      amount: "+$24,000.00 USDC",
      detail: "Quarterly retainer · Reconciled",
      id: "3",
      time: "12m ago",
      title: "Solstice Global Media",
      tone: "in" as const,
    },
    {
      amount: "-$4,200.00 USDC",
      detail: "Smart Account treasury transfer",
      id: "4",
      time: "28m ago",
      title: "Cloud Infra & Security Audit",
      tone: "out" as const,
    },
  ];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStreamIndex((prev) => (prev + 1) % liveEvents.length);
    }, 3800);
    return () => window.clearInterval(timer);
  }, [liveEvents.length]);

  // Spatial mouse motion values
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springConfig = { damping: 22, stiffness: 180 };
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [6, -6]), springConfig);
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-6, 6]), springConfig);

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

  const periodMetrics = {
    "7D": {
      d1: "M 0 55 Q 35 48, 70 38 T 140 28 T 210 20 T 280 14 T 350 8",
      d2: "M 0 68 Q 35 62, 70 54 T 140 48 T 210 40 T 280 34 T 350 28",
      fill1: "M 0 55 Q 35 48, 70 38 T 140 28 T 210 20 T 280 14 T 350 8 L 350 80 L 0 80 Z",
      incoming: "+$38,200.00",
      net: "+$25,800.00",
      nodeX: 350,
      nodeY: 8,
      outgoing: "-$12,400.00",
    },
    "30D": {
      d1: "M 0 60 Q 35 52, 70 40 T 140 30 T 210 18 T 280 24 T 350 6",
      d2: "M 0 74 Q 35 68, 70 60 T 140 50 T 210 44 T 280 38 T 350 30",
      fill1: "M 0 60 Q 35 52, 70 40 T 140 30 T 210 18 T 280 24 T 350 6 L 350 80 L 0 80 Z",
      incoming: "+$142,500.00",
      net: "+$94,300.00",
      nodeX: 350,
      nodeY: 6,
      outgoing: "-$48,200.00",
    },
    "90D": {
      d1: "M 0 65 Q 35 56, 70 42 T 140 32 T 210 22 T 280 12 T 350 4",
      d2: "M 0 78 Q 35 72, 70 64 T 140 54 T 210 42 T 280 34 T 350 24",
      fill1: "M 0 65 Q 35 56, 70 42 T 140 32 T 210 22 T 280 12 T 350 4 L 350 80 L 0 80 Z",
      incoming: "+$426,000.00",
      net: "+$290,900.00",
      nodeX: 350,
      nodeY: 4,
      outgoing: "-$135,100.00",
    },
  };

  const activeData = periodMetrics[period];
  const activeEvent = liveEvents[streamIndex];

  return (
    <div className="mx-auto max-w-5xl" style={{ perspective: 1200 }}>
      <motion.div
        className="relative overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl transition-shadow duration-300 hover:shadow-primary/10"
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
              background: `radial-gradient(450px circle at ${glarePos.x}px ${glarePos.y}px, rgba(124, 58, 237, 0.12), transparent 80%)`,
            }}
          />
        )}

        {/* 1. Chrome Top Bar */}
        <div className="flex items-center justify-between border-b border-border/80 bg-muted/40 px-3.5 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
            <span className="ml-2 hidden font-mono text-[11px] text-muted-foreground sm:inline">
              https://app.saphra.one/business
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{arcChain.name} · 0x8a92...3F10</span>
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              Circle Smart Account
            </span>
          </div>
        </div>

        {/* 2. Interior Dashboard Deck */}
        <div className="space-y-3.5 bg-background/50 p-4 sm:p-5">
          {/* Subheader */}
          <div
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3"
            style={{ transform: "translateZ(26px)" }}
          >
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-lg sm:text-xl font-bold text-foreground">
                Apex Technologies Ltd
              </h3>
              <Badge className="gap-1 border-emerald-500/20 bg-emerald-500/10 py-0.5 text-[11px] text-emerald-500">
                <ShieldCheck className="h-3 w-3" />
                Verified Business
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Corporate Treasury Active · 4 Workspace Members
            </p>
          </div>

          {/* Core Grid: Left Balance + Right Analytics */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
            {/* Left Column: Balance & Quick Actions (5 cols) */}
            <div
              className="flex flex-col justify-between gap-3 lg:col-span-5"
              style={{ transform: "translateZ(24px)" }}
            >
              {/* Balance Card */}
              <div className="rounded-xl border border-border/80 bg-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Total Business Balance
                  </p>
                  <span className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-500">
                    <TrendingUp className="h-3 w-3" />
                    +8.4%
                  </span>
                </div>
                <p className="mt-1 font-heading text-2xl sm:text-3xl font-extrabold text-foreground">
                  $128,450.00
                  <span className="ml-1 text-xs font-semibold text-muted-foreground">USDC</span>
                </p>

                {/* Currency Chips */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">
                        $
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground">USDC</span>
                    </div>
                    <p className="mt-1 font-heading text-sm font-bold text-foreground">120,000.00</p>
                    <p className="text-[10px] text-muted-foreground">93.4% of treasury</p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[9px] font-bold text-white">
                        €
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground">EURC</span>
                    </div>
                    <p className="mt-1 font-heading text-sm font-bold text-foreground">7,800.00</p>
                    <p className="text-[10px] text-muted-foreground">≈ $8,450 (6.6%)</p>
                  </div>
                </div>

                {/* Liquidity Ratio Bar */}
                <div className="mt-3 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Available: <strong className="text-foreground">$124,200.00</strong>
                  </span>
                  <span className="text-emerald-500 font-semibold">96.7% Liquid</span>
                </div>
              </div>

              {/* Quick Actions (Imperial Purple #5B21B6) */}
              <div
                className="grid grid-cols-4 gap-2"
                style={{ transform: "translateZ(30px)" }}
              >
                <button
                  className="flex flex-col items-center justify-center gap-1 rounded-lg bg-[#5B21B6] p-2 text-center text-white transition hover:bg-[#4C1D95]"
                  type="button"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold">Send</span>
                </button>
                <button
                  className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card p-2 text-center text-foreground transition hover:bg-accent"
                  type="button"
                >
                  <Receipt className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[11px] font-medium">Invoice</span>
                </button>
                <button
                  className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card p-2 text-center text-foreground transition hover:bg-accent"
                  type="button"
                >
                  <Users className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-[11px] font-medium">Payroll</span>
                </button>
                <button
                  className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border bg-card p-2 text-center text-foreground transition hover:bg-accent"
                  type="button"
                >
                  <UsersRound className="h-3.5 w-3.5 text-sky-500" />
                  <span className="text-[11px] font-medium">BulkPay</span>
                </button>
              </div>
            </div>

            {/* Right Column: Live Analytics & Live Operations Stream (7 cols) */}
            <div
              className="flex flex-col justify-between gap-3 lg:col-span-7"
              style={{ transform: "translateZ(20px)" }}
            >
              {/* Cash Flow Analytics */}
              <div className="rounded-xl border border-border/80 bg-card p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <div>
                    <h4 className="font-heading text-sm font-bold text-foreground">
                      Cash Flow Analytics
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      Real-time indexed on-chain inflows & disbursements
                    </p>
                  </div>
                  {/* Period Toggles */}
                  <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-[11px]">
                    {(["7D", "30D", "90D"] as const).map((item) => (
                      <button
                        className={`rounded-md px-2 py-0.5 font-medium transition ${
                          period === item
                            ? "bg-card text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        key={item}
                        onClick={() => setPeriod(item)}
                        type="button"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Key Numbers */}
                <div className="flex items-center justify-between text-xs mb-2">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Inflow: {activeData.incoming}
                    </span>
                    <span className="flex items-center gap-1 text-rose-500 font-semibold">
                      <span className="h-2 w-2 rounded-full bg-rose-500" />
                      Outflow: {activeData.outgoing}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Net: <strong className="text-emerald-500 font-bold">{activeData.net}</strong>
                  </span>
                </div>

                {/* SVG Curve with animated pulse node */}
                <div className="relative h-20 w-full overflow-hidden">
                  <svg
                    className="h-full w-full overflow-visible"
                    preserveAspectRatio="none"
                    viewBox="0 0 350 80"
                  >
                    <defs>
                      <linearGradient id="landingEmeraldGrad" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    {/* Fill */}
                    <path d={activeData.fill1} fill="url(#landingEmeraldGrad)" />
                    {/* Incoming line */}
                    <path
                      d={activeData.d1}
                      fill="none"
                      stroke="#10B981"
                      strokeLinecap="round"
                      strokeWidth="2.5"
                    />
                    {/* Outgoing line */}
                    <path
                      d={activeData.d2}
                      fill="none"
                      stroke="#F43F5E"
                      strokeDasharray="4 4"
                      strokeWidth="1.5"
                    />
                    {/* Active Radar Node */}
                    <circle cx={activeData.nodeX} cy={activeData.nodeY} fill="#10B981" r="3.5" />
                  </svg>
                  {/* Ping effect over active node */}
                  <span
                    className="pointer-events-none absolute h-3 w-3 -translate-x-1.5 -translate-y-1.5 rounded-full bg-emerald-400 opacity-75 animate-ping"
                    style={{
                      left: `${(activeData.nodeX / 350) * 100}%`,
                      top: `${(activeData.nodeY / 80) * 100}%`,
                    }}
                  />
                </div>
              </div>

              {/* Live Operations Stream */}
              <div
                className="rounded-xl border border-border/80 bg-card p-3"
                style={{ transform: "translateZ(26px)" }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Live Treasury Stream</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">Arc Sub-second</span>
                </div>

                <AnimatePresence initial={false} mode="wait">
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-2 text-xs"
                    exit={{ opacity: 0, y: -8 }}
                    initial={{ opacity: 0, y: 8 }}
                    key={activeEvent.id}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full ${
                          activeEvent.tone === "in"
                            ? "bg-emerald-500/15 text-emerald-500"
                            : "bg-purple-500/15 text-purple-500"
                        }`}
                      >
                        {activeEvent.tone === "in" ? (
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div>
                        <p className="font-semibold text-foreground">{activeEvent.title}</p>
                        <p className="text-[10px] text-muted-foreground">{activeEvent.detail}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-bold ${
                          activeEvent.tone === "in" ? "text-emerald-500" : "text-foreground"
                        }`}
                      >
                        {activeEvent.amount}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{activeEvent.time}</p>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* 3. Bottom Health Strip (Single-line high density) */}
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-4 pt-1 border-t border-border/60 text-[11px]"
            style={{ transform: "translateZ(22px)" }}
          >
            <div className="flex items-center justify-between rounded-md border border-border/50 bg-card px-2.5 py-1.5">
              <span className="text-muted-foreground">Cash Position:</span>
              <strong className="text-emerald-500 font-bold">98/100 (14m)</strong>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/50 bg-card px-2.5 py-1.5">
              <span className="text-muted-foreground">Activity:</span>
              <strong className="text-emerald-500 font-bold">94/100 (Instant)</strong>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/50 bg-card px-2.5 py-1.5">
              <span className="text-muted-foreground">Invoices:</span>
              <strong className="text-emerald-500 font-bold">96% On-time</strong>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/50 bg-card px-2.5 py-1.5">
              <span className="text-muted-foreground">Obligations:</span>
              <strong className="text-emerald-500 font-bold">Zero Arrears</strong>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function BusinessShowcase() {
  const businessFeatures = [
    {
      icon: Wallet,
      title: "Financial Command Center",
      description:
        `Real-time treasury overview with multi-asset tracking in USDC & EURC on ${arcChain.name}, automated liquidity segregation, and live asset valuation.`,
      highlight: "Multi-Asset Treasury",
    },
    {
      icon: FileSpreadsheet,
      title: "Automated Team Payroll",
      description:
        "Disburse team salaries and contractor payouts in a single batch transaction. Manage recipients, preview disbursements, and execute repeat payrolls in seconds.",
      highlight: "One-Click Payroll",
    },
    {
      icon: Receipt,
      title: "Branded Invoicing Hub",
      description:
        "Issue professional cryptographic invoices in USDC or EURC with your business branding, shareable payment links, QR codes, and instant reconciliation.",
      highlight: "Instant Reconciliation",
    },
    {
      icon: BarChart3,
      title: "Live Cash Flow & Runway Analytics",
      description:
        "Interactive dual-trend cash flow tracking with 7D, 30D, and 90D intervals. Monitor incoming receivables, outgoing liabilities, and net cash position.",
      highlight: "Interactive Curves",
    },
    {
      icon: UsersRound,
      title: "High-Throughput BulkPay",
      description:
        "Upload CSV rosters and execute bulk payouts to up to 500 recipients in a single on-chain transaction with sub-second Arc finality and sub-cent fees.",
      highlight: "Up to 500 Recipients",
    },
    {
      icon: ShieldCheck,
      title: "Corporate Financial Health",
      description:
        "Four-pillar automated health assessment covering Cash Position, Payment Activity, Invoice Collection, and Obligations with immutable ArcScan audit trails.",
      highlight: "4-Pillar Scoring",
    },
  ];

  const whyChooseBusiness = [
    {
      icon: ShieldCheck,
      title: "True Non-Custodial Security",
      description:
        "Powered by Circle Programmable Smart Wallets. Your organization holds full cryptographic ownership. No bank run risk, no frozen accounts, and no single point of failure.",
    },
    {
      icon: Zap,
      title: usesLegacySendFee() ? "0.1% Flat Fee vs 3% Card Interchange" : "Fees Capped at 5 USDC vs 3% Card Interchange",
      description:
        "Slash payment acceptance and operational overhead by up to 90%. Gas is paid directly in stablecoins on Arc with predictable, sub-cent execution.",
    },
    {
      icon: CheckCircle2,
      title: "Zero Chargebacks & Fraud Guarantee",
      description:
        "Every transaction is cryptographically signed and finalized in under a second on Arc. Eliminate costly chargebacks, friendly fraud, and disputed card reversals.",
    },
    {
      icon: Building2,
      title: "Audit-Ready Bookkeeping",
      description:
        "Every transfer, payroll disbursement, and invoice receipt produces immutable on-chain records with cryptographic proof ready for GAAP/IFRS accounting integration.",
    },
  ];

  const comparisonRows = [
    {
      feature: "Settlement Speed",
      legacy: "3 - 5 business days (ACH / SWIFT wires)",
      saphra: "Sub-second (<1s) instant finality on Arc",
    },
    {
      feature: "Processing Fees",
      legacy: "2.9% + $0.30 per payment + wire fees ($25-$50)",
      saphra: usesLegacySendFee()
        ? "0.1% flat protocol fee with sub-cent gas"
        : "From 0.01 per payment, never more than 5 USDC, with sub-cent gas",
    },
    {
      feature: "Custody & Control",
      legacy: "Centralized banks & processors can freeze accounts",
      saphra: "Self-sovereign Circle Programmable Smart Wallets",
    },
    {
      feature: "Global Payroll",
      legacy: "Multiple FX conversions, correspondent bank delays",
      saphra: "Single-click batch payout to 500 global wallets in USDC",
    },
    {
      feature: "Dispute & Chargeback Risk",
      legacy: "High chargeback fraud & 90-day reversal windows",
      saphra: "Zero chargebacks; immutable cryptographic settlement",
    },
  ];

  return (
    <section className="marketing-section" id="business">
      {/* The header and the 3D showcase sit over a dimmed background video,
          which stops where the showcase ends. */}
      <div className="landing-video-stage business-video-stage">
      <LandingVideoBackground
        mobileSrc="/video/business-bg-mobile.mp4?v=2"
        poster="/video/business-bg-poster.jpg?v=2"
        position="60% center"
        src="/video/business-bg.mp4?v=2"
      />

      {/* ── Section Header ── */}
      <div className="marketing-section-header max-w-3xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
          <Building2 className="h-3.5 w-3.5" />
          For Organizations & Teams
        </div>
        <h2 className="section-title text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
          SaphraONE for Business: Global Crypto Rails with Local Precision
        </h2>
        <p className="section-copy mt-3 text-base leading-7 text-muted-foreground sm:text-lg">
          Transform your organization&apos;s financial operations. Manage corporate treasury,
          disburse automated batch payroll, generate branded invoices, and track live cash flow—all
          powered by non-custodial Circle smart accounts and sub-second Arc settlement.
        </p>
      </div>

      {/* ── Compact Spatial 3D Interactive Business Showcase ── */}
      <FadeUp className="mt-8">
        <SpatialBusinessDeck />
      </FadeUp>
      </div>

      {/* ── Core Business Features Grid ── */}
      <div className="mt-14">
        <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">
              Engineered for Enterprise
            </p>
            <h3 className="mt-1 font-heading text-xl font-bold tracking-tight sm:text-2xl">
              Everything Your Organization Needs to Operate On-Chain
            </h3>
          </div>
          <p className="text-xs text-muted-foreground sm:text-sm max-w-md">
            Built from the ground up for modern businesses, Web3 protocols, global agencies, and high-volume teams.
          </p>
        </div>

        <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {businessFeatures.map((feature) => {
            const Icon = feature.icon;
            return (
              <StaggerItem key={feature.title}>
                <div className="flex h-full flex-col justify-between rounded-xl border border-border bg-card/80 p-5 transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="rounded-full bg-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {feature.highlight}
                      </span>
                    </div>
                    <h4 className="mt-4 font-heading text-base font-semibold text-foreground">
                      {feature.title}
                    </h4>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </Stagger>
      </div>

      {/* ── Why It Suits Businesses / Enterprise Advantage ── */}
      <div className="mt-16 rounded-2xl border border-border bg-muted/30 p-6 sm:p-8 lg:p-10">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-5">
            <Badge className="mb-3 bg-primary/15 text-primary border-primary/20" variant="outline">
              The Enterprise Edge
            </Badge>
            <h3 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
              Why Global Companies Choose SaphraONE Business
            </h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Traditional commercial banking and card networks were built decades ago for domestic fiat.
              SaphraONE Business offers the instant finality, security, and low fees of stablecoins combined with
              the financial clarity, auditability, and structure modern teams require.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <LaunchAppLink className="sp-bubble inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90">
                Launch Business Profile
                <ArrowRight className="h-4 w-4" />
              </LaunchAppLink>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:bg-accent hover:text-accent-foreground"
                href="/bulkpay"
              >
                Explore BulkPay
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
            {whyChooseBusiness.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  className="rounded-xl border border-border/80 bg-card p-4 transition hover:border-border"
                  key={item.title}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h4 className="mt-3 font-heading text-sm font-semibold text-foreground">
                    {item.title}
                  </h4>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Comparison Table: Legacy vs SaphraONE ── */}
        <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-muted/40 px-4 py-3 sm:px-6">
            <h4 className="font-heading text-sm font-bold text-foreground">
              Direct Comparison: Legacy Commercial Banking vs. SaphraONE Business
            </h4>
          </div>
          <div className="divide-y divide-border overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted/20 text-muted-foreground">
                  <th className="p-3.5 font-semibold sm:px-6">Metric / Capability</th>
                  <th className="p-3.5 font-semibold sm:px-6 text-rose-500/90">Traditional Banking & Cards</th>
                  <th className="p-3.5 font-semibold sm:px-6 text-emerald-500">SaphraONE Business</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {comparisonRows.map((row) => (
                  <tr className="hover:bg-muted/10 transition-colors" key={row.feature}>
                    <td className="p-3.5 font-medium text-foreground sm:px-6">{row.feature}</td>
                    <td className="p-3.5 text-muted-foreground sm:px-6">{row.legacy}</td>
                    <td className="p-3.5 font-medium text-emerald-600 dark:text-emerald-400 sm:px-6 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      {row.saphra}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
