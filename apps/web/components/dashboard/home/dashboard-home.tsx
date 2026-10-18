"use client";

import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ArrowUpRight,
  CalendarClock,
  ChartPie,
  ChevronRight,
  Eye,
  EyeOff,
  QrCode,
  ReceiptText,
  Send,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { OnePointsMark } from "@/components/brand/one-points-mark";
import { Announcements } from "@/components/dashboard/announcements";
import { rampEntryEnabled } from "@/lib/ramp/flag";
import { useOnePoints } from "@/lib/referral/use-one-points";
import { rewardsV2Enabled } from "@/lib/rewards/config";
import type { ArcTokenSymbol } from "@/lib/tokens";
import { cn } from "@/lib/utils";

import "./dashboard-home.css";

export type HomeToken = { symbol: ArcTokenSymbol; amount: string; share: number };

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** "1,234.56" → ["1,234", ".56"]: the cents sit smaller, like a bank card. */
function splitAmount(label: string) {
  const match = label.match(/^(.*?)([.,]\d{1,2})$/);
  return match ? [match[1], match[2]] : [label, ""];
}


/**
 * The dashboard, quiet and premium, in the shape of the iPhone app: a
 * greeting, one balance card, the four everyday actions as
 * tiles under it, ONE Points, this week in two numbers, then transactions
 * and the rest. Every other place is in the tab bar and its More sheet.
 *
 * A wide desktop window splits it in two: the card, actions, transactions
 * and promos in the main column, and ONE Points, this week, announcements,
 * notices and Invest in a rail beside them. On narrower screens the two
 * columns dissolve (display: contents) and `order` puts every block back in
 * the phone's sequence (dashboard-home.css).
 */
