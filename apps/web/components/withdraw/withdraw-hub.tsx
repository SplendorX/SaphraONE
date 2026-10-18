"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Landmark,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";

import { formatNaira, formatUsdc } from "@/components/deposit/naira-onramp-panel";
import { KycSheet } from "@/components/kyc/kyc-sheet";
import { Button } from "@/components/ui/button";
import { WalletConnectButton } from "@/components/wallet-connect-button";
import { switchToArc } from "@/lib/arc-network";
import { arcChain } from "@/lib/chains";
import { explorerTxUrl } from "@/lib/onchain-facts";
import {
  createOrder,
  deleteBeneficiary,
  fetchRampStatus,
  RampApiError,
  getOrder,
  listBanks,
  listBeneficiaries,
  readOpenOrderId,
  readPendingWithdrawal,
  rememberOpenOrderId,
  rememberPendingWithdrawal,
  reportCryptoSentWithRetry,
  requestQuote,
  saveBeneficiary,
  verifyAccount,
  type PendingWithdrawal,
} from "@/lib/ramp/client";
import { EXPIRY_MARGIN_MS, expiresSoon, parseUsdcAmount, readNuban, usdcUnits } from "@/lib/ramp/rules";
import { sendUsdcOnArc } from "@/lib/ramp/send-usdc";
import type { RampBank, RampBeneficiary, RampKycInfo, RampOrderView, RampQuote, ResolvedBankAccount } from "@/lib/ramp/types";
import { formatCountdown, isFinished, useDebounced, useRampOrder, useSecondsLeft } from "@/lib/ramp/use-ramp-order";
import { arcTokens } from "@/lib/tokens";
import { TxApprovalCancelled } from "@/lib/tx-approval/client";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { useSigningWallet } from "@/lib/use-signing-wallet";
import { cn } from "@/lib/utils";

import "@/components/deposit/deposit.css";
import "@/components/deposit/ramp.css";

type Step = "account" | "amount" | "review";

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function message(cause: unknown, fallback: string) {
  if (cause instanceof TxApprovalCancelled) return "Withdrawal cancelled. No USDC was sent.";
  const text = cause instanceof Error ? cause.message : "";
  if (/user (rejected|denied)|rejected the request/i.test(text)) return "You cancelled in your wallet. No USDC was sent.";
  return text || fallback;
}

