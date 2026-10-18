"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardPaste,
  ScanQrCode,
  Coins,
  Delete,
  KeyRound,
  Loader2,
  Network,
  QrCode,
  Search,
  Send,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatUnits, isAddress, parseUnits } from "viem";

import { PlatformLogoMark } from "@/components/brand/platform-logo-mark";
import { BeneficiaryContacts } from "@/components/dashboard/beneficiary-contacts";
import type { SendPaymentWizardProps } from "@/components/dashboard/send-payment-wizard";
import { RecipientStatus } from "@/components/recipient-status";
import { CrossChainSend } from "@/components/send/cross-chain-send";
import { QrScanSheet } from "@/components/send/qr-scan-sheet";
import { TransferProgressOverlay } from "@/components/send/transfer-progress";
import { RecurringScheduleFields, RecurringToggle } from "@/components/recurring-schedule-fields";
import { useTransactionReceipts } from "@/components/transactions/transaction-parts";
import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import type { AccountActivityItem } from "@/lib/activity/merge";
import { transactionHistoryDays } from "@/lib/activity/types";
import { useAccountTransactions } from "@/lib/activity/use-account-transactions";
import type { BeneficiaryRecord } from "@/lib/beneficiaries";
import { fetchDirectoryProfile, searchPeople } from "@/lib/business/client";
import type { DirectoryHit } from "@/lib/business/types";
import { isOwnAgentWallet, useWalletUsernames } from "@/lib/activity/usernames";
import { multichainEnabled } from "@/lib/multichain/flag";
import { fetchProfile } from "@/lib/profile";
import { UsernameField, type ResolvedPerson } from "@/components/username-field";
import { formatUsernameLabel } from "@/lib/profile-utils";
import { calculateTransactionCashback } from "@/lib/referral/cashback-service";
import { cashbackPointsFor, rewardsV2Enabled } from "@/lib/rewards/config";
import { maxSendableUnits } from "@/lib/fees";
import { arcTokens, arcTokenSymbols } from "@/lib/tokens";
import { useConversionRates, usdPerUnit } from "@/lib/use-conversion-rates";
import { bottomSheetClassName, useSheetSide } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

import "./send.css";

type ContactEdit = Parameters<React.ComponentProps<typeof BeneficiaryContacts>["onUpdate"]>[1];

export type SendHubProps = SendPaymentWizardProps & {
  isBeneficiariesLoading: boolean;
  onDeleteBeneficiary: (beneficiary: BeneficiaryRecord) => Promise<void>;
  onUpdateBeneficiary: (beneficiary: BeneficiaryRecord, edit: ContactEdit) => Promise<void>;
  /** Change to refetch history, e.g. when a payment settles. */
  refreshKey?: string;
  savedBeneficiaries: BeneficiaryRecord[];
};

type View = "home" | "to" | "chat" | "network";

type Person = {
  /** What goes in the recipient field: a ONE ID (amara.one) or a wallet. */
  value: string;
  wallet: string | null;
  name: string;
  avatarUrl?: string | null;
  sub?: string;
};

/** Kept back on MAX when an external wallet pays in USDC, which is also Arc's gas. */
const EXTERNAL_GAS_RESERVE_USDC = "0.02";

function timeAgo(value: string | null) {
  if (!value) return "just now";
  const seconds = Math.max(0, (Date.now() - Date.parse(value)) / 1000);
  if (seconds < 60) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatAmount(value: string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value ?? "0";
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 6, minimumFractionDigits: 2 });
}

function counterpartyOf(item: AccountActivityItem) {
  return (item.transfer?.counterparty ?? item.counterparty ?? "").toLowerCase();
}

/**
 * Under the search results, in the sign-up page's colours: someone you
 * can't find can join in a minute and be paid by @username from then on.
 */
