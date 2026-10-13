"use client";

import { switchToArc } from "@/lib/arc-network";
import {
  KeyRound,
  Loader2,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatUnits, maxUint256, type Address, type Hash } from "viem";

import { AmountConfirmDialog } from "@/components/save/amount-confirm-dialog";
import { formatMoneyShort, pocketProgress } from "@/components/save/format";
import {
  PocketActivity,
  PocketBar,
  PocketEditSheet,
  PocketFigures,
  PocketHero,
  PocketLockCard,
  PocketOptionsSheet,
  PocketSpendSave,
} from "@/components/save/pocket-detail-views";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { Button } from "@/components/ui/button";
import {
  executeCircleChallenge,
  readCircleAppId,
  getCircleLoginIdentity,
  readCircleLogin,
  type CircleLoginResult,
} from "@/lib/circle-session";
import { erc20Abi } from "@/lib/contracts";
import {
  circleVaultDeposit,
  circleVaultWithdraw,
} from "@/lib/save/circle-vault";
import { swiftSaveVaultAbi } from "@/lib/save/abis";
import {
  archiveSavingsPocket,
  deleteSavingsPocket,
  confirmDeposit,
  confirmWithdraw,
  fetchSavingsPocket,
  fetchSpendSaveHistory,
  initiateDeposit,
  initiateWithdraw,
  updateSavingsPocket,
} from "@/lib/save/client";
import {
  isSwiftSaveVaultConfigured,
} from "@/lib/save/config";
import {
  formatUnlockDate,
  getPocketLockState,
} from "@/lib/save/lock";
import {
  type SavingsPocketRecord,
  type SavingsTransactionRecord,
  type SpendSaveConfigRecord,
  type SpendSaveEventRecord,
} from "@/lib/save/types";
import { buildPocketActivity, type PocketActivityItem } from "@/lib/save/activity";
import { executeSavingsReversal } from "@/lib/save/spend-save-browser";
import { arcTokens } from "@/lib/tokens";
import {
  fetchWalletSession,
  signInWalletSession,
} from "@/lib/wallet-auth-client";
import {
  extractCircleTransactionId,
  extractCircleTxHash,
} from "@/lib/circle-tx";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { arcChain } from "@/lib/chains";
import { showSuccess } from "@/components/success-popup";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export default function SavingsPocketDetailPage() {
  const params = useParams<{ id: string }>();
  const pocketId = params.id;
  const { address: wagmiAddress, connector } = useAccount();
  const {
    address: platformAddress,
    circleWallet: platformCircleWallet,
    isBusinessWorkspace,
    isConnected,
    source,
  } = usePlatformWallet();
  const address = (platformAddress ??
    (isBusinessWorkspace ? undefined : wagmiAddress)) as Address | undefined;
  const chainId = useChainId();
  const { signMessageAsync, isPending: isSigningIn } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending: isWritePending } = useWriteContract();
  const circleSdkRef = useRef<W3SSdk | null>(null);
  const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(null);
  const [circleSdkReady, setCircleSdkReady] = useState(false);

  const [authWallet, setAuthWallet] = useState<string | null>(null);
  const [circleSocialUuid, setCircleSocialUuid] = useState<string | undefined>();
  const [pocket, setPocket] = useState<SavingsPocketRecord | null>(null);
  const [stats, setStats] = useState<{
    totalDeposits: string;
    totalWithdrawals: string;
    lastDepositAt: string | null;
  } | null>(null);
  const [spendSave, setSpendSave] = useState<SpendSaveConfigRecord | null>(null);
  const [transactions, setTransactions] = useState<SavingsTransactionRecord[]>(
    [],
  );
  const [spendEvents, setSpendEvents] = useState<SpendSaveEventRecord[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Shares the dashboard's and Save's "hide balances" choice.
  const [hideBalance, setHideBalance] = useState(false);
  useEffect(() => {
    try {
      setHideBalance(window.localStorage.getItem("saphra.hide-balance") === "1");
    } catch {
      setHideBalance(false);
    }
  }, []);
  const toggleHideBalance = useCallback(() => {
    setHideBalance((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("saphra.hide-balance", next ? "1" : "0");
      } catch {
        // Private mode: the choice lasts this visit.
      }
      return next;
    });
  }, []);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStopAtTarget, setEditStopAtTarget] = useState(false);
  const [amountMode, setAmountMode] = useState<"deposit" | "withdraw" | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<Hash | undefined>();
  const [pendingConfirm, setPendingConfirm] = useState<{
    amount: string;
    mode: "deposit" | "withdraw";
    transactionId: string;
  } | null>(null);

  /** The finished animation with the pocket's receipt. */
  function showPocketSuccess(mode: "deposit" | "withdraw", amount: string, txHash?: string) {
    showSuccess({
      amount: `${amount} ${pocket?.currency ?? "USDC"}`,
      eyebrow: "Save",
      explorerUrl: txHash ? `${arcChain.blockExplorers.default.url}/tx/${txHash}` : undefined,
      rows: pocket ? [{ label: "Pocket", value: pocket.name }] : undefined,
      subtitle:
        mode === "deposit" ? "Money was added to your pocket." : "Funds are back in your wallet.",
      title: mode === "deposit" ? "Deposit successful" : "Withdrawal successful",
    });
  }

  const currency = pocket?.currency ?? "USDC";
  const token = arcTokens[currency];

  const { data: walletTokenBalance, refetch: refetchBalance } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: arcChain.id,
    query: { enabled: Boolean(address) },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "allowance",
    args:
      address && isSwiftSaveVaultConfigured()
        ? [
            address,
            process.env.NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS as Address,
          ]
        : undefined,
    chainId: arcChain.id,
    query: {
      enabled: Boolean(address && isSwiftSaveVaultConfigured()),
    },
  });

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: pendingTxHash });

  const walletBalanceLabel = useMemo(() => {
    if (walletTokenBalance === undefined) return "n/a";
    return `${formatMoneyShort(formatUnits(walletTokenBalance, token.decimals))} ${currency}`;
  }, [walletTokenBalance, token.decimals, currency]);

  const isWalletAuthenticated =
    source === "embedded" ||
    (Boolean(authWallet) &&
      Boolean(address) &&
      authWallet === address?.toLowerCase());

  const load = useCallback(async () => {
    const owner = address;
    if (!owner || !pocketId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const social =
        getCircleLoginIdentity(readCircleLogin())?.socialUserUUID ?? undefined;
      setCircleSocialUuid(social);
      const [data, history] = await Promise.all([
        fetchSavingsPocket(pocketId, owner, social),
        fetchSpendSaveHistory(owner, social).catch(() => ({ events: [] as SpendSaveEventRecord[] })),
      ]);
      setSpendEvents(history.events.filter((event) => event.pocket_id === pocketId));
      setPocket(data.pocket);
      setStats(data.stats);
      setSpendSave(data.spendSave);
      setTransactions(data.transactions);
      setEditName(data.pocket.name);
      setEditTarget(data.pocket.target_amount ?? "");
      setEditDescription(data.pocket.description ?? "");
      setEditStopAtTarget(Boolean(data.pocket.stop_at_target));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [address, pocketId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function syncSession() {
      if (!address) {
        setAuthWallet(null);
        return;
      }
      try {
        const session = await fetchWalletSession();
        if (cancelled) return;
        if (
          session.authenticated &&
          session.ownerWallet?.toLowerCase() === address.toLowerCase()
        ) {
          setAuthWallet(session.ownerWallet.toLowerCase());
        } else {
          setAuthWallet(null);
        }
      } catch {
        if (!cancelled) setAuthWallet(null);
      }
    }
    void syncSession();
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    const login = readCircleLogin();
    setCircleLogin(login);
    if (!login?.userToken || !login.encryptionKey) {
      circleSdkRef.current = null;
      setCircleSdkReady(false);
      return;
    }

    const appId = readCircleAppId();
    if (!appId) {
      circleSdkRef.current = null;
      setCircleSdkReady(false);
      return;
    }

    let cancelled = false;
    void import("@circle-fin/w3s-pw-web-sdk")
      .then(({ W3SSdk: CircleW3SSdk }) => {
        if (cancelled) return;
        circleSdkRef.current = new CircleW3SSdk({
          appSettings: { appId },
          authentication: {
            encryptionKey: login.encryptionKey,
            userToken: login.userToken,
          },
        });
        setCircleSdkReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          circleSdkRef.current = null;
          setCircleSdkReady(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  const isCircleMode = Boolean(
    circleLogin && platformCircleWallet?.id && circleSdkReady,
  );

  useEffect(() => {
    if (!isConfirmed || !pendingConfirm || !pendingTxHash || !address || !pocket)
      return;

    const confirm = pendingConfirm;
    const owner = address;
    const hash = pendingTxHash;
    const pocketRef = pocket;
    let cancelled = false;

    async function finalize() {
      try {
        setIsActing(true);
        if (confirm.mode === "deposit") {
          await confirmDeposit(pocketRef.id, {
            ownerWallet: owner,
            circleSocialUuid,
            transactionId: confirm.transactionId,
            txHash: hash,
          });
          setSuccess("Deposit confirmed.");
          showPocketSuccess("deposit", confirm.amount, hash);
        } else {
          await confirmWithdraw(pocketRef.id, {
            ownerWallet: owner,
            circleSocialUuid,
            transactionId: confirm.transactionId,
            txHash: hash,
          });
          setSuccess("Withdrawal confirmed.");
          showPocketSuccess("withdraw", confirm.amount, hash);
        }
        setAmountMode(null);
        setPendingConfirm(null);
        setPendingTxHash(undefined);
        await load();
        void refetchBalance();
      } catch (err) {
        if (!cancelled) setActionError(getErrorMessage(err));
      } finally {
        if (!cancelled) setIsActing(false);
      }
    }
    void finalize();
    return () => {
      cancelled = true;
    };
  }, [
    isConfirmed,
    pendingConfirm,
    pendingTxHash,
    address,
    pocket,
    circleSocialUuid,
    load,
    refetchBalance,
  ]);

  async function ensureArcNetwork() {
    if (chainId === arcChain.id) return true;
    try {
      await switchToArc(switchChainAsync);
      return true;
    } catch (err) {
      setError(getErrorMessage(err));
      return false;
    }
  }

  async function handleWalletSignIn() {
    if (!address || !connector) return;
    try {
      await signInWalletSession({
        ownerWallet: address,
        connectorName: connector.name,
        signMessage: async (message) =>
          signMessageAsync({ message, account: address }),
      });
      setAuthWallet(address.toLowerCase());
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function ensureAllowance(amountUnits: bigint, vault: Address) {
    if (!address) throw new Error("Wallet not connected.");
    const current = (allowance as bigint | undefined) ?? 0n;
    if (current >= amountUnits) return;
    await writeContractAsync({
      address: token.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [vault, maxUint256],
      chainId: arcChain.id,
    });
    await new Promise((r) => setTimeout(r, 4000));
    await refetchAllowance();
  }

  function buildCircleExecutor() {
    const circleWallet = platformCircleWallet;
    if (!circleLogin || !circleWallet?.id || !circleSdkRef.current) {
      throw new Error("Circle wallet is not ready.");
    }
    const login = circleLogin;
    const sdk = circleSdkRef.current;
    return {
      login,
      walletId: circleWallet.id,
      executeChallenge: async (challengeId: string) => {
        let result: unknown;
        try {
          result = await executeCircleChallenge(sdk, login, challengeId);
        } catch (error) {
          throw new Error(getErrorMessage(error));
        }
        return {
          transactionId: extractCircleTransactionId(result),
          txHash: extractCircleTxHash(result),
        };
      },
    };
  }

  /**
   * A payment that triggered a Spend&Save was refunded: move that save back
   * to spendable money (the pocket's own reverse-refund action).
   */
  async function handleReverseSpendSave(item: PocketActivityItem) {
    const tx = item.transaction;
    if (!address || !tx || tx.type !== "SPEND_SAVE" || tx.status !== "COMPLETED") return;
    setError(null);
    try {
      setIsActing(true);
      setSuccess("Reversing the save for the refunded payment…");
      await executeSavingsReversal({
        ownerWallet: address,
        originalTransactionId: tx.id,
        circleSocialUuid,
        mode: isCircleMode ? "circle" : "external",
        chainId: arcChain.id,
        writeContractAsync: isCircleMode
          ? undefined
          : async (args) =>
              writeContractAsync({
                address: args.address,
                abi: args.abi,
                functionName: args.functionName as "withdraw",
                args: args.args as never,
                chainId: args.chainId,
              }),
        circleExecutor: isCircleMode ? buildCircleExecutor() : undefined,
        reason: "payment_refund",
      });
      setSuccess("Reversed. The saved amount is back in your spendable balance.");
      await load();
      void refetchBalance();
    } catch (err) {
      setSuccess(null);
      setError(getErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  }

  async function handleAmountConfirm(amount: string) {
    if (!address || !pocket || !amountMode) return;
    setActionError(null);
    if (!isSwiftSaveVaultConfigured()) {
      setActionError("SwiftSaveVault is not configured.");
      return;
    }
    if (amountMode === "withdraw") {
      const blocked = getPocketLockState(pocket);
      if (blocked.locked) {
        setActionError(
          `This pocket is locked until ${formatUnlockDate(blocked.until)}.`,
        );
        return;
      }
    }
    if (!isCircleMode && !(await ensureArcNetwork())) return;

    try {
      setIsActing(true);
      if (amountMode === "deposit") {
        const prepared = await initiateDeposit(pocket.id, {
          ownerWallet: address,
          circleSocialUuid,
          amount,
        });
        const amountUnits = BigInt(prepared.amountUnits);
        if (isCircleMode) {
          const result = await circleVaultDeposit({
            executor: buildCircleExecutor(),
            vault: prepared.vaultAddress as Address,
            token: prepared.tokenAddress as Address,
            pocketIdBytes32: prepared.pocketIdBytes32 as `0x${string}`,
            amountUnits,
          });
          if (!result.txHash) {
            throw new Error(
              "Circle deposit submitted without a hash yet. Check again shortly.",
            );
          }
          await confirmDeposit(pocket.id, {
            ownerWallet: address,
            circleSocialUuid,
            transactionId: prepared.transaction.id,
            txHash: result.txHash,
          });
          setSuccess("Nice! Money was added to your pocket.");
          showPocketSuccess("deposit", amount, result.txHash);
          setAmountMode(null);
          await load();
          void refetchBalance();
        } else {
          await ensureAllowance(amountUnits, prepared.vaultAddress as Address);
          const hash = await writeContractAsync({
            address: prepared.vaultAddress as Address,
            abi: swiftSaveVaultAbi,
            functionName: "deposit",
            args: [
              prepared.pocketIdBytes32 as `0x${string}`,
              prepared.tokenAddress as Address,
              amountUnits,
            ],
            chainId: arcChain.id,
          });
          setPendingTxHash(hash);
          setPendingConfirm({
            amount,
            mode: "deposit",
            transactionId: prepared.transaction.id,
          });
        }
      } else {
        const prepared = await initiateWithdraw(pocket.id, {
          ownerWallet: address,
          circleSocialUuid,
          amount,
        });
        const amountUnits = BigInt(prepared.amountUnits);
        if (isCircleMode) {
          const result = await circleVaultWithdraw({
            executor: buildCircleExecutor(),
            vault: prepared.vaultAddress as Address,
            token: prepared.tokenAddress as Address,
            pocketIdBytes32: prepared.pocketIdBytes32 as `0x${string}`,
            amountUnits,
          });
          if (!result.txHash) {
            throw new Error(
              "Circle withdrawal submitted without a hash yet. Check again shortly.",
            );
          }
          await confirmWithdraw(pocket.id, {
            ownerWallet: address,
            circleSocialUuid,
            transactionId: prepared.transaction.id,
            txHash: result.txHash,
          });
          setSuccess("Withdrawal confirmed on-chain and pocket updated.");
          showPocketSuccess("withdraw", amount, result.txHash);
          setAmountMode(null);
          await load();
          void refetchBalance();
        } else {
          const hash = await writeContractAsync({
            address: prepared.vaultAddress as Address,
            abi: swiftSaveVaultAbi,
            functionName: "withdraw",
            args: [
              prepared.pocketIdBytes32 as `0x${string}`,
              prepared.tokenAddress as Address,
              amountUnits,
            ],
            chainId: arcChain.id,
          });
          setPendingTxHash(hash);
          setPendingConfirm({
            amount,
            mode: "withdraw",
            transactionId: prepared.transaction.id,
          });
        }
      }
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  }

  async function handleSaveEdit() {
    if (!address || !pocket) return;
    try {
      setIsActing(true);
      const { pocket: updated } = await updateSavingsPocket(pocket.id, {
        ownerWallet: address,
        circleSocialUuid,
        name: editName,
        description: editDescription || null,
        targetAmount: editTarget || null,
        stopAtTarget: editTarget ? editStopAtTarget : false,
      });
      setPocket(updated);
      setEditing(false);
      setSuccess("Pocket updated.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  }

  async function handleLock(input: {
    lockDays?: number;
    lockUntil?: string;
  }) {
    if (!address || !pocket) return;
    try {
      setIsActing(true);
      setError(null);
      const { pocket: next } = await updateSavingsPocket(pocket.id, {
        ownerWallet: address,
        circleSocialUuid,
        lockKind: "fixed",
        lockDays: input.lockDays,
        lockUntil: input.lockUntil,
      });
      setPocket(next);
      setSuccess(
        input.lockUntil
          ? `Pocket locked until ${formatUnlockDate(input.lockUntil)}.`
          : `Pocket locked for ${input.lockDays} days.`,
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  }

  async function handleArchive() {
    if (!address || !pocket) return;
    try {
      await archiveSavingsPocket(pocket.id, {
        ownerWallet: address,
        circleSocialUuid,
      });
      setOptionsOpen(false);
      router.replace("/save");
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDeleteConfirmed() {
    if (!address || !pocket) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteSavingsPocket(pocket.id, {
        ownerWallet: address,
        circleSocialUuid,
      });
      router.replace("/save");
    } catch (err) {
      setError(getErrorMessage(err));
      setIsDeleting(false);
      setOptionsOpen(false);
    }
  }

  // Deletable only while it holds nothing. The server re-checks, and also
  // refuses a pocket that has any transaction or Spend&Save history.
  const isPocketEmpty = Boolean(
    pocket && pocket.status === "active" && Number(pocket.current_balance) === 0,
  );
  const progress = pocket ? pocketProgress(pocket) : null;
  const lockState = pocket ? getPocketLockState(pocket) : null;

  const activity = pocket ? buildPocketActivity(pocket.id, transactions, spendEvents) : [];
  const canAct = isWalletAuthenticated && pocket?.status === "active";

  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        // The page draws its own bar and hero.
        hideHeader
        subtitle="Pocket detail"
        title="Save"
      >
        <div className="pocket-page">
          {!isConnected || !address ? (
            <>
              <PocketBar name="Pocket" />
              <p className="text-sm text-muted-foreground">Connect a wallet to view this pocket.</p>
            </>
          ) : isLoading && !pocket ? (
            <>
              <PocketBar name="Pocket" />
              <div className="pocket-hero pocket-hero-skeleton" />
            </>
          ) : !pocket ? (
            <>
              <PocketBar name="Pocket" />
              <p className="text-sm text-destructive">{error ?? "Pocket not found."}</p>
            </>
          ) : (
            <>
              <PocketBar name={pocket.name} onMore={pocket.status === "active" ? () => setOptionsOpen(true) : undefined} />

              {!isWalletAuthenticated ? (
                <div className="pocket-card pocket-notice">
                  <KeyRound className="h-5 w-5 shrink-0 text-primary" />
                  <p className="min-w-0 flex-1 text-sm">Authorize this wallet to move money in or out of this pocket.</p>
                  <Button disabled={isSigningIn} onClick={() => void handleWalletSignIn()} size="sm">
                    {isSigningIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    Authorize
                  </Button>
                </div>
              ) : null}

              <PocketHero
                canAct={Boolean(canAct)}
                hidden={hideBalance}
                lock={lockState!}
                onAdd={() => {
                  setAmountMode("deposit");
                  setActionError(null);
                }}
                onToggleHidden={toggleHideBalance}
                onWithdraw={() => {
                  if (lockState?.locked) {
                    setError(`This pocket is locked until ${formatUnlockDate(lockState.until)}.`);
                    return;
                  }
                  setAmountMode("withdraw");
                  setActionError(null);
                }}
                pocket={pocket}
                progress={progress}
              />

              {error ? <p className="pocket-message is-error">{error}</p> : null}
              {success ? <p className="pocket-message is-success">{success}</p> : null}

              {pocket.status === "active" ? (
                <PocketLockCard
                  busy={isActing}
                  canAct={Boolean(canAct)}
                  lock={lockState!}
                  onLock={(input) => void handleLock(input)}
                />
              ) : null}

              {spendSave && spendSave.pocket_id === pocket.id ? <PocketSpendSave spendSave={spendSave} /> : null}

              <PocketFigures
                created={pocket.created_at}
                hidden={hideBalance}
                lastDepositAt={stats?.lastDepositAt ?? null}
                totalIn={stats?.totalDeposits ?? "0"}
                totalOut={stats?.totalWithdrawals ?? "0"}
              />

              <PocketActivity
                acting={isActing}
                canReverse={isWalletAuthenticated}
                hidden={hideBalance}
                items={activity}
                onReverse={(item) => void handleReverseSpendSave(item)}
              />

              <PocketOptionsSheet
                canAct={Boolean(canAct)}
                canDelete={isPocketEmpty}
                deleting={isDeleting}
                onArchive={() => void handleArchive()}
                onClose={() => setOptionsOpen(false)}
                onDelete={() => void handleDeleteConfirmed()}
                onEdit={() => {
                  setOptionsOpen(false);
                  setEditing(true);
                }}
                open={optionsOpen}
              />

              <PocketEditSheet
                busy={isActing}
                description={editDescription}
                name={editName}
                onClose={() => setEditing(false)}
                onDescription={setEditDescription}
                onName={setEditName}
                onSave={() => void handleSaveEdit()}
                onStopAtTarget={setEditStopAtTarget}
                onTarget={setEditTarget}
                open={editing}
                stopAtTarget={editStopAtTarget}
                target={editTarget}
              />

              {amountMode ? (
                <AmountConfirmDialog
                  currency={pocket.currency}
                  error={actionError}
                  isSubmitting={isActing || isWritePending || isConfirming || Boolean(pendingConfirm)}
                  mode={amountMode}
                  onConfirm={(amount) => void handleAmountConfirm(amount)}
                  onOpenChange={(open) => {
                    if (!open) {
                      setAmountMode(null);
                      setActionError(null);
                    }
                  }}
                  open={Boolean(amountMode)}
                  pocketBalance={pocket.current_balance}
                  pocketName={pocket.name}
                  walletBalanceLabel={walletBalanceLabel}
                />
              ) : null}
            </>
          )}
        </div>
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
