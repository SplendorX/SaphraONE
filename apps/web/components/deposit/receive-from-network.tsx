"use client";

import { AlertTriangle, CheckCircle2, ChevronRight, Copy, Loader2, RefreshCw, Share2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { IncomingDeposits } from "@/components/deposit/incoming-deposits";
import { LazyQRCodeSVG } from "@/components/lazy-qr-code";
import { NetworkPicker } from "@/components/send/network-picker";
import { arcChain } from "@/lib/chains";
import {
  fetchMultichainOverview,
  refreshIncomingDeposits,
  requestDepositAddress,
  type MultichainOverview,
} from "@/lib/multichain/client";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

import "./multichain.css";
import "@/components/dashboard/receive-share-card.css";

/** How often an open receive screen checks for arrivals. */
const POLL_MS = 20_000;

/**
 * Receive USDC sent on another network. Each network has its own address; what
 * lands there moves to the Arc balance by itself.
 */
export function ReceiveFromNetwork() {
  const { address: ownerWallet } = usePlatformWallet();
  const [overview, setOverview] = useState<MultichainOverview | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState<"address" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkingRef = useRef(false);

  useEffect(() => {
    if (!ownerWallet) return;
    let cancelled = false;
    fetchMultichainOverview(ownerWallet)
      .then((next) => {
        if (cancelled) return;
        setOverview(next);
        setNetwork((current) => current ?? next.chains[0]?.key ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load networks.");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerWallet]);

  const chain = overview?.chains.find((entry) => entry.key === network) ?? null;
  const address = overview?.addresses.find((entry) => entry.network === network)?.address ?? null;
  const minByNetwork = useMemo(
    () => Object.fromEntries((overview?.chains ?? []).map((entry) => [entry.key, entry.minDeposit])),
    [overview],
  );

  // First visit to a network creates its address.
  useEffect(() => {
    if (!ownerWallet || !overview?.enabled || !network || address || creating) return;
    let cancelled = false;
    setCreating(true);
    setError(null);
    requestDepositAddress(ownerWallet, network)
      .then((created) => {
        if (cancelled) return;
        setOverview((current) =>
          current
            ? {
                ...current,
                addresses: [
                  ...current.addresses.filter((entry) => entry.network !== created.network),
                  { address: created.address, network: created.network },
                ],
              }
            : current,
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not create the address.");
      })
      .finally(() => {
        if (!cancelled) setCreating(false);
      });
    return () => {
      cancelled = true;
    };
    // `creating` is left out on purpose: it is set here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerWallet, overview?.enabled, network, address]);

  const checkNow = useCallback(async () => {
    if (!ownerWallet || checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      setOverview(await refreshIncomingDeposits(ownerWallet));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check for deposits.");
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [ownerWallet]);

  // While the screen is open and visible, look for arrivals on a timer.
  const hasAddresses = (overview?.addresses.length ?? 0) > 0;
  useEffect(() => {
    if (!overview?.enabled || !hasAddresses) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkNow();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [overview?.enabled, hasAddresses, checkNow]);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied("address");
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied(null);
    }
  }

  /** The phone's share sheet when there is one; otherwise copy the details. */
  async function shareDetails() {
    if (!address || !chain) return;
    const text = [
      `Send USDC on ${chain.name} only`,
      `Address: ${address}`,
      `Minimum: ${chain.minDeposit} USDC`,
    ].join("\n");
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, title: `My ${chain.name} USDC address` });
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied("share");
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied(null);
    }
  }

  if (!ownerWallet) {
    return <p className="mc-note">Sign in to get your deposit addresses.</p>;
  }

  if (overview && !overview.enabled) {
    return <p className="mc-note">Receiving from other networks is not available on this account yet.</p>;
  }

  return (
    <div className="rx">
      <button
        aria-label={copied === "address" ? "Address copied" : "Copy address"}
        className="rx-board"
        disabled={!address}
        onClick={() => void copyAddress()}
        type="button"
      >
        <span aria-hidden className="rx-board-sheen" />
        <span className="rx-qr">
          {address && chain ? (
            <LazyQRCodeSVG
              bgColor="transparent"
              fgColor="#f5f5f7"
              level="H"
              marginSize={0}
              size={232}
              title={`${chain.name} deposit address`}
              value={address}
            />
          ) : (
            <span className="rx-board-hint">
              <Loader2 className="h-5 w-5 animate-spin" />
              {overview ? `Creating your ${chain?.name ?? ""} address…` : "Loading networks…"}
            </span>
          )}
          {address && chain ? (
            <span aria-hidden className="rx-qr-badge">
              <img alt="" className="rx-qr-token" height={28} src={`/networks/${chain.key}.png`} width={28} />
            </span>
          ) : null}
        </span>
        {address ? (
          <span className="rx-board-hint">
            {copied === "address" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" /> Address copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Tap to copy address
              </>
            )}
          </span>
        ) : null}
      </button>

      <div className="rx-network-picker">
        <NetworkPicker
          chains={overview?.chains ?? []}
          description="Each network has its own address. What lands there moves to your balance by itself."
          detail={(entry) => `Min ${entry.minDeposit} USDC · ${entry.typicalWait}`}
          onChange={(entry) => {
            setNetwork(entry.key);
            setError(null);
          }}
          value={chain}
        />
      </div>

      {address && chain ? (
        <>
          <div className="rx-tile">
            <span className="rx-tile-main">
              <span className="rx-label">Receive address · {chain.name}</span>
              <span className="rx-value rx-address">{address}</span>
            </span>
            <button
              aria-label={copied === "address" ? "Address copied" : "Copy address"}
              className="rx-copy"
              onClick={() => void copyAddress()}
              type="button"
            >
              {copied === "address" ? <CheckCircle2 className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            </button>
          </div>

          <div className="rx-tile">
            <span className="rx-label-strong">Minimum</span>
            <span className="rx-value-strong">{chain.minDeposit} USDC</span>
          </div>

          {chain.depositFee ? (
            <div className="rx-tile">
              <span className="rx-label-strong">
                Deposit fee
                {chain.key === "ethereum" ? <span className="rx-label-note">Follows Ethereum&apos;s gas price</span> : null}
              </span>
              <span className="rx-value-strong">{Number(chain.depositFee).toFixed(2)} USDC</span>
            </div>
          ) : null}

          <div className="rx-tile">
            <span className="rx-label-strong">Arrives in {arcChain.name}</span>
            <span className="rx-value-strong">{chain.typicalWait}</span>
          </div>

          <p className="rx-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Send <strong>USDC on {chain.name} only</strong>. Other tokens or networks aren&apos;t credited. Smaller
              amounts wait until they reach the minimum.{" "}
              {chain.depositFee
                ? `The ${Number(chain.depositFee).toFixed(2)} USDC deposit fee and Circle's network fee (about 2 cents) come off the amount.`
                : "Circle's fee (about 2 cents) comes off the amount."}
            </span>
          </p>
        </>
      ) : null}

      {error ? <p className="mc-error">{error}</p> : null}

      <div className="mc-arriving-head">
        <h2 className="dep-section-title">Incoming</h2>
        <button className="mc-check" disabled={checking || !hasAddresses} onClick={() => void checkNow()} type="button">
          <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
          Check now
        </button>
      </div>
      {overview && overview.deposits.length > 0 ? (
        <IncomingDeposits deposits={overview.deposits} minDepositByNetwork={minByNetwork} />
      ) : (
        <p className="mc-note">Nothing yet. Transfers show here as soon as their network sees them.</p>
      )}

      <Link className="rx-tile rx-tile-link" href="/support">
        <span className="rx-label-strong">I need help</span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>

      <button className="rx-share" disabled={!address} onClick={() => void shareDetails()} type="button">
        {copied === "share" ? <CheckCircle2 className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        {copied === "share" ? "Details copied" : "Share details"}
      </button>
    </div>
  );
}
