"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  BadgeCheck,
  Building2,
  ChevronRight,
  FileText,
  Send,
  Store,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, formatUnits, getAddress, isAddress } from "viem";
import { useReadContract } from "wagmi";

import { useAccountContext } from "@/components/account/account-provider";
import { useT } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { fetchBusinessOverview } from "@/lib/account/client";
import { profileCompletionPercent } from "@/lib/account/money";
import type { InvoiceRecord, InvoiceSummary } from "@/lib/account/types";
import { fetchPayrollDashboard } from "@/lib/payroll/client";
import type { PayrollDashboardSummary } from "@/lib/payroll/types";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { erc20Abi } from "@/lib/contracts";
import { arcTokens } from "@/lib/tokens";
import { arcChain, arcTransport } from "@/lib/chains";
import type { WalletTransfer } from "@/lib/arcscan-history";
import {
  callCircleWalletApi,
  findCircleTokenBalance,
  readCircleLogin,
  readCircleWallets,
  type CircleTokenBalance,
} from "@/lib/circle-session";

import { TokenIcon } from "@/components/token-icon";
import { checkoutEnabled } from "@/lib/checkout/flag";
import { CashFlowCard } from "@/components/business/overview/cash-flow-card";
import { BusinessActivityCard } from "@/components/business/overview/business-activity-card";
import { BusinessInsightsCard } from "@/components/business/overview/business-insights-card";
import { CheckoutOverviewCard } from "@/components/business/overview/checkout-overview-card";
import { InvoiceOverviewCard } from "@/components/business/overview/invoice-overview-card";
import type { ChargeSummary } from "@/lib/checkout/types";
import { TeamPaymentsCard } from "@/components/business/overview/team-payments-card";
import { BusinessHealthCard } from "@/components/business/overview/business-health-card";
import { OneWatermark } from "@/components/brand/one-watermark";
import { BusinessOverviewSkeleton } from "@/components/business/overview/business-overview-skeleton";
import {
  buildRealOverviewData,
  computeRealCashFlow,
} from "@/components/business/overview/overview-data";

import "./overview.css";

const arcPublicClient = createPublicClient({
  chain: arcChain,
  transport: arcTransport(),
});

