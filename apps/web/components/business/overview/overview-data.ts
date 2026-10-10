import { arcChain } from "@/lib/chains";
import type {
  BusinessBalanceData,
  BusinessMetricItem,
  CashFlowPeriod,
  CashFlowSummary,
  CashFlowDataPoint,
  BusinessActivityItem,
  BusinessInsightItemData,
  InvoiceOverviewData,
  InvoiceAttentionItem,
  TeamPaymentsData,
  BusinessFinancialHealthData,
} from "./types";
import type { InvoiceRecord, InvoiceSummary } from "@/lib/account/types";
import type { PayrollDashboardSummary } from "@/lib/payroll/types";
import type { WalletTransfer } from "@/lib/arcscan-history";

type BuildRealOverviewParams = {
  usdcBalance: number;
  eurcBalance: number;
  summary: InvoiceSummary | null;
  invoices: InvoiceRecord[];
  payrollSummary: PayrollDashboardSummary | null;
  transfers: WalletTransfer[];
  walletAddress?: string | null;
};

function formatCurrency(amount: number, prefix: string = "$"): string {
  return `${prefix}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function computeRealCashFlow(params: {
  transfers: WalletTransfer[];
  invoices: InvoiceRecord[];
  payrollSummary: PayrollDashboardSummary | null;
}): Record<CashFlowPeriod, CashFlowSummary> {
  const { transfers, invoices, payrollSummary } = params;

  // Flatten all real money movement events into a unified timestamped stream
  type FlowEvent = {
    amount: number;
    isIncoming: boolean;
    timestamp: number;
  };

  const events: FlowEvent[] = [];

  // 1. On-chain transfers
  for (const t of transfers) {
    const amt = parseFloat(t.amount);
    if (!isNaN(amt) && amt > 0) {
      const ts = t.timestamp ? new Date(t.timestamp).getTime() : Date.now();
      events.push({
        amount: amt,
        isIncoming: t.direction === "in",
        timestamp: ts,
      });
    }
  }

  // 2. Paid invoices (if not already captured on-chain)
  for (const inv of invoices) {
    if (inv.status === "PAID") {
      const amt = parseFloat(inv.total);
      if (!isNaN(amt) && amt > 0) {
        const ts = inv.paid_at
          ? new Date(inv.paid_at).getTime()
          : new Date(inv.created_at).getTime();
        events.push({
          amount: amt,
          isIncoming: true,
          timestamp: ts,
        });
      }
    }
  }

  // 3. Completed payroll runs
  if (payrollSummary?.recentRuns) {
    for (const run of payrollSummary.recentRuns) {
      if (run.status === "COMPLETED") {
        const amt = parseFloat(run.total_amount);
        if (!isNaN(amt) && amt > 0) {
          const ts = run.completed_at
            ? new Date(run.completed_at).getTime()
            : new Date(run.created_at).getTime();
          events.push({
            amount: amt,
            isIncoming: false,
            timestamp: ts,
          });
        }
      }
    }
  }

  const now = Date.now();

  const buildPeriod = (
    durationMs: number,
    numBuckets: number,
    formatLabel: (startTime: number, endTime: number, index: number) => string
  ): CashFlowSummary => {
    const periodStart = now - durationMs;
    const bucketDuration = durationMs / numBuckets;

    const relevantEvents = events.filter((e) => e.timestamp >= periodStart);

    let incomingTotal = 0;
    let outgoingTotal = 0;

    const points: CashFlowDataPoint[] = [];

    for (let i = 0; i < numBuckets; i++) {
      const bStart = periodStart + i * bucketDuration;
      const bEnd = bStart + bucketDuration;
      const label = formatLabel(bStart, bEnd, i);

      let bIncoming = 0;
      let bOutgoing = 0;

      for (const e of relevantEvents) {
        if (e.timestamp >= bStart && (i === numBuckets - 1 ? e.timestamp <= bEnd : e.timestamp < bEnd)) {
          if (e.isIncoming) {
            bIncoming += e.amount;
          } else {
            bOutgoing += e.amount;
          }
        }
      }

      incomingTotal += bIncoming;
      outgoingTotal += bOutgoing;

      points.push({
        label,
        incoming: Math.round(bIncoming * 100) / 100,
        outgoing: Math.round(bOutgoing * 100) / 100,
        net: Math.round((bIncoming - bOutgoing) * 100) / 100,
      });
    }

    const netFlow = incomingTotal - outgoingTotal;

    return {
      incomingTotal: Math.round(incomingTotal * 100) / 100,
      incomingTotalFormatted: formatCurrency(incomingTotal),
      outgoingTotal: Math.round(outgoingTotal * 100) / 100,
      outgoingTotalFormatted: formatCurrency(outgoingTotal),
      netFlow: Math.round(netFlow * 100) / 100,
      netFlowFormatted: formatCurrency(netFlow),
      points,
    };
  };

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    "7D": buildPeriod(7 * 24 * 60 * 60 * 1000, 7, (bStart) => {
      const d = new Date(bStart);
      return dayNames[d.getDay()];
    }),
    "30D": buildPeriod(30 * 24 * 60 * 60 * 1000, 5, (bStart) => {
      const d = new Date(bStart);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }),
    "3M": buildPeriod(90 * 24 * 60 * 60 * 1000, 3, (bStart) => {
      const d = new Date(bStart);
      return d.toLocaleDateString(undefined, { month: "short" });
    }),
    "1Y": buildPeriod(365 * 24 * 60 * 60 * 1000, 4, (_bStart, _bEnd, i) => {
      return `Q${i + 1}`;
    }),
  };
}

export function buildRealOverviewData(params: BuildRealOverviewParams) {
  const {
    usdcBalance,
    eurcBalance,
    summary,
    invoices,
    payrollSummary,
    transfers,
  } = params;

  // 1. Total Balance & Liquidity
  const totalBalance = usdcBalance + eurcBalance;
  const scheduledPayrollAmount = payrollSummary?.nextPayrollAmount
    ? parseFloat(payrollSummary.nextPayrollAmount) || 0
    : 0;

  const availableToSpend = Math.max(0, totalBalance - scheduledPayrollAmount);
  const scheduledAndReserved = scheduledPayrollAmount;

  // Trend: calculate net flow over past 30 days vs starting balance
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let net30d = 0;
  for (const t of transfers) {
    const ts = t.timestamp ? new Date(t.timestamp).getTime() : 0;
    if (ts >= thirtyDaysAgo) {
      const amt = parseFloat(t.amount) || 0;
      net30d += t.direction === "in" ? amt : -amt;
    }
  }

  const previousBalance = Math.max(0, totalBalance - net30d);
  const trendPercentage =
    previousBalance > 0
      ? Math.round(Math.abs((net30d / previousBalance) * 100) * 10) / 10
      : net30d > 0
      ? 100
      : 0;

  const trendDirection: "up" | "down" | "flat" =
    net30d > 0.001 ? "up" : net30d < -0.001 ? "down" : "flat";

  const balanceData: BusinessBalanceData = {
    totalBalance,
    totalBalanceFormatted: formatCurrency(totalBalance),
    trendPercentage,
    trendDirection,
    assets: [
      {
        name: "USD Coin",
        symbol: "USDC",
        balance: usdcBalance,
        formatted: formatCurrency(usdcBalance),
      },
      {
        name: "Euro Coin",
        symbol: "EURC",
        balance: eurcBalance,
        formatted: formatCurrency(eurcBalance, "€"),
      },
    ],
    liquidity: {
      availableToSpend,
      availableToSpendFormatted: formatCurrency(availableToSpend),
      scheduledAndReserved,
      scheduledAndReservedFormatted: formatCurrency(scheduledAndReserved),
    },
  };

  // 2. Metrics Grid
  // Real revenue received: paid invoices + incoming transfers
  let incomingTransfersTotal = 0;
  let incomingTransfersCount = 0;
  let outgoingTransfersTotal = 0;
  let outgoingTransfersCount = 0;

  for (const t of transfers) {
    const amt = parseFloat(t.amount) || 0;
    if (t.direction === "in") {
      incomingTransfersTotal += amt;
      incomingTransfersCount++;
    } else {
      outgoingTransfersTotal += amt;
      outgoingTransfersCount++;
    }
  }

  const realRevenue = (summary?.paid ?? 0) + incomingTransfersTotal;
  const paidInvoiceCount = invoices.filter((i) => i.status === "PAID").length;
  const totalRevenueEvents = paidInvoiceCount + incomingTransfersCount;

  // Real payments sent: outgoing transfers + executed payroll runs
  let completedPayrollTotal = 0;
  let completedPayrollCount = 0;
  if (payrollSummary?.recentRuns) {
    for (const run of payrollSummary.recentRuns) {
      if (run.status === "COMPLETED") {
        completedPayrollTotal += parseFloat(run.total_amount) || 0;
        completedPayrollCount++;
      }
    }
  }

  const totalPaymentsSent = outgoingTransfersTotal + completedPayrollTotal;
  const totalSentCount = outgoingTransfersCount + completedPayrollCount;

  // Real outstanding invoices
  const outstandingAmount = (summary?.pending ?? 0) + (summary?.overdue ?? 0);
  const outstandingInvoicesList = invoices.filter(
    (i) => i.status === "PENDING" || i.status === "OVERDUE"
  );
  const outstandingCount = outstandingInvoicesList.length;

  const metrics: BusinessMetricItem[] = [
    {
      id: "revenue",
      title: "Revenue Received",
      valueFormatted: formatCurrency(realRevenue),
      subtitle: `${totalRevenueEvents} settlement${totalRevenueEvents === 1 ? "" : "s"} received`,
      trend: trendPercentage > 0 ? `${trendPercentage}%` : undefined,
      trendPositive: trendDirection === "up",
    },
    {
      id: "payments_sent",
      title: "Payments Sent",
      valueFormatted: formatCurrency(totalPaymentsSent),
      subtitle: `${totalSentCount} payment${totalSentCount === 1 ? "" : "s"} sent`,
    },
    {
      id: "outstanding_invoices",
      title: "Outstanding Invoices",
      valueFormatted: formatCurrency(outstandingAmount),
      subtitle: `${outstandingCount} awaiting payment`,
      href: "/business/invoices",
    },
    {
      id: "scheduled_payments",
      title: "Scheduled Payments",
      valueFormatted: formatCurrency(scheduledPayrollAmount),
      subtitle:
        scheduledPayrollAmount > 0
          ? `${payrollSummary?.activeTeamMembersCount ?? 0} recipients scheduled`
          : "No payments scheduled",
      href: "/business/payroll",
    },
  ];

  // 3. Real Business Activity (Merged and timestamp-sorted)
  type UnifiedActivity = BusinessActivityItem & { rawTimestamp: number };
  const rawActivities: UnifiedActivity[] = [];

  // A. Real Invoices
  for (const inv of invoices) {
    const amt = parseFloat(inv.total) || 0;
    const isPaid = inv.status === "PAID";
    const ts = inv.paid_at
      ? new Date(inv.paid_at).getTime()
      : new Date(inv.created_at).getTime();

    rawActivities.push({
      id: `inv-${inv.id}`,
      title: inv.customer_name || inv.customer_company || `Customer Invoice`,
      description: `Invoice #${inv.invoice_number} · ${inv.status.toLowerCase()}`,
      amountFormatted: `${formatCurrency(amt, inv.currency === "EURC" ? "€" : "$")} ${inv.currency}`,
      isIncoming: true,
      status: isPaid ? "Completed" : inv.status === "OVERDUE" ? "Failed" : "Pending",
      dateFormatted: formatActivityDate(ts),
      category: "invoice",
      rawTimestamp: ts,
    });
  }

  // B. Real On-chain Transfers
  for (const t of transfers) {
    const amt = parseFloat(t.amount) || 0;
    const ts = t.timestamp ? new Date(t.timestamp).getTime() : Date.now();
    const shortAddress = `${t.counterparty.slice(0, 6)}…${t.counterparty.slice(-4)}`;

    rawActivities.push({
      id: `tx-${t.hash}-${t.logIndex}`,
      title: t.direction === "in" ? `Received from ${shortAddress}` : `Payment to ${shortAddress}`,
      description: t.method ? `${t.method} on ${arcChain.name}` : `Transfer (${t.symbol})`,
      amountFormatted: `${formatCurrency(amt, t.symbol === "EURC" ? "€" : "$")} ${t.symbol}`,
      isIncoming: t.direction === "in",
      status: "Completed",
      dateFormatted: formatActivityDate(ts),
      category: t.direction === "in" ? "transfer" : "vendor",
      txHash: t.hash,
      counterparty: t.counterparty,
      rawTimestamp: ts,
    });
  }

  // C. Real Payroll Runs
  if (payrollSummary?.recentRuns) {
    for (const run of payrollSummary.recentRuns) {
      const amt = parseFloat(run.total_amount) || 0;
      const ts = run.completed_at
        ? new Date(run.completed_at).getTime()
        : new Date(run.created_at).getTime();

      rawActivities.push({
        id: `payroll-${run.id}`,
        title: run.name,
        description: `Team Payroll (${run.recipient_count} recipient${run.recipient_count === 1 ? "" : "s"})`,
        amountFormatted: `${formatCurrency(amt, "$")} ${run.asset}`,
        isIncoming: false,
        status:
          run.status === "COMPLETED"
            ? "Completed"
            : run.status === "FAILED"
            ? "Failed"
            : "Pending",
        dateFormatted: formatActivityDate(ts),
        category: "payroll",
        rawTimestamp: ts,
      });
    }
  }

  // Sort descending by timestamp
  rawActivities.sort((a, b) => b.rawTimestamp - a.rawTimestamp);
  const activities: BusinessActivityItem[] = rawActivities.slice(0, 8);

  // 4. Real Business Insights
  const insights: BusinessInsightItemData[] = [];

  // Insight A: Cash flow & revenue performance
  if (realRevenue > 0) {
    insights.push({
      id: "ins-revenue",
      title: "Revenue Inflow Active",
      description: `Your business has received ${formatCurrency(realRevenue)} in settled revenue across invoices and incoming transfers.`,
      type: "growth",
    });
  } else {
    insights.push({
      id: "ins-revenue-start",
      title: "Awaiting First Settlement",
      description:
        "No incoming payments received yet. Issue invoices or share your payment address to start receiving funds.",
      type: "growth",
      href: "/business/invoices",
    });
  }

  // Insight B: Invoices attention
  const overdueInvoices = invoices.filter((i) => i.status === "OVERDUE");
  if (overdueInvoices.length > 0) {
    const overdueSum = overdueInvoices.reduce(
      (acc, curr) => acc + (parseFloat(curr.total) || 0),
      0
    );
    insights.push({
      id: "ins-overdue",
      title: "Invoice Attention",
      description: `${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? "" : "s"} totaling ${formatCurrency(overdueSum)} are past their scheduled due date.`,
      type: "attention",
      href: "/business/invoices",
    });
  } else if (outstandingCount > 0) {
    insights.push({
      id: "ins-pending",
      title: "Invoices Pending",
      description: `${outstandingCount} invoice${outstandingCount === 1 ? "" : "s"} totaling ${formatCurrency(outstandingAmount)} are awaiting client settlement.`,
      type: "attention",
      href: "/business/invoices",
    });
  } else {
    insights.push({
      id: "ins-invoices-healthy",
      title: "Invoices Current",
      description: "All issued customer invoices are settled and up to date.",
      type: "growth",
      href: "/business/invoices",
    });
  }

  // Insight C: Upcoming Payroll
  if (payrollSummary?.upcomingRun || scheduledPayrollAmount > 0) {
    insights.push({
      id: "ins-payroll-due",
      title: "Upcoming Payroll",
      description: `Scheduled team payroll of ${formatCurrency(scheduledPayrollAmount)} is queued for execution${payrollSummary?.nextPayrollDate ? ` on ${new Date(payrollSummary.nextPayrollDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}.`,
      type: "upcoming",
      href: "/business/payroll",
    });
  } else if ((payrollSummary?.activeTeamMembersCount ?? 0) > 0) {
    insights.push({
      id: "ins-payroll-ready",
      title: "Team Configured",
      description: `${payrollSummary?.activeTeamMembersCount} active team member${payrollSummary?.activeTeamMembersCount === 1 ? "" : "s"} enrolled. Schedule your next payroll run to automate disbursements.`,
      type: "upcoming",
      href: "/business/payroll",
    });
  } else {
    insights.push({
      id: "ins-payroll-setup",
      title: "Team Payroll",
      description: "Add contractors and team members to automate recurring multi-currency payroll.",
      type: "upcoming",
      href: "/business/payroll",
    });
  }

  // 5. Real Invoices Overview
  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);

  const paidThisMonthInvoices = invoices.filter((i) => {
    if (i.status !== "PAID") return false;
    const paidDate = i.paid_at ? new Date(i.paid_at) : new Date(i.created_at);
    return paidDate.getTime() >= thisMonthStart.getTime();
  });

  const paidThisMonthTotal = paidThisMonthInvoices.reduce(
    (acc, curr) => acc + (parseFloat(curr.total) || 0),
    0
  );

  const attentionInvoices = invoices
    .filter((i) => i.status === "OVERDUE" || i.status === "PENDING")
    .slice(0, 5)
    .map((inv): InvoiceAttentionItem => {
      const isOverdue = inv.status === "OVERDUE";
      let dueLabel = "Due soon";
      if (inv.due_date) {
        const dueDate = new Date(inv.due_date);
        const diffDays = Math.round(
          (dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        if (diffDays < 0) {
          dueLabel = `Overdue ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"}`;
        } else if (diffDays === 0) {
          dueLabel = "Due today";
        } else if (diffDays === 1) {
          dueLabel = "Due tomorrow";
        } else {
          dueLabel = `Due in ${diffDays} days`;
        }
      }

      return {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        clientName: inv.customer_name || inv.customer_company || "Customer",
        amountFormatted: `${formatCurrency(parseFloat(inv.total) || 0, inv.currency === "EURC" ? "€" : "$")} ${inv.currency}`,
        dueLabel,
        isUrgent: isOverdue,
        href: `/business/invoices`,
      };
    });

  const invoiceOverview: InvoiceOverviewData = {
    outstandingTotal: outstandingAmount,
    outstandingFormatted: formatCurrency(outstandingAmount),
    outstandingCount,
    paidThisMonthTotal,
    paidThisMonthFormatted: formatCurrency(paidThisMonthTotal),
    paidThisMonthCount: paidThisMonthInvoices.length,
    attentionItems: attentionInvoices,
  };

  // 6. Real Team Payments
  const teamPayments: TeamPaymentsData = {
    nextPayrollDateFormatted: payrollSummary?.nextPayrollDate
      ? new Date(payrollSummary.nextPayrollDate).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "None scheduled",
    teamMembersCount: payrollSummary?.activeTeamMembersCount ?? 0,
    scheduledAmountFormatted: scheduledPayrollAmount > 0
      ? `${formatCurrency(scheduledPayrollAmount)} USDC`
      : "$0.00 USDC",
  };

  // 7. Real Business Financial Health
  const totalInvoicesCount = invoices.length;
  const collectionRate =
    totalInvoicesCount > 0
      ? Math.round((paidInvoiceCount / totalInvoicesCount) * 100)
      : null;

  const totalActivityCount = rawActivities.length;

  const financialHealth: BusinessFinancialHealthData = {
    indicators: [
      {
        id: "health-cash",
        label: "Cash Position",
        status: totalBalance > 0 ? "Healthy" : "Setup Needed",
        statusCount: formatCurrency(totalBalance),
        description:
          totalBalance > 0
            ? `Available liquidity of ${formatCurrency(availableToSpend)} ready for operating expenses and payroll.`
            : "No token balances detected in active wallet. Connect or deposit funds to start operating.",
        tone: totalBalance > 0 ? "positive" : "neutral",
      },
      {
        id: "health-activity",
        label: "Payment Activity",
        status: totalActivityCount > 10 ? "Active" : totalActivityCount > 0 ? "Stable" : "New Account",
        statusCount: `${totalActivityCount} Events`,
        description:
          totalActivityCount > 0
            ? `${totalActivityCount} transaction${totalActivityCount === 1 ? "" : "s"} and settlements recorded on ${arcChain.name}.`
            : "No transaction history recorded yet on this business account.",
        tone: totalActivityCount > 0 ? "positive" : "neutral",
      },
      {
        id: "health-collection",
        label: "Invoice Collection",
        status:
          collectionRate !== null
            ? collectionRate >= 75
              ? "Good"
              : "Attention"
            : "No Invoices",
        statusCount: collectionRate !== null ? `${collectionRate}% Settled` : "0%",
        description:
          totalInvoicesCount > 0
            ? `${paidInvoiceCount} of ${totalInvoicesCount} invoices settled (${formatCurrency(summary?.paid ?? 0)} collected).`
            : "Create and issue invoices to clients to track real collection metrics.",
        tone:
          collectionRate !== null && collectionRate >= 75
            ? "positive"
            : overdueInvoices.length > 0
            ? "warning"
            : "neutral",
      },
      {
        id: "health-obligations",
        label: "Upcoming Obligations",
        status: scheduledPayrollAmount > 0 ? "Scheduled" : "0 Due",
        statusCount: formatCurrency(scheduledPayrollAmount),
        description:
          scheduledPayrollAmount > 0
            ? `${formatCurrency(scheduledPayrollAmount)} reserved for upcoming automated payroll disbursement.`
            : "No upcoming automated payment obligations queued.",
        tone: "neutral",
      },
    ],
  };

  return {
    balanceData,
    metrics,
    activities,
    insights,
    invoiceOverview,
    teamPayments,
    financialHealth,
  };
}

function formatActivityDate(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) {
    return "Just now";
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
