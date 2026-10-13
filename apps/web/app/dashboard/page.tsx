"use client";

import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import {
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  zeroHash,
  type Address,
  type Hash,
} from "viem";

import { Button } from "@/components/ui/button";
import { TokenSelect } from "@/components/design/token-select";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { FeaturePromos } from "@/components/dashboard/feature-promos";
import { DashboardTransactions } from "@/components/dashboard/dashboard-transactions";
import { DashboardHome } from "@/components/dashboard/home/dashboard-home";
import { DashboardIncoming } from "@/components/deposit/dashboard-incoming";
import { DashboardCircleInvites } from "@/components/swift-circle/circle-invite-inbox";
import { useWalletTransfers } from "@/lib/use-wallet-transfers";
import { shortenAddress } from "@/lib/wallet-receipt";
import { SendHub } from "@/components/send/send-hub";
import {
  createRecurringDraft,
  datetimeLocalToIso,
  startTimeError,
  type RecurringScheduleDraft,
} from "@/components/recurring-schedule-fields";
import { useOptionalWorkspace } from "@/components/business/workspace-provider";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { recordAccountActivity } from "@/lib/activity/client";
import { recordPlatformTransactionActivity } from "@/lib/referral/activity-client";
import { LazyQRCodeSVG } from "@/components/lazy-qr-code";
import { useT } from "@/components/locale-provider";
import { ProfileMenu } from "@/components/profile-menu";
import { TokenIcon } from "@/components/token-icon";
import { WalletConnectButton } from "@/components/wallet-connect-button";
import {
  deleteBeneficiary,
  updateBeneficiary,
  type BeneficiaryRecord,
} from "@/lib/beneficiaries";
import {
  completePaymentRequest,
  fetchPaymentRequestStatus,
  paymentRequestClosedMessage,
} from "@/lib/payment-request-client";
import { buildPaymentRequestUrl } from "@/lib/payment-request-url";
import {
  createBusinessPayment,
  submitBusinessPayment,
} from "@/lib/business/client";
import {
  dedicatedBusinessWallet,
  personalCircleWallet,
} from "@/lib/business/provision-wallet";
import {
  ensureProfile,
  fetchProfile,
  readCachedProfile,
  formatUsernameLabel,
  type ProfileRecord,
} from "@/lib/profile";
import { useResolvedRecipient } from "@/lib/use-resolved-recipient";
import {
  fetchWalletSessionForAddress,
  signInWalletSession,
} from "@/lib/wallet-auth-client";
import type { WalletTransfer } from "@/lib/arcscan-history";
import { erc20Abi } from "@/lib/contracts";
import {
  feePercentLabel,
  platformFeeRecipient,
  platformFeeUnits,
  SEND_FEE_BPS,
} from "@/lib/fees";
import { executeBundledSend } from "@/lib/payments/execute-send";
import { useDisplayCurrency } from "@/lib/display-currency";
import {
  convertFromUsd,
  formatConvertedAmount,
  formatSignedConvertedAmount,
  useConversionRates,
  usdPerUnit,
} from "@/lib/use-conversion-rates";
import {
  circleDeviceIdHelp,
  executeCircleChallenge as runCircleChallenge,
  callCircleWalletApi,
  isCircleDeviceIdError,
  friendlyCircleSdkMessage,
  userFacingErrorMessage,
  getCircleLoginIdentity,
  preferArcCircleWallets,
  readCircleLogin,
  readCircleWallets,
  type CircleClientErrorPayload,
  type CircleLoginResult,
  type CircleWallet,
  writeCircleWallets,
} from "@/lib/circle-session";
import {
  extractCircleTransactionId,
  extractCircleTxHash,
  recoverCircleTxHash,
} from "@/lib/circle-tx";
import {
  arcTokens,
  arcTokenSymbols,
  type ArcTokenSymbol,
} from "@/lib/tokens";
import { createRecurringSchedule } from "@/lib/recurring-schedules";
import { quotePayment, type PaymentQuote } from "@/lib/save/client";
import { isSwiftSaveVaultConfigured } from "@/lib/save/config";
import {
  recordBundledSpendSave,
  settleSpendSaveAfterPayment,
} from "@/lib/save/spend-save-browser";
import { getSwapErrorMessage } from "@/lib/swap-errors";
import { trackTractionEvent } from "@/lib/traction/client";
import { fetchPublicInvoice, payPublicInvoice } from "@/lib/account/client";
import { fetchPublicCharge, payPublicCharge } from "@/lib/checkout/client";
import { cn } from "@/lib/utils";
import { CoinDetailSheet } from "@/components/dashboard/coin-detail-sheet";
import { switchToArc } from "@/lib/arc-network";
import { InstallAppBanner } from "@/components/pwa/install-app";
import { OneWatermark } from "@/components/brand/one-watermark";
import { usePreferredWalletMode } from "@/lib/use-preferred-wallet-mode";
import { arcChain } from "@/lib/chains";

const fallbackAddress = "0x0000000000000000000000000000000000000000";
const sampleAddress = "0xA71CE15C5A0F4B9d7217B8A7A2E6d9D3F55A9cE1";
const zeroAmount = BigInt(0);

function spendSaveBundleFromQuote(quote: PaymentQuote | null) {
  const active = Boolean(quote?.spendSave.active);
  let saveAmountUnits = 0n;
  if (active && quote?.spendSave.saveAmountUnits) {
    try {
      saveAmountUnits = BigInt(quote.spendSave.saveAmountUnits);
    } catch {
      saveAmountUnits = 0n;
    }
  }
  const vault = quote?.vaultAddress?.trim() ?? "";
  const pocketId = quote?.spendSave.pocketIdBytes32;
  const canBundle =
    active &&
    saveAmountUnits > 0n &&
    /^0x[a-fA-F0-9]{40}$/.test(vault) &&
    Boolean(pocketId && /^0x[a-fA-F0-9]{64}$/i.test(pocketId) && pocketId !== zeroHash);

  return {
    active,
    saveAmountUnits,
    canBundle,
    pocketName: quote?.spendSave.pocketName,
    saveAmount: quote?.spendSave.saveAmount,
    percentage: quote?.spendSave.percentage,
    save: canBundle
      ? {
          amount: saveAmountUnits,
          pocketId: pocketId as Hash,
          vault: vault as Address,
        }
      : undefined,
  };
}

type CircleTransferChallenge = {
  challengeId?: string;
  id?: string;
};

type CircleChallengeResult = {
  data?: {
    id?: string;
    transactionId?: string;
    txHash?: string;
  };
  id?: string;
  status?: string;
  transactionId?: string;
};

