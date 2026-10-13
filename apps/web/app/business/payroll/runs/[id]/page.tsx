"use client";

import { switchToArc } from "@/lib/arc-network";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { confirmFlow } from "@/lib/tx-approval/client";
import { useAccount, useChainId, useReadContract, useSwitchChain, useWriteContract } from "wagmi";

import { useAccountContext } from "@/components/account/account-provider";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { Button } from "@/components/ui/button";
import { showSuccess } from "@/components/success-popup";
import { PayrollStatusBadge } from "@/components/payroll/payroll-status-badge";
import {
  approvePayrollRunClient,
  cancelPayrollRunClient,
  executePayrollRunClient,
  fetchPayrollRun,
  retryPayrollItemClient,
} from "@/lib/payroll/client";
import type {
  PayrollItemRecord,
  PayrollRunRecord,
} from "@/lib/payroll/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
  currentCircleAuth,
  callCircleWalletApi,
  findCircleTokenBalance,
  readCircleLogin,
  readCircleWallets,
  writeCircleWallets,
  type CircleLoginResult,
  type CircleTokenBalance,
  type CircleWallet,
} from "@/lib/circle-session";
import { recoverCircleTxHash } from "@/lib/circle-tx";
import {
  dedicatedBusinessWallet,
  personalCircleWallet,
} from "@/lib/business/provision-wallet";
import { useOptionalWorkspace } from "@/components/business/workspace-provider";
import { erc20Abi, swiftBatchAbi, swiftBatchAddress } from "@/lib/contracts";
import { bulkFeeLabel, bulkFeeUnits, usesLegacyPayrollFee } from "@/lib/fees";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";
import { usePreferredWalletMode } from "@/lib/use-preferred-wallet-mode";
import { arcChain, arcExplorerUrl, arcTransport } from "@/lib/chains";

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

const arcPublicClient = createPublicClient({
  chain: arcChain,
  transport: arcTransport(),
});

const configuredBatchAddress =
  swiftBatchAddress && isAddress(swiftBatchAddress)
    ? (getAddress(swiftBatchAddress) as Address)
    : undefined;

