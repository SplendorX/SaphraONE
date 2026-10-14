"use client";

import { CheckCircle2, ChevronRight, Copy, QrCode, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useOptionalAccount } from "@/components/account/account-provider";
import { LazyQRCodeSVG } from "@/components/lazy-qr-code";
import { TokenIcon } from "@/components/token-icon";
import { svgToPngBlob } from "@/lib/qr-image";
import { formatUsernameLabel } from "@/lib/profile";
import { buildPaymentRequestUrl } from "@/lib/payment-request-url";
import { arcChain } from "@/lib/chains";
import { checkoutEnabled } from "@/lib/checkout/flag";

import "./receive-share-card.css";

type CopiedField = "address" | "username" | "qr" | "share";

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

/**
 * Receive: a bold QR card (white code on the logo-gradient board, the tokens in
 * the middle), then the username and address to copy, the network, help, and
 * one button that shares everything.
 */
export function ReceiveShareCard({
  isConnected,
  username,
  walletAddress,
}: {
  isConnected: boolean;
  username?: string | null;
  walletAddress: string;
}) {
  // A plain black-on-white copy of the code, kept off screen: it is what
  // "Copy QR" puts on the clipboard, since the visible one is white on the gradient.
  const printableQrRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<CopiedField | null>(null);
  // Storefront pages exist for Business accounts only.
  const isBusiness = Boolean(useOptionalAccount()?.isBusiness);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const receiveUrl = useMemo(() => {
    if (!origin || !isConnected) {
      return "";
    }

    // With Checkout on, a scan opens a pay page for the payer (any wallet
    // or SaphraONE) rather than the signed-in Request screen.
    if (checkoutEnabled && isBusiness && username) {
      return `${origin}/p/${encodeURIComponent(username)}`;
    }

    return buildPaymentRequestUrl({
      chainId: arcChain.id,
      origin,
      path: "/pay",
      username: username || undefined,
      walletAddress: username ? undefined : walletAddress,
    });
  }, [isBusiness, isConnected, origin, username, walletAddress]);

  const qrValue =
    receiveUrl ||
    (isConnected ? `ethereum:${walletAddress}@${arcChain.id}` : "");

  async function markCopied(field: CopiedField) {
    setCopied(field);
    window.setTimeout(() => {
      setCopied((current) => (current === field ? null : current));
    }, 1400);
  }

  async function copy(field: CopiedField, value: string) {
    try {
      await copyText(value);
      await markCopied(field);
    } catch {
      setCopied(null);
    }
  }

  async function handleCopyQr() {
    if (!qrValue) return;

    try {
      const svg = printableQrRef.current?.querySelector("svg");
      if (svg && typeof ClipboardItem !== "undefined") {
        const blob = await svgToPngBlob(svg);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        await markCopied("qr");
        return;
      }
    } catch {
      // Fall back to the receive link.
    }
    await copy("qr", qrValue);
  }

  /** The phone's share sheet when there is one; otherwise copy the details. */
  async function handleShare() {
    const lines = [
      "Pay me on SaphraONE (USDC or EURC on Arc)",
      username ? `Username: ${formatUsernameLabel(username)}` : null,
      `Address: ${walletAddress}`,
      receiveUrl ? receiveUrl : null,
    ].filter(Boolean);
    const text = lines.join("\n");

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, title: "Pay me on SaphraONE" });
        return;
      } catch (error) {
        // Dismissing the share sheet is not a failure worth a fallback.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy("share", text);
  }

  if (!isConnected) {
    return (
      <p className="rx-empty">
        Connect a wallet to see your receive QR, username and address.
      </p>
    );
  }

  return (
    <div className="rx">
      <button
        aria-label={copied === "qr" ? "QR code copied" : "Copy QR code"}
        className="rx-board"
        onClick={() => void handleCopyQr()}
        type="button"
      >
        <span aria-hidden className="rx-board-sheen" />
        <span className="rx-qr">
          {qrValue ? (
            <LazyQRCodeSVG
              bgColor="transparent"
              fgColor="#f5f5f7"
              level="H"
              marginSize={0}
              size={232}
              title="SaphraONE receive QR"
              value={qrValue}
            />
          ) : (
            <QrCode className="h-10 w-10 text-white/60" />
          )}
          <span aria-hidden className="rx-qr-badge">
            <TokenIcon className="rx-qr-token" symbol="USDC" />
            <TokenIcon className="rx-qr-token" symbol="EURC" />
          </span>
        </span>
        <span className="rx-board-hint">
          {copied === "qr" ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" /> QR copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Tap to copy QR
            </>
          )}
        </span>
      </button>

      <div aria-hidden className="rx-printable" ref={printableQrRef}>
        {qrValue ? (
          <LazyQRCodeSVG bgColor="#ffffff" fgColor="#160f24" level="H" marginSize={2} size={512} value={qrValue} />
        ) : null}
      </div>

      <p className="rx-network">
        <span className="rx-network-icons" aria-hidden>
          <TokenIcon className="rx-network-token" symbol="USDC" />
          <TokenIcon className="rx-network-token" symbol="EURC" />
        </span>
        USDC · EURC on {arcChain.name}
      </p>

      {username ? (
        <div className="rx-tile">
          <span className="rx-tile-main">
            <span className="rx-label">ONE ID</span>
            <span className="rx-value">{formatUsernameLabel(username)}</span>
          </span>
          <button
            aria-label={copied === "username" ? "ONE ID copied" : "Copy ONE ID"}
            className="rx-copy"
            onClick={() => void copy("username", formatUsernameLabel(username))}
            type="button"
          >
            {copied === "username" ? <CheckCircle2 className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
          </button>
        </div>
      ) : (
        <Link className="rx-tile rx-tile-link" href="/settings">
          <span className="rx-tile-main">
            <span className="rx-label">ONE ID</span>
            <span className="rx-value">Claim your ONE ID so people can pay you by name</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        </Link>
      )}

      <div className="rx-tile">
        <span className="rx-tile-main">
          <span className="rx-label">Receive address</span>
          <span className="rx-value rx-address">{walletAddress}</span>
        </span>
        <button
          aria-label={copied === "address" ? "Address copied" : "Copy address"}
          className="rx-copy"
          onClick={() => void copy("address", walletAddress)}
          type="button"
        >
          {copied === "address" ? <CheckCircle2 className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
        </button>
      </div>

      <div className="rx-tile">
        <span className="rx-label-strong">Network</span>
        <span className="rx-value-strong">{arcChain.name}</span>
      </div>

      <Link className="rx-tile rx-tile-link" href="/support">
        <span className="rx-label-strong">I need help</span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </Link>

      <button className="rx-share" onClick={() => void handleShare()} type="button">
        {copied === "share" ? <CheckCircle2 className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        {copied === "share" ? "Details copied" : "Share details"}
      </button>
    </div>
  );
}
