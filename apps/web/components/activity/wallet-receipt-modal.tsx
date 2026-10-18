"use client";

import { useState } from "react";

import { useT } from "@/components/locale-provider";
import { TransactionReceipt } from "@/components/dashboard/transaction-receipt";
import { allieSenderLabel, isOwnAgentWallet, useWalletUsernames } from "@/lib/activity/usernames";
import type { WalletTransfer } from "@/lib/arcscan-history";
import { arcChain } from "@/lib/chains";
import {
  buildReceiptPngDataUrl,
  buildReceiptText,
  formatDisplayAmount,
  formatTransferTime,
  receiptCounterpartyName,
  shortenAddress,
} from "@/lib/wallet-receipt";

/**
 * The receipt for one wallet transfer: on-screen card, PNG download and
 * share. Opened from the Activity page.
 */
export function WalletReceiptModal({
  onClose,
  transfer,
  walletAddress,
}: {
  onClose: () => void;
  transfer: WalletTransfer;
  walletAddress: string;
}) {
  const t = useT();
  const usernameFor = useWalletUsernames([transfer.counterparty]);
  const [error, setError] = useState<string | null>(null);
  // Money ALLIE sent comes from the sender's Agent Wallet: name the owner,
  // on screen and in the downloaded or shared copy alike.
  // Your own Agent Wallet is ALLIE: a top-up or a withdrawal, not a person.
  const ownAgent = isOwnAgentWallet(transfer.counterparty, walletAddress);
  const viaAllie = ownAgent
    ? "ALLIE · Agent Wallet"
    : transfer.direction === "in"
      ? allieSenderLabel(transfer.counterparty)
      : null;
  const username = viaAllie ? null : usernameFor(transfer.counterparty);
  const receiptTransfer = viaAllie
    ? { ...transfer, counterpartyLabel: viaAllie }
    : transfer;
  const counterpartyName = receiptCounterpartyName(receiptTransfer, username);
  const explorerUrl = `${arcChain.blockExplorers.default.url}/tx/${transfer.hash}`;

  async function download() {
    setError(null);
    try {
      const url = await buildReceiptPngDataUrl(receiptTransfer, walletAddress, username);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `saphra-receipt-${transfer.hash.slice(0, 12)}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "The receipt image could not be created.",
      );
    }
  }

  async function share() {
    setError(null);
    const text = buildReceiptText(receiptTransfer, walletAddress, username);
    try {
      if (navigator.share) {
        await navigator.share({
          text,
          title: "SaphraONE transaction receipt",
          url: explorerUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(text);
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") {
        return;
      }
      setError("The receipt could not be shared. Copy it from ArcScan instead.");
    }
  }

  return (
    <>
      <TransactionReceipt
        amount={formatDisplayAmount(transfer.amount)}
        counterpartyName={counterpartyName}
        explorerUrl={explorerUrl}
        labels={{
          received: t("dashboard.received"),
          sent: t("dashboard.sent"),
          title: t("dashboard.transactionReceipt"),
        }}
        onClose={onClose}
        onDownload={() => void download()}
        onShare={() => void share()}
        rows={[
          {
            label: transfer.direction === "out" ? "To" : "From",
            value: counterpartyName,
            copy: transfer.counterparty,
          },
          {
            label: "Your wallet",
            value: shortenAddress(walletAddress),
            copy: walletAddress,
            mono: true,
          },
          { label: "Date", value: formatTransferTime(transfer.timestamp) },
          {
            label: "Network",
            value: transfer.destinationNetwork
              ? `${arcChain.name} → ${transfer.destinationNetwork}`
              : arcChain.name,
          },
          {
            label: "Block",
            value: transfer.blockNumber ? `#${transfer.blockNumber}` : "See ArcScan",
          },
          {
            label: "Transaction",
            value: shortenAddress(transfer.hash),
            copy: transfer.hash,
            mono: true,
          },
        ]}
        transfer={transfer}
      />
      {error ? (
        <p className="activity-receipt-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