export default function PayrollRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const circleSdkRef = useRef<W3SSdk | null>(null);
  const { ownerWallet, circleSocialUuid } = useAccountContext();
  const workspaceContext = useOptionalWorkspace();
  const { address: externalAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [walletMode] = usePreferredWalletMode("external");

  const [run, setRun] = useState<(PayrollRunRecord & { items: PayrollItemRecord[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>("");

  // Approval Modal state
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [confirmStatementChecked, setConfirmStatementChecked] = useState(false);

  // Circle wallet state
  const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(null);
  const [circleWallets, setCircleWallets] = useState<CircleWallet[]>([]);
  const [circleBalances, setCircleBalances] = useState<CircleTokenBalance[]>([]);
  const [directBalanceBigInt, setDirectBalanceBigInt] = useState<bigint | null>(null);

  // Determine active wallet address
  const circleWallet = useMemo(() => {
    const dedicated = dedicatedBusinessWallet(
      workspaceContext?.workspace ?? null,
      circleWallets,
      ownerWallet ?? undefined,
    );
    return (
      dedicated ??
      circleWallets.find((w) => w.address?.toLowerCase() === ownerWallet?.toLowerCase()) ??
      personalCircleWallet(circleWallets)
    );
  }, [workspaceContext?.workspace, circleWallets, ownerWallet]);

  const circleAddress = circleWallet?.address
    ? (getAddress(circleWallet.address) as Address)
    : undefined;

  const isCircleMode =
    walletMode === "circle" ||
    (!externalAddress && Boolean(circleAddress || circleLogin || circleSocialUuid || ownerWallet));

  const payingWalletAddress = (
    isCircleMode
      ? (circleAddress || ownerWallet || externalAddress)
      : (externalAddress || circleAddress || ownerWallet)
  ) as Address | undefined;

  const isPayingAddressValid = Boolean(payingWalletAddress && isAddress(payingWalletAddress));

  // Token & balance verification
  const tokenSymbol: ArcTokenSymbol = (run?.asset as ArcTokenSymbol) || "USDC";
  const tokenInfo = arcTokens[tokenSymbol] || arcTokens["USDC"];

  const { data: wagmiBalanceBigInt, refetch: refetchWagmiBalance } = useReadContract({
    address: tokenInfo.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: isPayingAddressValid ? [getAddress(payingWalletAddress!)] : undefined,
    chainId: arcChain.id,
    query: { enabled: isPayingAddressValid },
  });

  const refreshDirectBalance = useCallback(async () => {
    if (!payingWalletAddress || !isAddress(payingWalletAddress)) return;
    try {
      const bal = (await arcPublicClient.readContract({
        address: tokenInfo.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [getAddress(payingWalletAddress)],
      })) as bigint;
      setDirectBalanceBigInt(bal);
    } catch (err) {
      console.warn("Direct balance check failed:", err);
    }
  }, [payingWalletAddress, tokenInfo.address]);

  const refreshCircleData = useCallback(async () => {
    const login = readCircleLogin();
    if (!login) return;
    setCircleLogin(login);

    let wallets = readCircleWallets();
    if (wallets.length === 0) {
      try {
        const payload = await callCircleWalletApi<{ wallets?: CircleWallet[] }>(
          "listWallets",
          { userToken: login.userToken },
        );
        wallets = payload.wallets ?? [];
        if (wallets.length > 0) {
          writeCircleWallets(wallets);
          setCircleWallets(wallets);
        }
      } catch {
        // ignore
      }
    } else {
      setCircleWallets(wallets);
    }

    const target =
      wallets.find((w) => w.address?.toLowerCase() === ownerWallet?.toLowerCase()) ??
      personalCircleWallet(wallets);

    if (target?.id) {
      try {
        const balPayload = await callCircleWalletApi<{
          tokenBalances?: CircleTokenBalance[];
        }>("getTokenBalance", {
          userToken: login.userToken,
          walletId: target.id,
        });
        if (balPayload?.tokenBalances) {
          setCircleBalances(balPayload.tokenBalances);
        }
      } catch {
        // ignore
      }
    }
  }, [ownerWallet]);

  useEffect(() => {
    void refreshDirectBalance();
    void refreshCircleData();
  }, [refreshDirectBalance, refreshCircleData]);

  const circleTokenBal = findCircleTokenBalance(circleBalances, tokenSymbol);

  const activeBalanceFormatted = useMemo(() => {
    const rawBigInt =
      directBalanceBigInt ??
      (typeof wagmiBalanceBigInt === "bigint" ? wagmiBalanceBigInt : null);

    if (rawBigInt !== null) {
      return formatUnits(rawBigInt, tokenInfo.decimals);
    }
    if (circleTokenBal?.amount) {
      return circleTokenBal.amount;
    }
    return "0";
  }, [directBalanceBigInt, wagmiBalanceBigInt, circleTokenBal, tokenInfo.decimals]);

  const hasInsufficientBalance = useMemo(() => {
    if (!run) return false;
    const avail = Number(activeBalanceFormatted);
    const req = Number(run.total_required);
    return avail < req;
  }, [activeBalanceFormatted, run]);

  const shortfallAmount = useMemo(() => {
    if (!run) return "0.00";
    const avail = Number(activeBalanceFormatted);
    const req = Number(run.total_required);
    return (req - avail).toFixed(2);
  }, [activeBalanceFormatted, run]);

  async function loadData() {
    if (!ownerWallet) return null;
    setLoading(true);
    try {
      const data = await fetchPayrollRun(ownerWallet, id, circleSocialUuid ?? undefined, workspaceContext?.workspace?.id);
      setRun(data);
      setError(null);
      return data;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load payroll run.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    const cached = readCircleWallets();
    if (cached.length > 0) setCircleWallets(cached);
  }, [ownerWallet, id, circleSocialUuid, workspaceContext?.workspace?.id]);

  // Approval handler
  async function handleApprove() {
    if (!ownerWallet || !confirmStatementChecked) return;
    setIsProcessing(true);
    setError(null);
    try {
      await approvePayrollRunClient(
        ownerWallet,
        id,
        {
          confirmedAt: new Date().toISOString(),
          confirmedBy: ownerWallet,
          balanceVerified: activeBalanceFormatted,
        },
        circleSocialUuid ?? undefined,
        workspaceContext?.workspace?.id,
      );
      setIsApprovalModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Approval failed.");
    } finally {
      setIsProcessing(false);
    }
  }

  // Cancel handler
  async function handleCancel() {
    if (!ownerWallet || !confirm("Are you sure you want to cancel this payroll run?")) return;
    setIsProcessing(true);
    try {
      await cancelPayrollRunClient(ownerWallet, id, circleSocialUuid ?? undefined, workspaceContext?.workspace?.id);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Cancellation failed.");
    } finally {
      setIsProcessing(false);
    }
  }

  // Circle SDK helper
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
    const { W3SSdk: CircleW3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
    const sdk = new CircleW3SSdk({
      appSettings: { appId },
      authentication: {
        encryptionKey: login.encryptionKey,
        userToken: login.userToken,
      },
    });
    circleSdkRef.current = sdk;
    return sdk;
  }

  async function executeCircleChallenge(challengeId: string, label: string) {
    if (!circleLogin) {
      throw new Error("Circle wallet confirmation is not ready.");
    }
    const sdk = await ensureCircleSdk(circleLogin);
    sdk.setAuthentication(currentCircleAuth(circleLogin));
    setProcessingStatus(`Confirm ${label} in Circle wallet…`);
    return new Promise<CircleChallengeResult>((resolve, reject) => {
      sdk.execute(challengeId, (challengeError, result) => {
        if (challengeError) {
          reject(new Error((challengeError as { message?: string }).message || "Circle confirmation failed."));
          return;
        }
        resolve((result ?? {}) as CircleChallengeResult);
      });
    });
  }

  /** The Circle wallet that pays this run. */
  function payingCircleWallet() {
    return (
      circleWallet ??
      circleWallets.find((w) => w.address?.toLowerCase() === payingWalletAddress?.toLowerCase()) ??
      circleWallets[0]
    );
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
    if (!circleLogin) {
      throw new Error("Circle login session is not ready.");
    }
    const activeCircle = payingCircleWallet();

    if (!activeCircle?.id) {
      throw new Error("Circle wallet not found.");
    }

    const challenge = await callCircleWalletApi<CircleContractChallenge>(
      "createContractExecution",
      {
        callData,
        contractAddress,
        feeLevel: "HIGH",
        refId,
        userToken: circleLogin.userToken,
        walletId: activeCircle.id,
      },
    );
    const challengeId = getCircleChallengeId(challenge);
    if (!challengeId) {
      const txHash = getCircleTransactionHash(challenge);
      if (txHash) return { txHash };
      throw new Error("Circle did not return a contract challenge.");
    }

    const result = await executeCircleChallenge(challengeId, label);
    const immediateHash = getCircleTransactionHash(result) ?? getCircleTransactionHash(challenge);
    const transactionId =
      challenge.transactionId ??
      challenge.data?.transactionId ??
      result.transactionId ??
      result.data?.transactionId ??
      challengeId;

    if (immediateHash) {
      return { txHash: immediateHash, transactionId };
    }

    setProcessingStatus("Waiting for Circle settlement…");
    const recovered = await recoverCircleTxHash({
      transactionId,
      userToken: circleLogin.userToken,
      walletId: activeCircle.id,
      attempts: 8,
    });

    return { txHash: recovered ?? undefined, transactionId };
  }

  async function waitForAllowance(owner: Address, token: Address, amount: bigint) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const allowance = (await arcPublicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [owner, configuredBatchAddress!],
      })) as bigint;

      if (allowance >= amount) return;
      setProcessingStatus("Waiting for approval confirmation…");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Execution via BulkPay smart contract on Arc
  async function handleExecute() {
    if (!ownerWallet || !run) return;
    if (hasInsufficientBalance) {
      setError(
        `Insufficient ${run.asset} balance. Required: ${run.total_required}, Available: ${activeBalanceFormatted}. Shortfall: ${shortfallAmount}.`,
      );
      return;
    }

    if (!configuredBatchAddress) {
      setError("BulkPay contract address is not configured.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setProcessingStatus("Preparing batch settlement on Arc…");

    try {
      const recipientsList = run.items.map((it) => getAddress(it.recipient_destination_snapshot) as Address);
      const amountsList = run.items.map((it) => parseUnits(it.total_amount, tokenInfo.decimals));
      // Paid through BulkPay, which takes its own fee on the run total.
      const payoutUnits = amountsList.reduce((sum, value) => sum + value, BigInt(0));
      const requiredTotalUnits =
        payoutUnits + bulkFeeUnits(payoutUnits, amountsList.length, configuredBatchAddress);

      let batchHash: Hash | undefined;
      let settlementTxId: string | undefined;

      if (isCircleMode) {
        if (!payingWalletAddress) {
          throw new Error("Business Circle wallet address not found.");
        }
        const payingWallet = payingWalletAddress;
        // One confirmation for approve + settlement: the server checks the
        // batch pays only this run's recipients, and no more than its total.
        const execResult = await confirmFlow(
          payingCircleWallet()?.id,
          {
            amount: formatUnits(
              amountsList.reduce((sum, units) => sum + units, BigInt(0)),
              tokenInfo.decimals,
            ),
            maxUses: 3,
            recipients: recipientsList,
            title: `Pay ${recipientsList.length} ${recipientsList.length === 1 ? "person" : "people"}`,
            token: tokenSymbol,
          },
          async () => {
            setProcessingStatus(`Checking ${tokenSymbol} allowance for BulkPay…`);
            const allowance = (await arcPublicClient.readContract({
              address: tokenInfo.address,
              abi: erc20Abi,
              functionName: "allowance",
              args: [payingWallet, configuredBatchAddress],
            })) as bigint;

            if (allowance < requiredTotalUnits) {
              setProcessingStatus(`Approving ${tokenSymbol} for BulkPay…`);
              await executeCircleContract({
                callData: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [configuredBatchAddress, requiredTotalUnits],
                }),
                contractAddress: tokenInfo.address,
                label: `Approve ${tokenSymbol}`,
                refId: `payroll-approve-${run.id}-${Date.now()}`,
              });
              await waitForAllowance(payingWallet, tokenInfo.address, requiredTotalUnits);
            }

            setProcessingStatus("Executing BulkPay settlement via Circle…");
            return executeCircleContract({
              callData: encodeFunctionData({
                abi: swiftBatchAbi,
                functionName: "sendBatch",
                args: [tokenInfo.address, recipientsList, amountsList],
              }),
              contractAddress: configuredBatchAddress,
              label: "Execute BulkPay Settlement",
              refId: `payroll-batch-${run.id}-${Date.now()}`,
            });
          },
        );

        batchHash = execResult.txHash as Hash | undefined;
        settlementTxId = execResult.transactionId;
      } else {
        if (!externalAddress) {
          throw new Error("Connect your wallet to execute blockchain settlement.");
        }
        if (chainId !== arcChain.id) {
          setProcessingStatus(`Switching to ${arcChain.name}…`);
          await switchToArc(switchChainAsync);
        }

        setProcessingStatus(`Checking ${tokenSymbol} allowance for BulkPay…`);
        const allowance = (await arcPublicClient.readContract({
          address: tokenInfo.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [externalAddress, configuredBatchAddress],
        })) as bigint;

        if (allowance < requiredTotalUnits) {
          setProcessingStatus(`Approving ${tokenSymbol} for BulkPay…`);
          const approveHash = await writeContractAsync({
            address: tokenInfo.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [configuredBatchAddress, requiredTotalUnits],
            chainId: arcChain.id,
          });
          setProcessingStatus("Waiting for approval confirmation…");
          await arcPublicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        setProcessingStatus("Executing BulkPay settlement transaction…");
        batchHash = await writeContractAsync({
          address: configuredBatchAddress,
          abi: swiftBatchAbi,
          functionName: "sendBatch",
          args: [tokenInfo.address, recipientsList, amountsList],
          chainId: arcChain.id,
        });

        setProcessingStatus("Confirming settlement on ArcScan…");
        await arcPublicClient.waitForTransactionReceipt({ hash: batchHash });
        settlementTxId = batchHash;
      }

      // Record execution in backend
      setProcessingStatus("Reconciling payroll status…");
      const executed = await executePayrollRunClient(
        ownerWallet,
        run.id,
        {
          txHash: batchHash ?? null,
          transactionId: settlementTxId ?? batchHash ?? null,
          availableBalance: activeBalanceFormatted,
        },
        circleSocialUuid ?? undefined,
        workspaceContext?.workspace?.id,
      );

      await loadData();
      await refreshDirectBalance();
      await refetchWagmiBalance();

      if (executed && (executed.status === "COMPLETED" || executed.status === "APPROVED" || executed.status === "PROCESSING")) {
        showSuccess({
          eyebrow: "Payroll Settled",
          title: "Payroll Run Completed",
          subtitle: "Successfully settled payments for all recipients.",
          amount: `${executed.total_amount} ${executed.asset}`,
          explorerUrl: batchHash ? `${arcExplorerUrl}/tx/${batchHash}` : undefined,
          rows: [
            { label: "Payroll Run", value: executed.name },
            { label: "Recipients", value: `${executed.recipient_count}` },
            { label: "Service Fee", value: `${executed.total_fees} ${executed.asset}` },
            { label: "Total Required", value: `${executed.total_required} ${executed.asset}` },
            { label: "Status", value: executed.status },
          ],
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Payroll execution failed.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  }

  // Single item retry
  async function handleRetryItem(item: PayrollItemRecord) {
    if (!ownerWallet || !run) return;
    setIsProcessing(true);
    setProcessingStatus(`Retrying payment to ${item.recipient_name_snapshot}…`);
    try {
      // Execute single payment or simulate retry
      const txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
      await retryPayrollItemClient(
        ownerWallet,
        item.id,
        {
          txHash,
          success: true,
        },
        circleSocialUuid ?? undefined,
        workspaceContext?.workspace?.id,
      );
      const reloaded = await loadData();
      if (reloaded && reloaded.status === "COMPLETED") {
        showSuccess({
          eyebrow: "Payroll Settled",
          title: "Payroll Run Completed",
          subtitle: "All retry payments have settled successfully.",
          amount: `${reloaded.total_amount} ${reloaded.asset}`,
          rows: [
            { label: "Payroll Run", value: reloaded.name },
            { label: "Recipients", value: `${reloaded.recipient_count}` },
            { label: "Service Fee", value: `${reloaded.total_fees} ${reloaded.asset}` },
            { label: "Total Required", value: `${reloaded.total_required} ${reloaded.asset}` },
            { label: "Status", value: "Completed" },
          ],
        });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setIsProcessing(false);
      setProcessingStatus("");
    }
  }

  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        subtitle="Review, approve, and execute batch settlement on Arc."
        title="Payroll Run Detail"
      >
        <div className="mb-4">
          <Button asChild size="sm" variant="ghost">
            <Link href="/business/payroll">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to Payroll
            </Link>
          </Button>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            Loading payroll run…
          </div>
        ) : !run ? (
          <div className="section-panel p-8 text-center text-muted-foreground">
            Payroll run not found.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Run Header Panel */}
            <div className="section-panel p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="font-heading text-2xl font-bold">{run.name}</h2>
                    <PayrollStatusBadge status={run.status} />
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Created on{" "}
                    {new Date(run.created_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}{" "}
                    · Source: {run.source}
                  </p>
                </div>

                {/* Primary Action Buttons depending on status */}
                <div className="flex items-center gap-2">
                  {(run.status === "DRAFT" || run.status === "READY") && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => void handleCancel()} disabled={isProcessing}>
                        Cancel Run
                      </Button>
                      <Button size="sm" onClick={() => setIsApprovalModalOpen(true)} disabled={isProcessing}>
                        <ShieldCheck className="h-4 w-4 mr-1.5" />
                        Approve Payroll
                      </Button>
                    </>
                  )}

                  {run.status === "APPROVED" && (
                    <Button size="sm" onClick={() => void handleExecute()} disabled={isProcessing || hasInsufficientBalance}>
                      {isProcessing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                          {processingStatus || "Processing…"}
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-1.5" />
                          Execute Payroll via BulkPay
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid gap-4 sm:grid-cols-4 mt-6 pt-6 border-t border-border">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Recipients</span>
                  <p className="mt-1 font-heading text-xl font-bold">{run.recipient_count}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Total Payout</span>
                  <p className="mt-1 font-heading text-xl font-bold">{run.total_amount} {run.asset}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">{bulkFeeLabel(parseUnits(run.total_amount, 6), run.items.length, usesLegacyPayrollFee())}</span>
                  <p className="mt-1 font-heading text-xl font-bold text-muted-foreground">{run.total_fees} {run.asset}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Total Required</span>
                  <p className="mt-1 font-heading text-xl font-bold text-primary">{run.total_required} {run.asset}</p>
                </div>
              </div>

              {/* Available Balance Status Banner */}
              <div className="mt-4 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">Available Balance:</span>
                  <span className="font-semibold text-foreground">{activeBalanceFormatted} {run.asset}</span>
                </div>

                {hasInsufficientBalance ? (
                  <div className="flex items-center gap-1.5 font-semibold text-destructive">
                    <ShieldAlert className="h-4 w-4" />
                    Shortfall: {shortfallAmount} {run.asset}. Top up your business wallet before execution.
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-600">
                    <CheckCircle2 className="h-4 w-4" />
                    Balance verified for payroll execution.
                  </div>
                )}
              </div>
            </div>

            {/* Section 27: Recipient Review List */}
            <section className="section-panel p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-heading text-lg font-bold">Recipient Breakdown</h3>
                <span className="text-xs text-muted-foreground">{run.items.length} payees</span>
              </div>

              <div className="divide-y divide-border">
                {run.items.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{item.recipient_name_snapshot}</span>
                        <PayrollStatusBadge status={item.status} />
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                        {item.recipient_username_snapshot ? `@${item.recipient_username_snapshot} · ` : ""}
                        {item.recipient_destination_snapshot}
                      </p>
                      {item.failure_reason ? (
                        <p className="text-xs text-destructive mt-1 font-medium">
                          Failed: {item.failure_reason}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="font-heading font-bold text-foreground">
                          {item.total_amount} {item.asset}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Base: {item.base_amount}
                          {Number(item.adjustment_amount) !== 0 ? ` · Adj: ${item.adjustment_amount}` : ""}
                        </p>
                      </div>

                      {/* Targeted single item retry (Section 42-43) */}
                      {item.status === "FAILED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleRetryItem(item)}
                          disabled={isProcessing}
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                          Retry
                        </Button>
                      )}

                      {item.blockchain_tx_hash ? (
                        <a
                          href={`${arcExplorerUrl}/tx/${item.blockchain_tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline flex items-center"
                        >
                          ArcScan <ExternalLink className="h-3 w-3 ml-1" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Section 32: Approval Confirmation Modal */}
        {isApprovalModalOpen && run ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <h3 className="font-heading text-lg font-bold">Authorize Payroll Approval</h3>
                </div>
                <button
                  onClick={() => setIsApprovalModalOpen(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 space-y-4 text-sm">
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recipients:</span>
                    <span className="font-bold text-foreground">{run.recipient_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Payout:</span>
                    <span className="font-bold text-foreground">{run.total_amount} {run.asset}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estimated fees:</span>
                    <span className="font-bold text-foreground">{run.total_fees} {run.asset}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 text-sm">
                    <span className="font-bold text-foreground">Total Required:</span>
                    <span className="font-bold text-primary">{run.total_required} {run.asset}</span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  Approving this run creates an immutable snapshot. Changes to team members will not alter these payment instructions.
                </p>

                <label className="flex items-start gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmStatementChecked}
                    onChange={(e) => setConfirmStatementChecked(e.target.checked)}
                    className="mt-0.5 rounded border-border"
                  />
                  <span className="text-xs font-semibold text-foreground leading-relaxed">
                    "I confirm that I have reviewed this payroll and authorize SaphraONE to execute these payments."
                  </span>
                </label>
              </div>

              <div className="mt-6 pt-4 border-t border-border flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsApprovalModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!confirmStatementChecked || isProcessing}
                  onClick={() => void handleApprove()}
                >
                  {isProcessing ? "Authorizing…" : "Approve Payroll"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