/** Withdraw USDC on Arc to a Nigerian bank account as Naira, through Centiiv. */
export function WithdrawHub() {
  const { address, isConnected } = usePlatformWallet();
  const wallet = address?.toLowerCase() ?? null;
  const signing = useSigningWallet();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [kyc, setKyc] = useState<RampKycInfo | null>(null);
  const [kycOpen, setKycOpen] = useState(false);
  const [kycMode, setKycMode] = useState<"tier1" | "selfie">("tier1");
  const [step, setStep] = useState<Step>("account");
  const [beneficiaries, setBeneficiaries] = useState<RampBeneficiary[] | null>(null);
  const [selected, setSelected] = useState<RampBeneficiary | null>(null);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [started, setStarted] = useState<RampOrderView | null>(null);
  const [order, setOrder] = useRampOrder(wallet, started);
  const [pending, setPending] = useState<PendingWithdrawal | null>(null);

  const { data: balanceUnits } = useReadContract({
    abi: erc20Abi,
    address: arcTokens.USDC.address,
    args: wallet ? [wallet as `0x${string}`] : undefined,
    chainId: arcChain.id,
    functionName: "balanceOf",
    query: { enabled: Boolean(wallet), refetchInterval: 15_000 },
  });
  const balance = typeof balanceUnits === "bigint" ? formatUnits(balanceUnits, arcTokens.USDC.decimals) : null;

  const parsed = useMemo(() => (amount ? parseUsdcAmount(amount) : null), [amount]);
  const quoteAmount = useDebounced(parsed?.ok ? parsed.value : null);
  const shortOfFunds =
    parsed?.ok && balance !== null && Number(quote?.totalToPay ?? parsed.value) > Number(balance) + 0.000001;

  useEffect(() => {
    let cancelled = false;
    void fetchRampStatus(wallet ?? undefined).then((status) => {
      if (cancelled) return;
      setEnabled(status?.enabled === true && status.currencies.includes("NGN"));
      setKyc(status?.kyc ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const loadBeneficiaries = useCallback(async () => {
    if (!wallet) return;
    try {
      const list = await listBeneficiaries(wallet);
      setBeneficiaries(list);
      setSelected((current) => list.find((entry) => entry.id === current?.id) ?? list[0] ?? null);
      if (list.length === 0) setAdding(true);
    } catch (cause) {
      setBeneficiaries([]);
      setError(message(cause, "Couldn't load your bank accounts."));
    }
  }, [wallet]);

  // Saved accounts, a withdrawal sent but not recorded, and an open order.
  useEffect(() => {
    if (!wallet || !enabled) return;
    void loadBeneficiaries();
    setPending(readPendingWithdrawal(wallet));
    const id = readOpenOrderId("OFFRAMP", wallet);
    if (!id) return;
    let cancelled = false;
    getOrder(wallet, id)
      .then((found) => {
        if (cancelled) return;
        if (isFinished(found.status)) rememberOpenOrderId("OFFRAMP", wallet, null);
        else setStarted(found);
      })
      .catch(() => rememberOpenOrderId("OFFRAMP", wallet, null));
    return () => {
      cancelled = true;
    };
  }, [wallet, enabled, loadBeneficiaries]);

  useEffect(() => {
    if (!wallet || !quoteAmount) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    setError(null);
    requestQuote(wallet, "OFFRAMP", quoteAmount)
      .then((next) => {
        if (!cancelled) setQuote(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setQuote(null);
          setError(message(cause, "Couldn't get a rate."));
        }
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, quoteAmount]);

  useEffect(() => {
    if (wallet && order && isFinished(order.status)) rememberOpenOrderId("OFFRAMP", wallet, null);
    // Recorded elsewhere (another tab, a retry): nothing left to finish.
    if (wallet && pending && order?.id === pending.orderId && order.userTxHash === pending.hash.toLowerCase()) {
      rememberPendingWithdrawal(wallet, null);
      setPending(null);
    }
  }, [wallet, order, pending]);

  function changeAmount(value: string) {
    setAmount(value.replace(/[^\d.]/g, ""));
    setIdempotencyKey(newKey());
  }

  function fillMax() {
    if (balance === null) return;
    // Two decimals, rounded down, so the withdrawal never exceeds the balance.
    const [whole, fraction = ""] = balance.split(".");
    changeAmount(`${whole}${fraction ? `.${fraction.slice(0, 2)}` : ""}`);
  }

  /** Report a sent transfer; on failure keep the hash so it can be finished later. */
  const record = useCallback(
    async (sent: PendingWithdrawal) => {
      if (!wallet) return;
      setBusy("Recording your withdrawal…");
      setError(null);
      try {
        const result = await reportCryptoSentWithRetry(wallet, sent.orderId, sent.hash);
        if (result.pending) {
          setError("Your transfer is still confirming on Arc. Tap Finish recording withdrawal in a moment.");
          setPending(sent);
          return;
        }
        rememberPendingWithdrawal(wallet, null);
        setPending(null);
        setStarted(result.order);
        setOrder(result.order);
      } catch (cause) {
        setPending(sent);
        setError(message(cause, "Couldn't record the withdrawal."));
      } finally {
        setBusy(null);
      }
    },
    [wallet, setOrder],
  );

  /** Sign the exact USDC transfer for an open order, after re-checking it. */
  async function send(target: RampOrderView) {
    if (!wallet) return;
    setError(null);
    try {
      if (!signing.canSign || !signing.resolveProvider || !signing.address) {
        throw new Error(signing.reason ?? "Connect your wallet to withdraw.");
      }
      if (signing.address.toLowerCase() !== wallet) {
        throw new Error("Withdrawals come from your SaphraONE wallet. Switch back to it and try again.");
      }

      setBusy("Checking the withdrawal…");
      const fresh = await getOrder(wallet, target.id);
      setOrder(fresh);
      if (fresh.status !== "PENDING" || fresh.userTxHash) {
        throw new Error("This withdrawal can't take a transfer any more.");
      }
      if (!fresh.depositAddress || !fresh.totalToPay || !usdcUnits(fresh.totalToPay)) {
        throw new Error("Withdrawals are unavailable right now.");
      }
      if (expiresSoon(fresh.expiresAt, Date.now(), EXPIRY_MARGIN_MS)) {
        throw new Error("This withdrawal is about to expire. Start a new one.");
      }
      if (typeof balanceUnits === "bigint" && usdcUnits(fresh.totalToPay)! > balanceUnits) {
        throw new Error(`You need ${formatUsdc(fresh.totalToPay)} for this withdrawal.`);
      }

      if (signing.kind === "external" && chainId !== arcChain.id) {
        setBusy(`Switching to ${arcChain.name}…`);
        await switchToArc(switchChainAsync);
      }

      setBusy("Confirm the transfer…");
      const orderId = fresh.id;
      await sendUsdcOnArc({
        amount: fresh.totalToPay,
        circleWalletId: signing.circleWalletId,
        from: signing.address,
        onBroadcast: (hash) => {
          const sent = { hash, orderId };
          rememberPendingWithdrawal(wallet, sent);
          setPending(sent);
          setBusy("Waiting for Arc to confirm…");
        },
        resolveProvider: signing.resolveProvider,
        to: fresh.depositAddress,
      });
      const sent = readPendingWithdrawal(wallet);
      if (sent) await record(sent);
    } catch (cause) {
      setError(message(cause, "The withdrawal didn't go through."));
    } finally {
      setBusy(null);
    }
  }

  async function confirmWithdrawal() {
    if (!wallet || !selected || !parsed?.ok) return;
    setBusy("Starting your withdrawal…");
    setError(null);
    let created: RampOrderView;
    try {
      created = await createOrder({
        amount: parsed.value,
        beneficiaryId: selected.id,
        direction: "OFFRAMP",
        idempotencyKey,
        wallet,
      });
    } catch (cause) {
      setBusy(null);
      if (cause instanceof RampApiError && cause.code === "KYC_REQUIRED") {
        setKycMode("tier1");
        setKycOpen(true);
      } else if (cause instanceof RampApiError && cause.code === "KYC_LIMIT") {
        setKycMode("selfie");
        setKycOpen(true);
        setError(cause.message);
      } else {
        setError(message(cause, "Couldn't start the withdrawal."));
      }
      return;
    }
    rememberOpenOrderId("OFFRAMP", wallet, created.id);
    setStarted(created);
    await send(created);
  }

  function startAgain() {
    if (wallet) rememberOpenOrderId("OFFRAMP", wallet, null);
    setStarted(null);
    setOrder(null);
    setAmount("");
    setQuote(null);
    setError(null);
    setStep("amount");
    setIdempotencyKey(newKey());
  }

  const back =
    order || step === "account" ? null : () => setStep(step === "review" ? "amount" : "account");

  return (
    <div className="dep-page">
      <header className="dep-bar">
        {back ? (
          <button aria-label="Back" className="dep-round" onClick={back} type="button">
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <Link aria-label="Back to the dashboard" className="dep-round" href="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <h1 className="dep-title">Withdraw to bank</h1>
        <span />
      </header>

      {!isConnected || !wallet ? (
        <section className="section-panel">
          <h2 className="section-title">Withdraw</h2>
          <p className="section-copy">Connect your account to withdraw to your bank.</p>
          <div className="mt-5">
            <WalletConnectButton />
          </div>
        </section>
      ) : enabled === null ? (
        <p className="ramp-note flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : !enabled ? (
        <div className="ramp-card ramp-status">
          <span className="ramp-status-icon">
            <Landmark className="h-6 w-6" />
          </span>
          <h3>Bank withdrawals are coming soon</h3>
          <p>You&apos;ll be able to send USDC to a Nigerian bank account as Naira, straight from SaphraONE.</p>
        </div>
      ) : pending && !order?.userTxHash ? (
        <div className="ramp-card ramp-status">
          <span className="ramp-status-icon">
            <Clock className="h-6 w-6" />
          </span>
          <h3>Your USDC was sent</h3>
          <p>We still need to record it so your bank gets paid. This never sends USDC again.</p>
          <a className="ramp-link" href={explorerTxUrl(pending.hash)} rel="noreferrer" target="_blank">
            View transfer <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          {error ? <p className="ramp-error">{error}</p> : null}
          <Button className="mt-2" disabled={Boolean(busy)} onClick={() => void record(pending)} type="button">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ?? "Finish recording withdrawal"}
          </Button>
        </div>
      ) : order ? (
        <OfframpOrder busy={busy} error={error} onSend={() => void send(order)} onStartAgain={startAgain} order={order} />
      ) : kyc?.required && kyc.tier < 1 ? (
        <div className="ramp-card ramp-status">
          <h3>Verify your identity</h3>
          <p>Withdrawals go only to an account in your verified name.</p>
          <Button className="mt-2" onClick={() => { setKycMode("tier1"); setKycOpen(true); }} type="button">
            Verify identity
          </Button>
        </div>
      ) : step === "account" ? (
        <AccountStep
          adding={adding}
          beneficiaries={beneficiaries}
          onAdd={() => setAdding(true)}
          onCancelAdd={() => setAdding(false)}
          onContinue={() => selected && setStep("amount")}
          onDelete={async (id) => {
            try {
              await deleteBeneficiary(wallet, id);
              await loadBeneficiaries();
            } catch (cause) {
              setError(message(cause, "Couldn't remove that account."));
            }
          }}
          onSaved={async (saved) => {
            setAdding(false);
            setSelected(saved);
            await loadBeneficiaries();
            setSelected(saved);
          }}
          onSelect={setSelected}
          selected={selected}
          wallet={wallet}
        />
      ) : step === "amount" ? (
        <div className="ramp">
          <div className="ramp-card">
            <div className="flex items-center justify-between gap-3">
              <label className="ramp-label" htmlFor="usdc-amount">
                You send
              </label>
              <span className="ramp-note">Balance: {balance === null ? "…" : formatUsdc(balance)}</span>
            </div>
            <div className="ramp-amount">
              <input
                autoComplete="off"
                id="usdc-amount"
                inputMode="decimal"
                onChange={(event) => changeAmount(event.target.value)}
                placeholder="0.00"
                value={amount}
              />
              <span>USDC</span>
            </div>
            <div className="ramp-chips">
              <button className="ramp-chip" disabled={balance === null} onClick={fillMax} type="button">
                Max
              </button>
            </div>
            {parsed && !parsed.ok ? <p className="ramp-error">{parsed.message}</p> : null}
            {quote && parsed?.ok ? (
              <div className="ramp-quote">
                <div className="ramp-quote-row is-main">
                  <span>Bank receives about</span>
                  <b>{formatNaira(quote.receive)}</b>
                </div>
                <div className="ramp-quote-row">
                  <span>Rate</span>
                  <b>{formatNaira(quote.rate)} / USDC</b>
                </div>
                <p className="ramp-powered">Powered by Centiiv. The final rate can move slightly.</p>
              </div>
            ) : quoting ? (
              <p className="ramp-note">
                <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                Getting a rate…
              </p>
            ) : null}
            {shortOfFunds ? <p className="ramp-error">Not enough USDC in your wallet.</p> : null}
            {error ? <p className="ramp-error">{error}</p> : null}
            <Button
              className="h-12 w-full"
              disabled={!parsed?.ok || !quote || quoting || Boolean(shortOfFunds)}
              onClick={() => setStep("review")}
              type="button"
            >
              Review
            </Button>
          </div>
        </div>
      ) : (
        <div className="ramp">
          <div className="ramp-card">
            <p className="ramp-label">Review your withdrawal</p>
            <div className="ramp-quote">
              <div className="ramp-quote-row">
                <span>To</span>
                <b>
                  {selected?.bankName ?? "Bank"} {selected?.accountMasked}
                </b>
              </div>
              <div className="ramp-quote-row">
                <span>Account name</span>
                <b>{selected?.accountName}</b>
              </div>
              <div className="ramp-quote-row">
                <span>You send</span>
                <b>{formatUsdc(quote?.totalToPay ?? amount)}</b>
              </div>
              <div className="ramp-quote-row is-main">
                <span>Bank receives about</span>
                <b>{formatNaira(quote?.receive)}</b>
              </div>
              <div className="ramp-quote-row">
                <span>Rate</span>
                <b>{formatNaira(quote?.rate)} / USDC</b>
              </div>
            </div>
            <p className="ramp-note">
              The rate can move slightly before the payout. If the bank transfer can&apos;t be made, your USDC comes back
              to your wallet.
            </p>
            {error ? <p className="ramp-error">{error}</p> : null}
            <Button className="h-12 w-full" disabled={Boolean(busy)} onClick={() => void confirmWithdrawal()} type="button">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ?? "Withdraw"}
            </Button>
            <p className="ramp-powered">Powered by Centiiv.</p>
          </div>
        </div>
      )}
      {wallet ? (
        <KycSheet
          mode={kycMode}
          onOpenChange={setKycOpen}
          onVerified={(next) => {
            setKyc({
              available: next.available,
              limits: next.limits,
              nextTier: next.nextTier,
              remainingToday: next.remainingToday,
              required: next.required,
              status: next.status,
              tier: next.tier,
            });
            setKycOpen(false);
          }}
          open={kycOpen}
          wallet={wallet}
        />
      ) : null}
    </div>
  );
}

function AccountStep({
  adding,
  beneficiaries,
  onAdd,
  onCancelAdd,
  onContinue,
  onDelete,
  onSaved,
  onSelect,
  selected,
  wallet,
}: {
  adding: boolean;
  beneficiaries: RampBeneficiary[] | null;
  onAdd: () => void;
  onCancelAdd: () => void;
  onContinue: () => void;
  onDelete: (id: string) => Promise<void>;
  onSaved: (saved: RampBeneficiary) => Promise<void>;
  onSelect: (beneficiary: RampBeneficiary) => void;
  selected: RampBeneficiary | null;
  wallet: string;
}) {
  if (beneficiaries === null) {
    return (
      <p className="ramp-note flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your bank accounts…
      </p>
    );
  }

  if (adding) {
    return (
      <AddAccount
        onCancel={beneficiaries.length > 0 ? onCancelAdd : null}
        onSaved={onSaved}
        wallet={wallet}
      />
    );
  }

  return (
    <div className="ramp">
      <div className="ramp-card">
        <p className="ramp-label">Withdraw to</p>
        <div className="ramp-accounts">
          {beneficiaries.map((entry) => (
            <div className="flex items-center gap-2" key={entry.id}>
              <button
                className={cn("ramp-account", selected?.id === entry.id && "is-active")}
                onClick={() => onSelect(entry)}
                type="button"
              >
                <Landmark className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="ramp-account-main">
                  <strong>{entry.accountName}</strong>
                  <small>
                    {entry.bankName ?? entry.bankCode} {entry.accountMasked}
                  </small>
                </span>
                {selected?.id === entry.id ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}
              </button>
              <button
                aria-label={`Remove ${entry.accountName}`}
                className="dep-round shrink-0"
                onClick={() => void onDelete(entry.id)}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button className="ramp-link" onClick={onAdd} type="button">
          <Plus className="h-4 w-4" /> Add a bank account
        </button>
        <Button className="h-12 w-full" disabled={!selected} onClick={onContinue} type="button">
          Continue
        </Button>
      </div>
    </div>
  );
}

function AddAccount({
  onCancel,
  onSaved,
  wallet,
}: {
  onCancel: (() => void) | null;
  onSaved: (saved: RampBeneficiary) => Promise<void>;
  wallet: string;
}) {
  const [banks, setBanks] = useState<RampBank[] | null>(null);
  const [search, setSearch] = useState("");
  const [bank, setBank] = useState<RampBank | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [resolved, setResolved] = useState<ResolvedBankAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBanks(wallet)
      .then((list) => {
        if (!cancelled) setBanks(list);
      })
      .catch((cause) => {
        if (!cancelled) {
          setBanks([]);
          setError(message(cause, "Couldn't load the bank list."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (banks ?? []).filter((entry) => !term || entry.name.toLowerCase().includes(term)).slice(0, 50);
  }, [banks, search]);

  const nuban = readNuban(accountNumber);

  async function verify() {
    if (!bank || !nuban) return;
    setBusy(true);
    setError(null);
    try {
      setResolved(await verifyAccount(wallet, bank.code, nuban));
    } catch (cause) {
      setError(message(cause, "We couldn't find that account."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!bank || !nuban) return;
    setBusy(true);
    setError(null);
    try {
      await onSaved(await saveBeneficiary(wallet, bank.code, nuban));
    } catch (cause) {
      setError(message(cause, "Couldn't save the account."));
      setBusy(false);
    }
  }

  return (
    <div className="ramp">
      <div className="ramp-card">
        <p className="ramp-label">Add a Nigerian bank account</p>

        <div className="ramp-field">
          <label className="ramp-label" htmlFor="bank-search">
            Bank
          </label>
          {bank ? (
            <button
              className="ramp-account is-active"
              onClick={() => {
                setBank(null);
                setResolved(null);
              }}
              type="button"
            >
              <Landmark className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="ramp-account-main">
                <strong>{bank.name}</strong>
                <small>Tap to change</small>
              </span>
            </button>
          ) : (
            <>
              <div className="ramp-amount !py-0">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  className="!text-base !font-medium"
                  id="bank-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={banks === null ? "Loading banks…" : "Search banks"}
                  value={search}
                />
              </div>
              {banks && banks.length > 0 ? (
                <div className="ramp-banks">
                  {matches.map((entry) => (
                    <button
                      className="ramp-bank"
                      key={entry.code}
                      onClick={() => {
                        setBank(entry);
                        setResolved(null);
                      }}
                      type="button"
                    >
                      {entry.name}
                    </button>
                  ))}
                  {matches.length === 0 ? <p className="ramp-bank ramp-note">No bank matches.</p> : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="ramp-field">
          <label className="ramp-label" htmlFor="account-number">
            Account number
          </label>
          <input
            autoComplete="off"
            id="account-number"
            inputMode="numeric"
            maxLength={10}
            onChange={(event) => {
              setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10));
              setResolved(null);
            }}
            placeholder="10 digits"
            value={accountNumber}
          />
        </div>

        {resolved ? (
          <div className="ramp-resolved">
            <small>Account name from the bank</small>
            <strong>{resolved.accountName}</strong>
            <small>
              {resolved.bankName ?? bank?.name} · {resolved.accountNumber}
            </small>
          </div>
        ) : null}

        {error ? <p className="ramp-error">{error}</p> : null}

        <div className="ramp-actions">
          {resolved ? (
            <Button className="h-12 w-full" disabled={busy} onClick={() => void save()} type="button">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Yes, this is my account
            </Button>
          ) : (
            <Button className="h-12 w-full" disabled={!bank || !nuban || busy} onClick={() => void verify()} type="button">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Check account
            </Button>
          )}
          {onCancel ? (
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
          ) : null}
        </div>
        <p className="ramp-note">Withdraw only to an account in your own name.</p>
      </div>
    </div>
  );
}

function OfframpOrder({
  busy,
  error,
  onSend,
  onStartAgain,
  order,
}: {
  busy: string | null;
  error: string | null;
  onSend: () => void;
  onStartAgain: () => void;
  order: RampOrderView;
}) {
  const waitingForTransfer = order.status === "PENDING" && !order.userTxHash;
  const secondsLeft = useSecondsLeft(waitingForTransfer ? order.expiresAt : null);
  const bank = order.beneficiary;
  const destination = bank ? `${bank.bankName ?? "your bank"} ${bank.accountMasked}` : "your bank";

  if (order.status === "FULFILLED") {
    return (
      <div className="ramp-card ramp-status">
        <span className="ramp-status-icon">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <h3>
          {formatNaira(order.fiatAmount)} sent to {destination}
        </h3>
        <p>The Naira is on its way to {bank?.accountName ?? "your account"}.</p>
        {order.userTxHash ? (
          <a className="ramp-link" href={explorerTxUrl(order.userTxHash)} rel="noreferrer" target="_blank">
            View transfer <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        ) : null}
        <Button className="mt-2" onClick={onStartAgain} type="button" variant="outline">
          Make another withdrawal
        </Button>
      </div>
    );
  }

  if (isFinished(order.status)) {
    const title =
      order.status === "REFUNDED"
        ? "USDC returned to your wallet"
        : order.status === "EXPIRED"
          ? "This withdrawal expired"
          : "Withdrawal didn't complete";
    return (
      <div className="ramp-card ramp-status">
        <span className="ramp-status-icon is-bad">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <h3>{title}</h3>
        <p>
          {order.failureReason ??
            (order.userTxHash
              ? "Your USDC will be returned to your wallet. Contact support if it hasn't arrived."
              : "No USDC was sent.")}
        </p>
        <Button className="mt-2" onClick={onStartAgain} type="button">
          Start again
        </Button>
      </div>
    );
  }

  if (!waitingForTransfer) {
    return (
      <div className="ramp-card ramp-status">
        <span className="ramp-status-icon">
          <Loader2 className="h-6 w-6 animate-spin" />
        </span>
        <h3>{order.status === "PROCESSING" ? "Sending Naira to your bank…" : "Confirming your transfer…"}</h3>
        <p>
          About {formatNaira(order.fiatAmount)} to {destination}. This usually takes a few minutes.
        </p>
      </div>
    );
  }

  const expired = secondsLeft !== null && secondsLeft * 1000 < EXPIRY_MARGIN_MS;
  return (
    <div className="ramp">
      <div className="ramp-card">
        <div className="flex items-center justify-between gap-3">
          <span className="ramp-label">Withdrawal ready</span>
          {secondsLeft !== null ? (
            <span className="ramp-timer">
              <Clock className="h-3.5 w-3.5" />
              {secondsLeft > 0 ? formatCountdown(secondsLeft) : "Expired"}
            </span>
          ) : null}
        </div>
        <div className="ramp-quote">
          <div className="ramp-quote-row">
            <span>To</span>
            <b>{destination}</b>
          </div>
          <div className="ramp-quote-row">
            <span>You send</span>
            <b>{formatUsdc(order.totalToPay)}</b>
          </div>
          <div className="ramp-quote-row is-main">
            <span>Bank receives about</span>
            <b>{formatNaira(order.fiatAmount)}</b>
          </div>
        </div>
        {error ? <p className="ramp-error">{error}</p> : null}
        {expired ? (
          <Button className="h-12 w-full" onClick={onStartAgain} type="button">
            Start a new withdrawal
          </Button>
        ) : (
          <Button className="h-12 w-full" disabled={Boolean(busy)} onClick={onSend} type="button">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {busy ?? `Send ${formatUsdc(order.totalToPay)}`}
          </Button>
        )}
      </div>
      {!busy ? (
        <button className="ramp-note underline" onClick={onStartAgain} type="button">
          Cancel and start over
        </button>
      ) : null}
    </div>
  );
}