function formatDashboardGreetingName(username: string) {
  const normalized = username.trim().replace(/^@+/, "");
  const compact = normalized.replace(/[_-]+/g, " ");

  return compact
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function getTransferDateKey(timestamp: string | null) {
  if (!timestamp) {
    return null;
  }

  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function getStablecoinUsdValue(amount: bigint | undefined, decimals: number) {
  if (amount === undefined) {
    return undefined;
  }

  const value = Number(formatUnits(amount, decimals));
  return Number.isFinite(value) ? value : undefined;
}

/** The new dashboard home; false brings back the previous layout. */
const NEW_DASHBOARD = true;

type PortfolioFlow = {
  inflow7d: number;
  movements7d: number;
  movementsToday: number;
  netToday: number;
  outflow7d: number;
};

const emptyPortfolioFlow: PortfolioFlow = {
  inflow7d: 0,
  movements7d: 0,
  movementsToday: 0,
  netToday: 0,
  outflow7d: 0,
};

/**
 * Rolls the indexed transfer feed into the few figures the portfolio boards
 * show. EURC legs are valued at the live EUR/USD rate so the totals stay
 * comparable with the USD portfolio value.
 */
function buildPortfolioFlow(
  transfers: WalletTransfer[],
  fxRates: Record<string, number> | null,
): PortfolioFlow {
  const usdPerEur = usdPerUnit("EUR", fxRates) ?? 1;
  const todayKey = new Date().toISOString().slice(0, 10);
  const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const flow: PortfolioFlow = { ...emptyPortfolioFlow };

  for (const transfer of transfers) {
    const amount = Number(transfer.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const usdAmount = transfer.symbol === "EURC" ? amount * usdPerEur : amount;
    const timestamp = transfer.timestamp
      ? new Date(transfer.timestamp).getTime()
      : Number.NaN;

    if (getTransferDateKey(transfer.timestamp) === todayKey) {
      flow.movementsToday += 1;
      flow.netToday += transfer.direction === "in" ? usdAmount : -usdAmount;
    }

    if (Number.isFinite(timestamp) && timestamp >= weekCutoff) {
      flow.movements7d += 1;

      if (transfer.direction === "in") {
        flow.inflow7d += usdAmount;
      } else {
        flow.outflow7d += usdAmount;
      }
    }
  }

  return flow;
}

function formatShareLabel(share: number) {
  if (!Number.isFinite(share) || share <= 0) {
    return "0%";
  }

  if (share < 0.1) {
    return "<0.1%";
  }

  return `${share.toFixed(share >= 10 ? 0 : 1)}%`;
}

function PortfolioBoards({
  addressLabel,
  changeLabel,
  changeValue,
  currentValue,
  displayCurrency,
  flow,
  fxRates,
  hideBalance,
  isConnected,
  isLoading,
  onSelectToken,
  onToggleHideBalance,
  selectedToken,
  tokenBalances,
}: {
  addressLabel: string;
  changeLabel: string;
  changeValue: number | undefined;
  currentValue: number | undefined;
  displayCurrency: string;
  flow: PortfolioFlow;
  fxRates: Record<string, number> | null;
  hideBalance: boolean;
  isConnected: boolean;
  isLoading: boolean;
  onSelectToken: (symbol: ArcTokenSymbol) => void;
  onToggleHideBalance: () => void;
  selectedToken: ArcTokenSymbol;
  tokenBalances: Record<ArcTokenSymbol, bigint | undefined>;
}) {
  // Values arrive in USD. Without rates for a non-USD choice, show USD rather
  // than a converted figure we cannot stand behind.
  const canConvert = displayCurrency === "USD" || fxRates !== null;
  const activeCurrency = canConvert ? displayCurrency : "USD";
  const toDisplay = (usdValue: number | undefined) =>
    formatConvertedAmount(
      convertFromUsd(usdValue, activeCurrency, fxRates),
      activeCurrency,
    );
  // The board header already names the currency, so the figures inside it
  // read as plain grouped numbers rather than repeating the code.
  const fractionDigits = activeCurrency === "JPY" ? 0 : 2;
  const formatPlain = (amount: number | undefined) =>
    amount === undefined || !Number.isFinite(amount)
      ? "n/a"
      : new Intl.NumberFormat(undefined, {
          maximumFractionDigits: fractionDigits,
          minimumFractionDigits: fractionDigits,
        }).format(amount);
  const toPlainDisplay = (usdValue: number | undefined) =>
    formatPlain(convertFromUsd(usdValue, activeCurrency, fxRates));
  const toSignedPlainDisplay = (usdValue: number | undefined) => {
    const amount = convertFromUsd(usdValue, activeCurrency, fxRates);

    if (amount === undefined || !Number.isFinite(amount)) {
      return "n/a";
    }

    return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${formatPlain(Math.abs(amount))}`;
  };
  const mask = (label: string) => (hideBalance ? "••••" : label);
  // The coin whose market detail is open, if any.
  const [detailSymbol, setDetailSymbol] = useState<ArcTokenSymbol | null>(null);

  const usdPerEur = usdPerUnit("EUR", fxRates) ?? 1;
  const usdcUsd =
    getStablecoinUsdValue(tokenBalances.USDC, arcTokens.USDC.decimals) ?? 0;
  const eurcUnits =
    getStablecoinUsdValue(tokenBalances.EURC, arcTokens.EURC.decimals) ?? 0;
  const tokenUsdValues: Record<ArcTokenSymbol, number> = {
    EURC: eurcUnits * usdPerEur,
    USDC: usdcUsd,
  };
  const allocationTotal = tokenUsdValues.USDC + tokenUsdValues.EURC;
  const shares: Record<ArcTokenSymbol, number> =
    allocationTotal > 0
      ? {
          EURC: (tokenUsdValues.EURC / allocationTotal) * 100,
          USDC: (tokenUsdValues.USDC / allocationTotal) * 100,
        }
      : { EURC: 0, USDC: 0 };
  const hasAllocation = isConnected && allocationTotal > 0;

  const valueLabel = !isConnected
    ? "Connect wallet"
    : isLoading
      ? "Loading"
      : hideBalance
        ? "••••••"
        : toPlainDisplay(currentValue);
  const trend =
    changeValue === undefined || changeValue === 0
      ? "flat"
      : changeValue > 0
        ? "up"
        : "down";

  return (
    <div className="portfolio-boards">
      <article className="portfolio-hero one-watermark-host">
        <OneWatermark className="one-watermark-behind" />
        <div className="flex h-full flex-col gap-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Portfolio value · {activeCurrency}
              </p>
              <button
                aria-label={hideBalance ? "Show balances" : "Hide balances"}
                className="portfolio-hero-eye"
                onClick={onToggleHideBalance}
                type="button"
              >
                {hideBalance ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <span className={`portfolio-trend portfolio-trend-${trend}`}>
              {trend === "up" ? (
                <ArrowUpRight className="h-3.5 w-3.5" />
              ) : trend === "down" ? (
                <ArrowDownRight className="h-3.5 w-3.5" />
              ) : null}
              {changeLabel}
            </span>
          </header>

          <div>
            <p className="portfolio-hero-value">{valueLabel}</p>
            <p className="mt-2 font-mono text-[0.7rem] tracking-tight text-muted-foreground">
              {addressLabel}
            </p>
          </div>

          <div className="mt-auto">
            <div className="flex items-center justify-between text-[0.66rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              <span>Allocation</span>
              <span>{flow.movements7d} moves · 7d</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {arcTokenSymbols.map((symbol) => (
                <span className="portfolio-alloc-legend" key={symbol}>
                  <span
                    className={`portfolio-alloc-dot portfolio-alloc-dot-${symbol.toLowerCase()}`}
                  />
                  <span className="font-bold text-foreground">{symbol}</span>
                  <span className="text-muted-foreground">
                    {hasAllocation ? formatShareLabel(shares[symbol]) : "—"}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <dl className="portfolio-hero-stats">
            <div>
              <dt>Net today</dt>
              <dd className={flow.netToday < 0 ? "is-negative" : ""}>
                {mask(toSignedPlainDisplay(flow.netToday))}
              </dd>
            </div>
            <div>
              <dt>In · 7d</dt>
              <dd>{mask(toPlainDisplay(flow.inflow7d))}</dd>
            </div>
            <div>
              <dt>Out · 7d</dt>
              <dd>{mask(toPlainDisplay(flow.outflow7d))}</dd>
            </div>
          </dl>
        </div>
      </article>

      <div className="portfolio-token-column">
        {arcTokenSymbols.map((symbol) => (
          <TokenBalanceBoard
            convertedLabel={toDisplay(tokenUsdValues[symbol])}
            hideBalance={hideBalance}
            isActive={selectedToken === symbol}
            isConnected={isConnected}
            key={symbol}
            onOpen={() => setDetailSymbol(symbol)}
            onSelect={() => onSelectToken(symbol)}
            shareLabel={hasAllocation ? formatShareLabel(shares[symbol]) : "—"}
            symbol={symbol}
            units={tokenBalances[symbol]}
          />
        ))}
      </div>

      <CoinDetailSheet
        hideBalance={hideBalance}
        holdings={detailSymbol && isConnected ? tokenBalances[detailSymbol] : undefined}
        onOpenChange={(open) => {
          if (!open) setDetailSymbol(null);
        }}
        symbol={detailSymbol}
      />
    </div>
  );
}

function TokenBalanceBoard({
  convertedLabel,
  hideBalance,
  isActive,
  isConnected,
  onOpen,
  onSelect,
  shareLabel,
  symbol,
  units,
}: {
  convertedLabel: string;
  hideBalance: boolean;
  isActive: boolean;
  isConnected: boolean;
  onOpen: () => void;
  onSelect: () => void;
  shareLabel: string;
  symbol: ArcTokenSymbol;
  units: bigint | undefined;
}) {
  const token = arcTokens[symbol];
  const amountLabel = !isConnected
    ? "Nothing here yet"
    : hideBalance
      ? "••••••"
      : Number(formatUnits(units ?? 0n, token.decimals)).toLocaleString(
          undefined,
          { maximumFractionDigits: 4 },
        );

  // The card opens the coin's market detail; the pill beside it (a sibling,
  // not nested — buttons can't hold buttons) still picks the active token.
  return (
    <div className="relative">
    <button
      aria-label={`${token.name}: price, chart and market stats`}
      className={`token-board token-board-${symbol.toLowerCase()} ${
        isActive ? "token-board-active" : ""
      }`}
      onClick={onOpen}
      type="button"
    >
      <div className="flex h-full flex-col gap-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="token-board-icon">
              <TokenIcon className="h-6 w-6 rounded-full" symbol={symbol} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight text-foreground">
                {symbol}
              </p>
              <p className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {token.name}
              </p>
            </div>
          </div>
          {/* Holds the pill's space; the real control sits above the card. */}
          <span aria-hidden className="token-board-pill invisible">
            {isActive ? "Active" : "Select"}
          </span>
        </div>

        <div>
          <p className="token-board-amount">{amountLabel}</p>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {isConnected && !hideBalance ? `≈ ${convertedLabel}` : " "}
          </p>
        </div>

        <p className="token-board-share mt-auto">
          <span className="token-board-share-dot" />
          <span className="token-board-share-value">{shareLabel}</span>
          <span className="token-board-share-caption">of portfolio</span>
        </p>
      </div>
    </button>
    <button
      aria-pressed={isActive}
      className={`token-board-pill token-board-${symbol.toLowerCase()} absolute right-[1.1rem] top-4 z-10 ${
        isActive ? "token-board-pill-active" : "hover:text-foreground"
      }`}
      onClick={onSelect}
      type="button"
    >
      {isActive ? "Active" : "Select"}
    </button>
    </div>
  );
}

function getErrorMessage(error: unknown) {
  const friendly = friendlyCircleSdkMessage(error);
  if (friendly) {
    return friendly;
  }

  // Wallet errors first get the swap-specific wording, then the shared
  // plain-language pass — no raw codes ever reach the screen.
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null
          ? ((error as CircleClientErrorPayload).message ?? (error as CircleClientErrorPayload).error ?? "")
          : "";

  return userFacingErrorMessage(
    raw ? getSwapErrorMessage(raw.split("\n")[0] ?? raw) : error,
    "Transaction failed. Check wallet details and try again.",
  );
}

export function DashboardContent({
  preview = false,
  view = "dashboard",
}: {
  preview?: boolean;
  /** "send" renders only the payment workspace, on its own route. */
  view?: "dashboard" | "send";
} = {}) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const dashboardPrefillQuery = searchParams.toString();
  const incomingRequestId =
    new URLSearchParams(dashboardPrefillQuery).get("requestId")?.trim() || "";

  // The payment form lives on /send. Payment request links, and older links
  // that pointed here, carry their details in the query: pass them on.
  const hasPaymentPrefill = ["requestId", "to", "recipient", "username", "amount", "businessPayment", "invoice", "charge"]
    .some((key) => searchParams.has(key));
  // Paying a business invoice from a SaphraONE account: the invoice page sends
  // its public id so the payment is recorded against the invoice.
  const invoicePublicId =
    new URLSearchParams(dashboardPrefillQuery).get("invoice")?.trim() || "";
  const [linkedInvoice, setLinkedInvoice] = useState<{
    business: string;
    number: string;
    status: string;
  } | null>(null);
  const [invoiceRecording, setInvoiceRecording] = useState<
    "idle" | "recording" | "recorded" | "failed"
  >("idle");
  const recordedInvoiceHashes = useRef<Set<string>>(new Set());
  // Paying a Checkout charge (/c/<code> → "Pay with SaphraONE"): the code rides
  // along so the send is recorded against the charge.
  const chargeCode =
    new URLSearchParams(dashboardPrefillQuery).get("charge")?.trim().toUpperCase() || "";
  const [linkedCharge, setLinkedCharge] = useState<{
    business: string;
    code: string;
    status: string;
  } | null>(null);
  const [chargeRecording, setChargeRecording] = useState<
    "idle" | "recording" | "recorded" | "failed"
  >("idle");
  const recordedChargeHashes = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (view === "dashboard" && !preview && hasPaymentPrefill) {
      router.replace(`/send?${dashboardPrefillQuery}`);
    }
  }, [dashboardPrefillQuery, hasPaymentPrefill, preview, router, view]);
  const circleSdkRef = useRef<W3SSdk | null>(null);
  const {
    address: accountAddress,
    connector,
    isConnected: isAccountConnected,
  } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const { writeContractAsync, isPending: isWritePending } = useWriteContract();
  const publicClient = usePublicClient({ chainId: arcChain.id });
  const { signMessageAsync, isPending: isSigningIn } = useSignMessage();

  const [isMounted, setIsMounted] = useState(false);

  const [copied, setCopied] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<ArcTokenSymbol>("USDC");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [recurringDraft, setRecurringDraft] =
    useState<RecurringScheduleDraft>(createRecurringDraft);
  const [recurringNotice, setRecurringNotice] = useState<string | null>(null);
  const [paymentNarration, setPaymentNarration] = useState("");
  const [transactionHash, setTransactionHash] = useState<Hash>();
  const [transactionLabel, setTransactionLabel] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("Ready");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentQuote, setPaymentQuote] = useState<PaymentQuote | null>(null);
  const [spendSaveNotice, setSpendSaveNotice] = useState<string | null>(null);
  const spendSaveHandledTx = useRef<string | null>(null);
  const isRunningSpendSave = useRef(false);
  const spendSaveSettled = useRef(false);
  /** Snapshot of payment details at submit time so Spend&Save still runs after receipt. */
  const pendingSpendSavePayment = useRef<{
    amount: string;
    currency: ArcTokenSymbol;
    ownerWallet: string;
    bundled: boolean;
    pocketName?: string;
    saveAmount?: string;
  } | null>(null);
  const businessPaymentIdRef = useRef<string | null>(null);

  const [hideBalance, setHideBalance] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState("");
  const [receiveToken, setReceiveToken] = useState<ArcTokenSymbol>("USDC");
  const [paymentRequestCopied, setPaymentRequestCopied] = useState(false);
  const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(
    null,
  );
  const [walletMode, setWalletMode] = usePreferredWalletMode("circle");
  const [circleWallets, setCircleWallets] = useState<CircleWallet[]>([]);

  const [isCirclePaymentPending, setIsCirclePaymentPending] = useState(false);
  const [isPreparingPayment, setIsPreparingPayment] = useState(false);
  const [circleSendSettled, setCircleSendSettled] = useState(false);
  const [lastExecutedChainId, setLastExecutedChainId] = useState<number>(arcChain.id);
  const lastCashbackPoints = useRef<number | null>(null);


  const [savedBeneficiaries, setSavedBeneficiaries] = useState<
    BeneficiaryRecord[]
  >([]);
  const [authWallet, setAuthWallet] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isBeneficiariesLoading, setIsBeneficiariesLoading] = useState(false);
  const [isBeneficiarySaving, setIsBeneficiarySaving] = useState(false);
  const [beneficiaryStatus, setBeneficiaryStatus] = useState<string | null>(
    null,
  );
  const [beneficiaryError, setBeneficiaryError] = useState<string | null>(null);
  const [walletProfile, setWalletProfile] = useState<ProfileRecord | null>(null);
  const [incomingRequestStatus, setIncomingRequestStatus] = useState<
    "pending" | "paid" | "declined" | "expired" | "unknown" | null
  >(null);

  const [isRefreshingBalances, setIsRefreshingBalances] = useState(false);
  // Chosen in Settings; this page only reads it.
  const [displayCurrency] = useDisplayCurrency();
  const { rates: fxRates } = useConversionRates();

  const workspaceContext = useOptionalWorkspace();
  const activeWorkspace = workspaceContext?.workspace ?? null;
  const isBusinessWorkspace = activeWorkspace?.kind === "business";
  const publicUsername = isBusinessWorkspace
    ? activeWorkspace?.username ?? null
    : null;
  const externalAddress =
    isMounted && isAccountConnected ? accountAddress : undefined;
  const circleWallet = useMemo(() => {
    if (isBusinessWorkspace) {
      return (
        dedicatedBusinessWallet(
          activeWorkspace,
          circleWallets,
          workspaceContext?.ownerWallet,
        ) ??
        (workspaceContext?.ownerWallet
          ? circleWallets.find(
              (w) =>
                w.address?.toLowerCase() ===
                workspaceContext.ownerWallet?.toLowerCase(),
            )
          : null) ??
        circleWallets[0]
      );
    }
    return circleWallets[0];
  }, [
    activeWorkspace,
    circleWallets,
    isBusinessWorkspace,
    workspaceContext?.ownerWallet,
  ]);
  const circleAddress =
    circleWallet?.address && isAddress(circleWallet.address)
      ? (circleWallet.address as Address)
      : undefined;
  const isCircleWalletConnected = Boolean(circleLogin && circleAddress);
  const isEmbeddedWalletMode =
    walletMode === "circle" && isCircleWalletConnected;
  const isExternalWalletMode =
    walletMode === "external" ||
    (!isEmbeddedWalletMode && Boolean(externalAddress));
  // Prefer active Circle wallet when in circle mode; otherwise use external.
  // Fall back so a connected MetaMask is not ignored while walletMode is still "circle".
  const connectedAddress = isEmbeddedWalletMode
    ? (circleAddress || externalAddress)
    : (externalAddress ?? (isCircleWalletConnected ? circleAddress : undefined));

  const address =
    (isBusinessWorkspace && circleAddress ? circleAddress : undefined) ??
    connectedAddress;
  const isConnected = Boolean(address);

  const treasuryAddress =
    isBusinessWorkspace &&
    activeWorkspace?.paymentWallet &&
    isAddress(activeWorkspace.paymentWallet)
      ? (getAddress(activeWorkspace.paymentWallet).toLowerCase() as Address)
      : undefined;
  const isTreasuryMismatch = Boolean(
    isBusinessWorkspace &&
      !isEmbeddedWalletMode &&
      treasuryAddress &&
      address &&
      address.toLowerCase() !== treasuryAddress.toLowerCase(),
  );

  const handleSwitchToTreasuryWallet = useCallback(async () => {
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        await (window as any).ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
        return;
      }
      if (connector?.getProvider) {
        const provider = (await connector.getProvider()) as any;
        if (provider?.request) {
          await provider.request({
            method: "wallet_requestPermissions",
            params: [{ eth_accounts: {} }],
          });
        }
      }
    } catch (err: any) {
      if (err?.code !== 4001) {
        console.warn("Could not request account switch:", err);
      }
    }
  }, [connector]);

  const balanceTargetAddress = treasuryAddress ?? address;
  const walletAddress =
    (isBusinessWorkspace && treasuryAddress ? treasuryAddress : address) ??
    sampleAddress;
  const fallbackAddressTyped = fallbackAddress as Address;
  const isArcNetwork =
    isEmbeddedWalletMode || (isExternalWalletMode && chainId === arcChain.id);
  const selectedTokenInfo = arcTokens[selectedToken];
  const trimmedRecipientInput = recipientAddress.trim();
  const {
    displayLabel: recipientDisplayLabel,
    error: recipientResolveError,
    isResolving: isRecipientResolving,
    isValid: isRecipientValid,
    resolvedAddress: resolvedRecipientAddress,
    resolvedUsername: resolvedRecipientUsername,
  } = useResolvedRecipient(recipientAddress);
  const trimmedRecipientAddress = resolvedRecipientAddress ?? trimmedRecipientInput;
  const trimmedPaymentNarration = paymentNarration.trim();
  const trimmedBeneficiaryName = beneficiaryName.trim().replace(/\s+/g, " ");
  const isWalletAuthenticated = Boolean(
    isEmbeddedWalletMode ||
      (address && authWallet && authWallet.toLowerCase() === address.toLowerCase()),
  );
  const isAuthenticatingWallet = isAuthLoading || isSigningIn;

  const {
    data: rawEurcBalance,
    refetch: refetchEurcBalance,
  } = useReadContract({
    address: arcTokens.EURC.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [balanceTargetAddress ?? fallbackAddressTyped],
    chainId: arcChain.id,
    query: {
      enabled: Boolean(isConnected && (balanceTargetAddress || address)),
    },
  });

  const {
    data: rawUsdcBalance,
    refetch: refetchUsdcBalance,
  } = useReadContract({
    address: arcTokens.USDC.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [balanceTargetAddress ?? fallbackAddressTyped],
    chainId: arcChain.id,
    query: {
      enabled: Boolean(isConnected && (balanceTargetAddress || address)),
    },
  });

  const { data: transactionReceipt, isLoading: isConfirming } =
    useWaitForTransactionReceipt({
      hash: transactionHash,
      chainId: arcChain.id,
      pollingInterval: 400,
      query: {
        enabled: Boolean(transactionHash),
      },
    });

  const tokenBalances = {
    EURC: typeof rawEurcBalance === "bigint" ? rawEurcBalance : 0n,
    USDC: typeof rawUsdcBalance === "bigint" ? rawUsdcBalance : 0n,
  } satisfies Record<ArcTokenSymbol, bigint | undefined>;

  const portfolioValue = useMemo(() => {
    if (!isConnected) {
      return undefined;
    }

    const usdcValue = getStablecoinUsdValue(
      tokenBalances.USDC,
      arcTokens.USDC.decimals,
    );
    const eurcAmount = getStablecoinUsdValue(
      tokenBalances.EURC,
      arcTokens.EURC.decimals,
    );

    if (usdcValue === undefined || eurcAmount === undefined) {
      return undefined;
    }

    // EURC is euro-pegged. Value it at the live EUR/USD rate, falling back to
    // 1:1 only while rates are still loading.
    const usdPerEur = usdPerUnit("EUR", fxRates) ?? 1;

    return usdcValue + eurcAmount * usdPerEur;
  }, [fxRates, isConnected, tokenBalances.EURC, tokenBalances.USDC]);
  // Wallet history also feeds the portfolio chart; refetch after a payment
  // settles.
  const { transfers: walletTransfers } = useWalletTransfers(address, [
    transactionHash,
    transactionReceipt?.status,
  ].join("|"));
  const portfolioFlow = useMemo(
    () => buildPortfolioFlow(walletTransfers, fxRates),
    [fxRates, walletTransfers],
  );
  const portfolioChangeValue = isConnected ? portfolioFlow.netToday : undefined;
  const portfolioDisplayCurrency =
    displayCurrency === "USD" || fxRates !== null ? displayCurrency : "USD";
  const portfolioChangeLabel =
    portfolioChangeValue === undefined
      ? "Indexed by ArcScan"
      : portfolioFlow.movementsToday === 0
        ? "Flat today"
        : `${formatSignedConvertedAmount(
            convertFromUsd(
              portfolioChangeValue,
              portfolioDisplayCurrency,
              fxRates,
            ),
            portfolioDisplayCurrency,
          )} today`;
  const isPortfolioLoading = Boolean(isConnected && portfolioValue === undefined);

  const selectedTokenBalance = tokenBalances[selectedToken];

  const paymentAmountUnits = useMemo(() => {
    if (!paymentAmount.trim()) {
      return null;
    }

    try {
      return parseUnits(paymentAmount, selectedTokenInfo.decimals);
    } catch {
      return null;
    }
  }, [paymentAmount, selectedTokenInfo.decimals]);

  const spendSaveUnits = useMemo(() => {
    if (!paymentQuote?.spendSave.active || !paymentQuote.spendSave.saveAmountUnits) {
      return zeroAmount;
    }
    try {
      return BigInt(paymentQuote.spendSave.saveAmountUnits);
    } catch {
      return zeroAmount;
    }
  }, [paymentQuote]);

  const sendFeeUnits = useMemo(() => {
    if (paymentQuote?.platformFeeUnits) {
      try {
        return BigInt(paymentQuote.platformFeeUnits);
      } catch {
        return zeroAmount;
      }
    }
    if (paymentAmountUnits === null) {
      return zeroAmount;
    }
    return platformFeeUnits(paymentAmountUnits, SEND_FEE_BPS);
  }, [paymentAmountUnits, paymentQuote]);

  const totalPaymentRequiredUnits = useMemo(() => {
    if (paymentAmountUnits === null) return null;
    return paymentAmountUnits + sendFeeUnits + spendSaveUnits;
  }, [paymentAmountUnits, sendFeeUnits, spendSaveUnits]);

  const incomingRequestClosedMessage = incomingRequestStatus
    ? paymentRequestClosedMessage(incomingRequestStatus)
    : null;
  const isIncomingRequestClosed = Boolean(incomingRequestClosedMessage);
  const rawCurrentLocalBalance =
    selectedToken === "EURC"
      ? (typeof rawEurcBalance === "bigint" ? rawEurcBalance : 0n)
      : (typeof rawUsdcBalance === "bigint" ? rawUsdcBalance : 0n);

  const isNetworkReady =
    isEmbeddedWalletMode ||
    (isExternalWalletMode && chainId === arcChain.id);
  const hasEnoughArcBalance = Boolean(
    paymentAmountUnits !== null &&
      paymentAmountUnits > zeroAmount &&
      totalPaymentRequiredUnits !== null &&
      rawCurrentLocalBalance >= totalPaymentRequiredUnits,
  );
  const canSubmitPayment = Boolean(
    isConnected &&
      !isTreasuryMismatch &&
      isRecipientValid &&
      paymentAmountUnits !== null &&
      paymentAmountUnits > zeroAmount &&
      isNetworkReady &&
      hasEnoughArcBalance &&
      !isCirclePaymentPending &&
      !isPreparingPayment &&
      !isWritePending &&
      !(isConfirming && !circleSendSettled) &&
      !isIncomingRequestClosed,
  );
  const canSaveBeneficiary = Boolean(
    isConnected &&
      address &&
      isWalletAuthenticated &&
      isRecipientValid &&
      trimmedBeneficiaryName &&
      !isBeneficiarySaving,
  );
  const primaryButtonText = incomingRequestStatus === "declined"
    ? "Request declined"
    : incomingRequestStatus === "paid"
      ? "Request already paid"
    : incomingRequestStatus === "expired"
      ? "Request expired"
    : !isConnected
    ? "Connect wallet"
    : !isNetworkReady
      ? `Switch to ${arcChain.name}`
      : isTreasuryMismatch && treasuryAddress
        ? `Switch to business wallet (${shortenAddress(treasuryAddress)})`
        : isRecipientResolving
          ? "Resolving recipient"
          : !isRecipientValid
            ? "Enter recipient"
          : paymentAmountUnits === null || paymentAmountUnits <= zeroAmount
            ? "Enter amount"
            : selectedTokenBalance === undefined
              ? "Loading balance"
              : !hasEnoughArcBalance
                ? paymentQuote
                  ? `Need ${paymentQuote.totalRequired} ${selectedToken}`
                  : `Insufficient ${selectedToken}`
                : isEmbeddedWalletMode
                  ? `Send with Circle wallet`
                  : `Send ${selectedToken}`;
  const transactionExplorerUrl = transactionHash
    ? (lastExecutedChainId === 84532
        ? `https://sepolia.basescan.org/tx/${transactionHash}`
        : `${arcChain.blockExplorers.default.url}/tx/${transactionHash}`)
    : undefined;
  const paymentRequestUrl = useMemo(() => {
    if (!isMounted || typeof window === "undefined") {
      return "";
    }

    return buildPaymentRequestUrl({
      amount: receiveAmount,
      chainId: arcChain.id,
      origin: window.location.origin,
      path: "/pay",
      token: receiveToken,
      username:
        (isBusinessWorkspace ? publicUsername : walletProfile?.username) ||
        undefined,
      walletAddress,
    });
  }, [
    isMounted,
    receiveAmount,
    receiveToken,
    walletAddress,
    isBusinessWorkspace,
    publicUsername,
    walletProfile?.username,
  ]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    try {
      setHideBalance(window.localStorage.getItem("saphra.hide-balance") === "1");
    } catch {
      setHideBalance(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      return;
    }

    trackTractionEvent({
      chainId: arcChain.id,
      circleSocialUuid:
        getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined,
      eventType: "dashboard_active",
      metadata: {
        mode: isEmbeddedWalletMode ? "circle" : "external",
      },
      source: "dashboard",
      walletAddress: address,
    });
  }, [address, circleLogin, isEmbeddedWalletMode]);

  useEffect(() => {
    let cancelled = false;

    async function restoreCircleWallet() {
      const login = readCircleLogin();

      if (!login) {
        setCircleLogin(null);
        setCircleWallets([]);

        setWalletMode("external");
        return;
      }

      setCircleLogin(login);
      setWalletMode((currentMode) =>
        currentMode === "external" ? currentMode : "circle",
      );
      const cachedWallets = readCircleWallets();

      if (cachedWallets.length > 0) {
        setCircleWallets(cachedWallets);
      } else {
      }

      try {
        const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim() ?? "";

        if (appId) {
          const { W3SSdk: CircleW3SSdk } = await import(
            "@circle-fin/w3s-pw-web-sdk"
          );
          circleSdkRef.current = new CircleW3SSdk({
            appSettings: {
              appId,
            },
            authentication: {
              encryptionKey: login.encryptionKey,
              userToken: login.userToken,
            },
          });
        }

        const walletsPayload = await callCircleWalletApi<{
          wallets?: CircleWallet[];
        }>("listWallets", {
          userToken: login.userToken,
        });
        const wallets = preferArcCircleWallets(walletsPayload.wallets ?? []);
        const primaryWallet = personalCircleWallet(wallets);

        if (cancelled) {
          return;
        }

        setCircleWallets(wallets);
        writeCircleWallets(wallets);

        if (!primaryWallet) {
          return;
        }

        if (cancelled) {
          return;
        }
      } catch (error) {
        if (!cancelled) {
        }
      } finally {
        if (!cancelled) {
        }
      }
    }

    void restoreCircleWallet();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(dashboardPrefillQuery);
    const requestedRecipient = params.get("recipient") ?? params.get("to");
    const requestedUsername = params.get("username");
    const requestedAmount = params.get("amount");
    const requestedToken = params.get("token");
    const requestedMemo = params.get("memo");

    if (requestedUsername) {
      setRecipientAddress(
        requestedUsername.startsWith("@")
          ? requestedUsername
          : `@${requestedUsername}`,
      );
    } else if (requestedRecipient && isAddress(requestedRecipient)) {
      setRecipientAddress(requestedRecipient);
    } else if (requestedRecipient) {
      setRecipientAddress(
        requestedRecipient.startsWith("@")
          ? requestedRecipient
          : `@${requestedRecipient}`,
      );
    }

    if (requestedAmount) {
      setPaymentAmount(requestedAmount);
    }

    if (
      requestedToken &&
      arcTokenSymbols.includes(requestedToken as ArcTokenSymbol)
    ) {
      setSelectedToken(requestedToken as ArcTokenSymbol);
    }

    if (requestedMemo) {
      setPaymentNarration(requestedMemo);
    }

    if (
      requestedUsername ||
      requestedRecipient ||
      requestedAmount ||
      incomingRequestId
    ) {
      window.requestAnimationFrame(() => {
        document.getElementById("send")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  }, [dashboardPrefillQuery, incomingRequestId]);

  useEffect(() => {
    const workspaceId = new URLSearchParams(dashboardPrefillQuery).get(
      "workspace",
    );
    if (
      workspaceId &&
      workspaceContext?.setWorkspace &&
      workspaceContext.workspace?.id !== workspaceId
    ) {
      void workspaceContext.setWorkspace(workspaceId);
    }
  }, [
    dashboardPrefillQuery,
    workspaceContext?.setWorkspace,
    workspaceContext?.workspace?.id,
  ]);

  useEffect(() => {
    if (!incomingRequestId) {
      setIncomingRequestStatus(null);
      return;
    }

    let cancelled = false;
    setIncomingRequestStatus("pending");

    void fetchPaymentRequestStatus(incomingRequestId)
      .then((result) => {
        if (!cancelled) {
          setIncomingRequestStatus(result.status);
          const closed = paymentRequestClosedMessage(result.status);
          if (closed) {
            setPaymentError(closed);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIncomingRequestStatus("unknown");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [incomingRequestId]);

  useEffect(() => {
    if (!invoicePublicId) return;
    let cancelled = false;
    void fetchPublicInvoice(invoicePublicId)
      .then((payload) => {
        if (cancelled) return;
        setLinkedInvoice({
          business: payload.business.name,
          number: payload.invoice.invoice_number,
          status: payload.invoice.status,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [invoicePublicId]);

  useEffect(() => {
    if (!chargeCode) return;
    let cancelled = false;
    void fetchPublicCharge(chargeCode)
      .then((payload) => {
        if (cancelled) return;
        setLinkedCharge({
          business: payload.business.name,
          code: payload.charge.code,
          status: payload.charge.status,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chargeCode]);

  /**
   * Record a confirmed send against the Checkout charge it pays. Like an
   * invoice, the server reads the amount off the chain, so this retries while
   * the block propagates.
   */
  async function settleChargePayment(txHash?: string | null) {
    if (!chargeCode || !txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return;
    const key = txHash.toLowerCase();
    if (recordedChargeHashes.current.has(key)) return;
    recordedChargeHashes.current.add(key);
    setChargeRecording("recording");

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await payPublicCharge(chargeCode, {
          payerWallet: address || circleAddress || undefined,
          txHash,
        });
        setLinkedCharge((current) =>
          current ? { ...current, status: result.charge.status } : current,
        );
        setChargeRecording("recorded");
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
    setChargeRecording("failed");
    setPaymentError(
      `Your payment was sent, but it couldn't be matched to charge ${chargeCode}: ${getErrorMessage(lastError)} Show the transaction to ${linkedCharge?.business ?? "the business"} so they can confirm it.`,
    );
  }

  /**
   * Record a confirmed send against the invoice it pays. The server reads the
   * transfer off the chain, so this retries while the block propagates, and
   * credits only what actually reached the business in the invoice's token.
   */
  async function settleInvoicePayment(txHash?: string | null) {
    if (!invoicePublicId || !txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return;
    const key = txHash.toLowerCase();
    if (recordedInvoiceHashes.current.has(key)) return;
    recordedInvoiceHashes.current.add(key);
    setInvoiceRecording("recording");

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await payPublicInvoice(invoicePublicId, {
          amount: paymentAmount.trim(),
          asset: selectedToken,
          txHash,
        });
        setLinkedInvoice((current) =>
          current ? { ...current, status: result.invoice.status } : current,
        );
        setInvoiceRecording("recorded");
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
    setInvoiceRecording("failed");
    setPaymentError(
      `Your payment was sent, but it couldn't be matched to ${linkedInvoice?.number ?? "the invoice"}: ${getErrorMessage(lastError)} Share the transaction with ${linkedInvoice?.business ?? "the business"} so they can confirm it.`,
    );
  }

  async function settleIncomingPaymentRequest(txHash?: string | null) {
    if (!incomingRequestId || !address) {
      return;
    }

    try {
      await completePaymentRequest({
        circleSocialUuid:
          getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined,
        ownerWallet: address,
        requestId: incomingRequestId,
        txHash,
      });
      setIncomingRequestStatus("paid");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "This payment request is no longer open.";
      if (/declined|already paid|no longer open/i.test(message)) {
        setIncomingRequestStatus(
          /declined/i.test(message) ? "declined" : "paid",
        );
        setPaymentError(message);
      }
    }
  }

  useEffect(() => {
    if (!address) {
      setWalletProfile(null);
      return;
    }

    const connectedAddress =
      workspaceContext?.ownerWallet ?? address;
    let cancelled = false;

    // The last known profile first, so the picture is there at once.
    const cached = readCachedProfile(connectedAddress);
    if (cached) setWalletProfile(cached);

    async function loadWalletProfile() {
      try {
        const profile =
          (await fetchProfile(connectedAddress)) ??
          (await ensureProfile({
            authProvider: isEmbeddedWalletMode ? "google" : "external",
            circleSocialUuid: getCircleLoginIdentity(circleLogin).socialUserUUID,
            walletAddress: connectedAddress,
          }));

        if (!cancelled) {
          setWalletProfile(profile);
        }
      } catch {
        if (!cancelled) {
          setWalletProfile(cached);
        }
      }
    }

    void loadWalletProfile();

    return () => {
      cancelled = true;
    };
  }, [address, circleLogin, isEmbeddedWalletMode, workspaceContext?.ownerWallet]);

  useEffect(() => {
    if (!paymentAmountUnits || paymentAmountUnits <= zeroAmount || !address) {
      setPaymentQuote(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const social =
            getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined;
          const result = await quotePayment({
            ownerWallet: address,
            amount: paymentAmount.trim(),
            currency: selectedToken,
            paymentKind: "outgoing",
            circleSocialUuid: social,
          });
          if (cancelled) return;
          setPaymentQuote(result);
        } catch {
          // Keep the last successful quote so Spend&Save isn't dropped on a
          // transient 401/network blip while the user is reviewing the send.
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [address, paymentAmount, paymentAmountUnits, selectedToken, circleLogin]);

  async function fetchSubmitPaymentQuote(): Promise<PaymentQuote | null> {
    if (!address || !paymentAmount.trim()) {
      return paymentQuote;
    }

    const social =
      getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined;

    try {
      const result = await quotePayment({
        ownerWallet: address,
        amount: paymentAmount.trim(),
        currency: selectedToken,
        paymentKind: "outgoing",
        circleSocialUuid: social,
      });
      setPaymentQuote(result);
      return result;
    } catch {
      return paymentQuote;
    }
  }

  async function waitForPaymentReceipt(txHash: string) {
    if (!publicClient || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return;
    }
    try {
      await publicClient.waitForTransactionReceipt({
        hash: txHash as Hash,
        pollingInterval: 400,
        timeout: 15_000,
      });
    } catch {
      // complete() will still try a single receipt lookup
    }
  }

  /**
   * Always re-check Spend&Save on the server after a confirmed payment.
   * Do not rely only on client quote state (it can be null after submit / Circle).
   */
  async function runSpendSaveAfterConfirmedPayment(paymentTxHash: string) {
    if (isRunningSpendSave.current || spendSaveSettled.current) {
      return;
    }

    const snapshot = pendingSpendSavePayment.current;
    if (!snapshot) {
      return;
    }

    const ownerWallet = snapshot.ownerWallet;
    const amount = snapshot.amount;
    const currency = snapshot.currency;

    if (!ownerWallet || !amount || !paymentTxHash) {
      return;
    }

    // For unbundled savings, wait until we have a real mined on-chain hash
    if (!snapshot.bundled && (!paymentTxHash.startsWith("0x") || paymentTxHash.length !== 66)) {
      return;
    }

    if (spendSaveHandledTx.current === paymentTxHash) {
      return;
    }
    if (!isSwiftSaveVaultConfigured()) {
      setSpendSaveNotice(
        "Spend&Save is on, but the savings vault is not configured on this deployment.",
      );
      return;
    }

    isRunningSpendSave.current = true;
    spendSaveHandledTx.current = paymentTxHash;
    const social =
      getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined;

    try {
      await waitForPaymentReceipt(paymentTxHash);

      if (snapshot.bundled) {
        const settled = await recordBundledSpendSave({
          ownerWallet,
          amount,
          currency,
          paymentTxHash,
          circleSocialUuid: social,
        });
        const pocketLabel = snapshot.pocketName ?? "your pocket";
        const savedMsg = `${settled.saveAmount} ${currency} saved automatically to ${pocketLabel}.`;
        trackTractionEvent({
          amount: settled.saveAmount,
          chainId: arcChain.id,
          circleSocialUuid: social,
          currency,
          eventType: "savings_deposit_completed",
          metadata: {
            bundled: true,
            eventId: settled.eventId,
            pocketName: pocketLabel,
            transactionId: settled.transactionId,
          },
          source: "spend_save",
          txHash: settled.savingsTxHash,
          walletAddress: ownerWallet,
        });
        spendSaveSettled.current = true;
        setSpendSaveNotice(savedMsg);
        setPaymentStatus(`Payment successful. ${savedMsg}`);
        pendingSpendSavePayment.current = null;
        void refreshBalances();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("saphra:savings-updated"));
        }
        return;
      }

      // Server is source of truth for whether Spend&Save is active.
      const liveQuote = await quotePayment({
        ownerWallet,
        amount,
        currency,
        paymentKind: "outgoing",
        circleSocialUuid: social,
      });

      if (!liveQuote.spendSave.active) {
        setSpendSaveNotice(
          "Payment succeeded. Spend&Save was on at send time but is not active for this payment. Open Save to check the pocket currency and rule.",
        );
        pendingSpendSavePayment.current = null;
        spendSaveSettled.current = true;
        return;
      }

      const pocketLabel =
        liveQuote.spendSave.pocketName ?? "your pocket";

      setSpendSaveNotice(
        `Spend&Save: saving ${liveQuote.spendSave.saveAmount} ${currency} (${liveQuote.spendSave.percentage}%)…`,
      );
      setPaymentStatus(
        `Payment confirmed. Spend&Save: confirm the savings deposit…`,
      );

      const useCircle =
        isEmbeddedWalletMode &&
        Boolean(circleLogin && circleWallet?.id && circleSdkRef.current);

      const settled = await settleSpendSaveAfterPayment({
        ownerWallet,
        amount,
        currency,
        paymentTxHash,
        circleSocialUuid: social,
        mode: useCircle ? "circle" : "external",
        chainId: arcChain.id,
        writeContractAsync: useCircle
          ? undefined
          : async (args) =>
              writeContractAsync({
                address: args.address,
                abi: args.abi,
                functionName: args.functionName as "approve" | "deposit",
                args: args.args as never,
                chainId: args.chainId,
              }),
        circleExecutor:
          useCircle && circleLogin && circleWallet?.id
            ? {
                login: circleLogin,
                walletId: circleWallet.id,
                executeChallenge: async (challengeId) => {
                  const sdk = circleSdkRef.current;
                  if (!sdk) {
                    throw new Error(
                      "Circle wallet confirmation is not ready for Spend&Save.",
                    );
                  }
                  setPaymentStatus(
                    "Confirm Spend&Save deposit in Circle wallet…",
                  );
                  let challengeResult: CircleChallengeResult | undefined;
                  try {
                    challengeResult = (await runCircleChallenge(
                      sdk,
                      circleLogin,
                      challengeId,
                    )) as CircleChallengeResult | undefined;
                  } catch (error) {
                    throw new Error(getErrorMessage(error));
                  }
                  return {
                    transactionId:
                      challengeResult?.data?.transactionId ??
                      challengeResult?.transactionId ??
                      challengeResult?.data?.id ??
                      challengeResult?.id,
                    txHash: challengeResult?.data?.txHash,
                  };
                },
              }
            : undefined,
        readAllowance:
          useCircle && publicClient && circleAddress
            ? async (spender) =>
                publicClient.readContract({
                  abi: erc20Abi,
                  address: selectedTokenInfo.address,
                  args: [circleAddress, spender],
                  functionName: "allowance",
                })
            : undefined,
      });
      const savedMsg = `${settled.saveAmount} ${currency} saved automatically to ${pocketLabel}.`;
      trackTractionEvent({
        amount: settled.saveAmount,
        chainId: arcChain.id,
        circleSocialUuid: social,
        currency,
        eventType: "savings_deposit_completed",
        metadata: {
          eventId: settled.eventId,
          mode: useCircle ? "circle" : "external",
          pocketName: pocketLabel,
          transactionId: settled.transactionId,
        },
        source: "spend_save",
        txHash: settled.savingsTxHash,
        walletAddress: ownerWallet,
      });
      spendSaveSettled.current = true;
      setSpendSaveNotice(savedMsg);
      setPaymentStatus(`Payment successful. ${savedMsg}`);
      pendingSpendSavePayment.current = null;
      void refreshBalances();
    } catch (error) {
      if (spendSaveHandledTx.current === paymentTxHash) {
        spendSaveHandledTx.current = null;
      }
      const msg = `Payment succeeded. Spend&Save needs attention: ${getErrorMessage(error)}. Your payment wasn’t affected. Open Save to finish saving.`;
      setSpendSaveNotice(msg);
      setPaymentStatus(msg);
    } finally {
      isRunningSpendSave.current = false;
    }
  }

  useEffect(() => {
    if (!transactionHash || transactionReceipt || circleSendSettled) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setCircleSendSettled(true);
      setPaymentStatus(`${selectedToken} payment submitted`);
    }, 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [circleSendSettled, selectedToken, transactionHash, transactionReceipt]);

  useEffect(() => {
    if (!transactionReceipt) {
      return;
    }

    if (transactionReceipt.status === "success") {
      setPaymentError(null);
      setPaymentStatus(`${transactionLabel} confirmed`);
      void refreshBalances();

      const paymentTx = transactionReceipt.transactionHash;
      if (paymentTx) {
        if (!spendSaveSettled.current && pendingSpendSavePayment.current) {
          void runSpendSaveAfterConfirmedPayment(paymentTx);
        }
        void settleIncomingPaymentRequest(paymentTx);
      }

      return;
    }

    setPaymentError(`${transactionLabel} reverted`);
  }, [
    transactionReceipt,
    transactionReceipt?.status,
    transactionReceipt?.transactionHash,
    transactionLabel,
  ]);

  // A settled send ends on SendHub's animation receipt (components/send).

  useEffect(() => {
    if (!address || isEmbeddedWalletMode) {
      setAuthWallet(null);
      setIsAuthLoading(false);
      setBeneficiaryError(null);
      setBeneficiaryStatus(null);
      return;
    }

    const controller = new AbortController();
    const connectedAddress = address;

    async function loadWalletSession() {
      setIsAuthLoading(true);

      try {
        const session = await fetchWalletSessionForAddress(connectedAddress);
        if (controller.signal.aborted) {
          return;
        }

        setAuthWallet(
          session.authenticated && session.ownerWallet
            ? session.ownerWallet
            : null,
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setAuthWallet(null);
          setBeneficiaryError(getErrorMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsAuthLoading(false);
        }
      }
    }

    void loadWalletSession();

    return () => {
      controller.abort();
    };
  }, [address, isEmbeddedWalletMode]);

  useEffect(() => {
    if (!address || !isWalletAuthenticated) {
      setSavedBeneficiaries([]);
      setIsBeneficiariesLoading(false);
      setBeneficiaryStatus(null);
      return;
    }

    const controller = new AbortController();
    const ownerWallet = getAddress(address);

    async function loadBeneficiaries() {
      setIsBeneficiariesLoading(true);
      setBeneficiaryError(null);

      try {
        const params = new URLSearchParams({
          ownerWallet,
        });
        const circleSocialUuid =
          getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined;
        if (circleSocialUuid) {
          params.set("circleSocialUuid", circleSocialUuid);
        }
        const response = await fetch(`/api/beneficiaries?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          beneficiaries?: BeneficiaryRecord[];
          message?: string;
        };

        if (!response.ok) {
          throw new Error(payload.message ?? "Unable to load beneficiaries.");
        }

        const list = payload.beneficiaries ?? [];
        const withUsernames = await Promise.all(
          list.map(async (item) => {
            try {
              const profile = await fetchProfile(item.beneficiary_wallet);
              return { ...item, username: profile?.username ?? null };
            } catch {
              return item;
            }
          }),
        );
        if (!controller.signal.aborted) {
          setSavedBeneficiaries(withUsernames);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setBeneficiaryError(getErrorMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsBeneficiariesLoading(false);
        }
      }
    }

    void loadBeneficiaries();

    return () => {
      controller.abort();
    };
  }, [address, circleLogin, isWalletAuthenticated]);

  async function refreshCircleWallet() {
    if (!circleLogin || !circleWallet) {
      return;
    }
  }

  async function refreshBalances() {
    await Promise.allSettled([
      refetchEurcBalance(),
      refetchUsdcBalance(),
      refreshCircleWallet(),
    ]);
  }

  async function refreshBalancesFromButton() {
    setPaymentError(null);

    setIsRefreshingBalances(true);
    try {
      await refreshBalances();
      setPaymentStatus("Balances refreshed");
    } finally {
      setIsRefreshingBalances(false);
    }
  }

  async function ensureArcNetwork() {
    if (isArcNetwork) {
      return true;
    }

    try {
      await switchToArc(switchChainAsync);
      return true;
    } catch (error) {
      // switchToArc already words it: approve, add Arc, or open the wallet app.
      const message = error instanceof Error ? error.message : getErrorMessage(error);
      setPaymentError(message);

      return false;
    }
  }

  /** Who is editing contacts: this wallet, plus its Circle login if any. */
  function beneficiaryAuth() {
    if (!address) throw new Error("Connect a wallet to manage contacts.");
    return {
      ownerWallet: getAddress(address),
      circleSocialUuid: getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined,
    };
  }

  function mergeSavedBeneficiary(beneficiary: BeneficiaryRecord) {
    setSavedBeneficiaries((current) => {
      const withoutExisting = current.filter(
        (item) =>
          item.beneficiary_wallet.toLowerCase() !==
          beneficiary.beneficiary_wallet.toLowerCase(),
      );

      return [...withoutExisting, beneficiary].sort((first, second) =>
        first.name.localeCompare(second.name),
      );
    });
  }

  async function handleWalletSignIn() {
    setBeneficiaryError(null);
    setBeneficiaryStatus(null);

    if (!isConnected || !address) {
      setBeneficiaryError("Connect a wallet before signing in.");
      return;
    }

    try {
      setIsAuthLoading(true);

      const ownerWallet = getAddress(address);
      const session = await signInWalletSession({
        connectorName: connector?.name,
        ownerWallet,
        signMessage: (message) => signMessageAsync({ message }),
      });

      setAuthWallet(session.ownerWallet ?? ownerWallet);
      setBeneficiaryStatus("Wallet session ready");
    } catch (error) {
      setBeneficiaryError(getErrorMessage(error));
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function handleSaveBeneficiary() {
    setBeneficiaryError(null);
    setBeneficiaryStatus(null);

    if (!isConnected || !address) {
      setBeneficiaryError("Connect a wallet before saving beneficiaries.");
      return;
    }

    if (!isWalletAuthenticated) {
      setBeneficiaryError("Sign in with your wallet once before saving.");
      return;
    }

    if (!isRecipientValid) {
      setBeneficiaryError(
        recipientResolveError ??
          "Enter a valid beneficiary wallet address or @username.",
      );
      return;
    }

    if (!trimmedBeneficiaryName) {
      setBeneficiaryError("Enter a beneficiary name.");
      return;
    }

    try {
      setIsBeneficiarySaving(true);

      const beneficiaryWallet = getAddress(trimmedRecipientAddress);
      const response = await fetch("/api/beneficiaries", {
        body: JSON.stringify({
          beneficiaryWallet,
          circleSocialUuid:
            getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined,
          name: trimmedBeneficiaryName,
          ownerWallet: getAddress(address),
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as {
        beneficiary?: BeneficiaryRecord;
        message?: string;
      };

      if (!response.ok || !payload.beneficiary) {
        throw new Error(payload.message ?? "Beneficiary could not be saved.");
      }

      mergeSavedBeneficiary({
        ...payload.beneficiary,
        username: resolvedRecipientUsername,
      });
      setBeneficiaryStatus(`${trimmedBeneficiaryName} saved`);
    } catch (error) {
      setBeneficiaryError(getErrorMessage(error));
    } finally {
      setIsBeneficiarySaving(false);
    }
  }

  async function executePaymentCircleCall(
    callData: `0x${string}`,
    contractAddress: Address,
    refId: string,
    targetChainId?: number,
  ) {
    if (!circleLogin || !circleWallet?.id || !circleSdkRef.current) {
      throw new Error("Circle wallet confirmation is not ready.");
    }

    const effectiveWallet = circleWallet;
    setLastExecutedChainId(arcChain.id);

    setPaymentStatus(
      refId === "send-bundle"
        ? "Confirm payment in Circle wallet"
        : `Confirm ${refId} in Circle wallet`,
    );

    const challenge = await callCircleWalletApi<CircleTransferChallenge>(
      "createContractExecution",
      {
        callData,
        contractAddress,
        feeLevel: "HIGH",
        refId: trimmedPaymentNarration.slice(0, 50) || refId,
        userToken: circleLogin.userToken,
        walletId: effectiveWallet.id,
      },
    );

    if (!challenge.challengeId) {
      throw new Error("Circle did not return a transfer challenge.");
    }

    const executed = await executeCircleChallenge(challenge.challengeId, undefined, {
      recoverHash: true,
      walletId: effectiveWallet.id,
    });

    return {
      transactionId: challenge.id || challenge.challengeId || executed.transactionId,
      txHash: executed.txHash,
    };
  }

  async function prepareBusinessOutgoing() {
    businessPaymentIdRef.current = null;
    const existingPayment = new URLSearchParams(dashboardPrefillQuery).get(
      "businessPayment",
    );
    if (existingPayment) {
      businessPaymentIdRef.current = existingPayment;
      return true;
    }
    if (!isBusinessWorkspace || !activeWorkspace || !workspaceContext?.ownerWallet) {
      return true;
    }
    try {
      const result = await createBusinessPayment(
        workspaceContext.ownerWallet,
        activeWorkspace.id,
        {
          amount: paymentAmount.trim(),
          asset: selectedToken === "EURC" ? "EURC" : "USDC",
          memo: trimmedPaymentNarration,
          recipient: trimmedRecipientInput,
        },
        workspaceContext.circleSocialUuid,
      );
      if (
        result.payment.approval_status === "PENDING_APPROVAL" ||
        result.payment.approval_status === "PARTIALLY_APPROVED"
      ) {
        setPaymentError(
          "This payment needs approval in Overview before it can leave the business wallet.",
        );
        return false;
      }
      businessPaymentIdRef.current = result.payment.id;
      return true;
    } catch (error) {
      setPaymentError(getErrorMessage(error));
      return false;
    }
  }

  async function recordBusinessOutgoing(txHash: string) {
    const paymentId =
      businessPaymentIdRef.current ??
      new URLSearchParams(dashboardPrefillQuery).get("businessPayment");
    const workspaceId =
      activeWorkspace?.id ??
      new URLSearchParams(dashboardPrefillQuery).get("workspace");
    const owner =
      workspaceContext?.ownerWallet ?? circleAddress?.toLowerCase() ?? address?.toLowerCase();
    if (!paymentId || !workspaceId || !owner) return;
    await submitBusinessPayment(
      owner,
      workspaceId,
      paymentId,
      { txHash },
      workspaceContext?.circleSocialUuid ??
        getCircleLoginIdentity(circleLogin).socialUserUUID ??
        undefined,
    ).catch(() => undefined);
  }

  const processedCashbackIds = useRef<Set<string>>(new Set());
  const recordedSendHashes = useRef<Set<string>>(new Set());

  async function triggerTransactionCashback(txHash?: string, transactionId?: string) {
    // Runs for every send once its hash is known — including a Circle hash
    // recovered later — so the invoice is recorded whichever wallet paid.
    void settleInvoicePayment(txHash);
    void settleChargePayment(txHash);
    const actorAddress = address || circleAddress;
    if (!actorAddress || !paymentAmount.trim()) return;
    const numeric = parseFloat(paymentAmount.trim());
    if (isNaN(numeric) || numeric <= 0) return;

    const recipientLabel =
      beneficiaryName.trim() ||
      trimmedRecipientInput ||
      (resolvedRecipientAddress ? shortenAddress(resolvedRecipientAddress) : "recipient");

    // The Activity label needs the on-chain hash to find the transfer. A
    // Circle send often only has a transaction id at first, so this runs
    // again once the hash is recovered.
    if (
      txHash &&
      /^0x[0-9a-fA-F]{64}$/.test(txHash) &&
      !recordedSendHashes.current.has(txHash.toLowerCase())
    ) {
      recordedSendHashes.current.add(txHash.toLowerCase());
      void recordAccountActivity({
        amount: numeric,
        counterparty: recipientLabel,
        counterpartyWallet: incomingRequestId ? resolvedRecipientAddress : null,
        direction: "out",
        source: incomingRequestId ? "request" : chargeCode ? "checkout" : "send",
        title: incomingRequestId
          ? `Paid request from ${recipientLabel}`
          : chargeCode
            ? `Paid ${linkedCharge?.business ?? recipientLabel}`
            : `Sent to ${recipientLabel}`,
        token: selectedToken,
        txHash,
        walletAddress: actorAddress,
      });
    }

    const idKey = transactionId || txHash;
    if (idKey && processedCashbackIds.current.has(idKey)) {
      return;
    }
    if (idKey) {
      processedCashbackIds.current.add(idKey);
    }

    const data = await recordPlatformTransactionActivity({
      walletAddress: actorAddress,
      amount: numeric,
      token: selectedToken,
      txHash,
      transactionId,
      activityType: incomingRequestId || invoicePublicId ? "INVOICE_PAYMENT" : "TRANSFER",
      showToast: true,
    });

    if (data?.userCashback?.pointsAwarded > 0) {
      lastCashbackPoints.current = data.userCashback.pointsAwarded;
    }
  }

  async function handleCirclePaymentAction() {
    if (isIncomingRequestClosed) {
      setPaymentError(
        incomingRequestClosedMessage ??
          "This payment request is no longer open.",
      );
      return;
    }

    if (!circleLogin || !circleWallet?.id || !circleAddress) {
      setPaymentError("Circle wallet is not ready.");
      return;
    }

    if (!circleSdkRef.current) {
      setPaymentError("Circle wallet confirmation is not ready.");
      return;
    }

    if (!isRecipientValid || !resolvedRecipientAddress) {
      setPaymentError(
        recipientResolveError ??
          "Enter a valid recipient wallet address or @username.",
      );
      return;
    }

    if (!(await prepareBusinessOutgoing())) {
      return;
    }

    if (paymentAmountUnits === null || paymentAmountUnits <= zeroAmount) {
      setPaymentError("Enter a valid amount.");
      return;
    }

    if (!hasEnoughArcBalance) {
      setPaymentError(
          paymentQuote
            ? `Insufficient ${selectedToken}. This send needs ${paymentQuote.totalRequired} ${selectedToken} (payment + fee${paymentQuote.spendSave.active ? " + Spend&Save" : ""}).`
            : `Insufficient ${selectedToken} balance on Arc.`,
      );
      return;
    }

    const destinationAddress = getAddress(resolvedRecipientAddress);
    const recipientLabel = resolvedRecipientUsername
      ? formatUsernameLabel(resolvedRecipientUsername)
      : shortenAddress(destinationAddress);
    const feeRecipientValue = (paymentQuote?.feeRecipient ||
      platformFeeRecipient()) as Address;

    try {
      setIsCirclePaymentPending(true);
      setIsPreparingPayment(true);
      setCircleSendSettled(false);
      setPaymentStatus("Confirm payment in Circle wallet");
      isRunningSpendSave.current = false;
      spendSaveSettled.current = false;
      spendSaveHandledTx.current = null;

      const liveQuote = paymentQuote ?? (await fetchSubmitPaymentQuote());
      const saveBundle = spendSaveBundleFromQuote(liveQuote);
      const feeUnits = liveQuote?.platformFeeUnits
        ? BigInt(liveQuote.platformFeeUnits)
        : sendFeeUnits;

      if (saveBundle.active && !saveBundle.canBundle) {
        setSpendSaveNotice(
          "Spend&Save is on, but it could not be included in this send. Payment will continue. Finish saving from Save if needed.",
        );
      }

      pendingSpendSavePayment.current = saveBundle.active
        ? {
            amount: paymentAmount.trim(),
            bundled: Boolean(saveBundle.canBundle && saveBundle.save),
            currency: selectedToken,
            ownerWallet: circleAddress.toLowerCase(),
            pocketName: saveBundle.pocketName,
            saveAmount: saveBundle.saveAmount,
          }
        : null;

      setIsPreparingPayment(false);

      const result = await executeBundledSend({
        chainId: arcChain.id,
        circleExecutor: {
          execute: executePaymentCircleCall,
          walletId: circleWallet?.id,
        },
        router: liveQuote?.sendRouter ?? paymentQuote?.sendRouter,
        feeRecipient: (liveQuote?.feeRecipient || feeRecipientValue) as Address,
        feeUnits,
        mode: "circle",
        paymentUnits: paymentAmountUnits,
        readAllowance: publicClient
          ? async (spender) =>
              publicClient.readContract({
                abi: erc20Abi,
                address: selectedTokenInfo.address,
                args: [circleAddress, spender],
                functionName: "allowance",
              })
          : undefined,
        recipient: destinationAddress,
        save: saveBundle.save,
        token: selectedTokenInfo.address,
      });

      setPaymentError(null);
      setTransactionLabel(
        trimmedPaymentNarration
          ? `${trimmedPaymentNarration} to ${recipientLabel}`
          : `Payment to ${recipientLabel}`,
      );
      setCircleSendSettled(true);
      setPaymentStatus(`${selectedToken} payment submitted`);
      void refreshBalances();

      const finishWithHash = (txHash: string) => {
        if (txHash.startsWith("0x")) {
          setTransactionHash(txHash as Hash);
        }
        trackTractionEvent({
          amount: paymentAmount.trim(),
          chainId: arcChain.id,
          circleSocialUuid:
            getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined,
          currency: selectedToken,
          eventType: "payment_submitted",
          metadata: {
            bundledSave: result.bundledSave,
            mode: "circle",
            recipient: destinationAddress,
          },
          source: "dashboard",
          txHash,
          walletAddress: circleAddress,
        });
        if (result.bundledSave || (txHash.startsWith("0x") && txHash.length === 66)) {
          void runSpendSaveAfterConfirmedPayment(txHash);
        }
        void settleIncomingPaymentRequest(txHash);
        void recordBusinessOutgoing(txHash);
        void triggerTransactionCashback(txHash, result.transactionId);
      };

      // Award cashback immediately once user confirms challenge, using transactionId or txHash
      void triggerTransactionCashback(result.txHash, result.transactionId);

      const paymentRef = result.txHash || result.transactionId;
      if (paymentRef) {
        finishWithHash(paymentRef);
      }

      const txIdToPoll =
        result.transactionId ||
        (result.txHash && !result.txHash.startsWith("0x")
          ? result.txHash
          : undefined);

      const walletIdForPoll =
        (lastExecutedChainId === 84532
          ? circleWallets.find((w) => w.blockchain === "BASE-SEPOLIA")?.id
          : circleWallet?.id) ?? circleWallet?.id;

      if (txIdToPoll && circleLogin && walletIdForPoll) {
        void recoverCircleTxHash({
          attempts: 15,
          transactionId: txIdToPoll,
          userToken: circleLogin.userToken,
          walletId: walletIdForPoll,
        }).then((hash) => {
          if (hash) {
            setTransactionHash(hash as Hash);
            void recordBusinessOutgoing(hash);
            void triggerTransactionCashback(hash, txIdToPoll);
            void refreshBalances();
            if (!spendSaveSettled.current && pendingSpendSavePayment.current) {
              void runSpendSaveAfterConfirmedPayment(hash);
            }
          }
        });
      }
    } catch (error) {
      setPaymentError(getErrorMessage(error));
      setPaymentStatus("Circle transfer failed");
      trackTractionEvent({
        amount: paymentAmount.trim(),
        chainId: arcChain.id,
        circleSocialUuid:
          getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined,
        currency: selectedToken,
        eventType: "payment_failed",
        metadata: {
          message: getErrorMessage(error),
          mode: "circle",
        },
        source: "dashboard",
        walletAddress: circleAddress,
      });
      pendingSpendSavePayment.current = null;
    } finally {
      setIsPreparingPayment(false);
      setIsCirclePaymentPending(false);
    }
  }

  async function handleCreateRecurringFromPay() {
    if (!address) {
      setPaymentError("Connect a wallet before creating a recurring payment.");
      return false;
    }

    if (!isRecipientValid || !resolvedRecipientAddress) {
      setPaymentError(
        recipientResolveError ??
          "Enter a valid recipient wallet address or @username.",
      );
      return false;
    }

    if (!paymentAmount.trim()) {
      setPaymentError("Enter a valid amount.");
      return false;
    }

    const startError = startTimeError(recurringDraft.startsAt);
    if (startError) {
      setPaymentError(startError);
      return false;
    }

    const startsAt = datetimeLocalToIso(recurringDraft.startsAt);
    const endsAt = datetimeLocalToIso(recurringDraft.endsAt);

    if (endsAt && startsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
      setPaymentError("End time must be after the start time.");
      return false;
    }

    try {
      setIsPreparingPayment(true);
      setPaymentStatus("Creating recurring schedule");
      const schedule = await createRecurringSchedule({
        amount: paymentAmount.trim(),
        autopayEnabled: false,
        beneficiaryLabel: trimmedBeneficiaryName || undefined,
        beneficiaryUsername: resolvedRecipientUsername ?? undefined,
        beneficiaryWallet: resolvedRecipientAddress,
        circleSocialUuid:
          getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined,
        deferFirstOccurrence: true,
        endsAt,
        frequency: recurringDraft.frequency,
        intervalDays:
          recurringDraft.frequency === "custom"
            ? Number(recurringDraft.intervalDays) || undefined
            : undefined,
        maxRuns: recurringDraft.maxRuns
          ? Number(recurringDraft.maxRuns)
          : undefined,
        narration: trimmedPaymentNarration || "Pay schedule",
        ownerWallet: address,
        startsAt,
        tokenSymbol: selectedToken,
        walletMode: isEmbeddedWalletMode ? "circle" : "external",
      });

      setRecurringNotice(
        `${schedule.frequency} schedule created. Go to Recurepay to authorize Autopay.`,
      );

      setPaymentStatus("Recurring payment scheduled");
      setRecurringEnabled(false);
      return true;
    } catch (error) {
      setPaymentError(getErrorMessage(error));
      setPaymentStatus("Recurring schedule failed");
      return false;
    } finally {
      setIsPreparingPayment(false);
    }
  }

    async function handlePaymentAction() {
    setPaymentError(null);
    setSpendSaveNotice(null);
    setCircleSendSettled(false);
    setTransactionHash(undefined);
    setRecurringNotice(null);

    if (recurringEnabled) {
      const scheduled = await handleCreateRecurringFromPay();
      if (!scheduled) {
        return;
      }
    }

    if (isIncomingRequestClosed) {
      setPaymentError(
        incomingRequestClosedMessage ??
          "This payment request is no longer open.",
      );
      return;
    }

    if (!isConnected || !address) {
      setPaymentError("Connect with Google or an external wallet before sending.");
      return;
    }

    if (isTreasuryMismatch && treasuryAddress) {
      setPaymentError(
        `Active wallet (${shortenAddress(address)}) is not the business treasury (${shortenAddress(treasuryAddress)}). Switch to the business wallet in your wallet to pay from business funds.`,
      );
      void handleSwitchToTreasuryWallet();
      return;
    }

    if (isEmbeddedWalletMode) {
      await handleCirclePaymentAction();
      return;
    }

    setLastExecutedChainId(arcChain.id);
    if (!(await ensureArcNetwork())) {
      return;
    }

    if (!isRecipientValid || !resolvedRecipientAddress) {
      setPaymentError(
        recipientResolveError ??
          "Enter a valid recipient wallet address or @username.",
      );
      return;
    }

    if (!(await prepareBusinessOutgoing())) {
      return;
    }

    if (paymentAmountUnits === null || paymentAmountUnits <= zeroAmount) {
      setPaymentError("Enter a valid amount.");
      return;
    }

    if (!hasEnoughArcBalance) {
      setPaymentError(
          paymentQuote
            ? `Insufficient ${selectedToken}. This send needs ${paymentQuote.totalRequired} ${selectedToken} (payment + fee${paymentQuote.spendSave.active ? " + Spend&Save" : ""}).`
            : `Insufficient ${selectedToken} balance on Arc.`,
      );
      return;
    }

    const destinationAddress = getAddress(resolvedRecipientAddress) as Address;
    const recipientLabel = resolvedRecipientUsername
      ? formatUsernameLabel(resolvedRecipientUsername)
      : shortenAddress(destinationAddress);
    const feeRecipientValue = (paymentQuote?.feeRecipient ||
      platformFeeRecipient()) as Address;

    try {
      setIsPreparingPayment(true);
      setPaymentStatus("Confirm in your wallet...");
      isRunningSpendSave.current = false;
      spendSaveSettled.current = false;
      spendSaveHandledTx.current = null;

      const liveQuote = paymentQuote ?? (await fetchSubmitPaymentQuote());
      const saveBundle = spendSaveBundleFromQuote(liveQuote);
      const feeUnits = liveQuote?.platformFeeUnits
        ? BigInt(liveQuote.platformFeeUnits)
        : sendFeeUnits;

      if (saveBundle.active && !saveBundle.canBundle) {
        setSpendSaveNotice(
          "Spend&Save is on, but it could not be included in this send. Payment will continue. Finish saving from Save if needed.",
        );
      }

      pendingSpendSavePayment.current = saveBundle.active
        ? {
            amount: paymentAmount.trim(),
            bundled: Boolean(saveBundle.canBundle && saveBundle.save),
            currency: selectedToken,
            ownerWallet: address.toLowerCase(),
            pocketName: saveBundle.pocketName,
            saveAmount: saveBundle.saveAmount,
          }
        : null;

      setIsPreparingPayment(false);

      const result = await executeBundledSend({
        chainId: arcChain.id,
        feeRecipient: (liveQuote?.feeRecipient || feeRecipientValue) as Address,
        feeUnits,
        router: liveQuote?.sendRouter ?? paymentQuote?.sendRouter,
        mode: "external",
        paymentUnits: paymentAmountUnits,
        readAllowance: publicClient
          ? async (spender) =>
              publicClient.readContract({
                abi: erc20Abi,
                address: selectedTokenInfo.address,
                args: [address, spender],
                functionName: "allowance",
              })
          : undefined,
        recipient: destinationAddress,
        save: saveBundle.save,
        token: selectedTokenInfo.address,
        writeContractAsync: async (args) =>
          writeContractAsync({
            address: args.address,
            abi: args.abi,
            functionName: args.functionName as never,
            args: args.args as never,
            chainId: args.chainId,
          }),
      });

      const hash = result.txHash;
      if (hash) {
        setTransactionHash(hash);
        if (result.bundledSave || (hash.startsWith("0x") && hash.length === 66)) {
          void runSpendSaveAfterConfirmedPayment(hash);
        }
        void recordBusinessOutgoing(hash);
        void triggerTransactionCashback(hash);
      }
      void refreshBalances();
      trackTractionEvent({
        amount: paymentAmount.trim(),
        chainId: arcChain.id,
        currency: selectedToken,
        eventType: "payment_submitted",
        metadata: {
          mode: "external",
          recipient: destinationAddress,
        },
        source: "dashboard",
        txHash: hash,
        walletAddress: address,
      });
      setTransactionLabel(
        trimmedPaymentNarration
          ? `${trimmedPaymentNarration} to ${recipientLabel}`
          : `Payment to ${recipientLabel}`,
      );
      setPaymentStatus(`${selectedToken} payment submitted`);
    } catch (error) {
      pendingSpendSavePayment.current = null;
      setPaymentError(getErrorMessage(error));
      trackTractionEvent({
        amount: paymentAmount.trim(),
        chainId: arcChain.id,
        currency: selectedToken,
        eventType: "payment_failed",
        metadata: {
          message: getErrorMessage(error),
          mode: "external",
        },
        source: "dashboard",
        walletAddress: address,
      });
    } finally {
      setIsPreparingPayment(false);
    }
  }

    async function executeCircleChallenge(
    challengeId: string,
    label?: string,
    options?: { recoverHash?: boolean; walletId?: string },
  ) {
    const sdk = circleSdkRef.current;

    if (!circleLogin || !sdk) {
      throw new Error("Circle wallet confirmation is not ready.");
    }

    if (label) {
    }

    const runChallenge = async (client: W3SSdk) => {
      const challengeResult = (await runCircleChallenge(
        client,
        circleLogin,
        challengeId,
      )) as CircleChallengeResult | undefined;
      return {
        transactionId: extractCircleTransactionId(challengeResult),
        txHash: extractCircleTxHash(challengeResult),
      };
    };

    let executed: { transactionId?: string; txHash?: string };
    try {
      // Circle's window answers within seconds; if it never shows (blocked or
      // stuck on a phone), stop rather than spin forever.
      executed = await Promise.race([
        runChallenge(sdk),
        new Promise<never>((_, reject) => {
          window.setTimeout(
            () =>
              reject(
                new Error(
                  "Circle's confirmation didn't finish. Check Transactions before trying again; if it keeps happening, sign out and back in on this device.",
                ),
              ),
            120_000,
          );
        }),
      ]);
    } catch (error) {
      document.getElementById("sdkIframe")?.remove();
      void fetch("/api/client-errors", {
        body: JSON.stringify({
          message: `circle-execute: ${error instanceof Error ? error.message : JSON.stringify(error)}`.slice(0, 500),
          path: window.location.pathname,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }).catch(() => undefined);
      // executeCircleChallenge already tried renewing the login on this device
      // and marked the session stale.
      if (isCircleDeviceIdError(error)) {
        throw new Error(circleDeviceIdHelp);
      }
      throw new Error(getErrorMessage(error));
    }

    const targetWalletId = options?.walletId || circleWallet?.id;
    if (options?.recoverHash === false || executed.txHash || !targetWalletId) {
      return executed;
    }

    const recovered = await recoverCircleTxHash({
      transactionId: executed.transactionId,
      userToken: circleLogin.userToken,
      walletId: targetWalletId,
    });

    return {
      transactionId: executed.transactionId,
      txHash: recovered ?? executed.txHash,
    };
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  async function copyPaymentRequest() {
    if (!paymentRequestUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(paymentRequestUrl);
      setPaymentRequestCopied(true);
      window.setTimeout(() => setPaymentRequestCopied(false), 1400);
    } catch {
      setPaymentRequestCopied(false);
    }
  }

  function handleCircleSessionCleared() {
    circleSdkRef.current = null;
    setCircleLogin(null);
    setCircleWallets([]);

    setWalletMode("circle");
  }

  const dashboardGreetingName = isBusinessWorkspace
    ? activeWorkspace?.name ?? null
    : walletProfile?.username
      ? formatDashboardGreetingName(walletProfile.username)
      : null;

  const displayUsername = isBusinessWorkspace
    ? publicUsername
    : walletProfile?.username ?? null;

  // Send lives on its own page, paired with the contacts list.
  const sendWorkspace = (
    <section className="send-hub-shell" id="send">
      <div className="min-w-0">
        {invoicePublicId && linkedInvoice ? (
          <div
            className={cn(
              "mb-4 rounded-xl border px-3 py-2.5 text-sm",
              invoiceRecording === "recorded"
                ? "border-emerald-500/40 bg-emerald-500/10"
                : invoiceRecording === "failed"
                  ? "border-destructive/40 bg-destructive/10"
                  : "border-primary/30 bg-primary/5",
            )}
          >
            {invoiceRecording === "recorded" ? (
              <p>
                <span className="font-semibold">{linkedInvoice.number}</span>{" "}
                {linkedInvoice.status === "PAID" ? "is paid" : "has a payment recorded"} ·{" "}
                <a
                  className="font-medium text-primary hover:underline"
                  href={`/invoice/${encodeURIComponent(invoicePublicId)}`}
                >
                  View invoice
                </a>
              </p>
            ) : invoiceRecording === "recording" ? (
              <p>Recording your payment on {linkedInvoice.number}…</p>
            ) : linkedInvoice.status === "PAID" || linkedInvoice.status === "CANCELLED" ? (
              <p>
                {linkedInvoice.number} from {linkedInvoice.business} is already{" "}
                {linkedInvoice.status.toLowerCase()} — there&rsquo;s nothing to pay.
              </p>
            ) : (
              <p>
                Paying invoice <span className="font-semibold">{linkedInvoice.number}</span> from{" "}
                {linkedInvoice.business}. Keep the recipient and token as filled in so the payment
                is matched to the invoice.
              </p>
            )}
          </div>
        ) : null}
        {chargeCode && linkedCharge ? (
          <div
            className={cn(
              "mb-4 rounded-xl border px-3 py-2.5 text-sm",
              chargeRecording === "recorded"
                ? "border-emerald-500/40 bg-emerald-500/10"
                : chargeRecording === "failed"
                  ? "border-destructive/40 bg-destructive/10"
                  : "border-primary/30 bg-primary/5",
            )}
          >
            {chargeRecording === "recorded" ? (
              <p>
                {linkedCharge.business}{" "}
                {linkedCharge.status === "PAID" ? "has your payment" : "received part of the payment"} ·{" "}
                <a
                  className="font-medium text-primary hover:underline"
                  href={`/c/${encodeURIComponent(chargeCode)}`}
                >
                  View receipt
                </a>
              </p>
            ) : chargeRecording === "recording" ? (
              <p>Recording your payment to {linkedCharge.business}…</p>
            ) : linkedCharge.status !== "OPEN" ? (
              <p>
                This charge from {linkedCharge.business} is{" "}
                {linkedCharge.status.toLowerCase()} — there&rsquo;s nothing to pay.
              </p>
            ) : (
              <p>
                Paying <span className="font-semibold">{linkedCharge.business}</span> (charge{" "}
                {linkedCharge.code}). Keep the recipient and token as filled in so the payment is
                matched to the charge.
              </p>
            )}
          </div>
        ) : null}
        <SendHub
          address={address}
          treasuryAddress={treasuryAddress}
          isTreasuryMismatch={isTreasuryMismatch}
          onSwitchToTreasury={handleSwitchToTreasuryWallet}
          authWallet={authWallet}
          beneficiaryError={beneficiaryError}
          beneficiaryName={beneficiaryName}
          beneficiaryStatus={beneficiaryStatus}
          canSaveBeneficiary={canSaveBeneficiary}
          availableBalance={
            selectedTokenBalance !== undefined
              ? formatUnits(selectedTokenBalance, selectedTokenInfo.decimals)
              : undefined
          }
          availableBalances={(["USDC", "EURC"] as const).flatMap((symbol) => {
            const raw = tokenBalances[symbol];
            return raw === undefined
              ? []
              : [
                  {
                    amount: formatUnits(raw, arcTokens[symbol].decimals),
                    symbol,
                  },
                ];
          })}
          hideBalance={hideBalance}
          canSubmitPayment={canSubmitPayment}
          isAuthenticatingWallet={isAuthenticatingWallet}
          isBeneficiarySaving={isBeneficiarySaving}
          isCirclePaymentPending={isCirclePaymentPending}
          isConfirming={isConfirming}
          isConnected={isConnected}
          isEmbeddedWalletMode={isEmbeddedWalletMode}
          isRecipientResolving={isRecipientResolving}
          isRecipientValid={isRecipientValid}
          recipientDisplayLabel={recipientDisplayLabel}
          recipientResolveError={recipientResolveError}
          resolvedRecipientUsername={resolvedRecipientUsername}
          isSubmitting={
            isWritePending ||
            isConfirming ||
            isCirclePaymentPending ||
            isPreparingPayment
          }
          isSwitchingChain={isSwitchingChain}
          isWalletAuthenticated={isWalletAuthenticated}
          isWritePending={isWritePending}
          onBeneficiaryNameChange={setBeneficiaryName}
          onPaymentAmountChange={setPaymentAmount}
          onPaymentNarrationChange={setPaymentNarration}
          onRecipientChange={setRecipientAddress}
          onRecurringChange={setRecurringDraft}
          onRecurringEnabledChange={setRecurringEnabled}
          onSaveBeneficiary={() => void handleSaveBeneficiary()}
          onSelectToken={setSelectedToken}
          onSubmit={() => void handlePaymentAction()}
          onWalletSignIn={() => void handleWalletSignIn()}
          paymentAmount={paymentAmount}
          paymentAmountUnits={paymentAmountUnits}
          paymentError={paymentError}
          paymentNarration={paymentNarration}
          paymentStatus={paymentStatus}
          spendSaveNotice={spendSaveNotice}
          primaryButtonText={
            recurringEnabled ? "Pay and schedule" : primaryButtonText
          }
          receiveHref={
            displayUsername
              ? `/pay?username=${encodeURIComponent(displayUsername)}`
              : `/pay?to=${encodeURIComponent(walletAddress)}`
          }
          recipientAddress={recipientAddress}
          recurring={recurringDraft}
          recurringEnabled={recurringEnabled}
          recurringNotice={recurringNotice}
          refreshBalances={refreshBalancesFromButton}
          isRefreshingBalances={isRefreshingBalances}
          selectedToken={selectedToken}
          settlementQuote={
            paymentAmountUnits
              ? {
                  feeAmount:
                    paymentQuote?.platformFeeAmount ??
                    formatUnits(sendFeeUnits, selectedTokenInfo.decimals),
                  feeLabel: `${feePercentLabel(SEND_FEE_BPS)} service fee`,
                  saveAmount: paymentQuote?.spendSave.active
                    ? paymentQuote.spendSave.saveAmount
                    : undefined,
                  saveLabel: paymentQuote?.spendSave.active
                    ? `Spend&Save ${paymentQuote.spendSave.percentage}% to ${paymentQuote.spendSave.pocketName ?? "your pocket"} is included in this transaction.`
                    : undefined,
                  savePercent: paymentQuote?.spendSave.active
                    ? paymentQuote.spendSave.percentage
                    : undefined,
                  totalRequired:
                    paymentQuote?.totalRequired ??
                    formatUnits(
                      paymentAmountUnits + sendFeeUnits + spendSaveUnits,
                      selectedTokenInfo.decimals,
                    ),
                }
              : null
          }
          shortenAddress={shortenAddress}
          transactionConfirmed={
            transactionReceipt?.status === "success" || circleSendSettled
          }
          transactionExplorerUrl={transactionExplorerUrl}
          trimmedPaymentNarration={trimmedPaymentNarration}
          trimmedRecipientAddress={trimmedRecipientAddress}
          walletAddress={walletAddress}
          isBeneficiariesLoading={isBeneficiariesLoading}
          onDeleteBeneficiary={async (beneficiary) => {
            await deleteBeneficiary(beneficiaryAuth(), beneficiary.beneficiary_wallet);
            setSavedBeneficiaries((current) =>
              current.filter(
                (item) =>
                  item.beneficiary_wallet.toLowerCase() !==
                  beneficiary.beneficiary_wallet.toLowerCase(),
              ),
            );
          }}
          onUpdateBeneficiary={async (beneficiary, edit) => {
            const saved = await updateBeneficiary(beneficiaryAuth(), {
              beneficiaryWallet: beneficiary.beneficiary_wallet,
              name: edit.name,
              newBeneficiaryWallet: edit.wallet,
            });
            setSavedBeneficiaries((current) =>
              current
                .map((item) =>
                  item.beneficiary_wallet.toLowerCase() ===
                  beneficiary.beneficiary_wallet.toLowerCase()
                    ? { ...saved, username: edit.username }
                    : item,
                )
                .sort((first, second) => first.name.localeCompare(second.name)),
            );
          }}
          refreshKey={[transactionHash, transactionReceipt?.status, circleSendSettled].join("|")}
          savedBeneficiaries={savedBeneficiaries}
        />
      </div>
    </section>
  );

  const dashboardWorkspace = (
    <>
        <section className="dashboard-balances" id="balances">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="dashboard-greeting">
                {t("dashboard.welcome")}
                {dashboardGreetingName ? (
                  <>
                    ,{" "}
                    <span className="dashboard-greeting-name">
                      {dashboardGreetingName}
                    </span>
                  </>
                ) : null}
              </p>
              <h1 className="section-title dashboard-funds-title">
                {isBusinessWorkspace
                  ? t("dashboard.businessBalance")
                  : t("dashboard.yourFunds")}
              </h1>
            </div>
          </div>

          <InstallAppBanner className="mb-4" />

          <PortfolioBoards
            addressLabel={shortenAddress(walletAddress)}
            changeLabel={portfolioChangeLabel}
            changeValue={portfolioChangeValue}
            currentValue={portfolioValue}
            displayCurrency={displayCurrency}
            flow={portfolioFlow}
            fxRates={fxRates}
            hideBalance={hideBalance}
            isConnected={isConnected}
            isLoading={isPortfolioLoading}
            onSelectToken={setSelectedToken}
            onToggleHideBalance={() => {
              setHideBalance((current) => {
                const next = !current;
                try {
                  window.localStorage.setItem(
                    "saphra.hide-balance",
                    next ? "1" : "0",
                  );
                } catch {
                  // ignore
                }
                return next;
              });
            }}
            selectedToken={selectedToken}
            tokenBalances={tokenBalances}
          />

          {isTreasuryMismatch && treasuryAddress ? (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="font-semibold">Business Treasury Wallet Mismatch</p>
                  <p className="mt-0.5 text-xs opacity-90">
                    Your active wallet (<strong>{shortenAddress(address)}</strong>) does not match {activeWorkspace?.name ?? "this workspace"}&apos;s treasury wallet (<strong>{shortenAddress(treasuryAddress)}</strong>). Transactions sent now will be debited from your personal wallet.
                  </p>
                </div>
              </div>
              <Button
                className="shrink-0 border-amber-500/40 hover:bg-amber-500/20"
                onClick={handleSwitchToTreasuryWallet}
                size="sm"
                type="button"
                variant="outline"
              >
                Switch in wallet
              </Button>
            </div>
          ) : null}

        </section>

        <div className="dashboard-utility-row">
          <QuickActions />
        </div>

        <DashboardTransactions
          ownerWallet={address}
          refreshKey={[transactionHash, transactionReceipt?.status].join("|")}
        />

        <FeaturePromos />

        <DashboardCircleInvites />

    </>
  );

  // ── The new home (2026-10-05). Set NEW_DASHBOARD to false to bring back the
  // previous layout below, which is kept intact.
  const homeFraction = portfolioDisplayCurrency === "JPY" ? 0 : 2;
  const homePlain = (usdValue: number | undefined) => {
    const amount = convertFromUsd(usdValue, portfolioDisplayCurrency, fxRates);
    return amount === undefined || !Number.isFinite(amount)
      ? "0.00"
      : new Intl.NumberFormat(undefined, {
          maximumFractionDigits: homeFraction,
          minimumFractionDigits: homeFraction,
        }).format(amount);
  };
  const homeUsdPerEur = usdPerUnit("EUR", fxRates) ?? 1;
  const homeUsdc = getStablecoinUsdValue(tokenBalances.USDC, arcTokens.USDC.decimals) ?? 0;
  const homeEurc = getStablecoinUsdValue(tokenBalances.EURC, arcTokens.EURC.decimals) ?? 0;
  const homeTotal = homeUsdc + homeEurc * homeUsdPerEur;
  const homeTokens = (["USDC", "EURC"] as const)
    .map((symbol) => {
      const units = symbol === "USDC" ? homeUsdc : homeEurc;
      const usd = symbol === "USDC" ? homeUsdc : homeEurc * homeUsdPerEur;
      return {
        amount: units.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }),
        share: homeTotal > 0 ? (usd / homeTotal) * 100 : 0,
        symbol,
      };
    })
    .filter((token) => token.symbol === "USDC" || homeEurc > 0);
  const toggleHideBalance = () => {
    setHideBalance((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("saphra.hide-balance", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  const dashboardHome = (
    <DashboardHome
      avatarUrl={walletProfile?.avatar_url ?? null}
      balanceLabel={homePlain(portfolioValue)}
      banners={
        <>
          <InstallAppBanner />
          <DashboardIncoming />
          {isTreasuryMismatch && treasuryAddress ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="font-semibold">Business Treasury Wallet Mismatch</p>
                  <p className="mt-0.5 text-xs opacity-90">
                    Your active wallet (<strong>{shortenAddress(address)}</strong>) does not match {activeWorkspace?.name ?? "this workspace"}&apos;s treasury wallet (<strong>{shortenAddress(treasuryAddress)}</strong>). Transactions sent now will be debited from your personal wallet.
                  </p>
                </div>
              </div>
              <Button
                className="shrink-0 border-amber-500/40 hover:bg-amber-500/20"
                onClick={handleSwitchToTreasuryWallet}
                size="sm"
                type="button"
                variant="outline"
              >
                Switch in wallet
              </Button>
            </div>
          ) : null}
        </>
      }
      changeLabel={portfolioChangeLabel}
      currency={portfolioDisplayCurrency}
      extras={
        <>
          <FeaturePromos />
          <DashboardCircleInvites />
        </>
      }
      greetingName={dashboardGreetingName}
      hideBalance={hideBalance}
      isBusiness={Boolean(isBusinessWorkspace)}
      isConnected={isConnected}
      isLoading={isPortfolioLoading}
      moneyIn={`${homePlain(portfolioFlow.inflow7d)} ${portfolioDisplayCurrency}`}
      moneyOut={`${homePlain(portfolioFlow.outflow7d)} ${portfolioDisplayCurrency}`}
      onToggleHide={toggleHideBalance}
      tokens={homeTokens}
      transactions={
        <DashboardTransactions
          ownerWallet={address}
          refreshKey={[transactionHash, transactionReceipt?.status].join("|")}
        />
      }
      trend={
        portfolioChangeValue === undefined || portfolioChangeValue === 0
          ? "flat"
          : portfolioChangeValue > 0
            ? "up"
            : "down"
      }
    />
  );

  const workspace =
    view === "send" ? sendWorkspace : NEW_DASHBOARD ? dashboardHome : dashboardWorkspace;

  if (preview) {
    return workspace;
  }

  return (
    <PlatformChrome
      actions={
        <ProfileMenu
          circleLogin={circleLogin}
          circleWalletAddress={circleAddress}
          externalAddress={externalAddress}
          externalWalletAction={<WalletConnectButton />}
          onCircleSessionCleared={handleCircleSessionCleared}
          onWalletModeChange={setWalletMode}
          walletMode={walletMode}
        />
      }
      // Both draw their own top: the dashboard its balance, Send its own bar.
      hideHeader
      subtitle={
        view === "send"
          ? "Pay anyone on Arc, and reuse a saved contact"
          : "Financial command center"
      }
      title={view === "send" ? "Send payment" : "Dashboard"}
    >
      {workspace}

      {receiveOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm dark:bg-background/70">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-lg">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="font-ui text-sm font-semibold text-swift-700">
                  Receive payment
                </p>
                <h2 className="font-heading text-2xl font-semibold tracking-normal text-ink">
                  Payment link
                </h2>
              </div>
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground transition hover:border-primary/30 hover:bg-primary hover:text-primary-foreground active:translate-y-0"
                onClick={() => setReceiveOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_12rem]">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-ink">Amount</span>
                <input
                  className="h-11 rounded-lg border border-border/90 bg-background px-3 text-sm font-bold text-ink  outline-none transition placeholder:text-muted focus:border-swift-600 focus:bg-background focus:ring-2 focus:ring-swift-600/15"
                  inputMode="decimal"
                  onChange={(event) => setReceiveAmount(event.target.value)}
                  placeholder="0.00"
                  value={receiveAmount}
                />
              </label>

              <TokenSelect
                label="Asset"
                onChange={setReceiveToken}
                size="sm"
                value={receiveToken}
              />
            </div>

            <div className="mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center rounded-lg border border-border bg-background p-4 ">
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <LazyQRCodeSVG
                  bgColor="#ffffff"
                  fgColor="#160f24"
                  marginSize={1}
                  size={220}
                  title="SaphraONE payment request"
                  value={
                    paymentRequestUrl ||
                    `ethereum:${walletAddress}@${arcChain.id}`
                  }
                />
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-border bg-background p-4 ">
              <p className="mb-3 break-all text-xs font-bold leading-5 text-swift-700">
                {paymentRequestUrl || "Payment link will be generated here."}
              </p>
              {displayUsername ? (
                <p className="mb-2 text-sm font-bold text-swift-700">
                  {formatUsernameLabel(displayUsername)}
                </p>
              ) : null}
              <p className="truncate font-mono text-sm font-bold text-ink">
                {walletAddress}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  className="sp-bubble inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-swift-600 px-4 text-sm font-bold text-white shadow-[0_10px_24px_rgba(66,17,143,0.18)] transition hover:-translate-y-0.5 hover:bg-swift-700 active:translate-y-0"
                  onClick={copyAddress}
                  type="button"
                >
                  {copied ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Address"}
                </button>
                <button
                  className="sp-bubble inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-swift-600 px-4 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-swift-700 active:translate-y-0"
                  onClick={copyPaymentRequest}
                  type="button"
                >
                  {paymentRequestCopied ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {paymentRequestCopied ? "Copied" : "Link"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </PlatformChrome>
  );
}

export default function Dashboard() {
  return (
    <PlatformAccessGate>
      <DashboardContent />
    </PlatformAccessGate>
  );
}