function InviteBanner() {
  return (
    <section aria-label="Invite someone to SaphraONE" className="sx-invite">
      <span aria-hidden className="sx-invite-glow" />
      <span aria-hidden className="sx-invite-grain" />
      <p className="sx-invite-title">Can&apos;t find who you&apos;re looking for?</p>
      <p className="sx-invite-body">
        Invite them to SaphraONE. They sign up in a minute, and from then on you can pay them by
        their ONE ID, free and in seconds.
      </p>
      <Link className="sx-invite-cta" href="/referral">
        Invite friends
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}

/** Soft hues for photo-less avatars: lilac, violet, blue, pink, teal, peach, mint, indigo. */
const orbHues = [268, 285, 222, 322, 178, 24, 152, 245];

/** Two hues picked from `seed` (a wallet or ONE ID), the same every time. */
function orbColors(seed: string) {
  let hash = 2166136261;
  for (const char of seed.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const first = orbHues[Math.abs(hash) % orbHues.length];
  const second = orbHues[Math.abs(hash >> 8) % orbHues.length];
  return { "--orb-a": first, "--orb-b": second === first ? (first + 40) % 360 : second } as React.CSSProperties;
}

/** What an orb's colours come from: the ONE ID when there is one, else the wallet. */
function orbSeed(value: string, wallet?: string | null) {
  return /\.one$/i.test(value) ? value.toLowerCase() : (wallet ?? value).toLowerCase();
}

/**
 * A round avatar: the photo when there is one, else a soft blurred orb in
 * colours of its own (from `seed`, the wallet or ONE ID), so people without a
 * photo still look like someone.
 */
function Avatar({
  name,
  seed,
  size = "md",
  url,
}: {
  name: string;
  seed?: string | null;
  size?: "md" | "lg" | "sm";
  url?: string | null;
}) {
  if (url) {
    return (
      <span aria-hidden className={cn("sx-avatar", `is-${size}`)}>
        <img alt="" src={url} />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("sx-avatar is-orb", `is-${size}`)} style={orbColors(seed || name)}>
      <span className="sx-orb" />
    </span>
  );
}

/**
 * Send, in the Kuda pattern: a home with search, beneficiaries, the ways to
 * pay and recents; a "Pay to" step; then a chat-style screen with everything
 * already sent to that person and the amount at the bottom; a confirm sheet
 * sends. All payment state and logic stays with the dashboard.
 */
export function SendHub(props: SendHubProps) {
  const {
    address,
    authWallet,
    availableBalances,
    beneficiaryError,
    beneficiaryName,
    beneficiaryStatus,
    canSaveBeneficiary,
    canSubmitPayment,
    hideBalance = false,
    isAuthenticatingWallet,
    isBeneficiariesLoading,
    isBeneficiarySaving,
    isConnected,
    isEmbeddedWalletMode,
    isRecipientResolving,
    isRecipientValid,
    isSubmitting,
    isSwitchingChain,
    isTreasuryMismatch = false,
    isWalletAuthenticated,
    onBeneficiaryNameChange,
    onDeleteBeneficiary,
    onPaymentAmountChange,
    onPaymentNarrationChange,
    onRecipientChange,
    onRecurringChange,
    onRecurringEnabledChange,
    onSaveBeneficiary,
    onSelectToken,
    onSubmit,
    onSwitchToTreasury,
    onUpdateBeneficiary,
    onWalletSignIn,
    paymentAmount,
    paymentAmountUnits,
    paymentError,
    paymentNarration,
    primaryButtonText,
    receiveHref,
    recipientAddress,
    recipientResolveError,
    recurring,
    recurringEnabled,
    recurringNotice,
    refreshKey,
    resolvedRecipientUsername,
    savedBeneficiaries,
    selectedToken,
    settlementQuote,
    shortenAddress,
    spendSaveNotice,
    transactionConfirmed,
    transactionExplorerUrl,
    treasuryAddress,
    trimmedRecipientAddress,
    walletAddress,
  } = props;

  const [view, setView] = useState<View>("home");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [beneficiariesOpen, setBeneficiariesOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const router = useRouter();
  const [saveOpen, setSaveOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryHit[]>([]);
  const navigated = useRef(false);

  const { items, titleFor } = useAccountTransactions(walletAddress || null, transactionHistoryDays, refreshKey);

  // The recipient's profile photo, when they have a SaphraONE profile.
  const [recipientAvatar, setRecipientAvatar] = useState<string | null>(null);
  // A username asks the directory, which knows a business's logo as well as
  // a person's photo; a bare wallet asks its profile.
  useEffect(() => {
    setRecipientAvatar(null);
    if (!isRecipientValid || !trimmedRecipientAddress) return;
    let cancelled = false;
    const lookup = resolvedRecipientUsername
      ? fetchDirectoryProfile(resolvedRecipientUsername).then((payload) => payload.profile.avatarUrl ?? null)
      : fetchProfile(trimmedRecipientAddress).then((profile) => profile?.avatar_url ?? null);
    void lookup
      .catch(() =>
        fetchProfile(trimmedRecipientAddress)
          .then((profile) => profile?.avatar_url ?? null)
          .catch(() => null),
      )
      .then((url) => {
        if (!cancelled) setRecipientAvatar(url);
      });
    return () => {
      cancelled = true;
    };
  }, [isRecipientValid, resolvedRecipientUsername, trimmedRecipientAddress]);

  // A link that already names who to pay (?to=…, an invoice, ALLIE) opens the chat.
  useEffect(() => {
    if (!navigated.current && recipientAddress.trim()) {
      navigated.current = true;
      setView("chat");
    }
  }, [recipientAddress]);

  const beneficiaryByWallet = useMemo(() => {
    const map = new Map<string, BeneficiaryRecord>();
    savedBeneficiaries.forEach((entry) => map.set(entry.beneficiary_wallet.toLowerCase(), entry));
    return map;
  }, [savedBeneficiaries]);

  // People you've paid, newest first, once each.
  // The @username behind each wallet you've paid, so Recents names people.
  const paidWallets = useMemo(
    () =>
      items
        .filter((item) => item.direction === "out" && ["send", "wallet", "agent"].includes(item.source))
        .map(counterpartyOf),
    [items],
  );
  const usernameFor = useWalletUsernames(paidWallets);

  const recents = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<Person & { lastAmount: string; when: string | null }> = [];
    for (const item of items) {
      if (item.direction !== "out") continue;
      if (!["send", "wallet", "agent"].includes(item.source)) continue;
      const wallet = counterpartyOf(item);
      if (!wallet || !isAddress(wallet) || seen.has(wallet)) continue;
      // Topping up your own Agent Wallet isn't paying someone.
      if (isOwnAgentWallet(wallet, walletAddress)) continue;
      seen.add(wallet);
      const saved = beneficiaryByWallet.get(wallet);
      const titled = (titleFor(item) ?? "").replace(/^Sent to /, "");
      const username = usernameFor(wallet);
      const handle = username
        ? formatUsernameLabel(username)
        : titled.startsWith("@") || /\.one$/i.test(titled)
          ? titled
          : null;
      out.push({
        lastAmount: `${formatAmount(item.amount)} ${item.token ?? ""}`.trim(),
        name: saved?.name ?? handle ?? shortenAddress(wallet),
        value: saved?.username ? `${saved.username}.one` : handle ?? wallet,
        wallet,
        when: item.occurredAt,
      });
      if (out.length >= 8) break;
    }
    return out;
  }, [beneficiaryByWallet, items, shortenAddress, titleFor, usernameFor, walletAddress]);

  const beneficiaryPeople: Person[] = savedBeneficiaries.map((entry) => ({
    name: entry.name,
    sub: entry.username ? `${entry.username}.one` : shortenAddress(entry.beneficiary_wallet),
    value: entry.username ? `${entry.username}.one` : entry.beneficiary_wallet,
    wallet: entry.beneficiary_wallet,
  }));

  // Search: your people first, then anyone on SaphraONE.
  const needle = query.trim().replace(/^@+/, "").replace(/\.one$/i, "").toLowerCase();
  useEffect(() => {
    if (!needle || isAddress(needle)) {
      setDirectory([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchPeople(needle)
        .then((payload) => {
          if (!cancelled) setDirectory(payload.results.slice(0, 6));
        })
        .catch(() => {
          if (!cancelled) setDirectory([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needle]);

  const localMatches = needle
    ? [...beneficiaryPeople, ...recents].filter(
        (person, index, all) =>
          [person.name, person.value, person.wallet ?? ""].some((field) => field.toLowerCase().includes(needle)) &&
          all.findIndex((other) => other.value === person.value) === index,
      )
    : [];

  // Pay to: picking (search, tiles, recents), or typing a ONE ID or a wallet.
  const [toMode, setToMode] = useState<"pick" | "oneid" | "wallet">("pick");
  const [oneId, setOneId] = useState("");
  const [oneIdPerson, setOneIdPerson] = useState<ResolvedPerson | null>(null);

  function openChat(person: Person) {
    navigated.current = true;
    onRecipientChange(person.value);
    const saved = person.wallet ? beneficiaryByWallet.get(person.wallet.toLowerCase()) : undefined;
    onBeneficiaryNameChange(saved?.name ?? "");
    setQuery("");
    setView("chat");
  }

  function startNew() {
    navigated.current = true;
    onRecipientChange("");
    onBeneficiaryNameChange("");
    setQuery("");
    setToMode("pick");
    setOneId("");
    setView("to");
  }

  const savedHere = trimmedRecipientAddress ? beneficiaryByWallet.get(trimmedRecipientAddress.toLowerCase()) : undefined;
  const recipientName =
    savedHere?.name ??
    (resolvedRecipientUsername
      ? formatUsernameLabel(resolvedRecipientUsername)
      : isRecipientValid
        ? shortenAddress(trimmedRecipientAddress)
        : recipientAddress.trim() || "Recipient");

  const treasuryBanner =
    isTreasuryMismatch && treasuryAddress ? (
      <div className="sx-warn">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Signing with your personal wallet</p>
          <p className="mt-0.5 opacity-90">
            Connected {shortenAddress(address)} isn&apos;t this workspace&apos;s treasury (
            {shortenAddress(treasuryAddress)}). Sending now uses personal funds.
          </p>
        </div>
        {onSwitchToTreasury ? (
          <button className="sx-warn-action" onClick={onSwitchToTreasury} type="button">
            Switch
          </button>
        ) : null}
      </div>
    ) : null;

  // ── Home ────────────────────────────────────────────────────────────────
  if (view === "home") {
    return (
      <div className="sx-page">
        <header className="sx-bar">
          <Link aria-label="Back to the dashboard" className="sx-round" href="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="sx-title">Send money</h1>
          <Link aria-label="Receive" className="sx-round" href={receiveHref} title="Receive">
            <QrCode className="h-5 w-5" />
          </Link>
        </header>

        {treasuryBanner}

        <label className="sx-search">
          <Search className="h-4 w-4 shrink-0" />
          <input
            aria-label="Search people"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a name, ONE ID or 0x wallet"
            spellCheck={false}
            value={query}
          />
        </label>

        {needle ? (
          <>
          <section className="sx-card">
            <ul className="sx-list">
              {isAddress(needle) ? (
                <li>
                  <PersonRow
                    onClick={() => openChat({ name: shortenAddress(needle), value: needle, wallet: needle })}
                    person={{ name: shortenAddress(needle), sub: "Pay this Arc wallet", value: needle, wallet: needle }}
                  />
                </li>
              ) : null}
              {localMatches.map((person) => (
                <li key={`local-${person.value}`}>
                  <PersonRow onClick={() => openChat(person)} person={person} />
                </li>
              ))}
              {directory
                .filter((hit) => !localMatches.some((person) => person.value === `${hit.username}.one`))
                .map((hit) => {
                  const person: Person = {
                    avatarUrl: hit.avatarUrl,
                    name: hit.displayName || formatUsernameLabel(hit.username),
                    sub: `${formatUsernameLabel(hit.username)}${hit.kind === "business" ? " · Business" : ""}`,
                    value: `${hit.username}.one`,
                    wallet: null,
                  };
                  return (
                    <li key={`dir-${hit.username}`}>
                      <PersonRow onClick={() => openChat(person)} person={person} />
                    </li>
                  );
                })}
              {!isAddress(needle) && localMatches.length === 0 && directory.length === 0 ? (
                <li className="sx-empty">No one found for &ldquo;{query.trim()}&rdquo;.</li>
              ) : null}
            </ul>
          </section>
          <InviteBanner />
          </>
        ) : (
          <>
            <section className="sx-section">
              <div className="sx-section-head">
                <h2>Beneficiaries</h2>
                {savedBeneficiaries.length > 0 ? (
                  <button onClick={() => setBeneficiariesOpen(true)} type="button">
                    View all
                  </button>
                ) : null}
              </div>
              {isBeneficiariesLoading && savedBeneficiaries.length === 0 ? (
                <p className="sx-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading
                </p>
              ) : savedBeneficiaries.length === 0 ? (
                <p className="sx-muted">People you save while sending appear here.</p>
              ) : (
                <div className="sx-people-row">
                  {beneficiaryPeople.map((person) => (
                    <button className="sx-person" key={person.value} onClick={() => openChat(person)} type="button">
                      <Avatar name={person.name} seed={orbSeed(person.value, person.wallet)} />
                      <span>{person.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="sx-card">
              <ul className="sx-list">
                <li>
                  <OptionRow
                    badge="Instant"
                    body="Anyone on SaphraONE or any wallet on Arc."
                    icon={<Send className="h-5 w-5" />}
                    onClick={startNew}
                    title="Pay to a ONE ID or Arc address"
                  />
                </li>
                {multichainEnabled ? (
                  <li>
                    <OptionRow
                      body="Send USDC to an address on Base, Polygon, Arbitrum and more."
                      icon={<Network className="h-5 w-5" />}
                      onClick={() => {
                        navigated.current = true;
                        setView("network");
                      }}
                      title="Pay to other networks"
                    />
                  </li>
                ) : null}
                <li>
                  <OptionRow
                    body="Pay many people in one transaction."
                    href="/bulkpay"
                    icon={<Users className="h-5 w-5" />}
                    title="BulkPay"
                  />
                </li>
                <li>
                  <OptionRow
                    body="Schedule one-time and recurring payments."
                    href="/recurepay"
                    icon={<CalendarClock className="h-5 w-5" />}
                    title="Scheduled transfers"
                  />
                </li>
              </ul>
            </section>

            <section className="sx-section">
              <div className="sx-section-head">
                <h2>Recents</h2>
                {recents.length > 0 ? <Link href="/transactions">View all</Link> : null}
              </div>
              {recents.length === 0 ? (
                <p className="sx-muted">People you pay show up here.</p>
              ) : (
                <section className="sx-card">
                  <ul className="sx-list">
                    {recents.slice(0, 5).map((person) => (
                      <li key={person.value}>
                        <PersonRow
                          onClick={() => openChat(person)}
                          person={{ ...person, sub: `You sent ${person.lastAmount} • ${timeAgo(person.when)}` }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </section>
          </>
        )}

        <BeneficiariesSheet
          onClose={() => setBeneficiariesOpen(false)}
          open={beneficiariesOpen}
        >
          <BeneficiaryContacts
            isLoading={isBeneficiariesLoading}
            onDelete={onDeleteBeneficiary}
            onSelect={(beneficiary) => {
              setBeneficiariesOpen(false);
              openChat({
                name: beneficiary.name,
                value: beneficiary.username ? `${beneficiary.username}.one` : beneficiary.beneficiary_wallet,
                wallet: beneficiary.beneficiary_wallet,
              });
            }}
            onUpdate={onUpdateBeneficiary}
            savedBeneficiaries={savedBeneficiaries}
            selectedWallet={trimmedRecipientAddress}
            shortenAddress={shortenAddress}
          />
        </BeneficiariesSheet>
      </div>
    );
  }

  // ── Pay to another network ──────────────────────────────────────────────
  if (view === "network") {
    return (
      <CrossChainSend
        hideBalance={hideBalance}
        onBack={() => setView("home")}
        ownerWallet={walletAddress}
        usdcBalance={availableBalances?.find((balance) => balance.symbol === "USDC")?.amount}
      />
    );
  }

  // ── Pay to ──────────────────────────────────────────────────────────────
  // Search anyone, or pick how to pay: a ONE ID (the same field as Request's
  // "Who's paying?") or an Arc wallet (paste or scan). Recents underneath.
  if (view === "to") {
    const back = () => {
      if (toMode !== "pick") {
        setToMode("pick");
        onRecipientChange("");
        setOneId("");
        return;
      }
      setQuery("");
      setView("home");
    };
    const people = [...recents, ...beneficiaryPeople].filter(
      (person, index, all) => all.findIndex((other) => other.value === person.value) === index,
    );
    const directoryHits = directory.filter(
      (hit) => !localMatches.some((person) => person.value === `${hit.username}.one`),
    );
    const directoryPerson = (hit: DirectoryHit): Person => ({
      avatarUrl: hit.avatarUrl,
      name: hit.displayName || hit.username,
      sub: `${hit.username}.one${hit.kind === "business" ? " · Business" : ""}`,
      value: `${hit.username}.one`,
      wallet: null,
    });

    return (
      <div className="sx-page">
        <header className="sx-bar">
          <button aria-label="Back" className="sx-round" onClick={back} type="button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="sx-title">
            {toMode === "oneid" ? "Pay a ONE ID" : toMode === "wallet" ? "Pay a wallet" : "Pay to"}
          </h1>
          <span aria-hidden />
        </header>

        {toMode === "pick" ? (
          <>
            <label className="sx-search">
              <Search className="h-4 w-4 shrink-0" />
              <input
                aria-label="Search people"
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, ONE ID or wallet address"
                spellCheck={false}
                value={query}
              />
            </label>

            {needle ? (
              <>
                {isAddress(needle) ? (
                  <section className="sx-card">
                    <p className="sx-group-title">Arc wallet</p>
                    <ul className="sx-list">
                      <li>
                        <PersonRow
                          kind="wallet"
                          onClick={() => openChat({ name: shortenAddress(needle), value: needle, wallet: needle })}
                          person={{ name: shortenAddress(needle), sub: "Pay this Arc wallet", value: needle, wallet: needle }}
                        />
                      </li>
                    </ul>
                  </section>
                ) : null}
                {localMatches.length > 0 ? (
                  <section className="sx-card">
                    <p className="sx-group-title">
                      Your people <span>· {localMatches.length}</span>
                    </p>
                    <ul className="sx-list">
                      {localMatches.map((person) => (
                        <li key={`local-${person.value}`}>
                          <PersonRow onClick={() => openChat(person)} person={person} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {directoryHits.length > 0 ? (
                  <section className="sx-card">
                    <p className="sx-group-title">
                      On SaphraONE <span>· {directoryHits.length}</span>
                    </p>
                    <ul className="sx-list">
                      {directoryHits.map((hit) => (
                        <li key={`dir-${hit.username}`}>
                          <PersonRow onClick={() => openChat(directoryPerson(hit))} person={directoryPerson(hit)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {!isAddress(needle) && localMatches.length === 0 && directory.length === 0 ? (
                  <section className="sx-card">
                    <p className="sx-empty">No one found for &ldquo;{query.trim()}&rdquo;.</p>
                  </section>
                ) : null}
              </>
            ) : (
              <>
                <div className="sx-to-tiles">
                  <button className="sx-to-tile" onClick={() => setToMode("oneid")} type="button">
                    <OneIdArt />
                    <span>ONE ID</span>
                  </button>
                  <button className="sx-to-tile" onClick={() => setToMode("wallet")} type="button">
                    <WalletArt />
                    <span>Wallet</span>
                  </button>
                </div>

                <section className="sx-card sx-to-recents">
                  <p className="sx-group-title">Recents</p>
                  {people.length === 0 ? (
                    <p className="sx-empty">People you pay show up here.</p>
                  ) : (
                    <ul className="sx-list">
                      {people.slice(0, 12).map((person) => (
                        <li key={person.value}>
                          <PersonRow
                            onClick={() => openChat(person)}
                            person={{
                              ...person,
                              sub: /\.one$/i.test(person.value)
                                ? person.value
                                : shortenAddress(person.wallet ?? person.value),
                            }}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </>
        ) : toMode === "oneid" ? (
          <section className="sx-to-panel">
            <h2 className="sx-to-panel-title">Who are you paying?</h2>
            <UsernameField
              autoFocus
              id="send-one-id"
              onChange={setOneId}
              onResolved={setOneIdPerson}
              value={oneId}
            />
            <Button
              className="sx-to-continue"
              disabled={!oneIdPerson?.username}
              onClick={() => {
                if (!oneIdPerson?.username) return;
                openChat({
                  avatarUrl: oneIdPerson.avatarUrl,
                  name: oneIdPerson.displayName || formatUsernameLabel(oneIdPerson.username),
                  value: `${oneIdPerson.username}.one`,
                  wallet: oneIdPerson.address,
                });
              }}
              type="button"
            >
              {oneIdPerson?.username ? `Pay ${oneIdPerson.username}.one` : "Continue"}
            </Button>
          </section>
        ) : (
          <section className="sx-to-panel">
            <h2 className="sx-to-panel-title">Which Arc wallet?</h2>
            <div className="sx-to">
              <div className="sx-to-field">
                <input
                  aria-describedby="send-recipient-status"
                  aria-label="Arc wallet address"
                  autoCapitalize="off"
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => onRecipientChange(event.target.value.replace(/\s/g, ""))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && isRecipientValid) setView("chat");
                  }}
                  placeholder="0x…"
                  spellCheck={false}
                  value={recipientAddress}
                />
                {isRecipientResolving ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" /> : null}
                <button
                  className="sx-paste"
                  onClick={() => {
                    void navigator.clipboard
                      ?.readText()
                      .then((text) => onRecipientChange(text.trim()))
                      .catch(() => undefined);
                  }}
                  type="button"
                >
                  Paste
                  <ClipboardPaste className="h-4 w-4" />
                </button>
              </div>
              <button aria-label="Scan a QR code" className="sx-scan-button" onClick={() => setScanOpen(true)} type="button">
                <ScanQrCode className="h-6 w-6" />
              </button>
            </div>
            {recipientAddress.trim() ? (
              <RecipientStatus
                id="send-recipient-status"
                resolution={{
                  error: recipientResolveError,
                  isResolving: isRecipientResolving,
                  isValid: isRecipientValid,
                  resolvedAddress: isRecipientValid ? trimmedRecipientAddress : null,
                  resolvedUsername: resolvedRecipientUsername,
                }}
              />
            ) : (
              <p className="sx-muted">Any wallet on Arc. Payments settle in seconds.</p>
            )}
            <Button className="sx-to-continue" disabled={!isRecipientValid} onClick={() => setView("chat")} type="button">
              Continue
            </Button>
          </section>
        )}

        <QrScanSheet
          onClose={() => setScanOpen(false)}
          onResult={(text) => {
            setScanOpen(false);
            const scanned = readScannedRecipient(text);
            if (scanned.link) router.push(scanned.link);
            else if (scanned.recipient) {
              onRecipientChange(scanned.recipient);
              setToMode("wallet");
            }
          }}
          open={scanOpen}
        />
      </div>
    );
  }

  // ── Chat send ───────────────────────────────────────────────────────────
  return (
    <ChatView
      {...props}
      authWallet={authWallet}
      availableBalances={availableBalances}
      beneficiaryError={beneficiaryError}
      beneficiaryName={beneficiaryName}
      beneficiaryStatus={beneficiaryStatus}
      canSaveBeneficiary={canSaveBeneficiary}
      canSubmitPayment={canSubmitPayment}
      confirmOpen={confirmOpen}
      hideBalance={hideBalance}
      history={items.filter((item) => trimmedRecipientAddress && counterpartyOf(item) === trimmedRecipientAddress.toLowerCase())}
      isAuthenticatingWallet={isAuthenticatingWallet}
      isBeneficiarySaving={isBeneficiarySaving}
      isConnected={isConnected}
      isEmbeddedWalletMode={isEmbeddedWalletMode}
      isSaved={Boolean(savedHere)}
      isSubmitting={isSubmitting}
      isSwitchingChain={isSwitchingChain}
      isWalletAuthenticated={isWalletAuthenticated}
      onBack={() => setView(recipientAddress.trim() && !isRecipientValid ? "to" : "home")}
      onConfirmOpenChange={setConfirmOpen}
      onSaveOpenChange={setSaveOpen}
      paymentAmount={paymentAmount}
      paymentAmountUnits={paymentAmountUnits}
      paymentError={paymentError}
      paymentNarration={paymentNarration}
      primaryButtonText={primaryButtonText}
      recipientAvatar={recipientAvatar}
      recipientName={recipientName}
      recurring={recurring}
      recurringEnabled={recurringEnabled}
      recurringNotice={recurringNotice}
      saveOpen={saveOpen}
      selectedToken={selectedToken}
      settlementQuote={settlementQuote}
      spendSaveNotice={spendSaveNotice}
      transactionConfirmed={transactionConfirmed}
      transactionExplorerUrl={transactionExplorerUrl}
      treasuryBanner={treasuryBanner}
      onBeneficiaryNameChange={onBeneficiaryNameChange}
      onPaymentAmountChange={onPaymentAmountChange}
      onPaymentNarrationChange={onPaymentNarrationChange}
      onRecurringChange={onRecurringChange}
      onRecurringEnabledChange={onRecurringEnabledChange}
      onSaveBeneficiary={onSaveBeneficiary}
      onSelectToken={onSelectToken}
      onSubmit={onSubmit}
      onSwitchToTreasury={onSwitchToTreasury}
      onWalletSignIn={onWalletSignIn}
    />
  );
}

function PersonRow({
  kind,
  onClick,
  person,
}: {
  /** The small badge on the photo: a ONE ID or a plain wallet. Read from the value when left out. */
  kind?: "oneid" | "wallet";
  onClick: () => void;
  person: Person;
}) {
  const badge = kind ?? (/\.one$/i.test(person.value) ? "oneid" : isAddress(person.value) ? "wallet" : null);
  return (
    <button className="sx-row" onClick={onClick} type="button">
      <span className="sx-avatar-wrap">
        <Avatar name={person.name} seed={orbSeed(person.value, person.wallet)} url={person.avatarUrl} />
        {badge ? (
          <span aria-hidden className={cn("sx-avatar-badge", `is-${badge}`)}>
            {badge === "oneid" ? <OneBadgeGlyph /> : <Wallet className="h-2.5 w-2.5" />}
          </span>
        ) : null}
      </span>
      <span className="sx-row-main">
        <span className="sx-row-title">{person.name}</span>
        {person.sub ? <span className="sx-row-sub">{person.sub}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function OptionRow({
  badge,
  body,
  href,
  icon,
  onClick,
  title,
}: {
  badge?: string;
  body: string;
  href?: string;
  icon: ReactNode;
  onClick?: () => void;
  title: string;
}) {
  const inner = (
    <>
      <span className="sx-option-icon">{icon}</span>
      <span className="sx-row-main">
        <span className="sx-row-title">
          {title}
          {badge ? <em className="sx-badge">{badge}</em> : null}
        </span>
        <span className="sx-row-sub">{body}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </>
  );
  return href ? (
    <Link className="sx-row" href={href}>
      {inner}
    </Link>
  ) : (
    <button className="sx-row" onClick={onClick} type="button">
      {inner}
    </button>
  );
}

/**
 * What a scanned code means: a SaphraONE payment link opens as itself so its
 * amount and token come along; anything else is read for a username or address.
 */
function readScannedRecipient(text: string): { link?: string; recipient?: string } {
  const value = text.trim();
  try {
    const url = new URL(value);
    if (url.origin === window.location.origin) return { link: `${url.pathname}${url.search}` };
    const username = url.searchParams.get("username");
    if (username) return { recipient: formatUsernameLabel(username) };
  } catch {}
  const address = value.match(/0x[a-fA-F0-9]{40}/)?.[0];
  if (address) return { recipient: address };
  if (/^@?[a-zA-Z0-9_.]{2,32}$/.test(value)) return { recipient: formatUsernameLabel(value) };
  return {};
}

function BeneficiariesSheet({ children, onClose, open }: { children: ReactNode; onClose: () => void; open: boolean }) {
  const side = useSheetSide();
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className={cn("gap-0 p-0", side === "bottom" ? bottomSheetClassName : "w-full sm:max-w-md")}
        showCloseButton={false}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        <div className="sx-sheet">
          <SheetTitle className="text-center text-lg font-bold">Beneficiaries</SheetTitle>
          <SheetDescription className="sr-only">Your saved people</SheetDescription>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The person's history as chat bubbles, the amount at the bottom, and the confirm sheet. */
function ChatView(
  props: SendHubProps & {
    confirmOpen: boolean;
    history: AccountActivityItem[];
    isSaved: boolean;
    onBack: () => void;
    onConfirmOpenChange: (open: boolean) => void;
    onSaveOpenChange: (open: boolean) => void;
    recipientAvatar: string | null;
    recipientName: string;
    saveOpen: boolean;
    treasuryBanner: ReactNode;
  },
) {
  const {
    availableBalances,
    beneficiaryError,
    beneficiaryName,
    beneficiaryStatus,
    canSaveBeneficiary,
    canSubmitPayment,
    confirmOpen,
    hideBalance = false,
    history,
    isAuthenticatingWallet,
    isBeneficiarySaving,
    isConnected,
    isEmbeddedWalletMode,
    isRecipientResolving,
    isConfirming,
    isRecipientValid,
    isSaved,
    isSubmitting,
    isSwitchingChain,
    isTreasuryMismatch = false,
    isWalletAuthenticated,
    onBack,
    onBeneficiaryNameChange,
    onConfirmOpenChange,
    onPaymentAmountChange,
    onPaymentNarrationChange,
    onRecurringChange,
    onRecurringEnabledChange,
    onSaveBeneficiary,
    onSaveOpenChange,
    onSelectToken,
    onSubmit,
    onSwitchToTreasury,
    onWalletSignIn,
    paymentAmount,
    paymentAmountUnits,
    paymentError,
    paymentNarration,
    primaryButtonText,
    recipientAvatar,
    recipientName,
    recipientResolveError,
    recurring,
    recurringEnabled,
    recurringNotice,
    saveOpen,
    selectedToken,
    settlementQuote,
    shortenAddress,
    spendSaveNotice,
    transactionConfirmed,
    transactionExplorerUrl,
    treasuryAddress,
    treasuryBanner,
    trimmedRecipientAddress,
    walletAddress,
  } = props;
  const recipientSeed = props.resolvedRecipientUsername
    ? `${props.resolvedRecipientUsername}.one`
    : trimmedRecipientAddress;
  const side = useSheetSide();
  const logRef = useRef<HTMLDivElement>(null);
  const [amountOpen, setAmountOpen] = useState(false);
  // Every bubble, sent or received, opens its receipt.
  const { modals: receiptModals, openerFor } = useTransactionReceipts(walletAddress || null);
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Oldest first, like a chat; the newest sits just above the composer.
  const bubbles = useMemo(() => [...history].reverse(), [history]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [bubbles.length]);

  const { rates } = useConversionRates();
  const usdPerToken = selectedToken === "EURC" ? (usdPerUnit("EUR", rates) ?? 1) : 1;
  const cashback = useMemo(() => {
    // Rewards v2: about 1 point per $10; the month's tier and cap decide the
    // exact amount, so this is the most it can be.
    if (rewardsV2Enabled()) {
      const usdValue = (Number(paymentAmount) || 0) * usdPerToken;
      const points = cashbackPointsFor({ monthPoints: 0, monthVolumeUsd: 0, volumeUsd: usdValue });
      return { eligible: points > 0, points, upTo: true };
    }
    return { ...calculateTransactionCashback(paymentAmount, usdPerToken), upTo: false };
  }, [paymentAmount, usdPerToken]);

  const hasAmount = paymentAmountUnits !== null && paymentAmountUnits > BigInt(0);
  const balance = availableBalances?.find((entry) => entry.symbol === selectedToken)?.amount;
  const busy = isSubmitting || isSwitchingChain;
  // From the Send tap until the wallet answers, the confirm sheet must not
  // hold the page modal: Circle's confirmation window opens on top of it and
  // needs clicks and typing.
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
    } else if (wasBusy.current) {
      wasBusy.current = false;
      setAwaitingWallet(false);
    }
  }, [busy]);
  // The sheet closes while the wallet confirms (on a phone it would cover
  // Circle's window). An error brings it back; success ends on the
  // animation's receipt instead.
  useEffect(() => {
    if (!awaitingWallet) return;
    if (paymentError) {
      setAwaitingWallet(false);
      onConfirmOpenChange(true);
    } else if (transactionConfirmed) {
      setAwaitingWallet(false);
    }
  }, [awaitingWallet, onConfirmOpenChange, paymentError, transactionConfirmed]);
  const walletLock = busy || awaitingWallet;
  const needsSignIn = isConnected && !isWalletAuthenticated && !isEmbeddedWalletMode;

  // Percent chips. MAX leaves room for the service fee and Spend&Save (and,
  // for an external wallet paying in USDC, a little gas), so the total debit
  // never exceeds the balance.
  const [maxMode, setMaxMode] = useState(false);
  const savePercentRef = useRef(0);
  useEffect(() => {
    const percent = Number(settlementQuote?.savePercent);
    if (Number.isFinite(percent) && percent > 0) savePercentRef.current = percent;
  }, [settlementQuote?.savePercent]);
  const decimals = arcTokens[selectedToken].decimals;

  function balanceUnits() {
    if (balance === undefined) return null;
    try {
      return parseUnits(balance, decimals);
    } catch {
      return null;
    }
  }

  function maxUnits(savePercent: number) {
    const units = balanceUnits();
    if (units === null) return null;
    const reserve =
      !isEmbeddedWalletMode && selectedToken === "USDC" ? parseUnits(EXTERNAL_GAS_RESERVE_USDC, decimals) : BigInt(0);
    const spendable = units > reserve ? units - reserve : BigInt(0);
    const saveBps = BigInt(Math.ceil(savePercent * 100));
    return maxSendableUnits(spendable, saveBps);
  }

  function fillPercent(percent: number) {
    const units = balanceUnits();
    if (units === null) return;
    const next = percent === 100 ? maxUnits(savePercentRef.current) : (units * BigInt(percent)) / BigInt(100);
    if (next === null) return;
    setMaxMode(percent === 100);
    onPaymentAmountChange(next > BigInt(0) ? formatUnits(next, decimals) : "");
  }

  // MAX before the first quote can't know the Spend&Save rate; once the quote
  // shows the total going over the balance, shrink to fit.
  useEffect(() => {
    if (!maxMode || !settlementQuote?.totalRequired) return;
    const units = balanceUnits();
    let total: bigint;
    try {
      total = parseUnits(settlementQuote.totalRequired, decimals);
    } catch {
      return;
    }
    if (units === null || total <= units) return;
    const next = maxUnits(Number(settlementQuote.savePercent) || savePercentRef.current);
    if (next === null) return;
    const value = next > BigInt(0) ? formatUnits(next, decimals) : "";
    if (value !== paymentAmount) onPaymentAmountChange(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxMode, settlementQuote?.totalRequired, settlementQuote?.savePercent]);

  function press(key: string) {
    setMaxMode(false);
    const current = paymentAmount;
    if (key === "del") {
      onPaymentAmountChange(current.slice(0, -1));
      return;
    }
    if (key === "." && current.includes(".")) return;
    const next = current === "0" && key !== "." ? key : `${current}${key}`;
    const [, decimals] = next.split(".");
    if (decimals && decimals.length > 6) return;
    onPaymentAmountChange(next === "." ? "0." : next);
  }

  function finish() {
    onConfirmOpenChange(false);
    onPaymentAmountChange("");
    onPaymentNarrationChange("");
  }

  let lastDay = "";

  return (
    <div className="sx-chat">
      <header className="sx-chat-head">
        <button aria-label="Back" className="sx-round" onClick={onBack} type="button">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="sx-chat-who">
          <Avatar name={recipientName} seed={recipientSeed} size="sm" url={recipientAvatar} />
          <span className="sx-chat-name">{recipientName}</span>
          {isRecipientValid ? (
            <span className="sx-chat-wallet">{shortenAddress(trimmedRecipientAddress)}</span>
          ) : null}
        </div>
        <button
          aria-label={isSaved ? "Saved as a beneficiary" : "Save as a beneficiary"}
          className={cn("sx-round", isSaved && "is-done")}
          disabled={isSaved || !isRecipientValid}
          onClick={() => onSaveOpenChange(true)}
          title={isSaved ? "Saved as a beneficiary" : "Save as a beneficiary"}
          type="button"
        >
          {isSaved ? <Check className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
        </button>
      </header>

      {treasuryBanner}

      <div className="sx-log" ref={logRef}>
        {isRecipientResolving ? (
          <p className="sx-muted sx-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Finding {recipientName}…
          </p>
        ) : !isRecipientValid ? (
          <div className="sx-center sx-log-empty">
            <AlertCircle className="h-6 w-6" />
            <p>{recipientResolveError ?? "Choose who to pay."}</p>
            <Button onClick={onBack} variant="outline">
              Change recipient
            </Button>
          </div>
        ) : bubbles.length === 0 ? (
          <div className="sx-center sx-log-empty">
            <Avatar name={recipientName} seed={recipientSeed} size="lg" url={recipientAvatar} />
            <p>
              Your first payment to <strong>{recipientName}</strong>. Tap Send money to start.
            </p>
          </div>
        ) : (
          bubbles.map((item) => {
            const date = item.occurredAt ? new Date(item.occurredAt) : null;
            const day = date ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Pending";
            const showDay = day !== lastDay;
            lastDay = day;
            const outgoing = item.direction !== "in";
            return (
              <div key={item.id}>
                {showDay ? <p className="sx-day">{day}</p> : null}
                <div className={cn("sx-bubble-row", outgoing ? "is-out" : "is-in")}>
                  {outgoing ? <CheckCircle2 className="sx-bubble-check h-5 w-5" /> : null}
                  <button
                    className="sx-bubble"
                    disabled={!openerFor(item)}
                    onClick={() => openerFor(item)?.()}
                    title="View receipt"
                    type="button"
                  >
                    <span className="sx-bubble-amount">
                      {formatAmount(item.amount)} {item.token}
                    </span>
                    <span className="sx-bubble-note">{outgoing ? "Sent" : "Received"}</span>
                  </button>
                </div>
                <p className={cn("sx-bubble-time", outgoing ? "is-out" : "is-in")}>
                  {date ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""}
                </p>
              </div>
            );
          })
        )}
      </div>

      {walletLock && !confirmOpen ? (
        <p className="sx-pending" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          Confirm in your wallet to send {formatAmount(paymentAmount)} {selectedToken}…
        </p>
      ) : null}

      {/* One button; the amount slides up to be filled in. */}
      <div className="sx-dock">
        <Button
          className="sx-dock-cta"
          disabled={!isRecipientValid || walletLock}
          onClick={() => setAmountOpen(true)}
          type="button"
        >
          Send money
        </Button>
      </div>

      <Sheet onOpenChange={setAmountOpen} open={amountOpen}>
        <SheetContent
          className={cn("gap-0 p-0", side === "bottom" ? "max-h-[92dvh] rounded-t-[1.75rem] border-t-0" : "w-full sm:max-w-md")}
          showCloseButton={false}
          side={side}
        >
          {side === "bottom" ? <SheetGrabber /> : null}
          <div className="sx-sheet sx-amount-sheet">
            <SheetTitle className="text-center text-lg font-bold">Send to {recipientName}</SheetTitle>
            <SheetDescription className="sr-only">Enter the amount and a note</SheetDescription>
        <div className="sx-balance">
          {selectedToken} balance: {hideBalance ? "••••" : balance !== undefined ? formatAmount(balance) : "—"}
        </div>
        <div className="sx-amount-row">
          <input
            aria-label="Amount"
            className="sx-amount"
            inputMode={touch ? "none" : "decimal"}
            onChange={(event) => {
              setMaxMode(false);
              onPaymentAmountChange(event.target.value.replace(/[^\d.]/g, ""));
            }}
            placeholder="0.00"
            readOnly={touch}
            value={paymentAmount}
          />
          <div aria-label="Token" className="sx-tokens" role="radiogroup">
            {arcTokenSymbols.map((symbol) => (
              <button
                aria-checked={symbol === selectedToken}
                className="sx-token"
                key={symbol}
                onClick={() => {
                  setMaxMode(false);
                  onSelectToken(symbol);
                }}
                role="radio"
                type="button"
              >
                <TokenIcon className="h-4 w-4" symbol={symbol} />
                {symbol}
              </button>
            ))}
          </div>
        </div>
        <div className="sx-chips">
          {[25, 50, 75, 100].map((percent) => (
            <button
              aria-pressed={percent === 100 ? maxMode : undefined}
              className="sx-chip"
              disabled={balance === undefined || walletLock}
              key={percent}
              onClick={() => fillPercent(percent)}
              type="button"
            >
              {percent === 100 ? "MAX" : `${percent}%`}
            </button>
          ))}
        </div>
        <div className="sx-note-row">
          <input
            aria-label="Narration"
            className="sx-note"
            maxLength={140}
            onChange={(event) => onPaymentNarrationChange(event.target.value)}
            placeholder="Narration (e.g. rent, lunch)"
            value={paymentNarration}
          />
          <button
            aria-label="Review payment"
            className="sx-send"
            disabled={!isRecipientValid || !hasAmount}
            onClick={() => {
              setAmountOpen(false);
              onConfirmOpenChange(true);
            }}
            type="button"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
        {touch ? (
          <div className="sx-keypad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((key) => (
              <button
                aria-label={key === "del" ? "Delete" : key}
                key={key}
                onClick={() => press(key)}
                type="button"
              >
                {key === "del" ? <Delete className="h-5 w-5" /> : key}
              </button>
            ))}
          </div>
        ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {receiptModals}

      {/* The coin travels to the recipient while the payment runs. */}
      <TransferProgressOverlay
        active={(awaitingWallet || isConfirming) && !paymentError}
        coin={selectedToken}
        current={isConfirming ? 1 : 0}
        details={{
          amount: `${formatAmount(paymentAmount)} ${selectedToken}`,
          explorerUrl: transactionExplorerUrl,
          extra:
            spendSaveNotice || recurringNotice ? (
              <div className="grid gap-2 text-sm text-muted-foreground">
                {spendSaveNotice ? <p>{spendSaveNotice}</p> : null}
                {recurringNotice ? (
                  <Link className="sx-link" href="/recurepay">
                    Your schedule is set. Authorize Autopay in RecurePay
                  </Link>
                ) : null}
              </div>
            ) : undefined,
          rows: [
            { label: "To", value: recipientName },
            ...(settlementQuote
              ? [{ label: settlementQuote.feeLabel, value: `${settlementQuote.feeAmount} ${selectedToken}` }]
              : []),
            ...(settlementQuote?.saveAmount
              ? [{ label: "Spend&Save", value: `${settlementQuote.saveAmount} ${selectedToken}` }]
              : []),
            ...(settlementQuote?.totalRequired
              ? [{ label: "Total debit", value: `${settlementQuote.totalRequired} ${selectedToken}` }]
              : []),
            ...(cashback.eligible
              ? [{ label: "Cashback", value: `${cashback.upTo ? "Up to " : ""}+${cashback.points} OnePoints` }]
              : []),
            { label: "Status", value: "Confirmed on Arc" },
          ],
        }}
        doneSubtitle={`To ${recipientName}`}
        doneTitle="Sent"
        from={<TokenIcon className="h-8 w-8" symbol={selectedToken} />}
        onDone={finish}
        state={transactionConfirmed ? "done" : "running"}
        steps={["Confirming the payment", "Sending on Arc"]}
        to={<Avatar name={recipientName} seed={recipientSeed} size="sm" url={recipientAvatar} />}
      />

      {/* Save as a beneficiary */}
      <Sheet onOpenChange={onSaveOpenChange} open={saveOpen}>
        <SheetContent
          className={cn("gap-0 p-0", side === "bottom" ? "rounded-t-[1.75rem] border-t-0" : "w-full sm:max-w-sm")}
          showCloseButton={false}
          side={side}
        >
          {side === "bottom" ? <SheetGrabber /> : null}
          <div className="sx-sheet">
            <SheetTitle className="text-center text-lg font-bold">Save beneficiary</SheetTitle>
            <SheetDescription className="text-center text-sm text-muted-foreground">
              Save {shortenAddress(trimmedRecipientAddress)} to pay them again in one tap.
            </SheetDescription>
            <Input
              autoFocus
              className="h-12"
              maxLength={80}
              onChange={(event) => onBeneficiaryNameChange(event.target.value)}
              placeholder="Name"
              value={beneficiaryName}
            />
            {beneficiaryError ? <p className="text-sm text-destructive">{beneficiaryError}</p> : null}
            {beneficiaryStatus ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{beneficiaryStatus}</p> : null}
            {needsSignIn ? (
              <Button className="h-12" disabled={isAuthenticatingWallet} onClick={onWalletSignIn} variant="outline">
                <KeyRound className="h-4 w-4" /> Sign in to save
              </Button>
            ) : null}
            <Button className="h-12 font-bold" disabled={!canSaveBeneficiary} onClick={onSaveBeneficiary}>
              {isBeneficiarySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirm and send */}
      <Sheet
        modal={!walletLock}
        onOpenChange={(next) => {
          if (walletLock) return;
          if (!next && transactionConfirmed) finish();
          else onConfirmOpenChange(next);
        }}
        open={confirmOpen}
      >
        <SheetContent
          className={cn("gap-0 p-0", side === "bottom" ? "max-h-[92dvh] rounded-t-[1.75rem] border-t-0" : "w-full sm:max-w-md")}
          onFocusOutside={(event) => {
            if (walletLock) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (walletLock) event.preventDefault();
          }}
          showCloseButton={false}
          side={side}
        >
          {side === "bottom" ? <SheetGrabber /> : null}
          <div className="sx-sheet">
            {(
              <>
                <div className="sx-confirm-head">
                  <Avatar name={recipientName} seed={recipientSeed} url={recipientAvatar} />
                  <div className="min-w-0">
                    <SheetTitle className="truncate text-base font-bold">{recipientName}</SheetTitle>
                    <SheetDescription className="truncate font-mono text-xs text-muted-foreground">
                      {shortenAddress(trimmedRecipientAddress)}
                    </SheetDescription>
                  </div>
                </div>
                <p className="sx-confirm-amount">
                  {formatAmount(paymentAmount)} <span>{selectedToken}</span>
                </p>
                {paymentNarration.trim() ? <p className="sx-confirm-note">{paymentNarration.trim()}</p> : null}

                <dl className="sx-confirm-rows">
                  <div>
                    <dt>From</dt>
                    <dd>
                      <Wallet className="h-3.5 w-3.5" />
                      {isEmbeddedWalletMode ? "Circle wallet" : "External wallet"} · {shortenAddress(walletAddress)}
                    </dd>
                  </div>
                  <div>
                    <dt>{settlementQuote?.feeLabel ?? "Service fee"}</dt>
                    <dd>{settlementQuote ? `${settlementQuote.feeAmount} ${selectedToken}` : "Shown with the amount"}</dd>
                  </div>
                  {settlementQuote?.saveAmount ? (
                    <div>
                      <dt>Spend&amp;Save</dt>
                      <dd>
                        {settlementQuote.saveAmount} {selectedToken}
                      </dd>
                    </div>
                  ) : null}
                  {settlementQuote?.totalRequired ? (
                    <div className="is-total">
                      <dt>Total debit</dt>
                      <dd>
                        {settlementQuote.totalRequired} {selectedToken}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Cashback</dt>
                    <dd className={cashback.eligible ? "is-good" : undefined}>
                      <Coins className="h-3.5 w-3.5" />
                      {cashback.eligible
                        ? `${cashback.upTo ? "Up to " : ""}+${cashback.points} OnePoints`
                        : cashback.upTo
                          ? "1 point per $10"
                          : "On sends of $20 or more"}
                    </dd>
                  </div>
                </dl>
                {settlementQuote?.saveLabel ? <p className="sx-muted">{settlementQuote.saveLabel}</p> : null}

                {isTreasuryMismatch && treasuryAddress ? (
                  <p className="sx-warn">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    This uses your personal wallet, not the workspace treasury ({shortenAddress(treasuryAddress)}).
                  </p>
                ) : null}

                <RecurringToggle checked={recurringEnabled} onCheckedChange={onRecurringEnabledChange} />
                {recurringEnabled ? (
                  <RecurringScheduleFields onChange={onRecurringChange} showAutopay={false} value={recurring} />
                ) : null}

                {paymentError ? (
                  <p className="sx-error">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {paymentError}
                  </p>
                ) : null}

                {!isConnected ? (
                  <p className="sx-muted sx-center">Connect a wallet to send.</p>
                ) : needsSignIn ? (
                  <Button className="sx-confirm-cta" disabled={isAuthenticatingWallet} onClick={onWalletSignIn}>
                    {isAuthenticatingWallet ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
                    Sign in to send
                  </Button>
                ) : isTreasuryMismatch && onSwitchToTreasury ? (
                  <Button className="sx-confirm-cta" onClick={onSwitchToTreasury}>
                    <Wallet className="h-5 w-5" />
                    Switch to treasury
                  </Button>
                ) : (
                  <Button
                    className="sx-confirm-cta"
                    disabled={busy || !canSubmitPayment}
                    onClick={() => {
                      setAwaitingWallet(true);
                      onConfirmOpenChange(false);
                      onSubmit();
                    }}
                  >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                    {busy ? "Sending…" : recurringEnabled ? primaryButtonText : `Send ${formatAmount(paymentAmount)} ${selectedToken}`}
                  </Button>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The ONE logo, tiny, on the photo of someone paid by ONE ID. */
function OneBadgeGlyph() {
  return <PlatformLogoMark className="sx-avatar-badge-mark" />;
}

/** Pay to › ONE ID: a chrome ID card with a photo, a name and the ".one" tag. */
function OneIdArt() {
  return (
    <svg aria-hidden className="sx-to-art" viewBox="0 0 96 96">
      <defs>
        <linearGradient id="sx-chrome" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#fdfdff" />
          <stop offset="0.45" stopColor="#d7d9e2" />
          <stop offset="0.7" stopColor="#f4f5f9" />
          <stop offset="1" stopColor="#a9adbb" />
        </linearGradient>
        <linearGradient id="sx-chrome-edge" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#8d91a0" />
        </linearGradient>
        <linearGradient id="sx-one" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <filter id="sx-art-shadow" height="140%" width="140%" x="-20%" y="-10%">
          <feDropShadow dx="0" dy="4" floodColor="#1e1b2e" floodOpacity="0.22" stdDeviation="3.5" />
        </filter>
      </defs>
      <g filter="url(#sx-art-shadow)" transform="rotate(-8 48 48)">
        <rect fill="url(#sx-chrome-edge)" height="50" rx="9" width="70" x="13" y="25" />
        <rect fill="url(#sx-chrome)" height="47" rx="8" width="67" x="14.5" y="26.5" />
        <circle cx="32" cy="45" fill="#c3c6d1" r="9" />
        <circle cx="32" cy="42.5" fill="#f6f7fb" r="3.6" />
        <path d="M24.8 51.5a8 8 0 0 1 14.4 0 9 9 0 0 1-14.4 0Z" fill="#f6f7fb" />
        <rect fill="#b4b8c5" height="4" rx="2" width="26" x="46" y="38" />
        <rect fill="#c9ccd6" height="3.5" rx="1.75" width="18" x="46" y="46" />
        <rect fill="url(#sx-one)" height="12" rx="6" width="30" x="44" y="56" />
        <text fill="#ffffff" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="8.5" fontWeight="800" x="49.5" y="64.6">
          .one
        </text>
      </g>
    </svg>
  );
}

/** Pay to › Wallet: a chrome wallet with its clasp. */
function WalletArt() {
  return (
    <svg aria-hidden className="sx-to-art" viewBox="0 0 96 96">
      <defs>
        <linearGradient id="sx-wallet" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#fbfbfd" />
          <stop offset="0.5" stopColor="#cfd2dc" />
          <stop offset="1" stopColor="#9a9eac" />
        </linearGradient>
        <linearGradient id="sx-wallet-flap" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b9bcc8" />
        </linearGradient>
        <filter id="sx-wallet-shadow" height="140%" width="140%" x="-20%" y="-10%">
          <feDropShadow dx="0" dy="4" floodColor="#1e1b2e" floodOpacity="0.22" stdDeviation="3.5" />
        </filter>
      </defs>
      <g filter="url(#sx-wallet-shadow)">
        <rect fill="#8e92a1" height="46" rx="8" width="62" x="15" y="28" />
        <rect fill="url(#sx-wallet)" height="44" rx="7.5" width="60" x="16" y="28" />
        <path d="M16 36c0-4 3-7 7-7h46c3 0 5 2 5 5v2Z" fill="url(#sx-wallet-flap)" opacity="0.9" />
        <rect fill="url(#sx-wallet-flap)" height="18" rx="6" width="22" x="58" y="41" />
        <rect fill="#8e92a1" height="18" opacity="0.35" rx="6" width="22" x="58" y="41.6" />
        <rect fill="url(#sx-wallet-flap)" height="17" rx="5.5" width="21.5" x="58.2" y="41" />
        <circle cx="66" cy="49.5" fill="#6e7282" r="3.4" />
        <circle cx="66" cy="49" fill="#e9eaf0" r="1.6" />
      </g>
    </svg>
  );
}
