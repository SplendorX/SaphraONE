"use client";

import { AlertCircle, ExternalLink, Loader2, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EarnExternalWalletNotice } from "@/components/earn/earn-signer-notice";
import { TransferProgressOverlay } from "@/components/send/transfer-progress";
import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import { browserPosition, browserWithdraw, browserWithdrawQuote } from "@/lib/earn/browser";
import { formatAssetAmount, formatFeeList, vaultName } from "@/lib/earn/display";
import {
  EARN_POSITION_EVENT,
  notifyEarnPositionUpdated,
} from "@/lib/earn/selected-vault";
import type {
  EarnPosition,
  EarnTxResult,
  EarnVault,
  EarnWithdrawQuote,
} from "@/lib/earn/types";
import { formatUsdc, isValidUsdcAmount, parseUsdc } from "@/lib/onchain-money";
import { confirmFlow } from "@/lib/tx-approval/client";

type EarnWithdrawProps = {
  /** The Circle wallet id: one confirmation for the whole deposit or withdrawal (lib/tx-approval). */
  circleWalletId?: string | null;
  connectedAddress?: string | null;
  currentChainId?: number;
  resolveProvider?: (() => Promise<unknown>) | null;
  switchChainAsync?: (args: { chainId: number }) => Promise<unknown>;
  walletReason?: string | null;
  selectedVault?: EarnVault | null;
  vaultAddress?: string | null;
  /** Prefill from a link, e.g. ALLIE's handoff. */
  initialAmount?: string;
};

