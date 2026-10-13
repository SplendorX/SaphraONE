"use client";

import { switchToArc } from "@/lib/arc-network";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { RefreshCw, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordPlatformTransactionActivity } from "@/lib/referral/activity-client";
import {
 createPublicClient,
 encodeFunctionData,
 formatUnits,
 getAddress,
 isAddress,
 maxUint256,
 parseUnits,
 type Address,
 type Hash,
 type Hex,
} from "viem";
import { confirmFlow } from "@/lib/tx-approval/client";
import {
 useAccount,
 useChainId,
 useReadContract,
 useSwitchChain,
 useWriteContract,
} from "wagmi";

import {
 BatchPeopleComposer,
 type BatchComposerResult,
 type BatchPeopleComposerHandle,
} from "@/components/batch/batch-people-composer";
import { useOptionalWorkspace } from "@/components/business/workspace-provider";
import { useT } from "@/components/locale-provider";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { ProfileMenu } from "@/components/profile-menu";
import {
  executeCircleChallenge as runCircleChallenge,
  callCircleWalletApi,
  circleStorageKeys,
  findCircleTokenBalance,
  userFacingErrorMessage,
  getCircleLoginIdentity,
  readCircleLogin,
  readCircleSessionStorage,
  readCircleWallets,
  type CircleLoginResult,
  type CircleTokenBalance,
  type CircleWallet,
  writeCircleWallets,
} from "@/lib/circle-session";
import { recoverCircleTxHash } from "@/lib/circle-tx";
import {
 erc20Abi,
 swiftBatchAbi,
 swiftBatchAddress,
 swiftBatchFeeBasisPoints,
 swiftBatchFeeRecipient,
 swiftBatchMaxRecipients,
} from "@/lib/contracts";
import { BatchReceiptModal } from "@/components/batch/batch-receipt-modal";
import { TransferProgressOverlay } from "@/components/send/transfer-progress";
import { TokenIcon } from "@/components/token-icon";
import {
  BulkpayBar,
  BulkpayComposerTools,
  BulkpayContinueBar,
  BulkpayIntro,
  BulkpayPeopleCard,
  BulkpaySteps,
  BulkpaySummary,
  BulkpayTokenStrip,
  type BulkpayBreakdown,
} from "@/components/bulkpay/bulkpay-views";
import {
  batchReceiptFileName,
  buildBatchReceiptPng,
  downloadBatchReceiptImage,
  downloadPngBlob,
  } from "@/lib/batch-receipt";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";
import {
  activeCircleWallet,
  personalCircleWallet,
} from "@/lib/business/provision-wallet";
import { usePreferredWalletMode } from "@/lib/use-preferred-wallet-mode";
import { arcChain, arcTransport } from "@/lib/chains";

type BulkpayStep = "intro" | "people" | "summary";

type BatchRecipient = {
 address: Address;
 amount: string;
 amountUnits: bigint;
 label?: string;
 line: number;
 username?: string;
};

type BatchReceipt = {
 contractAddress: string;
 explorerUrl: string | null;
 feeAmount: string;
 feeRecipient: string;
 id: string;
 mode: string;
 payoutTotal: string;
 recipientCount: number;
 recipients: Array<{
 address: Address;
 amount: string;
 label?: string;
 line: number;
 }>;
 requiredApproval: string;
 submittedAt: string;
 token: ArcTokenSymbol;
 txHash: string | null;
 walletAddress: string;
};

type CircleContractChallenge = {
 challengeId?: string;
 data?: {
 challengeId?: string;
 id?: string;
 transactionId?: string;
 txHash?: string;
 };
 id?: string;
 transactionId?: string;
 txHash?: string;
};

type CircleChallengeResult = {
 data?: {
 id?: string;
 transactionId?: string;
 txHash?: string;
 };
 id?: string;
 transactionId?: string;
 txHash?: string;
};

const zeroAmount = BigInt(0);
const feeBasisPointsDenominator = BigInt(10_000);
const feeBasisPoints = BigInt(swiftBatchFeeBasisPoints);
const allowancePollAttempts = 30;
const allowancePollDelayMs = 2_000;
const arcPublicClient = createPublicClient({
 chain: arcChain,
 transport: arcTransport(),
});
const configuredSwiftBatchAddress =
 swiftBatchAddress && isAddress(swiftBatchAddress)
 ? (getAddress(swiftBatchAddress) as Address)
 : undefined;

