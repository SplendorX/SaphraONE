"use client";

import { switchToArc } from "@/lib/arc-network";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Download,
  Loader2,
  Lock,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { showSuccess } from "@/components/success-popup";
import { erc20Abi as viemErc20Abi, formatUnits, getAddress, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { InvoiceDocument } from "@/components/account/invoice-document";
import { PlatformBrand } from "@/components/brand/platform-brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WalletConnectButton } from "@/components/wallet-connect-button";
import { fetchPublicInvoice, payPublicInvoice } from "@/lib/account/client";
import { remainingInvoiceBalance } from "@/lib/account/invoice-preview";
import { downloadInvoiceReceipt } from "@/lib/account/invoice-receipt";
import { formatMoney, moneyNumber, roundMoney } from "@/lib/account/money";
import { arcChain } from "@/lib/chains";
import { erc20Abi } from "@/lib/contracts";
import { officialArcExplorerUrl } from "@/lib/network";
import { recordPlatformTransactionActivity } from "@/lib/referral/activity-client";
import { arcTokens } from "@/lib/tokens";
import { cn } from "@/lib/utils";
import { fetchWalletSessionForAddress } from "@/lib/wallet-auth-client";
import "@/components/layout/windows-surfaces.css";

type PublicInvoice = Awaited<ReturnType<typeof fetchPublicInvoice>>;

/**
 * Where a payment is. `recording` can outlive a reload: the hash is kept so a
 * payment that landed on chain is never asked for twice.
 */
type Phase = "idle" | "switching" | "signing" | "confirming" | "recording";

const pendingKey = (publicId: string) => `saphra:invoice-payment:${publicId}`;

function readPending(publicId: string) {
  try {
    const raw = sessionStorage.getItem(pendingKey(publicId));
    return raw ? (JSON.parse(raw) as { hash: `0x${string}`; amount: string }) : null;
  } catch {
    return null;
  }
}

function writePending(publicId: string, value: { hash: string; amount: string } | null) {
  try {
    if (value) sessionStorage.setItem(pendingKey(publicId), JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey(publicId));
  } catch {
    // Private mode: recovery just won't survive a reload.
  }
}

function explorerTx(hash: string) {
  const base = officialArcExplorerUrl();
  return base ? `${base}/tx/${hash}` : "";
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function PublicInvoicePage() {
  const params = useParams<{ publicId: string }>();
  const publicId = params.publicId;
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: arcChain.id });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [payload, setPayload] = useState<PublicInvoice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // A payment that reached the chain but isn't recorded yet.
  const [pending, setPending] = useState<{ hash: `0x${string}`; amount: string } | null>(null);
  const [lastHash, setLastHash] = useState<string | null>(null);

  const applyPayload = useCallback((next: PublicInvoice) => {
    setPayload(next);
    setPayAmount(
      roundMoney(
        remainingInvoiceBalance({
          amountReceived: next.invoice.amount_received,
          total: next.invoice.total,
        }),
      ),
    );
  }, []);

  useEffect(() => {
    if (!publicId) return;
    setPending(readPending(publicId));
    void fetchPublicInvoice(publicId)
      .then(applyPayload)
      .catch((err: unknown) =>
        setLoadError(err instanceof Error ? err.message : "Invoice was not found."),
      );
  }, [applyPayload, publicId]);

  const invoice = payload?.invoice;
  const token = invoice ? arcTokens[invoice.currency] : arcTokens.USDC;

  const { data: balanceUnits } = useReadContract({
    abi: viemErc20Abi,
    address: token.address,
    args: address ? [address] : undefined,
    chainId: arcChain.id,
    functionName: "balanceOf",
    query: { enabled: Boolean(address && invoice), refetchInterval: 15_000 },
  });

  const remaining = useMemo(
    () =>
      invoice
        ? remainingInvoiceBalance({ amountReceived: invoice.amount_received, total: invoice.total })
        : 0,
    [invoice],
  );

  /**
   * Record a payment the chain has confirmed. Retries while the server's RPC
   * catches up with the block the wallet just saw.
   */
  const record = useCallback(
    async (hash: `0x${string}`, amount: string) => {
      if (!invoice) return;
      setPhase("recording");
      setError(null);
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const confirmed = await payPublicInvoice(publicId, {
            amount,
            asset: invoice.currency,
            txHash: hash,
          });
          writePending(publicId, null);
          setPending(null);
          setLastHash(hash);
          applyPayload({ ...payload!, invoice: confirmed.invoice });
          showSuccess({
            amount: `${amount} ${invoice.currency}`,
            eyebrow: "Invoice",
            explorerUrl: `${arcChain.blockExplorers.default.url}/tx/${hash}`,
            rows: [{ label: "Invoice", value: invoice.invoice_number }],
            subtitle:
              confirmed.invoice.status === "PAID"
                ? "The invoice is paid in full."
                : "Recorded as a partial payment.",
            title: confirmed.invoice.status === "PAID" ? "Payment confirmed" : "Partial payment recorded",
          });
          setPhase("idle");
          return true;
        } catch (err) {
          lastError = err;
          await wait(1500 * (attempt + 1));
        }
      }
      setError(
        lastError instanceof Error
          ? `Your payment went through on Arc, but we couldn't record it yet: ${lastError.message}`
          : "Your payment went through on Arc, but we couldn't record it yet.",
      );
      setPhase("idle");
      return false;
    },
    [applyPayload, invoice, payload, publicId],
  );

  if (loadError) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <PlatformBrand />
        <h1 className="mt-6 font-heading text-3xl">Invoice not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
      </main>
    );
  }

  if (!payload || !invoice) {
    return (
      <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading invoice…
      </main>
    );
  }

  const paid = invoice.status === "PAID";
  const cancelled = invoice.status === "CANCELLED";
  const allowPartial = Boolean(invoice.allow_partial_payment);
  const amountValue = moneyNumber(payAmount || "0");
  const overpayment = amountValue > remaining + 0.000001;
  const underpayment = !allowPartial && amountValue + 0.000001 < remaining;
  const wrongNetwork = isConnected && chainId !== arcChain.id;
  const balance =
    typeof balanceUnits === "bigint" ? Number(formatUnits(balanceUnits, token.decimals)) : null;
  const shortOfFunds = balance !== null && amountValue > balance + 0.000001;
  const dueDate = formatDate(invoice.due_date);
  const overdue = Boolean(
    invoice.due_date && !paid && !cancelled && new Date(`${invoice.due_date}T23:59:59`) < new Date(),
  );
  const busy = phase !== "idle";
  const payHref = `/send?to=${encodeURIComponent(payload.destinationWallet)}&amount=${encodeURIComponent(
    payAmount || String(remaining),
  )}&token=${encodeURIComponent(invoice.currency)}&memo=${encodeURIComponent(
    invoice.invoice_number,
  )}&invoice=${encodeURIComponent(publicId)}`;

  // Step 1 connect, 2 approve in wallet, 3 confirmed on Arc.
  const step = !isConnected ? 1 : phase === "confirming" || phase === "recording" ? 3 : 2;

  async function pay() {
    if (!payload || !invoice || !address) return;
    const amount = payAmount.trim();
    if (amountValue <= 0) {
      setError("Enter a payment amount.");
      return;
    }
    if (underpayment) {
      setError("This invoice doesn't accept partial payments. Pay the full balance.");
      return;
    }
    setError(null);

    try {
      if (wrongNetwork) {
        setPhase("switching");
        await switchToArc(switchChainAsync);
      }

      setPhase("signing");
      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: token.address,
        args: [getAddress(payload.destinationWallet), parseUnits(amount, token.decimals)],
        chainId: arcChain.id,
        functionName: "transfer",
      });

      // From here the money has moved: keep the hash so nothing is lost.
      writePending(publicId, { amount, hash });
      setPending({ amount, hash });
      setPhase("confirming");
      await publicClient?.waitForTransactionReceipt({ hash });

      const recorded = await record(hash, amount);

      // Cashback and the activity label only apply to someone already signed
      // in to SaphraONE with this wallet. A guest payer is never contacted,
      // registered or remembered.
      if (recorded) {
        const session = await fetchWalletSessionForAddress(address).catch(() => null);
        if (session?.authenticated) {
          void recordPlatformTransactionActivity({
            activity: {
              counterparty: invoice.invoice_number,
              source: "invoice",
              title: `Paid invoice ${invoice.invoice_number}`,
            },
            activityType: "INVOICE_PAYMENT",
            amount,
            showToast: false,
            token: invoice.currency,
            txHash: hash,
            walletAddress: address,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment could not be completed.";
      setError(
        /reject|denied|cancel/i.test(message)
          ? "You cancelled the payment in your wallet. Nothing was sent."
          : message.split("\n")[0],
      );
      setPhase("idle");
    }
  }

  const primaryLabel =
    phase === "switching"
      ? "Switching to Arc…"
      : phase === "signing"
        ? "Confirm in your wallet…"
        : phase === "confirming"
          ? "Confirming on Arc…"
          : phase === "recording"
            ? "Recording payment…"
            : wrongNetwork
              ? "Switch to Arc and pay"
              : `Pay ${formatMoney(payAmount || "0", invoice.currency)}`;

  return (
    <main className="win-surface win-pay min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="win-pay-bar mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <PlatformBrand />
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Secure invoice payment
          </p>
        </div>
      </header>

      <div className="win-pay-body mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-8">
        {/* The pay card leads on phones; the invoice sits beside it on desktop. */}
        <aside className="lg:order-2">
          <section className="win-pay-panel section-panel space-y-5 p-5 sm:p-6 lg:sticky lg:top-6">
            <div>
              <p className="text-sm text-muted-foreground">
                {payload.business.name} · {invoice.invoice_number}
              </p>
              {paid ? (
                <div className="mt-3 flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <Check className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-heading text-2xl">Paid</p>
                    <p className="text-sm text-muted-foreground">
                      {formatMoney(invoice.amount_received || invoice.total, invoice.currency)}
                      {invoice.paid_at ? ` on ${formatDate(invoice.paid_at)}` : ""}
                    </p>
                  </div>
                </div>
              ) : cancelled ? (
                <p className="mt-2 font-heading text-2xl">Cancelled</p>
              ) : (
                <>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {moneyNumber(invoice.amount_received || "0") > 0 ? "Balance due" : "Amount due"}
                  </p>
                  <p className="mt-1 font-heading text-4xl tabular-nums">
                    {formatMoney(remaining, invoice.currency)}
                  </p>
                  {dueDate ? (
                    <span
                      className={cn(
                        "mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                        overdue
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {overdue ? `Overdue · was due ${dueDate}` : `Due ${dueDate}`}
                    </span>
                  ) : null}
                </>
              )}
            </div>

            {paid ? (
              <div className="space-y-3">
                {moneyNumber(invoice.overpayment || "0") > 0 ? (
                  <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                    Overpaid by {formatMoney(invoice.overpayment || "0", invoice.currency)}. The
                    business will see the full amount received.
                  </p>
                ) : null}
                <Button
                  className="h-11 w-full"
                  onClick={() =>
                    void downloadInvoiceReceipt({
                      amountReceived: invoice.amount_received || invoice.total,
                      businessName: payload.business.name,
                      currency: invoice.currency,
                      customerName: invoice.customer_name,
                      invoiceNumber: invoice.invoice_number,
                      items: invoice.items,
                      logoUrl: payload.business.logoUrl,
                      overpayment: invoice.overpayment,
                      paidAt: invoice.paid_at,
                      total: invoice.total,
                    })
                  }
                >
                  <Download className="h-4 w-4" />
                  Download receipt
                </Button>
                {lastHash && explorerTx(lastHash) ? (
                  <a
                    className="inline-flex w-full items-center justify-center gap-1 text-sm font-medium text-primary hover:underline"
                    href={explorerTx(lastHash)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View transaction on Arc
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            ) : cancelled ? (
              <p className="text-sm text-muted-foreground">
                {payload.business.name} cancelled this invoice, so it can&rsquo;t be paid. Contact
                them if you think this is a mistake.
              </p>
            ) : pending ? (
              // The transfer landed but isn't recorded: never offer to pay again.
              <div className="space-y-3">
                <div className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  {phase === "recording" ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <p>
                    {phase === "confirming"
                      ? "Waiting for Arc to confirm your payment…"
                      : phase === "recording"
                        ? "Payment sent. Recording it on the invoice…"
                        : error ?? "Your payment was sent. Finish recording it on the invoice."}
                  </p>
                </div>
                <Button
                  className="h-11 w-full"
                  disabled={busy}
                  onClick={() => void record(pending.hash, pending.amount)}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? primaryLabel : "Finish recording payment"}
                </Button>
                {explorerTx(pending.hash) ? (
                  <a
                    className="inline-flex w-full items-center justify-center gap-1 text-sm font-medium text-primary hover:underline"
                    href={explorerTx(pending.hash)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View transaction
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                <ol className="grid grid-cols-3 gap-2 text-center text-[11px] font-medium">
                  {["Connect", "Approve", "Confirmed"].map((label, index) => (
                    <li
                      className={cn(
                        "rounded-full px-2 py-1.5",
                        index + 1 < step
                          ? "bg-primary/15 text-primary"
                          : index + 1 === step
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                      )}
                      key={label}
                    >
                      {label}
                    </li>
                  ))}
                </ol>

                {allowPartial ? (
                  <label className="block text-sm font-medium">
                    <span className="flex items-center justify-between">
                      Amount to pay
                      {amountValue !== remaining ? (
                        <button
                          className="text-xs font-semibold text-primary hover:underline"
                          onClick={() => setPayAmount(roundMoney(remaining))}
                          type="button"
                        >
                          Pay full balance
                        </button>
                      ) : null}
                    </span>
                    <div className="relative mt-2">
                      <Input
                        className="h-11 pr-16 tabular-nums"
                        disabled={busy}
                        inputMode="decimal"
                        onChange={(event) => setPayAmount(event.target.value.replace(/[^\d.]/g, ""))}
                        value={payAmount}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                        {invoice.currency}
                      </span>
                    </div>
                  </label>
                ) : null}

                {overpayment ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    That&rsquo;s more than the balance. The extra is recorded as an overpayment.
                  </p>
                ) : null}

                {isConnected && address ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-muted-foreground" />
                      {shortAddress(address)}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums",
                        shortOfFunds ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {wrongNetwork
                        ? "Not on Arc"
                        : balance === null
                          ? "…"
                          : formatMoney(balance, invoice.currency)}
                    </span>
                  </div>
                ) : null}

                {shortOfFunds && !wrongNetwork ? (
                  <p className="text-sm text-destructive">
                    This wallet doesn&rsquo;t hold enough {invoice.currency} on Arc for this payment.
                  </p>
                ) : null}
                {error ? <p className="text-sm text-destructive">{error}</p> : null}

                {!isConnected ? (
                  <WalletConnectButton fullWidth />
                ) : (
                  <Button
                    className="h-12 w-full text-base"
                    disabled={busy || amountValue <= 0 || underpayment || (shortOfFunds && !wrongNetwork)}
                    onClick={() => void pay()}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {primaryLabel}
                  </Button>
                )}

                <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  Pay from any wallet — no SaphraONE account needed. Paying doesn&rsquo;t sign you up
                  or save your wallet; the funds go straight to {payload.business.name}.
                </p>

                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>

                <Button asChild className="h-11 w-full" variant="outline">
                  <a href={payHref}>Pay with my SaphraONE account</a>
                </Button>
              </div>
            )}
          </section>
        </aside>

        <div className="win-pay-doc min-w-0 lg:order-1">
          <InvoiceDocument
            invoice={{
              amountReceived: invoice.amount_received,
              businessDescription: payload.business.description,
              businessLogoUrl: payload.business.logoUrl,
              businessName: payload.business.name,
              businessUsername: payload.business.username,
              currency: invoice.currency,
              customerName: invoice.customer_name,
              customerUsername: invoice.customer_username,
              discount: invoice.discount,
              dueDate: invoice.due_date,
              invoiceNumber: invoice.invoice_number,
              issueDate: invoice.issue_date,
              items: invoice.items,
              notes: invoice.notes,
              overpayment: invoice.overpayment,
              paymentTerms: invoice.payment_terms,
              status: invoice.status,
              subtotal: invoice.subtotal,
              tax: invoice.tax,
              total: invoice.total,
            }}
          />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Payments settle on Arc in seconds.{" "}
            <a className="font-medium text-primary hover:underline" href="/support">
              Need help?
            </a>
            {" · "}
            <a className="font-medium text-primary hover:underline" href="https://app.saphra.one">
              app.saphra.one
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
