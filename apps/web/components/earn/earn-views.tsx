"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  Crown,
  KeyRound,
  Repeat,
  ShieldCheck,
  TrendingUp,
  Unlock,
} from "lucide-react";
import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import type { AutoDepositRule } from "@/lib/earn/auto-deposit";
import {
  formatApy,
  formatUsdGrouped,
  isActiveVault,
  isLowLiquidityVault,
  protocolLabel,
  vaultName,
} from "@/lib/earn/display";
import type { EarnPosition, EarnVault } from "@/lib/earn/types";
import { FEATURE_UNLOCK_TERM_LABEL } from "@/lib/referral/types";
import { useSheetSide } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

// ── Shared sheet ────────────────────────────────────────────────────────────

/** Deposit, withdraw, vaults and automation open here: up from the bottom on phones. */
export function EarnSheet({
  children,
  description,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const side = useSheetSide();
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className={cn(
          "earn-sheet w-full gap-0 p-0 sm:max-w-md",
          side === "bottom" && "max-h-[92dvh] rounded-t-[1.75rem] border-t-0 sm:max-w-none",
        )}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        <div className="overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8">
          <SheetTitle className="text-xl font-bold">{title}</SheetTitle>
          <SheetDescription className={description ? "mt-1" : "sr-only"}>{description ?? title}</SheetDescription>
          <div className="mt-4">{children}</div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function earnedLine(position: EarnPosition | null) {
  const pnl = position?.pnl;
  if (!pnl) return null;
  if (pnl.status === "pending") return { text: "Working out your earnings…", tone: "quiet" as const };
  if (pnl.status === "available") {
    const earned = formatUsdGrouped(pnl.totalYieldEarned);
    if (!earned) return null;
    return { text: `${earned.startsWith("-") ? "" : "+"}${earned} earned`, tone: "good" as const };
  }
  return null;
}

/** Coins rising out of a glow: decorative, not data. */
function HeroArt() {
  return (
    <svg aria-hidden className="earn-hero-art" viewBox="0 0 200 200">
      <defs>
        <radialGradient id="earn-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="earn-coin" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="110" fill="url(#earn-glow)" r="95" />
      <g className="earn-hero-coins">
        <ellipse cx="96" cy="150" fill="#3b1478" opacity="0.55" rx="44" ry="10" />
        {[0, 1, 2, 3].map((index) => (
          <g key={index}>
            <ellipse cx="96" cy={140 - index * 14} fill="#5b21b6" rx="40" ry="11" />
            <ellipse cx="96" cy={136 - index * 14} fill="url(#earn-coin)" rx="40" ry="11" />
          </g>
        ))}
        <circle className="earn-hero-coin-float" cx="150" cy="58" fill="url(#earn-coin)" r="17" />
        <text fill="#3b1478" fontSize="16" fontWeight="800" textAnchor="middle" x="150" y="64">
          $
        </text>
      </g>
      <path className="earn-hero-arrow" d="M38 128 L70 92 L92 108 L132 62" fill="none" stroke="#86efac" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
      <path className="earn-hero-arrow" d="M118 60 L134 60 L134 76" fill="none" stroke="#86efac" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
    </svg>
  );
}

export function EarnHero({
  bestApy,
  canTransact,
  connected,
  loadingPosition,
  onDeposit,
  onPickVault,
  onWithdraw,
  position,
  vault,
}: {
  bestApy: number | null;
  canTransact: boolean;
  connected: boolean;
  loadingPosition: boolean;
  onDeposit: () => void;
  onPickVault: () => void;
  onWithdraw: () => void;
  position: EarnPosition | null;
  vault: EarnVault | null;
}) {
  const balance = formatUsdGrouped(position?.currentBalance);
  const hasBalance = Boolean(position?.currentBalance && Number(position.currentBalance) > 0);
  const apy = formatApy(position?.currentApy ?? vault?.currentApy);
  const earned = earnedLine(position);

  // Nothing in a vault yet: lead with the best rate on offer (a live figure).
  if (!vault || (!hasBalance && !loadingPosition)) {
    return (
      <section className="earn-hero">
        <HeroArt />
        <div className="earn-hero-body">
          <p className="earn-hero-eyebrow">
            <TrendingUp className="h-4 w-4" /> Invest your idle USDC
          </p>
          <p className="earn-hero-headline">
            {bestApy !== null ? (
              <>
                Up to <span>{formatApy(bestApy)}</span> APY
              </>
            ) : (
              "Put your USDC to work"
            )}
          </p>
          <p className="earn-hero-sub">
            Deposit into a vault, withdraw whenever you like. No lock-up, no notice period.
          </p>
          <div className="earn-hero-actions">
            {vault ? (
              <button className="earn-hero-button is-primary" disabled={!canTransact} onClick={onDeposit} type="button">
                <ArrowDownToLine className="h-4 w-4" /> Deposit into {vaultName(vault)}
              </button>
            ) : (
              <button className="earn-hero-button is-primary" onClick={onPickVault} type="button">
                Start investing <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
          {!connected ? <p className="earn-hero-hint">Sign in or connect a wallet to deposit.</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="earn-hero">
      <HeroArt />
      <div className="earn-hero-body">
        <p className="earn-hero-eyebrow">
          <TrendingUp className="h-4 w-4" /> Your investment
        </p>
        <p className="earn-hero-amount">
          {loadingPosition && !balance ? <span className="earn-hero-skeleton" /> : (balance ?? "$0.00")}
        </p>
        <div className="earn-hero-chips">
          {earned ? <span className={cn("earn-hero-chip", earned.tone === "good" && "is-good")}>{earned.text}</span> : null}
          {apy ? <span className="earn-hero-chip">Earning {apy} APY</span> : null}
        </div>
        <div className="earn-hero-actions">
          <button className="earn-hero-button is-primary" disabled={!canTransact} onClick={onDeposit} type="button">
            <ArrowDownToLine className="h-4 w-4" /> Deposit
          </button>
          <button className="earn-hero-button" disabled={!canTransact} onClick={onWithdraw} type="button">
            <ArrowUpFromLine className="h-4 w-4" /> Withdraw
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Position details ────────────────────────────────────────────────────────

export function EarnPositionFacts({ position }: { position: EarnPosition | null }) {
  const pnl = position?.pnl;
  const principal =
    pnl?.status === "available" ? formatUsdGrouped(pnl.principalDeposited) : pnl?.status === "pending" ? "Calculating" : null;
  if (!position || (!principal && !position.shares)) return null;
  return (
    <section className="earn-figures">
      <div className="earn-card earn-figure">
        <span className="earn-figure-value">{principal ?? "—"}</span>
        <span className="earn-figure-label">You put in</span>
      </div>
      <div className="earn-card earn-figure">
        <span className="earn-figure-value">{formatApy(position.currentApy) ?? "—"}</span>
        <span className="earn-figure-label">Current APY</span>
      </div>
      <div className="earn-card earn-figure">
        <span className="earn-figure-value">{position.shares ? Number(position.shares).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</span>
        <span className="earn-figure-label">Vault shares</span>
      </div>
    </section>
  );
}

// ── Vaults ──────────────────────────────────────────────────────────────────

function VaultStatus({ vault }: { vault: EarnVault }) {
  if (isLowLiquidityVault(vault.status)) return <span className="earn-status is-warn">Low liquidity</span>;
  if (isActiveVault(vault.status)) return <span className="earn-status is-good">Active</span>;
  return vault.status ? <span className="earn-status">{vault.status.replaceAll("_", " ")}</span> : null;
}

export function SelectedVaultCard({ onChange, vault }: { onChange: () => void; vault: EarnVault }) {
  const supplied = formatUsdGrouped(vault.totalDeposits);
  return (
    <button className="earn-card earn-selected" onClick={onChange} type="button">
      <span className="earn-vault-mark">{protocolLabel(vault.protocol).slice(0, 1)}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-2">
          <span className="earn-vault-name">{vaultName(vault)}</span>
          <VaultStatus vault={vault} />
        </span>
        <span className="earn-vmeta">
          {supplied ? `${supplied} supplied · ` : ""}Powered by {protocolLabel(vault.protocol) === "MORPHO" ? "Morpho" : protocolLabel(vault.protocol)}
        </span>
      </span>
      <span className="earn-vault-apy">
        {formatApy(vault.currentApy) ?? "—"}
        <small>APY</small>
      </span>
      <span className="earn-change">Change</span>
    </button>
  );
}

export function VaultGrid({
  onSelect,
  selected,
  vaults,
}: {
  onSelect: (address: string) => void;
  selected?: string | null;
  vaults: EarnVault[];
}) {
  const best = Math.max(...vaults.map((vault) => vault.currentApy ?? -1));
  return (
    <div className="earn-vaults">
      {vaults.map((vault) => {
        const isSelected = selected?.toLowerCase() === vault.vaultAddress.toLowerCase();
        const supplied = formatUsdGrouped(vault.totalDeposits);
        const muted = !isActiveVault(vault.status) || isLowLiquidityVault(vault.status);
        return (
          <button
            aria-pressed={isSelected}
            className={cn("earn-card earn-vault", isSelected && "is-selected", muted && "is-muted")}
            key={vault.vaultAddress}
            onClick={() => onSelect(vault.vaultAddress)}
            type="button"
          >
            <span className="flex items-start justify-between gap-2">
              <span className="earn-vault-name">{vaultName(vault)}</span>
              {isSelected ? (
                <span className="earn-status is-brand">
                  <Check className="h-3 w-3" /> Yours
                </span>
              ) : vault.currentApy === best && vaults.length > 1 ? (
                <span className="earn-status is-good">Best rate</span>
              ) : (
                <VaultStatus vault={vault} />
              )}
            </span>
            <span className="earn-vault-rate">
              {formatApy(vault.currentApy) ?? "—"}
              <small>APY</small>
            </span>
            <span className="earn-vmeta">
              {supplied ? `${supplied} supplied` : "Supply not reported"} · {protocolLabel(vault.protocol) === "MORPHO" ? "Morpho" : protocolLabel(vault.protocol)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Automate ────────────────────────────────────────────────────────────────

export function AutomateCard({
  expiresAt,
  loading,
  onOpen,
  rule,
  unlockCost,
  unlocked,
}: {
  expiresAt: string | null;
  loading: boolean;
  onOpen: () => void;
  rule: AutoDepositRule | null;
  unlockCost: number | string;
  unlocked: boolean;
}) {
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const status = loading
    ? "Checking…"
    : !unlocked
      ? `${unlockCost} OnePoints for ${FEATURE_UNLOCK_TERM_LABEL.EARN_AUTO_DEPOSIT}`
      : rule?.enabled
        ? `${rule.frequency[0].toUpperCase()}${rule.frequency.slice(1)} · ${Number(rule.amount_usdc).toFixed(2)} USDC · ${rule.mode === "UNATTENDED" ? "Fully automatic" : "Sweep on visit"}`
        : "Unlocked · not set up yet";
  return (
    <button className="earn-card earn-automate" onClick={onOpen} type="button">
      <span className="earn-automate-icon">{unlocked ? <Repeat className="h-5 w-5" /> : <Crown className="h-5 w-5" />}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Automatic deposits</span>
          {unlocked && rule?.enabled ? <span className="earn-status is-good">On</span> : null}
          {!unlocked ? <span className="earn-status is-premium">Premium</span> : null}
        </span>
        <span className="block text-sm text-muted-foreground">{status}</span>
        {unlocked && expiry && Number.isFinite(expiry.getTime()) ? (
          <span className="block text-xs text-muted-foreground">
            Access until {expiry.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
          </span>
        ) : null}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ── Facts ───────────────────────────────────────────────────────────────────

export function EarnFacts() {
  const facts = [
    { icon: Unlock, text: "Withdraw any time. No lock-up, no notice period." },
    { icon: KeyRound, text: "Your wallet signs every move, so the position stays yours." },
    { icon: ShieldCheck, text: "Rates are live from the vault and change with the market." },
  ];
  return (
    <ul className="earn-facts">
      {facts.map((fact) => (
        <li key={fact.text}>
          <fact.icon className="h-4 w-4" />
          <span>{fact.text}</span>
        </li>
      ))}
    </ul>
  );
}