function wait(milliseconds: number) {
 return new Promise((resolve) => {
 window.setTimeout(resolve, milliseconds);
 });
}

function shortenAddress(value?: string) {
 if (!value) {
 return "Not connected";
 }

 return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getErrorMessage(error: unknown) {
 return userFacingErrorMessage(error, "BulkPay transaction failed. Nothing was sent — try again.");
}

function formatTokenAmount(
 amount: bigint,
 decimals: number,
 symbol: ArcTokenSymbol,
) {
 return `${Number(formatUnits(amount, decimals)).toLocaleString(undefined, {
 maximumFractionDigits: 6,
 })} ${symbol}`;
}

function getCircleChallengeId(challenge: CircleContractChallenge) {
 return (
 challenge.challengeId ??
 challenge.data?.challengeId ??
 challenge.id ??
 challenge.data?.id
 );
}

function getCircleTransactionHash(value: CircleContractChallenge | CircleChallengeResult) {
 return value.txHash ?? value.data?.txHash;
}

export default function BulkPayPage() {
 const t = useT();
 const circleSdkRef = useRef<W3SSdk | null>(null);
 const composerRef = useRef<BatchPeopleComposerHandle | null>(null);
 const fileInputRef = useRef<HTMLInputElement | null>(null);
 const { address: externalAddress } = useAccount();
 const chainId = useChainId();
 const { switchChainAsync } = useSwitchChain();
 const { writeContractAsync } = useWriteContract();
 const [walletMode, setWalletMode] = usePreferredWalletMode("external");
 const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(
 null,
 );
 const [circleWallets, setCircleWallets] = useState<CircleWallet[]>([]);
 const [circleBalances, setCircleBalances] = useState<CircleTokenBalance[]>(
 [],
 );
 const [selectedToken, setSelectedToken] = useState<ArcTokenSymbol>("USDC");
 const [status, setStatus] = useState("Ready");
 const [composer, setComposer] = useState<BatchComposerResult>({
 errors: [],
 recipients: [],
 resolving: false,
 });
 const [error, setError] = useState<string | null>(null);
 const [explorerUrl, setExplorerUrl] = useState("");
 const [isPending, setIsPending] = useState(false);
 const [batchReceipt, setBatchReceipt] = useState<BatchReceipt | null>(null);
 // Circle can return before the on-chain hash exists; keep its transaction id
 // so the batch can still be recorded once the hash arrives.
 const pendingCircleBatchTxIdRef = useRef<string | null>(null);
 const closeSuccess = useCallback(() => setSuccessOpen(false), []);
 const [successOpen, setSuccessOpen] = useState(false);
 // The moving-coin animation for a batch; it ends on the batch summary, with
 // the full receipt (download, share) one tap away.
 const [batchDone, setBatchDone] = useState(false);
 // intro → people → summary, like RecurePay.
 const [step, setStep] = useState<BulkpayStep>("intro");
 const [refreshing, setRefreshing] = useState(false);
 const selectedTokenInfo = arcTokens[selectedToken];
 const handleComposerChange = useCallback((next: BatchComposerResult) => {
 setComposer(next);
 }, []);
 const recipients = composer.recipients as BatchRecipient[];
 const totalAmountUnits = useMemo(
 () =>
 recipients.reduce(
 (total, recipient) => total + recipient.amountUnits,
 zeroAmount,
 ),
 [recipients],
 );
 const feeAmountUnits =
 (totalAmountUnits * feeBasisPoints) / feeBasisPointsDenominator;
 const requiredAmountUnits = totalAmountUnits + feeAmountUnits;
 const workspaceContext = useOptionalWorkspace();
 const isBusinessWorkspace = workspaceContext?.workspace?.kind === "business";
 const circleWallet = activeCircleWallet(
 workspaceContext?.workspace ?? null,
 circleWallets,
 workspaceContext?.ownerWallet,
 );
 const circleAddress = circleWallet?.address
 ? (getAddress(circleWallet.address) as Address)
 : undefined;
  const walletAddress = isBusinessWorkspace
    ? (circleAddress ?? externalAddress)
    : walletMode === "circle"
      ? (circleAddress ?? externalAddress)
      : externalAddress;
 const isEmbeddedWalletMode = walletMode === "circle";
 const isArcNetwork = chainId === arcChain.id;
 const circleTokenBalance = findCircleTokenBalance(
 circleBalances,
 selectedToken,
 );
 const parsedCircleBalance = useMemo(() => {
 if (!circleTokenBalance?.amount) {
 return undefined;
 }

 try {
 return parseUnits(circleTokenBalance.amount, selectedTokenInfo.decimals);
 } catch {
 return undefined;
 }
 }, [circleTokenBalance?.amount, selectedTokenInfo.decimals]);
 const { data: externalTokenBalance, refetch: refetchExternalBalance } =
 useReadContract({
 address: selectedTokenInfo.address,
 abi: erc20Abi,
 functionName: "balanceOf",
 args: externalAddress ? [externalAddress] : undefined,
 chainId: arcChain.id,
 query: {
 enabled: Boolean(externalAddress),
 },
 });
  const activeBalance =
    typeof externalTokenBalance === "bigint"
      ? externalTokenBalance
      : typeof parsedCircleBalance === "bigint"
        ? parsedCircleBalance
        : 0n;
  const hasEnoughBalance =
    activeBalance !== undefined && activeBalance >= requiredAmountUnits;
 const canSubmit = Boolean(
 configuredSwiftBatchAddress &&
 walletAddress &&
 recipients.length > 0 &&
 recipients.length <= swiftBatchMaxRecipients &&
 composer.errors.length === 0 &&
 !composer.resolving &&
 requiredAmountUnits > zeroAmount &&
 hasEnoughBalance &&
 !isPending,
 );

 async function refreshCircleWallet() {
 const login = readCircleLogin();

 if (!login) {
 circleSdkRef.current = null;
 setCircleLogin(null);
 setCircleWallets([]);
 setCircleBalances([]);
 setWalletMode("external");
 return;
 }

 setCircleLogin(login);
 setWalletMode("circle");

 const cachedWallets = readCircleWallets();

 if (cachedWallets.length > 0) {
 setCircleWallets(cachedWallets);
 }

 const payload = await callCircleWalletApi<{ wallets?: CircleWallet[] }>(
 "listWallets",
 {
 userToken: login.userToken,
 },
 );
 const wallets = payload.wallets ?? [];

 setCircleWallets(wallets);
 writeCircleWallets(wallets);

 const walletId = personalCircleWallet(wallets)?.id;

 if (walletId) {
 const balancePayload = await callCircleWalletApi<{
 tokenBalances?: CircleTokenBalance[];
 }>("getTokenBalance", {
 userToken: login.userToken,
 walletId,
 });

 setCircleBalances(balancePayload.tokenBalances ?? []);
 }
 }

 async function ensureCircleSdk(login: CircleLoginResult | null = circleLogin) {
 if (!login) {
 throw new Error("Circle wallet confirmation is not ready.");
 }

 const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim() ?? "";

 if (!appId) {
 throw new Error("Circle wallet confirmation is not configured.");
 }

 const storedDeviceToken = readCircleSessionStorage(circleStorageKeys.deviceToken);
 const storedDeviceEncryptionKey = readCircleSessionStorage(circleStorageKeys.deviceEncryptionKey);
 const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";

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
 ...(storedDeviceToken && storedDeviceEncryptionKey
 ? {
 loginConfigs: {
 deviceToken: storedDeviceToken,
 deviceEncryptionKey: storedDeviceEncryptionKey,
 google: {
 clientId: googleClientId,
 redirectUri: typeof window !== "undefined" ? window.location.origin : "",
 selectAccountPrompt: true,
 },
 },
 }
 : {}),
 });

 circleSdkRef.current = sdk;

 return sdk;
 }

 useEffect(() => {
 void refreshCircleWallet().catch(() => {
 circleSdkRef.current = null;
 });
 }, []);

  async function refreshBalances() {
    if (isEmbeddedWalletMode) {
      await refreshCircleWallet();
      return;
    }

    await refetchExternalBalance();
  }

 async function ensureArcNetwork() {
 if (isArcNetwork) {
 return true;
 }

 try {
 await switchToArc(switchChainAsync);
 return true;
 } catch (switchError) {
 setError(getErrorMessage(switchError));
 return false;
 }
 }

 async function readAllowance(owner: Address, token: Address) {
 if (!configuredSwiftBatchAddress) {
 return zeroAmount;
 }

 return arcPublicClient.readContract({
 address: token,
 abi: erc20Abi,
 functionName: "allowance",
 args: [owner, configuredSwiftBatchAddress],
 });
 }

 async function waitForAllowance(owner: Address, token: Address, amount: bigint) {
 for (let attempt = 0; attempt < allowancePollAttempts; attempt += 1) {
 const allowance = await readAllowance(owner, token);

 if (allowance >= amount) {
 return;
 }

 setStatus("Waiting for approval confirmation");
 await wait(allowancePollDelayMs);
 }

 throw new Error("Approval was submitted, but allowance is not ready yet.");
 }

 async function executeCircleChallenge(challengeId: string, label: string) {
 if (!circleLogin) {
 throw new Error("Circle wallet confirmation is not ready.");
 }

 // Clean up any lingering iframe in DOM to prevent postMessage collisions
 if (typeof document !== "undefined") {
 const existingIframe = document.getElementById("sdkIframe");
 if (existingIframe?.parentNode) {
 existingIframe.parentNode.removeChild(existingIframe);
 }
 }

 const sdk = await ensureCircleSdk(circleLogin);

 setStatus(`Confirm ${label} in Circle wallet`);

 try {
 const result = await runCircleChallenge(sdk, circleLogin, challengeId);
 return (result ?? {}) as CircleChallengeResult;
 } catch (challengeError) {
 throw new Error(getErrorMessage(challengeError));
 }
 }

 async function executeCircleContract({
 callData,
 contractAddress,
 label,
 refId,
 }: {
 callData: Hex;
 contractAddress: Address;
 label: string;
 refId: string;
 }) {
 if (!circleLogin || !circleWallet?.id) {
 throw new Error("Circle wallet is not ready.");
 }

 const challenge = await callCircleWalletApi<CircleContractChallenge>(
 "createContractExecution",
 {
 callData,
 contractAddress,
 feeLevel: "HIGH",
 refId,
 userToken: circleLogin.userToken,
 walletId: circleWallet.id,
 },
 );
 const challengeId = getCircleChallengeId(challenge);

 if (!challengeId) {
 const txHash = getCircleTransactionHash(challenge);

 if (txHash) {
 return { txHash };
 }

 throw new Error("Circle did not return a contract challenge.");
 }

 const result = await executeCircleChallenge(challengeId, label);
 const immediateHash = getCircleTransactionHash(result) ?? getCircleTransactionHash(challenge);
 // A real transaction id only: the challenge id goes to the lookup as its
 // own field. Passed as a transaction id it switched off the lookup's
 // fallback, so a batch could wait out every retry and end without a hash.
 const realTransactionId =
 challenge.transactionId ??
 challenge.data?.transactionId ??
 (result as { transactionId?: string; data?: { transactionId?: string } })?.transactionId ??
 (result as { transactionId?: string; data?: { transactionId?: string } })?.data?.transactionId;
 const transactionId = realTransactionId ?? challengeId;

 if (immediateHash) {
 return { txHash: immediateHash, transactionId };
 }

 setStatus("Waiting for Circle on-chain settlement…");
 const recovered = await recoverCircleTxHash({
 attempts: 12,
 challengeId,
 transactionId: realTransactionId,
 userToken: circleLogin.userToken,
 walletId: circleWallet.id,
 });

 return {
 transactionId,
 txHash: recovered ?? undefined,
 };
 }

 function requireSwiftBatchAddress() {
 if (!configuredSwiftBatchAddress) {
 throw new Error(
 "BulkPay is not configured. Deploy BulkPay and set NEXT_PUBLIC_SWIFTBATCH_ADDRESS.",
 );
 }

 return configuredSwiftBatchAddress;
 }

 function getBatchArgs() {
 return [
 selectedTokenInfo.address,
 recipients.map((recipient) => recipient.address),
 recipients.map((recipient) => recipient.amountUnits),
 ] as const;
 }

 async function executeExternalBatch() {
 if (!externalAddress) {
 throw new Error("Connect an external wallet before sending.");
 }

 if (!(await ensureArcNetwork())) {
 return undefined;
 }

 const batchAddress = requireSwiftBatchAddress();
 const tokenAddress = selectedTokenInfo.address;
 const allowance = await readAllowance(externalAddress, tokenAddress);

 if (allowance < requiredAmountUnits) {
 setStatus(`Approve ${selectedToken} for BulkPay`);
 const approvalHash = await writeContractAsync({
 address: tokenAddress,
 abi: erc20Abi,
 functionName: "approve",
 args: [batchAddress, requiredAmountUnits],
 chainId: arcChain.id,
 });

 await arcPublicClient.waitForTransactionReceipt({
 hash: approvalHash,
 timeout: 10 * 60_000,
 });
 await waitForAllowance(externalAddress, tokenAddress, requiredAmountUnits);
 }

 setStatus("Send BulkPay transaction");
 const hash = await writeContractAsync({
 address: batchAddress,
 abi: swiftBatchAbi,
 functionName: "sendBatch",
 args: getBatchArgs(),
 chainId: arcChain.id,
 });

 await arcPublicClient.waitForTransactionReceipt({
 hash,
 timeout: 10 * 60_000,
 });

 return hash;
 }

 async function executeCircleBatch() {
 if (!circleLogin || !circleWallet?.id || !circleAddress) {
 throw new Error("Circle wallet is not ready.");
 }

 const batchAddress = requireSwiftBatchAddress();
 const tokenAddress = selectedTokenInfo.address;

 // One confirmation for approve + batch: the server checks the batch pays
 // only these recipients, and no more than this total.
 return confirmFlow(
 circleWallet.id,
 {
 amount: formatUnits(totalAmountUnits, selectedTokenInfo.decimals),
 maxUses: 3,
 recipients: recipients.map((recipient) => recipient.address),
 title: `Pay ${recipients.length} ${recipients.length === 1 ? "person" : "people"}`,
 token: selectedToken,
 },
 async () => {
 const allowance = await readAllowance(circleAddress, tokenAddress);

 if (allowance < requiredAmountUnits) {
 setStatus(`Approve ${selectedToken} for BulkPay`);
 await executeCircleContract({
 callData: encodeFunctionData({
 abi: erc20Abi,
 functionName: "approve",
 args: [batchAddress, maxUint256],
 }),
 contractAddress: tokenAddress,
 label: `Approve ${selectedToken}`,
 refId: `bp-appr-${Date.now()}`.slice(0, 36),
 });
 await waitForAllowance(circleAddress, tokenAddress, requiredAmountUnits);
 }

 setStatus("Create BulkPay transaction");
 const result = await executeCircleContract({
 callData: encodeFunctionData({
 abi: swiftBatchAbi,
 functionName: "sendBatch",
 args: getBatchArgs(),
 }),
 contractAddress: batchAddress,
 label: "Send BulkPay",
 refId: `bp-send-${Date.now()}`.slice(0, 36),
 });

 pendingCircleBatchTxIdRef.current = result.transactionId ?? null;
 return result.txHash as Hash | undefined;
 },
 );
 }

 function createBatchReceipt(txHash?: Hash): BatchReceipt {
 const nextExplorerUrl = txHash
 ? `${arcChain.blockExplorers.default.url}/tx/${txHash}`
 : null;

 return {
 contractAddress: configuredSwiftBatchAddress
 ? configuredSwiftBatchAddress
 : "Not configured",
 explorerUrl: nextExplorerUrl,
 feeAmount: formatTokenAmount(
 feeAmountUnits,
 selectedTokenInfo.decimals,
 selectedToken,
 ),
 feeRecipient: swiftBatchFeeRecipient || "Not configured",
 id: txHash ?? `swiftbatch-${Date.now()}`,
 mode: isEmbeddedWalletMode ? "Circle wallet" : "External wallet",
 payoutTotal: formatTokenAmount(
 totalAmountUnits,
 selectedTokenInfo.decimals,
 selectedToken,
 ),
 recipientCount: recipients.length,
 recipients: recipients.map((recipient) => ({
 address: recipient.address,
 amount: recipient.amount,
 label: recipient.username
 ? `@${recipient.username}${recipient.label ? ` · ${recipient.label}` : ""}`
 : recipient.label,
 line: recipient.line,
 })),
 requiredApproval: formatTokenAmount(
 requiredAmountUnits,
 selectedTokenInfo.decimals,
 selectedToken,
 ),
 submittedAt: new Date().toISOString(),
 token: selectedToken,
 txHash: txHash ?? null,
 walletAddress: walletAddress ?? "Not connected",
 };
 }

 async function submitBatch() {
 setError(null);
 setExplorerUrl("");
 setSuccessOpen(false);

 try {
 if (composer.resolving) {
 throw new Error("Wait for usernames to resolve before sending.");
 }

 if (composer.errors.length > 0) {
 throw new Error(composer.errors[0]);
 }

 if (recipients.length === 0) {
 throw new Error("Add at least one recipient.");
 }

 if (recipients.length > swiftBatchMaxRecipients) {
 throw new Error(`BulkPay supports up to ${swiftBatchMaxRecipients} recipients.`);
 }

 if (!walletAddress) {
 throw new Error("Connect a wallet before sending.");
 }

 if (!hasEnoughBalance) {
 throw new Error(`Insufficient ${selectedToken} balance for payouts and fee.`);
 }

 setIsPending(true);
 setStatus("Preparing BulkPay");

 pendingCircleBatchTxIdRef.current = null;
 const txHash = isEmbeddedWalletMode
 ? await executeCircleBatch()
 : await executeExternalBatch();

 const receipt = createBatchReceipt(txHash);
 // Snapshot what this batch paid: amounts from exact on-chain units (not the
 // composer text), names from the receipt.
 const totalAmountDecimal = formatUnits(totalAmountUnits, selectedTokenInfo.decimals);
 const paid = recipients.map((recipient, index) => ({
 amount: formatUnits(recipient.amountUnits, selectedTokenInfo.decimals),
 label: receipt.recipients[index]?.label ?? null,
 wallet: recipient.address,
 }));
 const batchToken = selectedToken;
 const recordBatch = (hash: Hash) => {
 if (!walletAddress) return;
 void recordPlatformTransactionActivity({
 walletAddress,
 amount: totalAmountDecimal,
 token: batchToken,
 txHash: hash,
 activityType: "BATCH_PAYMENT",
 showToast: true,
 activity: {
 counterparty: `${paid.length} ${paid.length === 1 ? "recipient" : "recipients"}`,
 fee: receipt.feeAmount,
 mode: receipt.mode,
 // Kept with the activity so its receipt can be reopened from Activity.
 recipients: paid,
 source: "batch",
 title: `Batch payment to ${paid.length} ${paid.length === 1 ? "recipient" : "recipients"}`,
 },
 });
 };

 if (txHash) {
 recordBatch(txHash);
 } else if (
 isEmbeddedWalletMode &&
 pendingCircleBatchTxIdRef.current &&
 circleLogin &&
 circleWallet?.id
 ) {
 // Circle settled after we stopped waiting: keep polling in the
 // background, then record the batch and complete the receipt.
 const transactionId = pendingCircleBatchTxIdRef.current;
 void recoverCircleTxHash({
 attempts: 60,
 transactionId,
 userToken: circleLogin.userToken,
 walletId: circleWallet.id,
 }).then((lateHash) => {
 if (!lateHash) return;
 const hash = lateHash as Hash;
 recordBatch(hash);
 const lateExplorerUrl = `${arcChain.blockExplorers.default.url}/tx/${hash}`;
 setExplorerUrl(lateExplorerUrl);
 setBatchReceipt((current) =>
 current && current.id === receipt.id
 ? { ...current, explorerUrl: lateExplorerUrl, txHash: hash }
 : current,
 );
 });
 }

 if (receipt.explorerUrl) {
 setExplorerUrl(receipt.explorerUrl);
 }

 setBatchReceipt(receipt);
 // Paid: start over from the intro, where the receipt waits.
 composerRef.current?.clear();
 setStep("intro");
 setBatchDone(true);

 setStatus(`${recipients.length} recipient batch submitted`);
 await refreshBalances();
 } catch (submitError) {
 setError(getErrorMessage(submitError));
 setStatus("BulkPay failed");
 } finally {
 setIsPending(false);
 }
 }

 async function copyPreview() {
 const preview = [
 `BulkPay ${selectedToken}`,
 `Recipients: ${recipients.length}`,
 `Payout total: ${formatTokenAmount(totalAmountUnits, selectedTokenInfo.decimals, selectedToken)}`,
 `Service fee: ${formatTokenAmount(feeAmountUnits, selectedTokenInfo.decimals, selectedToken)}`,
 `Required approval: ${formatTokenAmount(requiredAmountUnits, selectedTokenInfo.decimals, selectedToken)}`,
 ].join("\n");

 await navigator.clipboard.writeText(preview);
 setStatus("Summary copied");
 }

 async function downloadReceiptPng(receipt: BatchReceipt | null = batchReceipt) {
 if (!receipt) return;
 try {
 await downloadBatchReceiptImage(receipt);
 setStatus("Batch receipt downloaded");
 } catch (error) {
 setStatus(
 error instanceof Error
 ? error.message
 : "Receipt PNG could not be downloaded.",
 );
 }
 }

 async function shareBatchReceipt(receipt: BatchReceipt | null = batchReceipt) {
 if (!receipt) {
 return;
 }

 try {
 const blob = await buildBatchReceiptPng(receipt);
 const file = new File([blob], batchReceiptFileName(receipt), {
 type: "image/png",
 });
 if (navigator.canShare?.({ files: [file] })) {
 await navigator.share({
 files: [file],
 title: "SaphraONE BulkPay receipt",
 });
 setStatus("Batch receipt shared");
 return;
 }
 downloadPngBlob(blob, file.name);
 setStatus("PNG downloaded. This browser cannot share image files.");
 } catch (shareError) {
 if (shareError instanceof DOMException && shareError.name === "AbortError") {
 return;
 }
 setStatus(
 shareError instanceof Error
 ? shareError.message
 : "Batch receipt could not be shared.",
 );
 }
 }

 function handleCsvUpload(event: React.ChangeEvent<HTMLInputElement>) {
 const file = event.target.files?.[0];
 if (!file) return;
 const reader = new FileReader();
 reader.onload = (e) => {
 const text = e.target?.result;
 if (typeof text !== "string") return;
 const count = composerRef.current?.importText(text) ?? 0;
 setStatus(count > 0 ? `Imported ${count} recipient${count > 1 ? "s" : ""} from CSV` : "No valid rows found in CSV");
 };
 reader.readAsText(file);
 // Reset the input so re-uploading the same file triggers onChange
 event.target.value = "";
 }

 function handleCircleSessionCleared() {
 circleSdkRef.current = null;
 setCircleLogin(null);
 setCircleWallets([]);
 setCircleBalances([]);
 setWalletMode("external");
 }

 const walletLabel = isEmbeddedWalletMode ? "Circle wallet" : "External wallet";
 const formatAmount = (amount: bigint) =>
  formatTokenAmount(amount, selectedTokenInfo.decimals, selectedToken);
 const breakdown: BulkpayBreakdown = {
  available: formatAmount(activeBalance),
  fee: formatAmount(feeAmountUnits),
  feePercent: swiftBatchFeeBasisPoints / 100,
  payout: formatAmount(totalAmountUnits),
  people: recipients.length,
  total: formatAmount(requiredAmountUnits),
 };
 const reviewPeople = recipients.map((recipient) => ({
  address: recipient.address,
  amount: recipient.amount,
  line: recipient.line,
  name: recipient.username ? `@${recipient.username}` : shortenAddress(recipient.address),
  note: recipient.label,
 }));
 const insufficient = !hasEnoughBalance && requiredAmountUnits > zeroAmount;
 // Everything but the wallet's own readiness: the summary says what's missing.
 const canContinue =
  recipients.length > 0 &&
  recipients.length <= swiftBatchMaxRecipients &&
  composer.errors.length === 0 &&
  !composer.resolving;

 async function handleRefresh() {
  setRefreshing(true);
  try {
   await refreshBalances();
  } finally {
   setRefreshing(false);
  }
 }

 function goTo(next: BulkpayStep) {
  setError(null);
  setStep(next);
  window.scrollTo({ top: 0 });
 }

 const refreshButton = (
  <button
   aria-label="Refresh balances"
   className="bulkpay-round"
   disabled={refreshing}
   onClick={() => void handleRefresh()}
   title="Refresh balances"
   type="button"
  >
   <RefreshCw className={refreshing ? "h-5 w-5 animate-spin" : "h-5 w-5"} />
  </button>
 );

 return (
 <PlatformChrome
 actions={
 <ProfileMenu
 circleLogin={circleLogin}
 circleWalletAddress={circleAddress}
 externalAddress={externalAddress}
 onCircleSessionCleared={handleCircleSessionCleared}
 walletMode={walletMode}
 />
 }
 // The page draws its own bar with a back button.
 hideHeader
 subtitle="Pay many people in one transaction"
 title="BulkPay"
 >
 <PlatformAccessGate>
 <div className="bulkpay-page">
  {step === "intro" ? (
   <>
    <BulkpayBar title="BulkPay" />
    <BulkpayIntro
     feePercent={swiftBatchFeeBasisPoints / 100}
     maxRecipients={swiftBatchMaxRecipients}
     onStart={() => goTo("people")}
    />
   </>
  ) : null}

  {/* Kept mounted through the summary, so going back keeps everyone added. */}
  <div className="bulkpay-step" hidden={step !== "people"}>
   <BulkpayBar action={refreshButton} onBack={() => goTo("intro")} title="Add people" />
   <BulkpaySteps step={1} />
   <BulkpayTokenStrip
    available={breakdown.available}
    onTokenChange={setSelectedToken}
    token={selectedToken}
    walletAddress={walletAddress}
    walletLabel={walletLabel}
   />
   <BulkpayPeopleCard errors={composer.errors}>
    <input
     accept=".csv,.txt"
     className="hidden"
     onChange={handleCsvUpload}
     ref={fileInputRef}
     type="file"
    />
    <BatchPeopleComposer
     actions={
      <BulkpayComposerTools
       onClear={() => composerRef.current?.clear()}
       onImport={() => fileInputRef.current?.click()}
      />
     }
     beneficiaryAuth={
      walletAddress
       ? {
          circleSocialUuid: getCircleLoginIdentity(circleLogin).socialUserUUID ?? undefined,
          ownerWallet: getAddress(walletAddress),
         }
       : null
     }
     maxRecipients={swiftBatchMaxRecipients}
     onResolvedChange={handleComposerChange}
     ref={composerRef}
     token={selectedToken}
    />
   </BulkpayPeopleCard>
   {recipients.length === 1 ? (
    <p className="bulkpay-hint">
     Paying just one person? A normal send is simpler and costs less (a 0.1% fee instead of{" "}
     {swiftBatchFeeBasisPoints / 100}%).{" "}
     <Link
      href={`/send?to=${encodeURIComponent(
       recipients[0].username ? `@${recipients[0].username}` : recipients[0].address,
      )}&amount=${encodeURIComponent(recipients[0].amount)}&token=${selectedToken}`}
     >
      Send instead
     </Link>
    </p>
   ) : null}
   {status !== "Ready" && !error ? <p className="bulkpay-note">{status}</p> : null}
   <BulkpayContinueBar
    canContinue={canContinue}
    insufficient={insufficient}
    onContinue={() => goTo("summary")}
    people={recipients.length}
    resolving={composer.resolving}
    total={breakdown.total}
   />
  </div>

  {step === "summary" ? (
   <>
    <BulkpayBar action={refreshButton} onBack={() => goTo("people")} title="Summary" />
    <BulkpaySteps step={2} />
    <BulkpaySummary
     breakdown={breakdown}
     canSend={canSubmit}
     contract={
      configuredSwiftBatchAddress
       ? shortenAddress(configuredSwiftBatchAddress)
       : t("common.notSet")
     }
     contractLabel={t("common.contract")}
     contractMissing={!configuredSwiftBatchAddress}
     error={error}
     explorerUrl={explorerUrl}
     insufficient={insufficient}
     onCopy={() => void copyPreview()}
     onSend={() => void submitBatch()}
     pending={isPending}
     people={reviewPeople}
     status={status}
     token={selectedToken}
     walletAddress={walletAddress}
     walletLabel={walletLabel}
    />
   </>
  ) : null}
 </div>

 <TransferProgressOverlay
  active={isPending || batchDone}
  coin={batchReceipt?.token ?? selectedToken}
  current={0}
  details={
   batchDone && batchReceipt
    ? {
       amount: batchReceipt.payoutTotal,
       eyebrow: "BulkPay",
       explorerUrl: batchReceipt.explorerUrl ?? undefined,
       extra: (
        <button
         className="tp-link"
         onClick={() => {
          setBatchDone(false);
          setSuccessOpen(true);
         }}
         type="button"
        >
         View receipt
        </button>
       ),
       rows: [
        { label: "Recipients", value: String(batchReceipt.recipientCount) },
        { label: "Service fee", value: batchReceipt.feeAmount },
       ],
      }
    : undefined
  }
  doneSubtitle={
   batchReceipt
    ? `Paid ${batchReceipt.recipientCount} ${batchReceipt.recipientCount === 1 ? "person" : "people"}.`
    : undefined
  }
  doneTitle="Batch sent"
  from={<TokenIcon className="h-8 w-8" symbol={batchReceipt?.token ?? selectedToken} />}
  onDone={() => setBatchDone(false)}
  state={batchDone ? "done" : "running"}
  steps={["Paying everyone in one transaction"]}
  title="Sending"
  to={<Users className="h-6 w-6 text-primary" />}
 />

 {successOpen && batchReceipt ? (
 <BatchReceiptModal
 onClose={closeSuccess}
 onDownload={(receipt) => void downloadReceiptPng(receipt)}
 onShare={(receipt) => void shareBatchReceipt(receipt)}
 receipt={batchReceipt}
 />
 ) : null}
 </PlatformAccessGate>
 </PlatformChrome>
 );
}
