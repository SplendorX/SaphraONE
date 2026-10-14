"use client";

import {
  ArrowLeft,
  Banknote,
  Check,
  ChevronRight,
  Copy,
  CreditCard,
  HandCoins,
  Network,
  QrCode,
  Share2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { DepositPanel } from "@/components/deposit/DepositPanel";
import { OnrampPanel } from "@/components/deposit/onramp-panel";
import { ReceiveFromNetwork } from "@/components/deposit/receive-from-network";
import { ReceiveShareCard } from "@/components/dashboard/receive-share-card";
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import { arcChain } from "@/lib/chains";
import { multichainEnabled } from "@/lib/multichain/flag";
import { fetchProfile, formatUsernameLabel, profileUpdatedEventName } from "@/lib/profile";
import { useSheetSide } from "@/lib/use-media-query";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

import "./deposit.css";

type View = "home" | "chain" | "bank" | "network";

const viewTitles: Record<Exclude<View, "home">, string> = {
  bank: "Bank transfer",
  chain: multichainEnabled ? "Bridge from my wallet" : "From another chain",
  network: "Receive from another network",
};

function shortAddress(value?: string | null) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not connected";
}

/** Add money: your account to share, then every way to bring funds in. */
export function DepositHub() {
  const { address, isConnected, source } = usePlatformWallet();
  // Bridging pulls USDC from a wallet you hold elsewhere (MetaMask and the
  // like). Google and email accounts have no such wallet here, so it's hidden.
  const canBridge = source !== "embedded";
  const [view, setView] = useState<View>("home");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [copied, setCopied] = useState<"username" | "address" | null>(null);
  // Bank transfer goes live once the server has an Onramp key.
  const [onrampEnabled, setOnrampEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onramp/sessions", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { enabled?: boolean } | null) => {
        if (!cancelled) setOnrampEnabled(payload?.enabled === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!address) {
      setUsername(null);
      return;
    }
    let cancelled = false;
    async function load(wallet: string) {
      try {
        const profile = await fetchProfile(wallet);
        if (!cancelled) setUsername(profile?.username ?? null);
      } catch {
        if (!cancelled) setUsername(null);
      }
    }
    void load(address);
    // Keep the card in step if the handle changes in settings.
    function handleProfileUpdated() {
      if (address) void load(address);
    }
    window.addEventListener(profileUpdatedEventName, handleProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(profileUpdatedEventName, handleProfileUpdated);
    };
  }, [address]);

  async function copy(value: string, field: "username" | "address") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      window.setTimeout(() => setCopied((current) => (current === field ? null : current)), 1400);
    } catch {
      setCopied(null);
    }
  }

  async function share() {
    if (!address) return;
    const text = username
      ? `Pay me on SaphraONE: ${formatUsernameLabel(username)} (or my ${arcChain.name} wallet ${address})`
      : `My ${arcChain.name} wallet: ${address}`;
    try {
      if (navigator.share) {
        await navigator.share({ text, title: "My SaphraONE account" });
      } else {
        await copy(username ? formatUsernameLabel(username) : address, username ? "username" : "address");
      }
    } catch {
      // Sharing was dismissed.
    }
  }

  if (view !== "home") {
    return (
      <div className="dep-page">
        <header className="dep-bar">
          <button aria-label="Back" className="dep-round" onClick={() => setView("home")} type="button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="dep-title">{viewTitles[view]}</h1>
          <span />
        </header>
        <div className="dep-panel">
          {view === "chain" ? <DepositPanel /> : view === "network" ? <ReceiveFromNetwork /> : <OnrampPanel />}
        </div>
      </div>
    );
  }

  return (
    <div className="dep-page">
      <header className="dep-bar">
        <Link aria-label="Back to the dashboard" className="dep-round" href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="dep-title">Add money</h1>
        <span />
      </header>

      {/* Your account, ready to share */}
      <section className="dep-hero">
        <span aria-hidden className="dep-hero-glow" />
        <p className="dep-hero-label">Your SaphraONE account</p>
        {isConnected && address ? (
          <>
            <p className="dep-hero-name">{username ? formatUsernameLabel(username) : shortAddress(address)}</p>
            <p className="dep-hero-wallet">
              <Wallet className="h-3.5 w-3.5" />
              {shortAddress(address)} · {arcChain.name}
            </p>
            <div className="dep-hero-actions">
              {username ? (
                <HeroAction
                  icon={copied === "username" ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                  label={copied === "username" ? "Copied" : "ONE ID"}
                  onClick={() => void copy(formatUsernameLabel(username), "username")}
                />
              ) : null}
              <HeroAction
                icon={copied === "address" ? <Check className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                label={copied === "address" ? "Copied" : "Address"}
                onClick={() => void copy(address, "address")}
              />
              <HeroAction icon={<QrCode className="h-5 w-5" />} label="QR code" onClick={() => setReceiveOpen(true)} />
              <HeroAction icon={<Share2 className="h-5 w-5" />} label="Share" onClick={() => void share()} />
            </div>
          </>
        ) : (
          <p className="dep-hero-sub">Connect a wallet to get your account details.</p>
        )}
      </section>

      <section className="dep-section">
        <h2 className="dep-section-title">Ways to add money</h2>
        <div className="dep-card">
          <ul className="dep-list">
            <li>
              <MethodRow
                body="Anyone on SaphraONE pays your ONE ID; any Arc wallet can send to your address."
                icon={<HandCoins className="h-5 w-5" />}
                onClick={() => setReceiveOpen(true)}
                title="Receive from anyone"
              />
            </li>
            {multichainEnabled ? (
              <li>
                <MethodRow
                  body="Get an address on Base, Polygon, Arbitrum and more. USDC sent there lands in your balance by itself."
                  icon={<Network className="h-5 w-5" />}
                  onClick={() => setNetworkOpen(true)}
                  title="Receive from another network"
                />
              </li>
            ) : null}
            {canBridge ? (
              <li>
                <MethodRow
                  body={
                    multichainEnabled
                      ? "Move USDC you hold in MetaMask or another wallet over Circle CCTP."
                      : "Bring USDC from Ethereum, Base and other networks over Circle CCTP."
                  }
                  icon={<Wallet className="h-5 w-5" />}
                  onClick={() => setView("chain")}
                  title={multichainEnabled ? "Bridge from my wallet" : "From another chain"}
                />
              </li>
            ) : null}
            <li>
              <MethodRow
                body="Buy USDC from your bank (US and supported European countries)."
                icon={<Banknote className="h-5 w-5" />}
                onClick={onrampEnabled ? () => setView("bank") : undefined}
                soon={!onrampEnabled}
                title="Bank transfer"
              />
            </li>
            <li>
              <MethodRow
                body="Top up with a debit or credit card."
                icon={<CreditCard className="h-5 w-5" />}
                soon
                title="Card"
              />
            </li>
          </ul>
        </div>
        <p className="dep-note">
          Money arrives as USDC or EURC on {arcChain.name} and is ready to send, save or swap straight away.
        </p>
      </section>

      <ReceiveSheet onClose={() => setReceiveOpen(false)} open={receiveOpen}>
        <ReceiveShareCard isConnected={isConnected} username={username} walletAddress={address ?? ""} />
      </ReceiveSheet>

      <ReceiveSheet
        description="Pick a network. USDC sent to its address lands in your balance by itself."
        onClose={() => setNetworkOpen(false)}
        open={networkOpen}
        title="Receive from another network"
      >
        {networkOpen ? <ReceiveFromNetwork /> : null}
      </ReceiveSheet>
    </div>
  );
}

function HeroAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="dep-hero-action" onClick={onClick} type="button">
      <span>{icon}</span>
      {label}
    </button>
  );
}

