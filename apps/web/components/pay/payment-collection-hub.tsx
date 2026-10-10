"use client";

import { motion } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  History,
  Link2,
  Lock,
  MessageSquareText,
  QrCode,
  Send,
  Share2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";

import { LazyQRCodeSVG } from "@/components/lazy-qr-code";
import { UsernameField } from "@/components/username-field";
import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import {
  fetchPaymentRequestStatus,
} from "@/lib/payment-request-client";
import { buildPaymentRequestUrl, readPaymentRequestIdFromLink } from "@/lib/payment-request-url";
import { fetchProfile, formatUsernameLabel } from "@/lib/profile";
import { normalizeUsername, validateUsername } from "@/lib/profile-utils";
import {
  readRequestUsernameHistory,
  rememberRequestedUsername,
} from "@/lib/request-username-history";
import { arcTokenSymbols, type ArcTokenSymbol } from "@/lib/tokens";
import { arcNetworkTarget } from "@/lib/network";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { arcChain } from "@/lib/chains";
import { useSheetSide } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

import "./request.css";

// Saved requests are kept per network and per signed-in wallet, so one
// account never sees another's, and testnet requests stay off mainnet.
function requestsStorageKey(owner: string) {
  return `saphra.payment.requests.v2:${arcNetworkTarget()}:${owner.toLowerCase()}`;
}

type RequestHistoryStatus = "active" | "expired" | "paid" | "declined";

type SavedRequest = {
  amount: string;
  createdAt: string;
  expiresInHours: number;
  id: string;
  link: string;
  note: string;
  requestId?: string;
  sentToUsername?: string;
  status: RequestHistoryStatus;
  token: ArcTokenSymbol;
  username?: string;
  wallet: string;
};

