"use client";

import { ArrowDownLeft, ArrowUpRight, Check, Fingerprint, Lock, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";

import { OnePointsMark } from "@/components/brand/one-points-mark";
import { TokenIcon } from "@/components/token-icon";
import { cn } from "@/lib/utils";

/**
 * The animated scenes on the sign-in and onboarding panels: illustrated
 * people and small pieces of the real product, floating on the brand
 * gradient. Decorative; screen readers skip them.
 */

type PersonLook = { skin: string; hair: string; shirt: string; style: "short" | "long" | "bun" | "curly" };

const people: Record<string, PersonLook> = {
  ada: { hair: "#1f1410", shirt: "#f5c842", skin: "#8d5a3b", style: "curly" },
  kenji: { hair: "#15151d", shirt: "#6ee7a0", skin: "#e8b98f", style: "short" },
  maya: { hair: "#6b3a1f", shirt: "#ff8fab", skin: "#c68a5e", style: "long" },
  tunde: { hair: "#0f0b0a", shirt: "#7dd3fc", skin: "#5c3a24", style: "short" },
  zara: { hair: "#2b1b14", shirt: "#c4b5fd", skin: "#a8714a", style: "bun" },
};

/** A friendly illustrated person, head and shoulders. */
export function Person({ name, className }: { name: keyof typeof people; className?: string }) {
  const look = people[name];
  return (
    <svg aria-hidden className={cn("av-person", className)} viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="32" fill="rgb(255 255 255 / 0.18)" />
      <clipPath id={`clip-${name}`}>
        <circle cx="32" cy="32" r="32" />
      </clipPath>
      <g clipPath={`url(#clip-${name})`}>
        <path d="M10 64c2-13 11-19 22-19s20 6 22 19z" fill={look.shirt} />
        <rect fill={look.skin} height="9" rx="4" width="10" x="27" y="38" />
        {look.style === "long" ? <path d="M17 30c0-12 7-19 15-19s15 7 15 19v14H17z" fill={look.hair} /> : null}
        <ellipse cx="32" cy="29" fill={look.skin} rx="11" ry="12.5" />
        {look.style === "short" ? <path d="M21 26c0-8 5-12 11-12s11 4 11 12c-3-4-7-6-11-6s-8 2-11 6z" fill={look.hair} /> : null}
        {look.style === "curly" ? (
          <g fill={look.hair}>
            <circle cx="22" cy="21" r="5" />
            <circle cx="28" cy="16" r="5.5" />
            <circle cx="36" cy="16" r="5.5" />
            <circle cx="42" cy="21" r="5" />
            <circle cx="20" cy="27" r="3.5" />
            <circle cx="44" cy="27" r="3.5" />
          </g>
        ) : null}
        {look.style === "long" ? <path d="M21 25c1-7 6-10 11-10s10 3 11 10c-4-3-7-4-11-4s-7 1-11 4z" fill={look.hair} /> : null}
        {look.style === "bun" ? (
          <g fill={look.hair}>
            <circle cx="32" cy="11" r="5" />
            <path d="M21 26c0-8 5-11 11-11s11 3 11 11c-3-3-7-5-11-5s-8 2-11 5z" />
          </g>
        ) : null}
        <circle cx="28" cy="30" fill="#1b1220" r="1.2" />
        <circle cx="36" cy="30" fill="#1b1220" r="1.2" />
        <path d="M28.5 35c2 1.6 5 1.6 7 0" fill="none" stroke="#1b1220" strokeLinecap="round" strokeWidth="1.3" />
      </g>
    </svg>
  );
}

function Allie({ className }: { className?: string }) {
  return <img alt="" className={cn("av-allie", className)} height={96} src="/brand/allie-avatar-256.webp" width={96} />;
}

/** Slide: send money to a person; it lands in seconds. */
export function SendScene() {
  return (
    <div aria-hidden className="av-scene">
      <div className="av-card av-balance av-float">
        <span className="av-card-label">Balance</span>
        <span className="av-balance-value">2,450.00</span>
        <span className="av-balance-unit">
          <TokenIcon className="h-4 w-4" symbol="USDC" /> USDC on Arc
        </span>
        <span className="av-row">
          <span className="av-chip">
            <ArrowUpRight className="h-3 w-3" /> Send
          </span>
          <span className="av-chip">
            <ArrowDownLeft className="h-3 w-3" /> Receive
          </span>
        </span>
      </div>

      <div className="av-card av-toast av-float-slow">
        <span className="av-check">
          <Check className="h-4 w-4" />
        </span>
        <span className="av-toast-text">
          <strong>50 USDC sent to @ada</strong>
          <small>Settled on Arc · 0.8s</small>
        </span>
      </div>

      <div className="av-people av-float-late">
        <Person name="ada" />
        <Person name="tunde" />
        <Person name="maya" />
        <Person name="kenji" />
        <span className="av-people-more">+ friends worldwide</span>
      </div>
    </div>
  );
}

/** Slide: ALLIE does the busywork, nothing moves without a yes. */
export function AllieScene() {
  return (
    <div aria-hidden className="av-scene">
      <div className="av-chat av-float">
        <div className="av-bubble av-bubble-me">Pay Ada 20 USDC for dinner 🍲</div>
        <div className="av-allie-row">
          <Allie />
          <div className="av-card av-confirm">
            <span className="av-confirm-name">Allie</span>
            <span className="av-confirm-line">
              Send to @ada <strong>20 USDC</strong>
            </span>
            <span className="av-confirm-actions">
              <span className="av-btn-primary">Confirm</span>
              <span className="av-btn-soft">Edit</span>
            </span>
          </div>
        </div>
        <div className="av-bubble av-bubble-allie av-typing-in">
          <small>Allie:</small> Done. 20 USDC sent to @ada.
        </div>
      </div>
      <div className="av-sparkle av-float-slow">
        <Sparkles className="h-5 w-5" />
      </div>
    </div>
  );
}

/** Slide: grow, save and earn rewards. */
export function GrowScene() {
  return (
    <div aria-hidden className="av-scene">
      <div className="av-card av-invest av-float">
        <span className="av-card-label">
          <TrendingUp className="h-3.5 w-3.5" /> Invest
        </span>
        <svg className="av-spark" viewBox="0 0 160 48">
          <defs>
            <linearGradient id="av-spark-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#6ee7a0" stopOpacity="0.5" />
              <stop offset="1" stopColor="#6ee7a0" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 40 C20 38 30 30 50 31 S80 22 100 20 S135 8 160 6 L160 48 L0 48Z" fill="url(#av-spark-fill)" />
          <path className="av-spark-line" d="M0 40 C20 38 30 30 50 31 S80 22 100 20 S135 8 160 6" fill="none" stroke="#6ee7a0" strokeWidth="3" />
        </svg>
        <span className="av-invest-foot">Idle USDC, working for you</span>
      </div>

      <div className="av-card av-pocket av-float-slow">
        <span className="av-card-label">Rent fund</span>
        <span className="av-progress">
          <span style={{ width: "68%" }} />
        </span>
        <span className="av-pocket-foot">680 of 1,000 USDC</span>
      </div>

      <div className="av-card av-points av-float-late">
        <OnePointsMark className="h-7 w-7" />
        <span>
          <strong>+12 ONE Points</strong>
          <small>for this week&apos;s payments</small>
        </span>
      </div>
      <Person className="av-corner-person" name="zara" />
    </div>
  );
}

/** Onboarding: language. */
export function WorldScene() {
  const hellos = ["Hello", "Bawo", "Hola", "Bonjour", "Hallo", "Olá", "مرحبا", "你好", "こんにちは", "안녕하세요"];
  return (
    <div aria-hidden className="av-scene">
      <div className="av-globe av-float">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" fill="rgb(255 255 255 / 0.12)" r="56" stroke="rgb(255 255 255 / 0.5)" strokeWidth="1.5" />
          <ellipse cx="60" cy="60" fill="none" rx="24" ry="56" stroke="rgb(255 255 255 / 0.35)" strokeWidth="1.5" />
          <path d="M6 60h108M14 32h92M14 88h92" stroke="rgb(255 255 255 / 0.35)" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="av-hellos">
        {hellos.map((hello, index) => (
          <span className="av-hello" key={hello} style={{ animationDelay: `${index * 0.45}s` }}>
            {hello}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Onboarding: personal or business, with a live preview of the profile card. */
export function ProfileScene({
  businessName,
  displayName,
  kind,
  logoUrl,
  username,
}: {
  businessName?: string;
  displayName?: string;
  kind: "personal" | "business" | "choose";
  logoUrl?: string | null;
  username?: string;
}) {
  const handle = username?.trim() ? `@${username.trim().replace(/^@+/, "").toLowerCase()}` : "@yourname";
  const name = (kind === "business" ? businessName : displayName)?.trim() || (kind === "business" ? "Your business" : "Your name");
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div aria-hidden className="av-scene">
      <div className="av-card av-profile av-float">
        <span className="av-profile-head">
          {logoUrl ? (
            <img alt="" className="av-profile-avatar" src={logoUrl} />
          ) : kind === "personal" ? (
            <Person className="av-profile-avatar" name="maya" />
          ) : (
            <span className="av-profile-avatar av-profile-initials">{initials || "S1"}</span>
          )}
          <span>
            <strong>{name}</strong>
            <small>{handle}</small>
          </span>
          {kind === "business" ? <span className="av-badge">Business</span> : null}
        </span>
        <span className="av-profile-pay">
          Pay {handle} <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </div>
      {kind !== "personal" ? (
        <div className="av-card av-toast av-float-slow">
          <span className="av-check">
            <Check className="h-4 w-4" />
          </span>
          <span className="av-toast-text">
            <strong>Invoice INV-0012 paid</strong>
            <small>1,200 USDC · from @acme</small>
          </span>
        </div>
      ) : (
        <div className="av-people av-float-slow">
          <Person name="tunde" />
          <Person name="ada" />
          <span className="av-people-more">people pay you by name</span>
        </div>
      )}
    </div>
  );
}

/** Onboarding: app lock. */
export function SecurityScene() {
  return (
    <div aria-hidden className="av-scene">
      <div className="av-card av-lock av-float">
        <span className="av-lock-ring">
          <Fingerprint className="h-9 w-9" />
        </span>
        <strong>Welcome back</strong>
        <span className="av-pin">
          {[0, 1, 2, 3, 4, 5].map((dot) => (
            <i key={dot} style={{ animationDelay: `${dot * 0.25}s` }} />
          ))}
        </span>
      </div>
      <div className="av-card av-shield av-float-slow">
        <ShieldCheck className="h-5 w-5" />
        <span>
          <strong>Only you can open it</strong>
          <small>PIN, Face ID or fingerprint</small>
        </span>
      </div>
      <div className="av-sparkle av-float-late">
        <Lock className="h-5 w-5" />
      </div>
    </div>
  );
}
