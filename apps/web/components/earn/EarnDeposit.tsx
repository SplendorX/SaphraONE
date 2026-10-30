"use client";

import { AlertCircle, ExternalLink, Loader2, TrendingUp } from "lucide-react";
import { useState } from "react";

import { EarnExternalWalletNotice } from "@/components/earn/earn-signer-notice";
import { TransferProgressOverlay } from "@/components/send/transfer-progress";
import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import {
  browserDeposit,
  browserDepositQuote,
  EarnRejectedError,
} from "@/lib/earn/browser";
import {
  formatApy,
  formatAssetAmount,
  formatFeeList,
  vaultName,
} from "@/lib/earn/display";
import { notifyEarnPositionUpdated } from "@/lib/earn/selected-vault";
import type { EarnDepositQuote, EarnTxResult, EarnVault } from "@/lib/earn/types";
import { userFacingErrorMessage } from "@/lib/circle-session";
import { formatUsdc, isValidUsdcAmount, parseUsdc } from "@/lib/onchain-money";
import { confirmFlow } from "@/lib/tx-approval/client";

type EarnDepositProps = {
  /** The Circle wallet id: one confirmation for the whole deposit or withdrawal (lib/tx-approval). */
  circleWalletId?: string | null;
  connectedAddress?: string | null;
  currentChainId?: number;
  resolveProvider?: (() => Promise<unknown>) | null;
  selectedVault?: EarnVault | null;
  switchChainAsync?: (args: { chainId: number }) => Promise<unknown>;
  vaultAddress?: string | null;
  walletReason?: string | null;
  /** Prefill from a link, e.g. ALLIE's handoff. */
  initialAmount?: string;
};

export function EarnDeposit({
  circleWalletId,
  connectedAddress,
  currentChainId,
  initialAmount = "",
  resolveProvider,
  selectedVault,
  switchChainAsync,
  vaultAddress,
  walletReason,
}: EarnDepositProps) {
  const [amount, setAmount] = useState(initialAmount);
  const [quote, setQuote] = useState<EarnDepositQuote | null>(null);
  const [result, setResult] = useState<EarnTxResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "checking" | "deposit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The moving-coin animation: runs with the deposit, then plays its check.
  const [depositDone, setDepositDone] = useState(false);

  const amountValid = isValidUsdcAmount(amount);

  async function handlePreview() {
    if (!vaultAddress || !connectedAddress || !amountValid) return;
    setBusy("preview");
    setError(null);
    try {
      parseUsdc(amount);
      const nextQuote = await browserDepositQuote({
        amount,
        currentChainId,
        resolveProvider,
        switchChainAsync,
        vaultAddress,
      });
      setQuote(nextQuote);
    } catch (cause) {
      setQuote(null);
      if (!(cause instanceof EarnRejectedError)) {
        setError(
          userFacingErrorMessage(
            cause,
            "We couldn't prepare a deposit preview. Check your connection and try again.",
          ),
        );
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleDeposit() {
    if (!vaultAddress || !connectedAddress || !amountValid || busy) return;
    // A quote performs the router's read-only validation (including a vault's
    // current minimum and liquidity checks). Depositing without it used to send
    // invalid requests straight to the wallet, where Arc could only return its
    // generic 5099 error after the customer had already started confirmation.
    setBusy("checking");
    setError(null);
    try {
      parseUsdc(amount);
      const freshQuote = await browserDepositQuote({
        amount,
        currentChainId,
        resolveProvider,
        switchChainAsync,
        vaultAddress,
      });
      setQuote(freshQuote);
      setBusy("deposit");
      const nextResult = await confirmFlow(
        circleWalletId,
        { amount, maxUses: 4, recipients: [], title: "Invest USDC", token: "USDC" },
        () =>
          browserDeposit({
            amount,
            currentChainId,
            resolveProvider,
            switchChainAsync,
            vaultAddress,
          }),
      );
      setResult(nextResult);
      setDepositDone(true);
      setAmount("");
      setQuote(null);
      notifyEarnPositionUpdated();
    } catch (cause) {
      if (!(cause instanceof EarnRejectedError)) {
        setError(
          userFacingErrorMessage(
            cause,
            "We couldn't prepare this deposit. Check your wallet activity before trying again.",
          ),
        );
      }
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
        Connect a wallet to preview and deposit USDC.
      </p>
    );
  }

  if (!resolveProvider) {
    return <EarnExternalWalletNotice reason={walletReason} />;
  }

  const apy = formatApy(quote?.currentApy);
  const shares = formatAssetAmount(quote?.expectedShares);
  const depositAmount = formatAssetAmount(quote?.deposit) ?? `${amount} USDC`;

  return (
    <div className="earn-form earn-panel-form">
      <TransferProgressOverlay
        active={busy === "deposit" || depositDone}
        current={0}
        details={
          result
            ? {
                amount: result.amount ? `${formatUsdc(parseUsdc(result.amount))} USDC` : undefined,
                eyebrow: "Invest",
                explorerUrl: result.explorerUrl,
                rows: selectedVault ? [{ label: "Vault", value: vaultName(selectedVault) }] : undefined,
              }
            : undefined
        }
        doneSubtitle={selectedVault ? `Deposited into ${vaultName(selectedVault)}.` : "Deposited into your vault."}
        doneTitle="Investment successful"
        from={<TokenIcon className="h-8 w-8" symbol="USDC" />}
        onDone={() => setDepositDone(false)}
        state={depositDone ? "done" : "running"}
        steps={[selectedVault ? `Investing in ${vaultName(selectedVault)}` : "Investing in the vault"]}
        title="Investing"
        to={<TrendingUp className="h-6 w-6 text-primary" />}
      />
      <p className="earn-label">
        {selectedVault ? vaultName(selectedVault) : "Selected vault"}
      </p>
      <label className="earn-label" htmlFor="earn-deposit-amount">
        Amount
      </label>
      <input
        className="earn-input"
        id="earn-deposit-amount"
        inputMode="decimal"
        onChange={(event) => {
          setAmount(event.target.value);
          setQuote(null);
          setResult(null);
        }}
        placeholder="100.00 USDC"
        value={amount}
      />
      {quote ? (
        <dl className="earn-form-preview">
          <div>
            <dt>You&apos;re depositing</dt>
            <dd>{depositAmount}</dd>
          </div>
          <div>
            <dt>Estimated shares</dt>
            <dd>{shares ?? "—"}</dd>
          </div>
          <div>
            <dt>Current APY</dt>
            <dd>{apy ? `${apy}` : "—"}</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>{formatFeeList(quote.fees)}</dd>
          </div>
        </dl>
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
          onClick={() => void handleDeposit()}
          type="button"
        >
          {busy === "checking" || busy === "deposit" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Deposit USDC"
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