export function DashboardHome({
  avatarUrl,
  balanceLabel,
  banners,
  changeLabel,
  currency,
  earn,
  extras,
  greetingName,
  hideBalance,
  isBusiness,
  isConnected,
  isLoading,
  moneyIn,
  moneyOut,
  onToggleHide,
  tokens,
  transactions,
  trend,
}: {
  avatarUrl?: string | null;
  balanceLabel: string;
  /** Treasury warnings, the install prompt and the like. */
  banners?: ReactNode;
  changeLabel: string;
  currency: string;
  earn?: ReactNode;
  /** Promos, Circle invites. */
  extras?: ReactNode;
  greetingName: string | null;
  hideBalance: boolean;
  isBusiness: boolean;
  isConnected: boolean;
  isLoading: boolean;
  moneyIn: string;
  moneyOut: string;
  onToggleHide: () => void;
  tokens: HomeToken[];
  transactions: ReactNode;
  trend: "up" | "down" | "flat";
}) {
  const name = useRememberedName(greetingName);

  return (
    <div className="dh">
      <header className="dh-hello">
        <span className="dh-hello-text">
          <p className="dh-hello-small">{greeting()},</p>
          {name ? (
            <p className="dh-hello-name">{name}</p>
          ) : isConnected ? (
            <span aria-hidden className="dh-hello-skeleton" />
          ) : (
            <p className="dh-hello-name">Welcome to SaphraONE</p>
          )}
        </span>
      </header>

      <div className="dh-main">
        {/* The one card that matters */}
        <section aria-label="Balance" className="dh-card">
          <span aria-hidden className="dh-card-glow" />
          <span aria-hidden className="dh-card-sheen" />
          {/* The ONE ribbon from the logo, drawn flat into the card. */}
          <svg aria-hidden className="dh-card-art" fill="none" viewBox="170 365 685 295">
            <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="44">
              <path d="M317 632a120 120 0 0 0 120-120 120 120 0 0 0-120-120 120 120 0 0 0-120 120 120 120 0 0 0 120 120" />
              <path d="M317 632h145q55 0 55-55V392l150 240V392h160" />
              <path d="M667 512h130M667 632h160" />
            </g>
          </svg>
          <div className="dh-card-top">
            <span className="dh-card-label">
              {isBusiness ? "Business balance" : "Total balance"} · {currency}
            </span>
            <button
              aria-label={hideBalance ? "Show balance" : "Hide balance"}
              className="dh-eye"
              onClick={onToggleHide}
              type="button"
            >
              {hideBalance ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {!isConnected ? (
            <p className="dh-amount">
              <span className="dh-amount-quiet">Connect a wallet</span>
            </p>
          ) : isLoading ? (
            <p className="dh-amount">
              <span className="dh-amount-skeleton" />
            </p>
          ) : (
            <BalanceWheel
              hidden={hideBalance}
              rows={[
                {
                  amount: tokens.find((token) => token.symbol === "USDC")?.amount ?? "0.00",
                  key: "USDC",
                  label: "USDC",
                  unit: "USDC",
                },
                { amount: balanceLabel, key: "all", label: "All", unit: currency },
                {
                  amount: tokens.find((token) => token.symbol === "EURC")?.amount ?? "0.00",
                  key: "EURC",
                  label: "EURC",
                  unit: "EURC",
                },
              ]}
            />
          )}

          {isConnected ? (
            <p className={cn("dh-change", `is-${trend}`)}>
              {trend === "up" ? "▲ " : trend === "down" ? "▼ " : ""}
              {hideBalance ? "••••" : changeLabel}
            </p>
          ) : null}

          {isConnected && tokens.length > 1 ? (
            <div aria-hidden className="dh-split">
              {tokens.map((token) => (
                <span data-symbol={token.symbol} key={token.symbol} style={{ flexGrow: Math.max(token.share, 0.5) }} />
              ))}
            </div>
          ) : null}

        </section>

        {/* The four everyday actions, as tiles under the card. */}
        <nav aria-label="Money actions" className="dh-actions">
          <Action href="/deposit" icon={ArrowDownToLine} label="Add money" />
          <Action href="/send" icon={Send} label="Send" />
          <Action href="/pay" icon={QrCode} label="Request" />
          {/* With the Naira ramp on, Withdraw takes Swap's place (Swap moves
              to the More sheet). */}
          {rampEntryEnabled ? (
            <Action href="/withdraw" icon={ArrowUpFromLine} label="Withdraw" />
          ) : (
            <Action href="/swap" icon={ArrowLeftRight} label="Swap" />
          )}
        </nav>

        <div className="dh-slot dh-slot-transactions">{transactions}</div>

        <div className="dh-slot dh-slot-extras">{extras}</div>
      </div>

      <aside aria-label="At a glance" className="dh-side">
        {/* Phones and wide desktops: ONE Points live here (in between, the top
            bar's points pill carries them). */}
        <PointsStrip />

        {/* Live campaigns and quests, each dismissible. */}
        <div className="dh-slot dh-slot-announcements">
          <Announcements />
        </div>

        <div className="dh-slot dh-slot-banners">{banners}</div>

        {/* This week, in two numbers */}
        <Link className="dh-week" href="/insights">
          <span className="dh-week-tile">
            <span className="dh-week-icon is-in">
              <ArrowDownLeft className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="dh-week-label">In · 7 days</span>
              <span className="dh-week-value">{hideBalance ? "••••" : moneyIn}</span>
            </span>
          </span>
          <span aria-hidden className="dh-week-rule" />
          <span className="dh-week-tile">
            <span className="dh-week-icon is-out">
              <ArrowUpRight className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="dh-week-label">Out · 7 days</span>
              <span className="dh-week-value">{hideBalance ? "••••" : moneyOut}</span>
            </span>
          </span>
        </Link>

        <div className="dh-slot dh-slot-earn">{earn}</div>

        {/* Wide desktops only: what the phone keeps in Send and More. */}
        <nav aria-label="Shortcuts" className="dh-more">
          <p className="dh-more-title">Shortcuts</p>
          <div className="dh-more-grid">
            {rampEntryEnabled ? (
              <MoreLink href="/swap" icon={ArrowLeftRight} label="Swap" />
            ) : (
              <MoreLink href="/withdraw" icon={ArrowUpFromLine} label="Withdraw" />
            )}
            <MoreLink href="/bulkpay" icon={UsersRound} label="BulkPay" />
            <MoreLink href="/recurepay" icon={CalendarClock} label="Scheduled" />
            <MoreLink href="/transactions" icon={ReceiptText} label="Transactions" />
            <MoreLink href="/insights" icon={ChartPie} label="Insights" />
            <MoreLink href="/deposit" icon={ArrowDownToLine} label="Add money" />
          </div>
        </nav>
      </aside>
    </div>
  );
}

/** How far a finger travels to roll one row. */
const wheelStep = 34;

const rememberedNameKey = "saphra.greetingName";

/**
 * The greeting name, remembered on this device so returning to the
 * dashboard shows it at once instead of a placeholder while the profile loads.
 */
function useRememberedName(name: string | null) {
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    try {
      setRemembered(window.localStorage.getItem(rememberedNameKey));
    } catch {}
  }, []);
  useEffect(() => {
    if (!name) return;
    setRemembered(name);
    try {
      window.localStorage.setItem(rememberedNameKey, name);
    } catch {}
  }, [name]);
  return name ?? remembered;
}