function isRequestExpired(request: SavedRequest) {
  const created = Date.parse(request.createdAt);
  if (!Number.isFinite(created)) {
    return request.status === "expired";
  }
  const hours = Number(request.expiresInHours);
  const ttlMs = (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000;
  return Date.now() >= created + ttlMs;
}

function deriveLocalRequestStatus(request: SavedRequest): RequestHistoryStatus {
  if (request.status === "paid" || request.status === "declined") {
    return request.status;
  }
  if (isRequestExpired(request)) {
    return "expired";
  }
  return "active";
}

function normalizeSavedRequest(request: SavedRequest): SavedRequest {
  const requestId =
    request.requestId ?? readPaymentRequestIdFromLink(request.link) ?? undefined;
  return {
    ...request,
    requestId,
    status: deriveLocalRequestStatus({ ...request, requestId }),
  };
}

type PaymentCollectionHubProps = {
  initialAmount: string;
  initialNote: string;
  initialToken: ArcTokenSymbol;
  initialUsername?: string;
  initialWalletAddress: string;
};

function isPositiveAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function shortenWallet(value: string) {
  if (!isAddress(value)) {
    return value;
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function requestHistoryKey(request: Pick<SavedRequest, "id" | "requestId">) {
  return request.requestId || request.id;
}

function requestContentKey(request: SavedRequest) {
  return [
    request.wallet.trim().toLowerCase(),
    request.token,
    request.amount.trim(),
    request.note.trim(),
    (request.sentToUsername ?? "").trim().toLowerCase(),
  ].join("|");
}

function requestRank(request: SavedRequest) {
  const created = Date.parse(request.createdAt);
  const statusScore =
    request.status === "paid"
      ? 3
      : request.status === "declined"
        ? 2
        : request.status === "active"
          ? 1
          : 0;
  const sentScore = request.sentToUsername ? 1 : 0;

  return (
    (Number.isFinite(created) ? created : 0) +
    statusScore * 1_000_000_000_000 +
    sentScore * 100_000_000_000
  );
}

function dedupeSavedRequests(requests: SavedRequest[]) {
  const byId = new Map<string, SavedRequest>();

  for (const request of requests) {
    const key = requestHistoryKey(request);
    if (!key) {
      continue;
    }

    const existing = byId.get(key);
    if (!existing || requestRank(request) >= requestRank(existing)) {
      byId.set(key, request);
    }
  }

  const byContent = new Map<string, SavedRequest>();

  for (const request of byId.values()) {
    const contentKey = request.sentToUsername
      ? `sent:${requestContentKey(request)}`
      : `draft:${request.wallet.trim().toLowerCase()}:${request.token}`;
    const existing = byContent.get(contentKey);
    if (!existing || requestRank(request) >= requestRank(existing)) {
      byContent.set(contentKey, request);
    }
  }

  return Array.from(byContent.values()).sort(
    (left, right) => requestRank(right) - requestRank(left),
  );
}

function readSavedRequests(owner: string | null): SavedRequest[] {
  if (typeof window === "undefined" || !owner) return [];
  try {
    const raw = window.localStorage.getItem(requestsStorageKey(owner));
    const parsed = raw ? (JSON.parse(raw) as SavedRequest[]) : [];
    return dedupeSavedRequests(parsed.map(normalizeSavedRequest));
  } catch {
    return [];
  }
}

function writeSavedRequests(owner: string | null, requests: SavedRequest[]) {
  if (!owner) return;
  window.localStorage.setItem(
    requestsStorageKey(owner),
    JSON.stringify(dedupeSavedRequests(requests)),
  );
}

export function PaymentCollectionHub({
  initialAmount,
  initialNote,
  initialToken,
  initialUsername = "",
  initialWalletAddress,
}: PaymentCollectionHubProps) {
  const { address: connectedWallet, isConnected, source } = usePlatformWallet();
  const historyOwner = connectedWallet?.toLowerCase() ?? null;
  const [origin, setOrigin] = useState("");
  const [requesterUsername, setRequesterUsername] = useState<string | null>(
    null,
  );
  const prefilledUsername = normalizeUsername(
    initialUsername ||
      (initialWalletAddress && !isAddress(initialWalletAddress)
        ? initialWalletAddress
        : ""),
  );
  const [shareUsername, setShareUsername] = useState(prefilledUsername);
  const [usernameHistory, setUsernameHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [amount, setAmount] = useState(initialAmount);
  const [note, setNote] = useState(initialNote);
  const [token, setToken] = useState<ArcTokenSymbol>(initialToken);
  const [expiresInHours, setExpiresInHours] = useState("24");
  const [copied, setCopied] = useState<"address" | "link" | null>(null);
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
  const [requestId, setRequestId] = useState("");
  // Whether the @username above is a real SaphraONE account.
  const [shareResolved, setShareResolved] = useState(false);

  const trimmedWalletAddress = connectedWallet ?? "";
  const trimmedAmount = amount.trim();
  const trimmedNote = note.trim();
  const isWalletValid = Boolean(
    trimmedWalletAddress && isAddress(trimmedWalletAddress),
  );
  const isAmountValid = isPositiveAmount(trimmedAmount);
  const normalizedShareUsername = normalizeUsername(shareUsername);
  const shareUsernameError = normalizedShareUsername
    ? validateUsername(normalizedShareUsername)
    : "Enter a SaphraONE username.";
  const canGenerateLink = Boolean(
    origin && isWalletValid && isAmountValid && isConnected,
  );

  const requestLink = useMemo(() => {
    if (!canGenerateLink) return "";

    return buildPaymentRequestUrl({
      amount: trimmedAmount,
      memo: trimmedNote,
      origin,
      path: "/send",
      requestId,
      token,
      username: requesterUsername ?? undefined,
      walletAddress: requesterUsername ? undefined : trimmedWalletAddress,
    });
  }, [
    canGenerateLink,
    origin,
    requestId,
    requesterUsername,
    token,
    trimmedAmount,
    trimmedNote,
    trimmedWalletAddress,
  ]);

  useEffect(() => {
    setOrigin(window.location.origin);
    setRequestId(crypto.randomUUID());
  }, []);

  // Reload the lists whenever the signed-in wallet changes.
  useEffect(() => {
    const cleaned = readSavedRequests(historyOwner);
    writeSavedRequests(historyOwner, cleaned);
    setSavedRequests(cleaned);
    setUsernameHistory(readRequestUsernameHistory(historyOwner));
  }, [historyOwner]);

  useEffect(() => {
    if (savedRequests.length === 0) {
      return;
    }

    let cancelled = false;

    async function refreshRequestStatuses() {
      const next = await Promise.all(
        savedRequests.map(async (request) => {
          const local = normalizeSavedRequest(request);
          const id = local.requestId;
          if (!id || local.status === "paid" || local.status === "declined") {
            return local;
          }

          try {
            const remote = await fetchPaymentRequestStatus(id);
            if (
              remote.status === "paid" ||
              remote.status === "declined" ||
              remote.status === "expired"
            ) {
              return { ...local, status: remote.status };
            }
          } catch {
            // Keep the local expiry/active status if the status API is unavailable.
          }

          return local;
        }),
      );

      if (cancelled) {
        return;
      }

      const changed = next.some(
        (item, index) =>
          item.status !== savedRequests[index]?.status ||
          item.requestId !== savedRequests[index]?.requestId,
      );
      if (!changed) {
        return;
      }

      writeSavedRequests(historyOwner, next);
      setSavedRequests(next);
    }

    void refreshRequestStatuses();
    const intervalId = window.setInterval(() => {
      void refreshRequestStatuses();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [savedRequests]);

  useEffect(() => {
    if (!connectedWallet) {
      setRequesterUsername(null);
      return;
    }

    let cancelled = false;

    void fetchProfile(connectedWallet)
      .then((profile) => {
        if (!cancelled) {
          setRequesterUsername(profile?.username ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRequesterUsername(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connectedWallet]);

  function persistGeneratedRequest(sentToUsername?: string) {
    if (!requestLink || !canGenerateLink) return;

    const persistedId = requestId || crypto.randomUUID();
    const current = readSavedRequests(historyOwner);
    const existingIndex = current.findIndex(
      (item) => requestHistoryKey(item) === persistedId,
    );
    const existing = existingIndex >= 0 ? current[existingIndex] : undefined;

    const nextRequest: SavedRequest = normalizeSavedRequest({
      amount: trimmedAmount,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      expiresInHours: Number(expiresInHours) || 24,
      id: existing?.id ?? persistedId,
      link: requestLink,
      note: trimmedNote,
      requestId: persistedId,
      sentToUsername: sentToUsername ?? existing?.sentToUsername,
      status: existing?.status ?? "active",
      token,
      username: requesterUsername ?? undefined,
      wallet: trimmedWalletAddress,
    });

    const next =
      existingIndex >= 0
        ? current.map((item, index) =>
            index === existingIndex ? nextRequest : item,
          )
        : [nextRequest, ...current].slice(0, 12);

    writeSavedRequests(historyOwner, next);
    setSavedRequests(next);
  }

  async function copyValue(
    value: string,
    type: "address" | "link",
    options: { persist?: boolean } = {},
  ) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (type === "link" && options.persist) {
        persistGeneratedRequest();
      }
      setCopied(type);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied(null);
    }
  }

  async function shareRequestLink() {
    if (!requestLink) return;
    try {
      persistGeneratedRequest();
      if (navigator.share) {
        await navigator.share({
          text: trimmedNote || `Payment request for ${trimmedAmount} ${token}`,
          title: "SaphraONE payment request",
          url: requestLink,
        });
        return;
      }
      await copyValue(requestLink, "link");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }

  function applyHistoryUsername(username: string) {
    setShareUsername(normalizeUsername(username));
    setShareError(null);
    setShareStatus(null);
  }

  async function sendRequestNotification() {
    if (!isConnected || !trimmedWalletAddress) {
      setShareError("Connect a wallet to send a payment request.");
      setShareStatus(null);
      return;
    }

    if (!requestLink) {
      setShareError("Enter a valid amount to generate this request.");
      setShareStatus(null);
      return;
    }

    if (shareUsernameError) {
      setShareError(shareUsernameError);
      setShareStatus(null);
      return;
    }

    setIsSendingNotification(true);
    setShareError(null);
    setShareStatus(null);

    try {
      const response = await fetch("/api/payment-requests/notify", {
        body: JSON.stringify({
          amount: trimmedAmount,
          expiresInHours,
          fromLabel: requesterUsername
            ? formatUsernameLabel(requesterUsername)
            : shortenWallet(trimmedWalletAddress),
          fromUsername: requesterUsername ?? undefined,
          fromWallet: trimmedWalletAddress,
          note: trimmedNote,
          recipientUsername: normalizedShareUsername,
          requestId,
          requestLink,
          token,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        recipientUsername?: string;
      } | null;

      if (!response.ok) {
        throw new Error(
          payload?.message ?? "Payment request notification failed.",
        );
      }

      const savedUsername =
        payload?.recipientUsername ?? normalizedShareUsername;
      setUsernameHistory(rememberRequestedUsername(historyOwner, savedUsername));
      persistGeneratedRequest(savedUsername);
      setRequestId(crypto.randomUUID());
      setShareStatus(
        `Request sent to ${formatUsernameLabel(savedUsername)}.`,
      );
    } catch (error) {
      setShareError(
        error instanceof Error
          ? error.message
          : "Payment request notification failed.",
      );
    } finally {
      setIsSendingNotification(false);
    }
  }

  // History shows only requests still in play. An expired or declined one is
  // dead — there is nothing left to copy or chase.
  const openRequests = useMemo(
    () =>
      savedRequests.filter((request) => {
        const status = deriveLocalRequestStatus(request);
        return status !== "expired" && status !== "declined";
      }),
    [savedRequests],
  );

  const recipientSummary = requesterUsername
    ? formatUsernameLabel(requesterUsername)
    : isWalletValid
      ? shortenWallet(trimmedWalletAddress)
      : "Connect a wallet";
  const walletSourceLabel =
    source === "embedded"
      ? "Embedded wallet"
      : source === "external"
        ? "External wallet"
        : "Not connected";

  const expiryOptions = [
    { label: "1 hour", value: "1" },
    { label: "24 hours", value: "24" },
    { label: "3 days", value: "72" },
    { label: "7 days", value: "168" },
  ];

  return (
    <div className="req-page">
      <header className="req-bar">
        <Link aria-label="Back to the dashboard" className="req-round" href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="req-title">Request money</h1>
        <button
          aria-label="Request history"
          className="req-round"
          onClick={() => setHistoryOpen(true)}
          title="Request history"
          type="button"
        >
          <History className="h-5 w-5" />
          {openRequests.length > 0 ? <span className="req-round-count">{openRequests.length}</span> : null}
        </button>
      </header>

      {/* Amount */}
      <section className="req-hero">
        <span aria-hidden className="req-hero-glow" />
        <div className="req-hero-top">
          <span className="req-hero-label">You&apos;re requesting</span>
          <div aria-label="Token" className="req-tokens" role="radiogroup">
            {arcTokenSymbols.map((symbol) => (
              <button
                aria-checked={symbol === token}
                className="req-token"
                key={symbol}
                onClick={() => setToken(symbol)}
                role="radio"
                type="button"
              >
                <TokenIcon className="h-4 w-4" symbol={symbol} />
                {symbol}
              </button>
            ))}
          </div>
        </div>
        <label className="req-amount">
          <input
            aria-label="Amount"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            value={amount}
          />
          <span>{token}</span>
        </label>
        <p className="req-hero-sub">
          {isConnected ? (
            <>
              <Lock className="h-3.5 w-3.5" /> Pays to {recipientSummary} · {walletSourceLabel.toLowerCase()}
            </>
          ) : (
            <>
              <Wallet className="h-3.5 w-3.5" /> Connect a wallet to receive payments
            </>
          )}
        </p>
      </section>

      {/* Who */}
      <section className="req-card">
        <h2 className="req-card-title">Who&apos;s paying?</h2>
        <UsernameField
          id="request-from"
          onChange={(next) => {
            setShareUsername(next.toLowerCase());
            setShareError(null);
            setShareStatus(null);
          }}
          onResolved={(person) => setShareResolved(Boolean(person?.username))}
          value={shareUsername}
        />
        {usernameHistory.length > 0 ? (
          <div className="req-chips">
            {usernameHistory.map((username) => (
              <button
                aria-pressed={normalizedShareUsername === normalizeUsername(username)}
                className="req-chip"
                key={username}
                onClick={() => applyHistoryUsername(username)}
                type="button"
              >
                {formatUsernameLabel(username)}
              </button>
            ))}
          </div>
        ) : (
          <p className="req-hint">People you request from will appear here.</p>
        )}
      </section>

      {/* Details */}
      <section className="req-card">
        <h2 className="req-card-title">Details</h2>
        <label className="req-field is-area">
          <MessageSquareText className="mt-0.5 h-4 w-4 text-primary" />
          <textarea
            aria-label="Note"
            maxLength={140}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What's it for? Rent, an invoice, a reference (optional)"
            value={note}
          />
        </label>
        <p className="req-sub-label">
          <Clock3 className="h-3.5 w-3.5" /> Expires after
        </p>
        <div className="req-chips" role="radiogroup" aria-label="Expires after">
          {expiryOptions.map((option) => (
            <button
              aria-checked={expiresInHours === option.value}
              className="req-chip"
              key={option.value}
              onClick={() => setExpiresInHours(option.value)}
              role="radio"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <Button
        className="req-cta"
        disabled={
          !requestLink || Boolean(shareUsernameError) || !shareResolved || isSendingNotification || !isConnected
        }
        onClick={() => void sendRequestNotification()}
        type="button"
      >
        {isSendingNotification ? <Clock3 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {normalizedShareUsername && !shareUsernameError
          ? `Send request to ${formatUsernameLabel(normalizedShareUsername)}`
          : "Send request"}
      </Button>
      {shareError ? <p className="req-message is-error">{shareError}</p> : null}
      {shareStatus ? (
        <p className="req-message is-ok">
          <CheckCircle2 className="h-4 w-4" />
          {shareStatus}
        </p>
      ) : null}
      <p className="req-hint is-center">They can pay or decline from their notifications.</p>

      {/* Link and QR */}
      <div className="req-or">
        <span>or share a link</span>
      </div>
      <section className="req-card req-share">
        <div className="req-qr">
          {requestLink ? (
            <motion.div animate={{ opacity: 1, scale: 1 }} className="req-qr-code" initial={{ opacity: 0, scale: 0.95 }}>
              <LazyQRCodeSVG
                bgColor="transparent"
                fgColor="currentColor"
                marginSize={1}
                size={168}
                title="SaphraONE payment request"
                value={requestLink}
              />
            </motion.div>
          ) : (
            <div className="req-qr-empty">
              <QrCode className="h-8 w-8" />
              Enter an amount to get a link and QR code.
            </div>
          )}
        </div>
        <div className="req-share-side">
          <p className="req-card-title">
            <Link2 className="h-4 w-4" /> Payment link
          </p>
          <p className="req-link" title={requestLink || undefined}>
            {requestLink || "Anyone with the link can pay you, on SaphraONE or with any Arc wallet."}
          </p>
          <div className="req-share-actions">
            <Button
              className="h-11 w-full sm:w-auto sm:flex-1"
              disabled={!requestLink}
              onClick={() => void copyValue(requestLink, "link", { persist: true })}
              type="button"
              variant="outline"
            >
              {copied === "link" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === "link" ? "Copied" : "Copy link"}
            </Button>
            <Button
              className="h-11 w-full sm:w-auto sm:flex-1"
              disabled={!requestLink}
              onClick={() => void shareRequestLink()}
              type="button"
              variant="outline"
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          </div>
          <p className="req-hint">On {arcChain.name}.</p>
        </div>
      </section>

      <RequestHistorySheet
        copied={copied === "link"}
        onClose={() => setHistoryOpen(false)}
        onCopy={(link) => void copyValue(link, "link")}
        open={historyOpen}
        requests={openRequests}
      />
    </div>
  );
}

/** Requests still in play: active or paid. Expired and declined ones are left out. */
function RequestHistorySheet({
  copied,
  onClose,
  onCopy,
  open,
  requests,
}: {
  copied: boolean;
  onClose: () => void;
  onCopy: (link: string) => void;
  open: boolean;
  requests: SavedRequest[];
}) {
  const side = useSheetSide();
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className={cn("gap-0 p-0", side === "bottom" ? "max-h-[85dvh] rounded-t-[1.75rem] border-t-0" : "w-full sm:max-w-md")}
        showCloseButton={false}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        <div className="req-sheet">
          <SheetTitle className="text-center text-lg font-bold">Request history</SheetTitle>
          <SheetDescription className="text-center text-sm text-muted-foreground">
            Requests still waiting to be paid, and paid ones.
          </SheetDescription>
          {requests.length === 0 ? (
            <p className="req-hint is-center py-8">No open requests.</p>
          ) : (
            <ul className="req-history">
              {requests.map((request) => {
                const status = deriveLocalRequestStatus(request);
                return (
                  <li key={request.id}>
                    <span className={status === "paid" ? "req-history-icon is-paid" : "req-history-icon"}>
                      {status === "paid" ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {request.amount} {request.token}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {request.sentToUsername
                          ? `Requested ${formatUsernameLabel(request.sentToUsername)}`
                          : request.username
                            ? `Pays ${formatUsernameLabel(request.username)}`
                            : `Pays ${shortenWallet(request.wallet)}`}
                        {request.note ? ` · ${request.note}` : ""}
                      </span>
                    </span>
                    <span className={status === "paid" ? "req-status is-paid" : "req-status"}>{status}</span>
                    <button
                      aria-label={copied ? "Link copied" : "Copy request link"}
                      className="req-copy"
                      onClick={() => onCopy(request.link)}
                      type="button"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