export function EarnWithdraw({
  circleWalletId,
  connectedAddress,
  currentChainId,
  initialAmount = "",
  resolveProvider,
  switchChainAsync,
  walletReason,
  selectedVault,
  vaultAddress,
}: EarnWithdrawProps) {
  const [amount, setAmount] = useState(initialAmount);
  const [position, setPosition] = useState<EarnPosition | null>(null);
  const [quote, setQuote] = useState<EarnWithdrawQuote | null>(null);
  const [result, setResult] = useState<EarnTxResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPosition = useCallback(async () => {
    if (!vaultAddress || !connectedAddress) {
      setPosition(null);
      return;
    }
    try {
      const next = await browserPosition({
        currentChainId,
        resolveProvider,
        vaultAddress,
      });
      setPosition(next);
    } catch (cause) {
      setPosition(null);
      setError(
        cause instanceof Error ? cause.message : "Position could not be loaded.",
      );
    }
  }, [connectedAddress, vaultAddress]);

  useEffect(() => {
    void loadPosition();
    window.addEventListener(EARN_POSITION_EVENT, loadPosition);
    return () => {
      window.removeEventListener(EARN_POSITION_EVENT, loadPosition);
    };
  }, [loadPosition]);

  const amountValid = isValidUsdcAmount(amount);
  const maxAmount = position?.currentBalance?.trim() || "";

  async function handlePreview() {
    if (!vaultAddress || !connectedAddress || !amountValid) return;
    setBusy("preview");
    setError(null);
    try {
      parseUsdc(amount);
      const nextQuote = await browserWithdrawQuote({
        amount,
        currentChainId,
        resolveProvider,
        switchChainAsync,
        vaultAddress,
      });
      setQuote(nextQuote);
    } catch (cause) {
      setQuote(null);
      setError(cause instanceof Error ? cause.message : "Preview failed.");
    } finally {
      setBusy(null);
    }
  }

  // The moving-coin animation: vault → wallet, ending on the receipt.
  const [withdrawDone, setWithdrawDone] = useState(false);

  async function handleWithdraw() {
    if (!vaultAddress || !connectedAddress || !amountValid || busy) return;
    setBusy("withdraw");
    setError(null);
    try {
      parseUsdc(amount);
      const nextResult = await confirmFlow(
        circleWalletId,
        { amount, maxUses: 4, recipients: [], title: "Withdraw from Invest", token: "USDC" },
        () =>
          browserWithdraw({
            amount,
            currentChainId,
            resolveProvider,
            switchChainAsync,
            vaultAddress,
          }),
      );
      setResult(nextResult);
      setWithdrawDone(true);
      setAmount("");
      setQuote(null);
      notifyEarnPositionUpdated();
      await loadPosition();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Withdraw failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!vaultAddress) {
    return (
      <p className="earn-footnote">
        Select a vault first. Your choice is kept while you move between Invest
        tabs.
      </p>
    );
  }

  if (!connectedAddress) {
    return (
      <p className="earn-footnote">
        Connect a wallet to preview and withdraw USDC.
      </p>
    );
  }

  if (!resolveProvider) {
    return <EarnExternalWalletNotice reason={walletReason} />;
  }

  const received = formatAssetAmount(quote?.withdrawal);
  const maxWithdrawable = formatAssetAmount(
    quote?.maxWithdrawable ?? position?.currentBalance,
  );

  return (
    <div className="earn-form earn-panel-form">
      <TransferProgressOverlay
        active={busy === "withdraw" || withdrawDone}
        current={0}
        details={
          result
            ? {
                amount: result.amount ? `${result.amount} USDC` : undefined,
                eyebrow: "Invest",
                explorerUrl: result.explorerUrl,
                rows: selectedVault ? [{ label: "From", value: vaultName(selectedVault) }] : undefined,
              }
            : undefined
        }
        doneSubtitle="Funds are back in your wallet."
        doneTitle="Withdrawal successful"
        from={<TrendingUp className="h-6 w-6 text-primary" />}
        onDone={() => setWithdrawDone(false)}
        state={withdrawDone ? "done" : "running"}
        steps={[selectedVault ? `Withdrawing from ${vaultName(selectedVault)}` : "Withdrawing from the vault"]}
        title="Withdrawing"
        to={<TokenIcon className="h-8 w-8" symbol="USDC" />}
      />
      <p className="earn-label">
        {selectedVault ? vaultName(selectedVault) : "Selected vault"}
      </p>
      <label className="earn-label" htmlFor="earn-withdraw-amount">
        Amount
      </label>
      <div className="flex gap-2">
        <input
          className="earn-input flex-1"
          id="earn-withdraw-amount"
          inputMode="decimal"
          onChange={(event) => {
            setAmount(event.target.value);
            setQuote(null);
            setResult(null);
          }}
          placeholder="50.00 USDC"
          value={amount}
        />
        <Button
          className="h-auto px-4"
          disabled={!maxAmount}
          onClick={() => {
            if (!maxAmount) return;
            try {
              setAmount(formatUsdc(parseUsdc(maxAmount)));
            } catch {
              setAmount(maxAmount);
            }
            setQuote(null);
          }}
          type="button"
          variant="outline"
        >
          Max
        </Button>
      </div>
      {quote ? (
        <dl className="earn-form-preview">
          <div>
            <dt>You&apos;re withdrawing</dt>
            <dd>{formatAssetAmount(quote.withdrawal) ?? `${amount} USDC`}</dd>
          </div>
          <div>
            <dt>Estimated USDC received</dt>
            <dd>{received ?? "—"}</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>{formatFeeList(quote.fees)}</dd>
          </div>
          <div>
            <dt>Maximum withdrawable</dt>
            <dd>{maxWithdrawable ?? "—"}</dd>
          </div>
        </dl>
      ) : null}
      {quote?.earnKitWarnings && quote.earnKitWarnings.length > 0 ? (
        <p className="earn-form-hint">{quote.earnKitWarnings.join(" ")}</p>
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          className="h-11 w-full sm:w-auto sm:flex-1"
          disabled={!amountValid || busy !== null}
          onClick={() => void handlePreview()}
          type="button"
          variant="outline"
        >
          {busy === "preview" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Preview"
          )}
        </Button>
        <Button
          className="h-11 w-full sm:w-auto sm:flex-1"
          disabled={!amountValid || busy !== null}
          onClick={() => void handleWithdraw()}
          type="button"
        >
          {busy === "withdraw" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Withdraw USDC"
          )}
        </Button>
      </div>
      {error ? (
        <p className="earn-error">
          <AlertCircle className="h-4 w-4" />
          {error}
        </p>
      ) : null}
      {result ? (
        <a
          className="earn-tx-link"
          href={result.explorerUrl}
          rel="noreferrer"
          target="_blank"
        >
          View transaction <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </div>
  );
}