type WheelRow = { amount: string; key: string; label: string; unit: string };

/**
 * The balance as a wheel: All in the middle, each coin above and below,
 * blurred until chosen. Tap a row, swipe, or use the arrow keys.
 */
function BalanceWheel({ hidden, rows }: { hidden: boolean; rows: WheelRow[] }) {
  const [index, setIndex] = useState(1);
  const startY = useRef<number | null>(null);
  // A roll shouldn't also count as a tap on the row it ends over.
  const rolled = useRef(false);
  const move = (step: number) => setIndex((current) => Math.min(rows.length - 1, Math.max(0, current + step)));

  return (
    <div
      aria-label="Balance by currency"
      className="dh-wheel"
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        }
      }}
      // Hold and roll: the wheel follows the finger, one row per step.
      onPointerCancel={() => {
        startY.current = null;
      }}
      onPointerDown={(event) => {
        startY.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (startY.current === null) return;
        const delta = event.clientY - startY.current;
        if (Math.abs(delta) >= wheelStep) {
          move(delta < 0 ? 1 : -1);
          startY.current = event.clientY;
          rolled.current = true;
        }
      }}
      onPointerUp={() => {
        startY.current = null;
      }}
      role="listbox"
      tabIndex={0}
    >
      {rows.map((row, rowIndex) => {
        const offset = rowIndex - index;
        const [whole, cents] = splitAmount(row.amount);
        return (
          <button
            aria-selected={offset === 0}
            className="dh-wheel-row"
            data-offset={Math.max(-1, Math.min(1, offset))}
            hidden={Math.abs(offset) > 1}
            key={row.key}
            onClick={() => {
              if (rolled.current) {
                rolled.current = false;
                return;
              }
              setIndex(rowIndex);
            }}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <span className="dh-wheel-label">{row.label}</span>
            <span className="dh-wheel-amount">
              {hidden ? (
                "••••••"
              ) : (
                <>
                  {whole}
                  <small>{cents}</small>
                </>
              )}
              <em>{row.unit}</em>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PointsStrip() {
  const { points, usdcValue } = useOnePoints();
  return (
    <Link className="dh-points" href={rewardsV2Enabled() ? "/rewards" : "/referral"}>
      <OnePointsMark className="dh-points-mark" />
      <span className="dh-points-text">
        <span className="dh-points-value">{points.toLocaleString()} ONE Points</span>
        <span className="dh-points-sub">Worth ${usdcValue.toFixed(2)} · collect them on every payment</span>
      </span>
      <ChevronRight aria-hidden className="h-5 w-5 shrink-0 opacity-70" />
    </Link>
  );
}

function Action({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link className="dh-action" href={href}>
      <span className="dh-action-icon">
        <Icon className="h-5 w-5" />
      </span>
      {label}
    </Link>
  );
}

function MoreLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link className="dh-more-link" href={href}>
      <span className="dh-more-icon">
        <Icon className="h-[1.1rem] w-[1.1rem]" />
      </span>
      {label}
    </Link>
  );
}