export function BusinessOverview() {
  const t = useT();
  const { account, circleSocialUuid, loading: accountLoading, ownerWallet, profile } = useAccountContext();
  const { address, circleSocialUuid: walletCircleUuid } = usePlatformWallet();
  const isBusiness = account?.account_type === "BUSINESS";

  const effectiveSocialUuid = circleSocialUuid || walletCircleUuid;
  const activeWallet = (ownerWallet || address)?.toLowerCase() ?? null;

  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [checkoutSummary, setCheckoutSummary] = useState<ChargeSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [payrollSummary, setPayrollSummary] = useState<PayrollDashboardSummary | null>(null);
  const [transfers, setTransfers] = useState<WalletTransfer[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [directUsdcBalance, setDirectUsdcBalance] = useState<number | null>(null);
  const [directEurcBalance, setDirectEurcBalance] = useState<number | null>(null);

  // 1. Fetch live database records (Invoices & Payroll)
  useEffect(() => {
    setError(null);
    if (!activeWallet || !isBusiness) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    let isMounted = true;

    Promise.allSettled([
      fetchBusinessOverview(activeWallet, effectiveSocialUuid),
      fetchPayrollDashboard(activeWallet, effectiveSocialUuid),
    ])
      .then(([overviewResult, payrollResult]) => {
        if (!isMounted) return;

        if (overviewResult.status === "fulfilled") {
          setSummary(overviewResult.value.summary);
          setCheckoutSummary(overviewResult.value.checkout ?? null);
          setInvoices(overviewResult.value.invoices);
        } else {
          console.error("Overview fetch failed:", overviewResult.reason);
          setError("Could not load full business overview.");
        }

        if (payrollResult.status === "fulfilled") {
          setPayrollSummary(payrollResult.value);
        } else {
          console.warn("Payroll fetch failed:", payrollResult.reason);
        }
      })
      .finally(() => {
        if (isMounted) setLoadingData(false);
      });

    return () => {
      isMounted = false;
    };
  }, [effectiveSocialUuid, activeWallet, isBusiness]);

  // 2. Fetch real on-chain transfer history from ArcScan for active business wallet
  const targetAddress = (address || ownerWallet) as `0x${string}` | undefined;

  useEffect(() => {
    if (!targetAddress || !isAddress(targetAddress)) {
      setTransfers([]);
      return;
    }

    let isMounted = true;
    fetch(`/api/arcscan/history?address=${targetAddress}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { items?: WalletTransfer[] }) => {
        if (isMounted && Array.isArray(data.items)) {
          setTransfers(data.items);
        }
      })
      .catch(() => {
        if (isMounted) setTransfers([]);
      });

    return () => {
      isMounted = false;
    };
  }, [targetAddress]);

  // 3. Read real on-chain token balances on the active Arc network
  const isAddressValid = Boolean(targetAddress && isAddress(targetAddress));

  const { data: rawUsdcBalance } = useReadContract({
    address: arcTokens.USDC.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: isAddressValid ? [targetAddress!] : undefined,
    chainId: arcChain.id,
    query: { enabled: isAddressValid },
  });

  const { data: rawEurcBalance } = useReadContract({
    address: arcTokens.EURC.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: isAddressValid ? [targetAddress!] : undefined,
    chainId: arcChain.id,
    query: { enabled: isAddressValid },
  });

  // Direct RPC and Circle token balance reading for Google/Circle sessions
  useEffect(() => {
    if (!targetAddress || !isAddress(targetAddress)) {
      setDirectUsdcBalance(null);
      setDirectEurcBalance(null);
      return;
    }

    let isMounted = true;

    async function fetchBalances() {
      try {
        const [usdcBigInt, eurcBigInt] = await Promise.all([
          arcPublicClient.readContract({
            address: arcTokens.USDC.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [getAddress(targetAddress!)],
          }).catch(() => null),
          arcPublicClient.readContract({
            address: arcTokens.EURC.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [getAddress(targetAddress!)],
          }).catch(() => null),
        ]);

        if (!isMounted) return;

        if (typeof usdcBigInt === "bigint") {
          setDirectUsdcBalance(parseFloat(formatUnits(usdcBigInt, arcTokens.USDC.decimals)) || 0);
        }
        if (typeof eurcBigInt === "bigint") {
          setDirectEurcBalance(parseFloat(formatUnits(eurcBigInt, arcTokens.EURC.decimals)) || 0);
        }
      } catch (err) {
        console.warn("Direct RPC balance check failed:", err);
      }

      // Also check Circle API balances if in Circle session
      try {
        const circleWallets = readCircleWallets();
        const login = readCircleLogin();
        const targetCircleWallet =
          circleWallets.find((w) => w.address?.toLowerCase() === targetAddress?.toLowerCase()) ??
          circleWallets[0];

        if (login?.userToken && targetCircleWallet?.id) {
          const balPayload = await callCircleWalletApi<{
            tokenBalances?: CircleTokenBalance[];
          }>("getTokenBalance", {
            userToken: login.userToken,
            walletId: targetCircleWallet.id,
          });

          if (!isMounted || !balPayload?.tokenBalances) return;
          const usdc = findCircleTokenBalance(balPayload.tokenBalances, "USDC");
          const eurc = findCircleTokenBalance(balPayload.tokenBalances, "EURC");
          if (typeof usdc?.amount === "string") {
            const parsed = parseFloat(usdc.amount);
            setDirectUsdcBalance((prev) => (prev !== null ? prev : (isNaN(parsed) ? 0 : parsed)));
          }
          if (typeof eurc?.amount === "string") {
            const parsed = parseFloat(eurc.amount);
            setDirectEurcBalance((prev) => (prev !== null ? prev : (isNaN(parsed) ? 0 : parsed)));
          }
        }
      } catch {
        // ignore
      }
    }

    void fetchBalances();

    return () => {
      isMounted = false;
    };
  }, [targetAddress]);

  const usdcBalance = useMemo(() => {
    if (typeof rawUsdcBalance === "bigint") {
      return parseFloat(formatUnits(rawUsdcBalance, arcTokens.USDC.decimals)) || 0;
    }
    if (directUsdcBalance !== null) {
      return directUsdcBalance;
    }
    return 0;
  }, [rawUsdcBalance, directUsdcBalance]);

  const eurcBalance = useMemo(() => {
    if (typeof rawEurcBalance === "bigint") {
      return parseFloat(formatUnits(rawEurcBalance, arcTokens.EURC.decimals)) || 0;
    }
    if (directEurcBalance !== null) {
      return directEurcBalance;
    }
    return 0;
  }, [rawEurcBalance, directEurcBalance]);

  if (accountLoading || (activeWallet && loadingData && !summary && invoices.length === 0)) {
    return <BusinessOverviewSkeleton />;
  }

  if (!isBusiness) {
    return (
      <div className="ov-page">
        <OverviewBar />
        <div className="ov-card ov-pad">
          <h2 className="ov-section-title">{t("business.overview")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Business overview is exclusive to SaphraONE Business accounts. Upgrade this account to Business to unlock invoicing, payroll, and business analytics.
          </p>
          <Button asChild className="mt-5 h-11">
            <Link href="/settings#account-type">Upgrade to Business</Link>
          </Button>
        </div>
      </div>
    );
  }

  const completion = profileCompletionPercent(profile);
  const businessDisplayName =
    profile?.business_name || account?.username || "SaphraONE Business";

  // 4. Compute 100% REAL data models without dummy placeholders
  const {
    balanceData,
    metrics,
    activities,
    insights,
    invoiceOverview,
    teamPayments,
    financialHealth,
  } = buildRealOverviewData({
    usdcBalance,
    eurcBalance,
    summary,
    invoices,
    payrollSummary,
    transfers,
    walletAddress: targetAddress,
  });

  const cashFlowSummaries = computeRealCashFlow({
    transfers,
    invoices,
    payrollSummary,
  });

  const quickActions = [
    { href: "/send", icon: Send, label: "Send" },
    { href: "/business/invoices?new=1", icon: FileText, label: "Invoice" },
    { href: "/pay", icon: ArrowDownLeft, label: "Request" },
    { href: "/business/payroll", icon: Users, label: "Pay team" },
    ...(checkoutEnabled ? [{ href: "/business/checkout", icon: Store, label: "Checkout" }] : []),
  ];

  return (
    <div className="ov-page">
      <OverviewBar />

      {/* The business and its money */}
      <section className="ov-hero one-watermark-host">
        <span aria-hidden className="ov-hero-glow" />
        <OneWatermark className="one-watermark-behind one-watermark-on-color" />
        <div className="ov-hero-top">
          <span className="ov-hero-name">
            <Building2 className="h-4 w-4" />
            {businessDisplayName}
            {completion.percent === 100 ? <BadgeCheck className="h-4 w-4" /> : null}
          </span>
          {balanceData.trendDirection !== "flat" ? (
            <span className="ov-hero-pill">
              {balanceData.trendDirection === "up" ? "▲" : "▼"} {Math.abs(balanceData.trendPercentage).toFixed(1)}%
            </span>
          ) : null}
        </div>
        <p className="ov-hero-label">Total balance</p>
        <p className="ov-hero-amount">{balanceData.totalBalanceFormatted}</p>
        <div className="ov-hero-chips">
          {balanceData.assets.map((asset) => (
            <span key={asset.symbol}>
              <TokenIcon className="h-3.5 w-3.5" symbol={asset.symbol} />
              {asset.formatted}
            </span>
          ))}
        </div>
        <div className="ov-hero-foot">
          <span>
            Available <strong>{balanceData.liquidity.availableToSpendFormatted}</strong>
          </span>
          <span>
            Scheduled <strong>{balanceData.liquidity.scheduledAndReservedFormatted}</strong>
          </span>
        </div>
      </section>

      {completion.percent < 100 ? (
        <Link className="ov-complete" href="/business/profile">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Business profile {completion.percent}% complete</span>
            <span className="block text-xs opacity-80">
              Missing: {completion.missing.join(", ") || "none"}
            </span>
          </span>
          <span className="ov-complete-cta">
            Complete
            <ChevronRight className="h-4 w-4" />
          </span>
        </Link>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <nav aria-label="Business actions" className="ov-quick">
        {quickActions.map((action) => (
          <Link href={action.href} key={action.href}>
            <span className="ov-quick-icon">
              <action.icon className="h-5 w-5" />
            </span>
            {action.label}
          </Link>
        ))}
      </nav>

      {checkoutSummary ? <CheckoutOverviewCard summary={checkoutSummary} /> : null}

      <div className="ov-metrics">
        {metrics.map((metric) => {
          const body = (
            <>
              <span className="ov-metric-title">{metric.title}</span>
              <span className="ov-metric-value">{metric.valueFormatted}</span>
              <span className="ov-metric-sub">
                {metric.trend ? (
                  <em className={metric.trendPositive ? "is-up" : "is-down"}>{metric.trend}</em>
                ) : null}
                {metric.subtitle}
              </span>
            </>
          );
          return metric.href ? (
            <Link className="ov-metric is-link" href={metric.href} key={metric.id}>
              {body}
            </Link>
          ) : (
            <div className="ov-metric" key={metric.id}>
              {body}
            </div>
          );
        })}
      </div>

      <div className="ov-block">
        <CashFlowCard summariesByPeriod={cashFlowSummaries} />
      </div>

      <div className="ov-two">
        <div className="ov-block">
          <BusinessActivityCard activities={activities} />
        </div>
        <div className="ov-block">
          <BusinessInsightsCard insights={insights} />
        </div>
      </div>

      <div className="ov-two">
        <div className="ov-block">
          <InvoiceOverviewCard data={invoiceOverview} />
        </div>
        <div className="ov-block">
          <TeamPaymentsCard data={teamPayments} />
        </div>
      </div>

      <div className="ov-block">
        <BusinessHealthCard data={financialHealth} />
      </div>
    </div>
  );
}

function OverviewBar() {
  return (
    <header className="ov-bar">
      <Link aria-label="Back to the dashboard" className="ov-round" href="/dashboard">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <h1 className="ov-title">Overview</h1>
      <Link aria-label="Business profile" className="ov-round" href="/business/profile" title="Business profile">
        <Building2 className="h-5 w-5" />
      </Link>
    </header>
  );
}