function MethodRow({
  body,
  icon,
  onClick,
  soon = false,
  title,
}: {
  body: string;
  icon: ReactNode;
  onClick?: () => void;
  soon?: boolean;
  title: string;
}) {
  return (
    <button className={cn("dep-row", soon && "is-soon")} disabled={soon || !onClick} onClick={onClick} type="button">
      <span className="dep-row-icon">{icon}</span>
      <span className="dep-row-main">
        <span className="dep-row-title">
          {title}
          {soon ? <em className="dep-soon">Soon</em> : null}
        </span>
        <span className="dep-row-sub">{body}</span>
      </span>
      {soon ? null : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </button>
  );
}

function ReceiveSheet({
  children,
  description = "Share your QR code, ONE ID or address.",
  onClose,
  open,
  title = "Receive USDC",
}: {
  children: ReactNode;
  description?: string;
  onClose: () => void;
  open: boolean;
  title?: string;
}) {
  const side = useSheetSide();
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className={cn("gap-0 p-0", side === "bottom" ? "max-h-[92dvh] rounded-t-[1.75rem] border-t-0" : "w-full sm:max-w-md")}
        showCloseButton={false}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        <div className="dep-sheet">
          <SheetTitle className="text-center text-xl font-bold">{title}</SheetTitle>
          <SheetDescription className="text-center text-sm text-muted-foreground">{description}</SheetDescription>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
