"use client";

import {
 AlertCircle,
 ArrowDownUp,
 ArrowLeft,
 ChevronRight,
 Delete,
 ExternalLink,
 Loader2,
 RefreshCw,
 Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { useAccount, useChainId, useReadContract, useSwitchChain } from "wagmi";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";

import { useOptionalWorkspace } from "@/components/business/workspace-provider";
import type { SuccessPopupDetail } from "@/components/success-popup";
import { TokenIcon } from "@/components/token-icon";
import { TransferProgressOverlay } from "@/components/send/transfer-progress";
import { recordPlatformTransactionActivity } from "@/lib/referral/activity-client";
import {
  currentCircleAuth,
 callCircleWalletApi,
 circleSessionEventName,
 readCircleLogin,
 readCircleWallets,
 type CircleLoginResult,
 type CircleWallet,
 writeCircleWallets,
} from "@/lib/circle-session";
import { erc20Abi } from "@/lib/contracts";
import { arcTokens, arcTokenSymbols, type ArcTokenSymbol } from "@/lib/tokens";
import { getSwapErrorMessage } from "@/lib/swap-errors";
import { withTxApproval } from "@/lib/tx-approval/client";
import { feePercentLabel, SWAP_FEE_BPS } from "@/lib/fees";
import { activeCircleWallet } from "@/lib/business/provision-wallet";
import { usePreferredWalletMode } from "@/lib/use-preferred-wallet-mode";
import { arcChain } from "@/lib/chains";
import { readSwapReceived } from "@/lib/swap-received";
import type { CircleSwapEstimate } from "@/lib/circle-swap";

import "./swap.css";

const fallbackAddress = "0x0000000000000000000000000000000000000000";
const zeroAmount = BigInt(0);

function shortenAddress(value?: string) {
 if (!value) {
 return "Not connected";
 }

 return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatTokenAmount(
 amount: bigint | undefined,
 decimals: number,
 symbol: string,
) {
 if (amount === undefined) {
 return `Loading ${symbol}`;
 }

 return `${Number(formatUnits(amount, decimals)).toLocaleString(undefined, {
 maximumFractionDigits: 4,
 })} ${symbol}`;
}

function getErrorMessage(error: unknown) {
 if (error instanceof Error) {
 return getSwapErrorMessage(error.message.split("\n")[0] ?? error.message);
 }

 return "Swap failed. Check wallet details and try again.";
}

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

export function SwapPanel() {
 const circleSdkRef = useRef<W3SSdk | null>(null);
 const {
 address: accountAddress,
 connector,
 isConnected: isAccountConnected,
 } = useAccount();
 const chainId = useChainId();
 const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
 const [isMounted, setIsMounted] = useState(false);
 const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(
 null,
 );
 const [walletMode, setWalletMode] = usePreferredWalletMode("circle");
 const [circleWallets, setCircleWallets] = useState<CircleWallet[]>([]);
 const [isCircleLoading, setIsCircleLoading] = useState(false);
 const [swapTokenIn, setSwapTokenIn] = useState<ArcTokenSymbol>("USDC");
 const [swapTokenOut, setSwapTokenOut] = useState<ArcTokenSymbol>("EURC");
 const [swapAmount, setSwapAmount] = useState("");
 const [swapEstimate, setSwapEstimate] = useState<CircleSwapEstimate>();
 const [swapExplorerUrl, setSwapExplorerUrl] = useState<string>();
 const [swapStatus, setSwapStatus] = useState("Ready");
 const [swapError, setSwapError] = useState<string | null>(null);
 const [isSwapEstimating, setIsSwapEstimating] = useState(false);
 const [isSwapPending, setIsSwapPending] = useState(false);
 const [step, setStep] = useState<"amount" | "review">("amount");
 const latestQuoteKeyRef = useRef("");
 // The moving-coin animation while a swap runs (step 0: the swap, 1: reading
 // what arrived). It ends on the swap's receipt.
 const [swapProgress, setSwapProgress] = useState<{
  current: number;
  done: boolean;
  receipt?: SuccessPopupDetail;
 } | null>(null);
 latestQuoteKeyRef.current = `${swapAmount}|${swapTokenIn}|${swapTokenOut}`;

 // Links such as ALLIE's "Review the quote" carry the swap in the URL:
 // /swap?amount=1&from=USDC&to=EURC.
 useEffect(() => {
 const params = new URLSearchParams(window.location.search);
 const pick = (value: string | null) => {
 const symbol = value?.trim().toUpperCase();
 return symbol && arcTokenSymbols.includes(symbol as ArcTokenSymbol)
 ? (symbol as ArcTokenSymbol)
 : null;
 };
 const tokenIn = pick(params.get("from"));
 const tokenOut = pick(params.get("to"));
 const amount = params.get("amount")?.trim();

 if (tokenIn && tokenOut && tokenIn !== tokenOut) {
 setSwapTokenIn(tokenIn);
 setSwapTokenOut(tokenOut);
 }
 if (amount && /^\d+(\.\d+)?$/.test(amount)) {
 setSwapAmount(amount);
 }
 }, []);

 const workspaceContext = useOptionalWorkspace();
 const isBusinessWorkspace = workspaceContext?.workspace?.kind === "business";
 const externalAddress =
 isMounted && isAccountConnected ? accountAddress : undefined;
 const circleWallet = activeCircleWallet(
 workspaceContext?.workspace ?? null,
 circleWallets,
 workspaceContext?.ownerWallet,
 );
 const circleAddress =
 circleWallet?.address && isAddress(circleWallet.address)
 ? (circleWallet.address as Address)
 : undefined;
 const isCircleWalletConnected = Boolean(circleLogin && circleAddress);
 const isEmbeddedWalletMode =
 walletMode === "circle" && isCircleWalletConnected;
  const isExternalWalletMode =
    walletMode === "external" || (!isEmbeddedWalletMode && Boolean(externalAddress));
  const address = isBusinessWorkspace
    ? (circleAddress ?? externalAddress)
    : isEmbeddedWalletMode
      ? circleAddress
      : isExternalWalletMode
        ? externalAddress
        : undefined;
 const isConnected = Boolean(address);
 const fallbackAddressTyped = fallbackAddress as Address;
 const isArcNetwork =
 isEmbeddedWalletMode || (isExternalWalletMode && chainId === arcChain.id);

 const {
 data: rawEurcBalance,
 refetch: refetchEurcBalance,
 } = useReadContract({
 address: arcTokens.EURC.address,
 abi: erc20Abi,
 functionName: "balanceOf",
 args: [address ?? fallbackAddressTyped],
 chainId: arcChain.id,
 query: {
 enabled: Boolean(isConnected && address),
 },
 });

 const {
 data: rawUsdcBalance,
 refetch: refetchUsdcBalance,
 } = useReadContract({
 address: arcTokens.USDC.address,
 abi: erc20Abi,
 functionName: "balanceOf",
 args: [address ?? fallbackAddressTyped],
 chainId: arcChain.id,
 query: {
 enabled: Boolean(isConnected && address),
 },
 });

 const tokenBalances = {
 EURC: typeof rawEurcBalance === "bigint" ? rawEurcBalance : undefined,
 USDC: typeof rawUsdcBalance === "bigint" ? rawUsdcBalance : undefined,
 } satisfies Record<ArcTokenSymbol, bigint | undefined>;

 const swapAmountUnits = useMemo(() => {
 if (!swapAmount.trim()) {
 return null;
 }

 try {
 return parseUnits(swapAmount, arcTokens[swapTokenIn].decimals);
 } catch {
 return null;
 }
 }, [swapAmount, swapTokenIn]);

 const swapTokenBalance = tokenBalances[swapTokenIn];
 const hasEnoughSwapBalance = Boolean(
 swapAmountUnits !== null &&
 swapTokenBalance !== undefined &&
 swapTokenBalance >= swapAmountUnits,
 );
 const embeddedSwapWallet =
 circleLogin && circleWallet?.id && circleAddress
 ? {
 login: circleLogin,
 walletAddress: circleAddress,
 walletId: circleWallet.id,
 }
 : null;
 const canUseEmbeddedSwapWallet = Boolean(
 isEmbeddedWalletMode && embeddedSwapWallet,
 );
 const activeEmbeddedSwapWallet = isEmbeddedWalletMode
 ? embeddedSwapWallet
 : null;
 const canUseExternalSwapWallet = Boolean(
 !isEmbeddedWalletMode && externalAddress && connector,
 );
 const canUseSwapWallet = isEmbeddedWalletMode
 ? canUseEmbeddedSwapWallet
 : canUseExternalSwapWallet;
 const canRequestSwapQuote = Boolean(
 isConnected &&
 canUseSwapWallet &&
 isArcNetwork &&
 swapTokenIn !== swapTokenOut &&
 swapAmountUnits !== null &&
 swapAmountUnits > zeroAmount &&
 hasEnoughSwapBalance &&
 !isSwapEstimating &&
 !isSwapPending,
 );
 const canExecuteSwap = Boolean(canRequestSwapQuote && swapEstimate);
 const swapQuoteButtonText = !isConnected
 ? "Connect wallet"
 : !canUseSwapWallet
 ? isEmbeddedWalletMode
 ? "Circle wallet loading"
 : "Connect wallet"
 : !isArcNetwork
 ? "Switch network"
 : swapTokenIn === swapTokenOut
 ? "Choose assets"
 : swapAmountUnits === null || swapAmountUnits <= zeroAmount
 ? "Enter amount"
 : swapTokenBalance === undefined
 ? "Loading balance"
 : !hasEnoughSwapBalance
 ? `Insufficient ${swapTokenIn}`
 : "Get quote";

 async function ensureCircleSdk(login: CircleLoginResult | null = circleLogin) {
 if (!login) {
 throw new Error("Circle wallet confirmation is not ready.");
 }

 if (circleSdkRef.current) {
 return circleSdkRef.current;
 }

 const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim() ?? "";

 if (!appId) {
 throw new Error("Circle wallet confirmation is not configured.");
 }

 const { W3SSdk: CircleW3SSdk } = await import(
 "@circle-fin/w3s-pw-web-sdk"
 );
 const sdk = new CircleW3SSdk({
 appSettings: {
 appId,
 },
 authentication: {
 encryptionKey: login.encryptionKey,
 userToken: login.userToken,
 },
 });
 circleSdkRef.current = sdk;

 return sdk;
 }

 useEffect(() => {
 setIsMounted(true);
 }, []);

 useEffect(() => {
 let cancelled = false;

 async function restoreCircleWallet() {
 const login = readCircleLogin();

 if (!login) {
 circleSdkRef.current = null;
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
 setIsCircleLoading(false);
 } else {
 setIsCircleLoading(true);
 }

 void ensureCircleSdk(login).catch(() => {
 if (!cancelled) {
 circleSdkRef.current = null;
 }
 });

 try {
 const payload = await callCircleWalletApi<{ wallets?: CircleWallet[] }>(
 "listWallets",
 {
 userToken: login.userToken,
 },
 );

 if (!cancelled) {
 const wallets = payload.wallets ?? [];
 setCircleWallets(wallets);
 writeCircleWallets(wallets);
 }
 } catch {
 if (!cancelled && cachedWallets.length === 0) {
 circleSdkRef.current = null;
 setCircleWallets([]);
 }
 } finally {
 if (!cancelled) {
 setIsCircleLoading(false);
 }
 }
 }

 function onSessionChange() {
 void restoreCircleWallet();
 }

 void restoreCircleWallet();
 window.addEventListener(circleSessionEventName, onSessionChange);

 return () => {
 cancelled = true;
 window.removeEventListener(circleSessionEventName, onSessionChange);
 };
 }, []);

 async function refreshBalances() {
 await Promise.allSettled([refetchEurcBalance(), refetchUsdcBalance()]);
 }

 async function ensureArcNetwork() {
 if (isArcNetwork) {
 return true;
 }

 try {
 await switchChainAsync({ chainId: arcChain.id });
 return true;
 } catch (error) {
 setSwapError(getErrorMessage(error));
 return false;
 }
 }

 async function executeCircleChallenge(challengeId: string, label?: string) {
 if (!circleLogin) {
 throw new Error("Circle wallet confirmation is not ready.");
 }

 const sdk = await ensureCircleSdk(circleLogin);

 sdk.setAuthentication(currentCircleAuth(circleLogin));

 if (label) {
 setSwapStatus(`Confirm ${label} in Circle wallet`);
 }

 return new Promise<{ transactionId?: string; txHash?: string }>(
 (resolve, reject) => {
 sdk.execute(challengeId, (error, result) => {
 if (error) {
 reject(new Error(getErrorMessage(error)));
 return;
 }

 const challengeResult = result as CircleChallengeResult | undefined;
 resolve({
 transactionId:
 challengeResult?.data?.transactionId ??
 challengeResult?.transactionId ??
 challengeResult?.data?.id ??
 challengeResult?.id,
 txHash: challengeResult?.data?.txHash,
 });
 });
 },
 );
 }

 async function handleEstimateSwap() {
 const quoteKey = `${swapAmount}|${swapTokenIn}|${swapTokenOut}`;
 setSwapError(null);
 setSwapEstimate(undefined);
 setSwapExplorerUrl(undefined);

 if (isEmbeddedWalletMode && !activeEmbeddedSwapWallet) {
 setSwapError("Circle wallet is not ready.");
 return;
 }

 if (!isEmbeddedWalletMode && (!isConnected || !connector)) {
 setSwapError("Connect a wallet before swapping.");
 return;
 }

 if (!(await ensureArcNetwork())) {
 return;
 }

 if (swapAmountUnits === null || swapAmountUnits <= zeroAmount) {
 setSwapError("Enter a valid swap amount.");
 return;
 }

 if (swapTokenIn === swapTokenOut) {
 setSwapError("Choose two different assets.");
 return;
 }

 if (!hasEnoughSwapBalance) {
 setSwapError(`Insufficient ${swapTokenIn} balance.`);
 return;
 }

 try {
 setIsSwapEstimating(true);
 const { estimateCircleSwap, estimateCircleUserWalletSwap } =
 await import("@/lib/circle-swap");
 const estimate = activeEmbeddedSwapWallet
 ? await estimateCircleUserWalletSwap({
 amountIn: swapAmount,
 executeChallenge: executeCircleChallenge,
 onStatus: setSwapStatus,
 slippageBps,
 tokenIn: swapTokenIn,
 tokenOut: swapTokenOut,
 userToken: activeEmbeddedSwapWallet.login.userToken,
 walletAddress: activeEmbeddedSwapWallet.walletAddress,
 walletId: activeEmbeddedSwapWallet.walletId,
 })
 : await estimateCircleSwap({
 amountIn: swapAmount,
 connector,
 slippageBps,
 tokenIn: swapTokenIn,
 tokenOut: swapTokenOut,
 });
 // The amount may have changed while this quote was in flight.
 if (latestQuoteKeyRef.current !== quoteKey) {
 return;
 }
 setSwapEstimate(estimate);
 setSwapStatus("Quote ready");
 } catch (error) {
 if (latestQuoteKeyRef.current === quoteKey) {
 setSwapError(getErrorMessage(error));
 }
 } finally {
 setIsSwapEstimating(false);
 }
 }

 async function handleExecuteSwap() {
 setSwapError(null);

 if (isEmbeddedWalletMode && !activeEmbeddedSwapWallet) {
 setSwapError("Circle wallet is not ready.");
 return;
 }

 if (!isEmbeddedWalletMode && (!isConnected || !connector)) {
 setSwapError("Connect a wallet before swapping.");
 return;
 }

 if (!(await ensureArcNetwork())) {
 return;
 }

 if (swapAmountUnits === null || swapAmountUnits <= zeroAmount) {
 setSwapError("Enter a valid swap amount.");
 return;
 }

 if (swapTokenIn === swapTokenOut) {
 setSwapError("Choose two different assets.");
 return;
 }

 if (!hasEnoughSwapBalance) {
 setSwapError(`Insufficient ${swapTokenIn} balance.`);
 return;
 }

 if (!swapEstimate) {
 setSwapError("Get a quote before swapping.");
 return;
 }

 try {
 setIsSwapPending(true);
 setSwapProgress({ current: 0, done: false });
 setSwapStatus(
 activeEmbeddedSwapWallet
 ? "Preparing Circle wallet swap"
 : "Confirm swap in external wallet",
 );
 const { executeCircleSwap, executeCircleUserWalletSwap } =
 await import("@/lib/circle-swap");
 const result = activeEmbeddedSwapWallet
 ? await withTxApproval(
 {
 amount: swapAmount,
 kind: "swap",
 // Approve + swap, with room for a retried approval.
 maxUses: 3,
 title: `Swap ${swapTokenIn} for ${swapTokenOut}`,
 token: swapTokenIn,
 walletId: activeEmbeddedSwapWallet.walletId,
 },
 () =>
 executeCircleUserWalletSwap({
 amountIn: swapAmount,
 executeChallenge: executeCircleChallenge,
 onStatus: setSwapStatus,
 slippageBps,
 stopLimit: swapEstimate.stopLimitAmount,
 tokenIn: swapTokenIn,
 tokenOut: swapTokenOut,
 userToken: activeEmbeddedSwapWallet.login.userToken,
 walletAddress: activeEmbeddedSwapWallet.walletAddress,
 walletId: activeEmbeddedSwapWallet.walletId,
 }),
 )
 : await executeCircleSwap({
 amountIn: swapAmount,
 connector,
 slippageBps,
 stopLimit: swapEstimate.stopLimitAmount,
 tokenIn: swapTokenIn,
 tokenOut: swapTokenOut,
 });
 setSwapExplorerUrl(
 result.explorerUrl ??
 `${arcChain.blockExplorers.default.url}/tx/${result.txHash}`,
 );
 const actorWallet =
 activeEmbeddedSwapWallet?.walletAddress ?? externalAddress ?? circleAddress;
 // Circle's result does not always carry the output amount; read what
 // actually arrived from the transaction, falling back to the quote.
 setSwapStatus("Confirming received amount");
 setSwapProgress({ current: 1, done: false });
 const receivedAmount =
 result.amountOut ??
 (actorWallet
 ? await readSwapReceived({
 token: swapTokenOut,
 txHash: result.txHash,
 wallet: actorWallet,
 })
 : null);
 const receivedLabel = receivedAmount
 ? `${receivedAmount} ${swapTokenOut}`
 : `≈ ${swapEstimate.estimatedOutput}`;
 setSwapStatus(`Received ${receivedLabel}`);
 const explorerUrl =
 result.explorerUrl ??
 `${arcChain.blockExplorers.default.url}/tx/${result.txHash}`;
 const receipt: SuccessPopupDetail = {
 amount: receivedLabel,
 explorerUrl,
 eyebrow: "Swap",
 rows: [
 { label: "You paid", value: `${swapAmount} ${swapTokenIn}` },
 {
 label: receivedAmount ? "You received" : "You receive (quoted)",
 value: receivedLabel,
 },
 ],
 subtitle: `Swapped ${swapAmount} ${swapTokenIn} for ${receivedLabel}.`,
 title: "Swap successful",
 };
 setSwapProgress({ current: 1, done: true, receipt });
 if (actorWallet && swapAmount) {
 void recordPlatformTransactionActivity({
 walletAddress: actorWallet,
 amount: swapAmount,
 token: swapTokenIn,
 txHash: result.txHash,
 activityType: "SWAP",
 showToast: true,
 activity: {
 amountIn: receivedAmount ?? null,
 direction: "internal",
 source: "swap",
 title: `Swapped ${swapTokenIn} to ${swapTokenOut}`,
 tokenIn: swapTokenOut,
 },
 });
 }
 // Back to the amount screen once the animation has finished (onDone).
 await refreshBalances();
 } catch (error) {
 setSwapProgress(null);
 setSwapError(getErrorMessage(error));
 } finally {
 setIsSwapPending(false);
 }
 }

 function flipSwapTokens() {
  setSwapTokenIn(swapTokenOut);
  setSwapTokenOut(swapTokenIn);
  setSwapEstimate(undefined);
  setSwapExplorerUrl(undefined);
  setSwapError(null);
 }

 function changeAmount(next: string) {
  setSwapAmount(next);
  setSwapEstimate(undefined);
  setSwapExplorerUrl(undefined);
  setSwapError(null);
 }

 function pressKey(key: string) {
  changeAmount(applyKeypadKey(swapAmount, key, arcTokens[swapTokenIn].decimals));
 }

 function fillPercent(percent: number) {
  if (swapTokenBalance === undefined) {
   return;
  }

  const units = (swapTokenBalance * BigInt(percent)) / BigInt(100);
  changeAmount(trimAmount(formatUnits(units, arcTokens[swapTokenIn].decimals)));
 }

 // Quote as the amount settles, so the screen shows what it buys before review.
 useEffect(() => {
  if (!canRequestSwapQuote || swapEstimate || swapError) {
   return;
  }

  const timer = window.setTimeout(() => {
   void handleEstimateSwap();
  }, 650);

  return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [canRequestSwapQuote, swapAmount, swapTokenIn, swapTokenOut, swapEstimate, swapError]);

 // A physical keyboard works the same as the on-screen keypad.
 useEffect(() => {
  if (step !== "amount") {
   return;
  }

  function onKeyDown(event: KeyboardEvent) {
   const target = event.target as HTMLElement | null;
   if (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    target?.closest("input, textarea, select, [contenteditable]")
   ) {
    return;
   }

   const key = event.key === "Backspace" ? "back" : event.key === "," ? "." : event.key;
   if (/^[0-9.]$/.test(key) || key === "back") {
    event.preventDefault();
    pressKey(key);
   }
  }

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
 });

 const quotedRate =
  swapEstimate && Number(swapAmount) > 0 && Number(swapEstimate.estimatedOutputAmount) > 0
   ? (Number(swapEstimate.estimatedOutputAmount) / Number(swapAmount)).toLocaleString(undefined, {
      maximumFractionDigits: 7,
     })
   : null;
 const statusText = isCircleLoading
  ? "Loading Circle wallet"
  : isSwitchingChain
   ? "Switching network"
   : swapStatus;
 const busy = isSwapEstimating || isSwapPending || isSwitchingChain;
 const estimatedOut = swapEstimate
  ? Number(swapEstimate.estimatedOutputAmount).toLocaleString(undefined, {
     maximumFractionDigits: 6,
    })
  : null;
 const balanceValue =
  swapTokenBalance === undefined
   ? "—"
   : `${currencySign[swapTokenIn]}${Number(
      formatUnits(swapTokenBalance, arcTokens[swapTokenIn].decimals),
     ).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
 const needsNetwork = isConnected && canUseSwapWallet && !isArcNetwork;
 // Named for what the user gets, in either direction: "Buy EURC", "Buy USDC".
 const action = "Buy";
 const reviewLabel = isSwapEstimating
  ? "Getting quote"
  : swapEstimate || swapQuoteButtonText === "Get quote"
   ? "Review buy"
   : swapQuoteButtonText;

 const progressOverlay = (
  <TransferProgressOverlay
   active={swapProgress !== null}
   coin={swapTokenIn}
   current={swapProgress?.current ?? 0}
   details={
    swapProgress?.receipt
     ? {
        amount: swapProgress.receipt.amount,
        eyebrow: swapProgress.receipt.eyebrow,
        explorerUrl: swapProgress.receipt.explorerUrl,
        rows: swapProgress.receipt.rows,
       }
     : undefined
   }
   doneSubtitle={swapProgress?.receipt?.subtitle}
   doneTitle={swapProgress?.receipt?.title ?? "Swap complete"}
   from={<TokenIcon className="h-8 w-8" symbol={swapTokenIn} />}
   onDone={() => {
    setSwapProgress(null);
    setSwapEstimate(undefined);
    setSwapAmount("");
    setStep("amount");
   }}
   state={swapProgress?.done ? "done" : "running"}
   steps={[`Swapping ${swapTokenIn} for ${swapTokenOut}`, "Confirming what arrived"]}
   title="Swapping"
   to={<TokenIcon className="h-8 w-8" symbol={swapTokenOut} />}
  />
 );

 if (step === "review" && (swapEstimate || isSwapEstimating)) {
  return (
   <div className="swap3-page is-review">
    {progressOverlay}
    <header className="swap3-bar">
     <button
      aria-label="Back to amount"
      className="swap3-round"
      disabled={isSwapPending}
      onClick={() => setStep("amount")}
      type="button"
     >
      <ArrowLeft className="h-5 w-5" />
     </button>
     <h1 className="swap3-title">Review buy</h1>
     <span aria-hidden="true" />
    </header>

    <section className="swap3-summary">
     <div aria-hidden="true" className="swap3-coins">
      <TokenIcon className="swap3-coin" symbol={swapTokenIn} />
      <TokenIcon className="swap3-coin" symbol={swapTokenOut} />
     </div>
     <p className="swap3-summary-amount">
      {estimatedOut ?? "…"} {swapTokenOut}
     </p>
     <p className="swap3-summary-pay">
      You pay {groupAmount(swapAmount)} {swapTokenIn}
     </p>
    </section>

    <dl className="swap3-details">
     <div>
      <dt>Rate</dt>
      <dd>{quotedRate ? `1 ${swapTokenIn} ≈ ${quotedRate} ${swapTokenOut}` : "—"}</dd>
     </div>
     <div>
      <dt>Minimum received</dt>
      <dd>{swapEstimate?.minimumOutput ?? "…"}</dd>
     </div>
     <div>
      <dt>Maximum slippage</dt>
      <dd>{feePercentLabel(slippageBps)}</dd>
     </div>
     <div>
      <dt>Service fee</dt>
      <dd>{feePercentLabel(SWAP_FEE_BPS)}</dd>
     </div>
     <div>
      <dt>Paying from</dt>
      <dd>
       <Wallet className="h-3.5 w-3.5" />
       {isEmbeddedWalletMode ? "SaphraONE wallet" : "External wallet"} ·{" "}
       <span className="font-mono">{shortenAddress(address)}</span>
      </dd>
     </div>
     <div>
      <dt>Estimated time</dt>
      <dd>A few seconds</dd>
     </div>
     {busy ? (
      <div>
       <dt>Status</dt>
       <dd className="swap3-status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {statusText}
       </dd>
      </div>
     ) : null}
    </dl>

    <p className="swap3-note">
     The final amount can change slightly before the transaction is submitted.
     The minimum received protects this trade from excess slippage.
    </p>

    {swapError ? (
     <p className="swap3-error" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{swapError}</span>
     </p>
    ) : null}

    <div className="swap3-footer">
     <button
      className="swap3-cta"
      disabled={!canExecuteSwap}
      onClick={handleExecuteSwap}
      type="button"
     >
      {isSwapPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {isSwapPending ? "Swapping" : `${action} ${swapTokenOut}`}
     </button>
     {!isSwapPending ? (
      <button
       className="swap3-text-btn"
       disabled={!canRequestSwapQuote}
       onClick={handleEstimateSwap}
       type="button"
      >
       <RefreshCw className={`h-3.5 w-3.5 ${isSwapEstimating ? "animate-spin" : ""}`} />
       Refresh quote
      </button>
     ) : null}
    </div>
   </div>
  );
 }

 return (
  <div className="swap3-page">
   {progressOverlay}
   <header className="swap3-bar">
    <Link aria-label="Back to the dashboard" className="swap3-round" href="/dashboard">
     <ArrowLeft className="h-5 w-5" />
    </Link>
    <h1 className="swap3-title">
     {action} {swapTokenOut}
    </h1>
    <button
     aria-label={`Switch direction: pay with ${swapTokenOut} instead`}
     className="swap3-round"
     disabled={busy}
     onClick={flipSwapTokens}
     title="Switch direction"
     type="button"
    >
     <ArrowDownUp className="h-5 w-5" />
    </button>
   </header>

   <section aria-live="polite" className="swap3-display">
    <p className={swapAmount ? "swap3-amount" : "swap3-amount is-empty"}>
     <span className="swap3-sign">{currencySign[swapTokenIn]}</span>
     {groupAmount(swapAmount || "0")}
    </p>
    <p className="swap3-estimate">
     {isSwapEstimating ? (
      <>
       <Loader2 className="h-3.5 w-3.5 animate-spin" /> Getting quote
      </>
     ) : estimatedOut ? (
      `≈ ${estimatedOut} ${swapTokenOut}`
     ) : swapError ? (
      <span className="swap3-estimate-error">{swapError}</span>
     ) : !swapAmount ? (
      <span className="swap3-type-hint">Type an amount</span>
     ) : (
      " "
     )}
    </p>
   </section>

   <div className="swap3-controls">
    <button
     aria-label={`Paying with ${swapTokenIn}. Switch to pay with ${swapTokenOut}`}
     className="swap3-source"
     disabled={busy}
     onClick={flipSwapTokens}
     type="button"
    >
     <TokenIcon className="swap3-source-icon" symbol={swapTokenIn} />
     <span className="swap3-source-name">
      <strong>With {currencyName[swapTokenIn]}</strong>
      <span>{swapTokenIn}</span>
     </span>
     <span className="swap3-source-balance">
      <strong>{isConnected ? balanceValue : "—"}</strong>
      <span>
       {isConnected
        ? formatTokenAmount(swapTokenBalance, arcTokens[swapTokenIn].decimals, swapTokenIn)
        : "Not connected"}
      </span>
     </span>
     <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>

    <div className="swap3-chips">
     {[25, 50, 75, 100].map((percent) => (
      <button
       className="swap3-chip"
       disabled={swapTokenBalance === undefined || busy}
       key={percent}
       onClick={() => fillPercent(percent)}
       type="button"
      >
       {percent}%
      </button>
     ))}
    </div>

    <button
     className="swap3-cta"
     disabled={needsNetwork ? isSwitchingChain : !swapEstimate || busy}
     onClick={() => {
      if (needsNetwork) {
       void ensureArcNetwork();
       return;
      }
      setSwapError(null);
      setStep("review");
     }}
     type="button"
    >
     {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
     {reviewLabel}
    </button>

    <div className="swap3-keypad">
     {keypadKeys.map((key) => (
      <button
       aria-label={key === "back" ? "Delete" : key === "." ? "Decimal point" : key}
       className="swap3-key"
       disabled={isSwapPending}
       key={key}
       onClick={() => pressKey(key)}
       type="button"
      >
       {key === "back" ? <Delete className="h-6 w-6" /> : key}
      </button>
     ))}
    </div>

    {swapExplorerUrl ? (
     <a className="swap3-text-btn" href={swapExplorerUrl} rel="noreferrer" target="_blank">
      View last swap on ArcScan
      <ExternalLink className="h-4 w-4" />
     </a>
    ) : null}
   </div>
  </div>
 );
}

const slippageBps = 100;

const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

const currencySign: Record<ArcTokenSymbol, string> = { EURC: "€", USDC: "$" };

const currencyName: Record<ArcTokenSymbol, string> = {
 EURC: "Euros",
 USDC: "US Dollars",
};

function applyKeypadKey(current: string, key: string, decimals: number) {
 if (key === "back") {
  return current.slice(0, -1);
 }

 if (key === ".") {
  if (current.includes(".")) return current;
  return current ? `${current}.` : "0.";
 }

 const [whole, fraction] = current.split(".");
 if (fraction !== undefined && fraction.length >= decimals) return current;
 if (fraction === undefined && whole.length >= 12) return current;
 if (current === "0") return key;
 return `${current}${key}`;
}

function trimAmount(value: string) {
 return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function groupAmount(value: string) {
 const [whole, fraction] = value.split(".");
 const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
 return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
