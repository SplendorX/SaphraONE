"use client";

import Link from "next/link";
import { Info, KeyRound, Loader2, PiggyBank, Plus, ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { useT } from "@/components/locale-provider";
import { showSuccess } from "@/components/success-popup";
import { AmountConfirmDialog } from "@/components/save/amount-confirm-dialog";
import { CreatePocketDialog } from "@/components/save/create-pocket-dialog";
import {
  formatMoneyShort,
} from "@/components/save/format";
import { SpendSaveSetupDialog } from "@/components/save/spend-save-setup-dialog";
import {
  PocketCard,
  PocketsIntro,
  SaveHero,
  SaveWays,
  SpendSaveCard,
} from "@/components/save/save-views";
import { Button } from "@/components/ui/button";
import {
  executeCircleChallenge,
  readCircleAppId,
  getCircleLoginIdentity,
  readCircleLogin,
  readCircleWallets,
  type CircleLoginResult,
  type CircleWallet,
} from "@/lib/circle-session";
import { erc20Abi } from "@/lib/contracts";
import { swiftSaveVaultAbi } from "@/lib/save/abis";
import {
  circleVaultDeposit,
  circleVaultWithdraw,
} from "@/lib/save/circle-vault";
import {
  archiveSavingsPocket,
  confirmDeposit,
  confirmWithdraw,
  disableSpendSave,
  fetchSavingsPockets,
  fetchSavingsSummary,
  fetchSpendSave,
  initiateDeposit,
  initiateWithdraw,
  pauseSpendSave,
  resumeSpendSave,
} from "@/lib/save/client";
import {
  isSwiftSaveVaultConfigured,
  SWIFT_SAVE_DISCLAIMER,
  swiftSaveVaultAddress,
} from "@/lib/save/config";
import {
  formatUnlockDate,
  getPocketLockState,
} from "@/lib/save/lock";
import {
  type SavingsPocketRecord,
  type SavingsSummary,
  type SpendSaveConfigRecord,
} from "@/lib/save/types";
import { arcTokens, type ArcTokenSymbol } from "@/lib/tokens";
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
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function SwiftSaveHub() {
  const t = useT();
  const { address: wagmiAddress, connector } = useAccount();
  const {
    address: platformAddress,
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

  const [authWallet, setAuthWallet] = useState<string | null>(null);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [circleSocialUuid, setCircleSocialUuid] = useState<string | undefined>();
  const [circleLogin, setCircleLogin] = useState<CircleLoginResult | null>(null);
  const [circleWallet, setCircleWallet] = useState<CircleWallet | null>(null);
  const [circleSdkReady, setCircleSdkReady] = useState(false);
  const [currency] = useState<ArcTokenSymbol>("USDC");
  const [summary, setSummary] = useState<SavingsSummary | null>(null);
  const [pockets, setPockets] = useState<SavingsPocketRecord[]>([]);
  const [spendSave, setSpendSave] = useState<SpendSaveConfigRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<"flexible" | "fixed">("flexible");
  // Shares the dashboard's "hide balances" choice.
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
  const [setupOpen, setSetupOpen] = useState(false);
  const [amountMode, setAmountMode] = useState<"deposit" | "withdraw" | null>(
    null,
  );
  const [activePocket, setActivePocket] = useState<SavingsPocketRecord | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<Hash | undefined>();
  const [pendingConfirm, setPendingConfirm] = useState<{
    mode: "deposit" | "withdraw";
    pocketId: string;
    transactionId: string;
  } | null>(null);

  const vault = swiftSaveVaultAddress();
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
      address && vault
        ? [address, vault]
        : undefined,
    chainId: arcChain.id,
    query: { enabled: Boolean(address && vault) },
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

  // A link such as ALLIE's "Open Save to deposit" carries the move in the URL:
  // /save?intent=deposit&amount=5&pocket=Rent. The amount is held until the
  // person opens that kind of move, and a pocket that can be identified
  // (named, or the only one) opens straight away.
  const [linkPrefill, setLinkPrefill] = useState<{
    mode: "deposit" | "withdraw";
    amount: string;
    pocket: string;
    opened: boolean;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intent = params.get("intent") ?? params.get("action");
    const amount = params.get("amount")?.trim() ?? "";
    if (intent !== "deposit" && intent !== "withdraw") return;
    setLinkPrefill({
      mode: intent,
      amount: /^\d+(\.\d+)?$/.test(amount) ? amount : "",
      pocket: params.get("pocket")?.trim().toLowerCase() ?? "",
      opened: false,
    });
  }, []);

  useEffect(() => {
    if (!linkPrefill || linkPrefill.opened || isLoading || !isWalletAuthenticated) {
      return;
    }
    const open = pockets.filter((pocket) => pocket.status === "active");
    const target = linkPrefill.pocket
      ? open.find((pocket) => pocket.name.trim().toLowerCase() === linkPrefill.pocket)
      : open.length === 1
        ? open[0]
        : undefined;
    setLinkPrefill({ ...linkPrefill, opened: true });
    if (!target) return;
    if (linkPrefill.mode === "withdraw" && getPocketLockState(target).locked) return;
    setActivePocket(target);
    setAmountMode(linkPrefill.mode);
    setActionError(null);
  }, [isLoading, isWalletAuthenticated, linkPrefill, pockets]);

  const loadAll = useCallback(async () => {
    const owner = address;
    if (!owner) {
      setSummary(null);
      setPockets([]);
      setSpendSave(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const social =
        getCircleLoginIdentity(readCircleLogin())?.socialUserUUID ?? undefined;
      setCircleSocialUuid(social);

      const [summaryRes, pocketsRes, spendRes] = await Promise.all([
        fetchSavingsSummary(owner, currency, social),
        fetchSavingsPockets(owner, { circleSocialUuid: social }),
        fetchSpendSave(owner, social),
      ]);

      setSummary(summaryRes.summary);
      setPockets(pocketsRes.pockets);
      setSpendSave(spendRes.config);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [address, currency]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    function handleSavingsUpdated() {
      void loadAll();
    }
    window.addEventListener("saphra:savings-updated", handleSavingsUpdated);
    return () => {
      window.removeEventListener("saphra:savings-updated", handleSavingsUpdated);
    };
  }, [loadAll]);

  // Circle embedded wallet session (for vault deposit/withdraw without external signer)
  useEffect(() => {
    const login = readCircleLogin();
    setCircleLogin(login);
    const wallets = readCircleWallets();
    const primary = address
      ? wallets.find((w) => w.address?.toLowerCase() === address.toLowerCase()) ??
        null
      : null;
    setCircleWallet(primary);

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
    circleLogin && circleWallet?.id && circleSdkReady && circleSdkRef.current,
  );

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
    if (!isConfirmed || !pendingConfirm || !pendingTxHash || !address) return;

    const confirm = pendingConfirm;
    const owner = address;
    const hash = pendingTxHash;
    let cancelled = false;

    async function finalize() {
      try {
        setIsActing(true);
        if (confirm.mode === "deposit") {
          await confirmDeposit(confirm.pocketId, {
            ownerWallet: owner,
            circleSocialUuid,
            transactionId: confirm.transactionId,
            txHash: hash,
          });
          setSuccess("Deposit confirmed on-chain and pocket updated.");
          showSuccess({
            eyebrow: "Save",
            subtitle: "Deposit confirmed on-chain and pocket updated.",
            title: "Deposit successful",
          });
        } else {
          await confirmWithdraw(confirm.pocketId, {
            ownerWallet: owner,
            circleSocialUuid,
            transactionId: confirm.transactionId,
            txHash: hash,
          });
          setSuccess("Withdrawal confirmed on-chain and pocket updated.");
          showSuccess({
            eyebrow: "Save",
            subtitle: "Withdrawal confirmed on-chain and pocket updated.",
            title: "Withdrawal successful",
          });
        }
        setAmountMode(null);
        setActivePocket(null);
        setPendingConfirm(null);
        setPendingTxHash(undefined);
        await loadAll();
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
    circleSocialUuid,
    loadAll,
    refetchBalance,
  ]);

  async function ensureArcNetwork() {
    if (chainId === arcChain.id) return true;
    try {
      await switchChainAsync({ chainId: arcChain.id });
      return true;
    } catch (err) {
      setError(getErrorMessage(err));
      return false;
    }
  }

  async function handleWalletSignIn() {
    if (!address || !connector) {
      setError("Connect a wallet first.");
      return;
    }
    try {
      setIsAuthLoading(true);
      setError(null);
      await signInWalletSession({
        ownerWallet: address,
        connectorName: connector.name,
        signMessage: async (message) =>
          signMessageAsync({ message, account: address }),
      });
      setAuthWallet(address.toLowerCase());
      setSuccess("Wallet authorized for Save.");
      await loadAll();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function ensureAllowance(amountUnits: bigint) {
    if (!address || !vault) {
      throw new Error("SwiftSaveVault is not configured.");
    }
    const current = (allowance as bigint | undefined) ?? 0n;
    if (current >= amountUnits) return;

    const hash = await writeContractAsync({
      address: token.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [vault, maxUint256],
      chainId: arcChain.id,
    });
    setPendingTxHash(hash);
    // Wait via receipt hook is async; for approve we poll simply via refetch after short wait
    await new Promise((r) => setTimeout(r, 4000));
    await refetchAllowance();
  }

  function buildCircleExecutor() {
    if (!circleLogin || !circleWallet?.id || !circleSdkRef.current) {
      throw new Error("Circle wallet is not ready.");
    }
    const login = circleLogin;
    const walletId = circleWallet.id;
    const sdk = circleSdkRef.current;
    return {
      login,
      walletId,
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

  async function handleAmountConfirm(amount: string) {
    if (!address || !activePocket || !amountMode) return;
    setActionError(null);
    setSuccess(null);

    if (!isSwiftSaveVaultConfigured()) {
      setActionError(
        "Deploy SwiftSaveVault and set NEXT_PUBLIC_SWIFT_SAVE_VAULT_ADDRESS.",
      );
      return;
    }

    if (amountMode === "withdraw") {
      const blocked = getPocketLockState(activePocket);
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
        const prepared = await initiateDeposit(activePocket.id, {
          ownerWallet: address,
          circleSocialUuid,
          amount,
        });
        if (!prepared.vaultAddress) {
          throw new Error("Vault address missing from deposit prepare.");
        }
        const amountUnits = BigInt(prepared.amountUnits);

        if (isCircleMode) {
          setSuccess("Confirm deposit in Circle wallet…");
          const result = await circleVaultDeposit({
            executor: buildCircleExecutor(),
            vault: prepared.vaultAddress as Address,
            token: prepared.tokenAddress as Address,
            pocketIdBytes32: prepared.pocketIdBytes32 as `0x${string}`,
            amountUnits,
          });
          if (!result.txHash) {
            throw new Error(
              "Circle deposit submitted without a hash yet. Check again shortly. Reconciliation will finalize it.",
            );
          }
          await confirmDeposit(activePocket.id, {
            ownerWallet: address,
            circleSocialUuid,
            transactionId: prepared.transaction.id,
            txHash: result.txHash,
          });
          setSuccess("Nice! Money was added to your pocket.");
          showSuccess({
            eyebrow: "Save",
            subtitle: "Money was added to your pocket.",
            title: "Deposit successful",
          });
          setAmountMode(null);
          setActivePocket(null);
          await loadAll();
          void refetchBalance();
        } else {
          await ensureAllowance(amountUnits);
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
            mode: "deposit",
            pocketId: activePocket.id,
            transactionId: prepared.transaction.id,
          });
          setSuccess("Deposit submitted. Waiting for confirmation…");
        }
      } else {
        const prepared = await initiateWithdraw(activePocket.id, {
          ownerWallet: address,
          circleSocialUuid,
          amount,
        });
        if (!prepared.vaultAddress) {
          throw new Error("Vault address missing from withdraw prepare.");
        }
        const amountUnits = BigInt(prepared.amountUnits);

        if (isCircleMode) {
          setSuccess("Confirm withdrawal in Circle wallet…");
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
          await confirmWithdraw(activePocket.id, {
            ownerWallet: address,
            circleSocialUuid,
            transactionId: prepared.transaction.id,
            txHash: result.txHash,
          });
          setSuccess("Withdrawal confirmed. Funds are back in your wallet.");
          showSuccess({
            eyebrow: "Save",
            subtitle: "Funds are back in your wallet.",
            title: "Withdrawal successful",
          });
          setAmountMode(null);
          setActivePocket(null);
          await loadAll();
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
            mode: "withdraw",
            pocketId: activePocket.id,
            transactionId: prepared.transaction.id,
          });
          setSuccess("Withdrawal submitted. Waiting for confirmation…");
        }
      }
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  }

  async function handleArchive(pocket: SavingsPocketRecord) {
    if (!address) return;
    setError(null);
    try {
      await archiveSavingsPocket(pocket.id, {
        ownerWallet: address,
        circleSocialUuid,
      });
      setSuccess(`Archived ${pocket.name}.`);
      await loadAll();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleSpendSaveControl(mode: "pause" | "resume" | "disable") {
    if (!address) return;
    setError(null);
    try {
      const body = { ownerWallet: address, circleSocialUuid };
      if (mode === "pause") await pauseSpendSave(body);
      else if (mode === "resume") await resumeSpendSave(body);
      else await disableSpendSave(body);
      setSuccess(
        mode === "pause"
          ? "Spend&Save paused."
          : mode === "resume"
            ? "Spend&Save resumed."
            : "Spend&Save disabled. Existing savings are untouched.",
      );
      await loadAll();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const spendSavePocket = pockets.find((p) => p.id === spendSave?.pocket_id);

  const openCreate = (kind: "flexible" | "fixed") => {
    setCreateKind(kind);
    setCreateOpen(true);
  };
  const activePockets = pockets.filter((pocket) => pocket.status === "active");

  if (!isConnected || !address) {
    return (
      <div className="save-page">
        <header className="pocket-bar">
          <Link aria-label="Back to the dashboard" className="pocket-round" href="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="pocket-bar-title">Save</h1>
          <span />
        </header>
        <SaveHero
          disabled
          hidden={hideBalance}
          loading={false}
          monthSaved="0"
          onAddPocket={() => undefined}
          onToggleHidden={toggleHideBalance}
          pocketCount={0}
          total="0"
        />
        <div className="save-card save-notice">
          <PiggyBank className="h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">{t("save.connectToUse")}</p>
            <p className="text-sm text-muted-foreground">{t("save.connectToUseBody")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="save-page">
      <header className="pocket-bar">
        <Link aria-label="Back to the dashboard" className="pocket-round" href="/dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="pocket-bar-title">Save</h1>
        <span />
      </header>
      <SaveHero
        disabled={!isWalletAuthenticated}
        hidden={hideBalance}
        loading={isLoading}
        monthSaved={summary?.monthSaved ?? "0"}
        onAddPocket={() => openCreate("flexible")}
        onToggleHidden={toggleHideBalance}
        pocketCount={summary?.pocketCount ?? activePockets.length}
        total={summary?.totalSaved ?? "0"}
      />

      {!isWalletAuthenticated ? (
        <div className="save-card save-notice">
          <KeyRound className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Authorize this wallet</p>
            <p className="text-sm text-muted-foreground">
              Sign a one-time message so SaphraONE can manage your pockets.
            </p>
          </div>
          <Button
            disabled={isAuthLoading || isSigningIn}
            onClick={() => void handleWalletSignIn()}
            size="sm"
            type="button"
          >
            {isAuthLoading || isSigningIn ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {t("common.authorizeWallet")}
          </Button>
        </div>
      ) : null}

      {!isSwiftSaveVaultConfigured() ? (
        <div className="save-card save-warning">
          Savings vault isn&rsquo;t configured on this deployment, so money can&rsquo;t be moved in or out yet. Pockets and
          Spend + Save settings still work.
        </div>
      ) : null}

      {error ? <p className="save-message is-error">{error}</p> : null}
      {success ? <p className="save-message is-success">{success}</p> : null}

      {spendSave ? (
        <SpendSaveCard
          disabled={!isWalletAuthenticated}
          onDisable={() => void handleSpendSaveControl("disable")}
          onEdit={() => setSetupOpen(true)}
          onPause={() => void handleSpendSaveControl("pause")}
          onResume={() => void handleSpendSaveControl("resume")}
          pocketName={spendSavePocket?.name ?? null}
          spendSave={spendSave}
        />
      ) : null}

      {isLoading ? (
        <div className="save-pockets-grid">
          {[0, 1].map((index) => (
            <div className="save-pocket save-pocket-skeleton" key={index} />
          ))}
        </div>
      ) : activePockets.length === 0 ? (
        <PocketsIntro disabled={!isWalletAuthenticated} onStart={() => openCreate("flexible")} />
      ) : (
        <section className="save-section">
          <div className="save-section-head">
            <h2 className="save-section-title">{t("save.pockets")}</h2>
            <button
              className="save-link"
              disabled={!isWalletAuthenticated}
              onClick={() => openCreate("flexible")}
              type="button"
            >
              <Plus className="h-4 w-4" /> New pocket
            </button>
          </div>
          <div className="save-pockets-grid">
            {activePockets.map((pocket) => {
              const lockState = getPocketLockState(pocket);
              return (
                <PocketCard
                  disabled={!isWalletAuthenticated}
                  hidden={hideBalance}
                  key={pocket.id}
                  onAdd={() => {
                    setActivePocket(pocket);
                    setAmountMode("deposit");
                    setActionError(null);
                  }}
                  onArchive={() => void handleArchive(pocket)}
                  onWithdraw={() => {
                    if (lockState.locked) {
                      setError(`“${pocket.name}” is locked until ${formatUnlockDate(lockState.until)}.`);
                      return;
                    }
                    setActivePocket(pocket);
                    setAmountMode("withdraw");
                    setActionError(null);
                  }}
                  pocket={pocket}
                />
              );
            })}
          </div>
        </section>
      )}

      <SaveWays
        disabled={!isWalletAuthenticated}
        onFlexible={() => openCreate("flexible")}
        onLocked={() => openCreate("fixed")}
        onSpendSave={() => setSetupOpen(true)}
        spendSave={spendSave}
      />

      <div className="save-about">
        <button
          aria-expanded={disclaimerOpen}
          className="save-about-toggle"
          onClick={() => setDisclaimerOpen((open) => !open)}
          type="button"
        >
          <Info className="h-3.5 w-3.5" /> About Save
        </button>
        {disclaimerOpen ? <p className="mt-2 leading-5">{SWIFT_SAVE_DISCLAIMER}</p> : null}
      </div>

      <CreatePocketDialog
        circleSocialUuid={circleSocialUuid}
        onCreated={async (pocket) => {
          setSuccess(`Created ${pocket.name}.`);
          await loadAll();
        }}
        onOpenChange={setCreateOpen}
        open={createOpen}
        ownerWallet={address}
        currency={currency}
        initialLockKind={createKind}
      />

      <SpendSaveSetupDialog
        circleSocialUuid={circleSocialUuid}
        onOpenChange={setSetupOpen}
        onPocketsChange={setPockets}
        onSaved={async () => {
          setSuccess("Spend&Save activated.");
          await loadAll();
        }}
        open={setupOpen}
        ownerWallet={address}
        pockets={pockets}
      />

      {activePocket && amountMode ? (
        <AmountConfirmDialog
          currency={activePocket.currency}
          error={actionError}
          initialAmount={
            linkPrefill?.mode === amountMode ? linkPrefill.amount : undefined
          }
          isSubmitting={
            isActing || isWritePending || isConfirming || Boolean(pendingConfirm)
          }
          mode={amountMode}
          onConfirm={(amount) => void handleAmountConfirm(amount)}
          onOpenChange={(open) => {
            if (!open) {
              setAmountMode(null);
              setActivePocket(null);
              setActionError(null);
              // The link's amount is used once.
              setLinkPrefill(null);
            }
          }}
          open={Boolean(amountMode)}
          pocketBalance={activePocket.current_balance}
          pocketName={activePocket.name}
          walletBalanceLabel={walletBalanceLabel}
        />
      ) : null}

    </div>
  );
}
