"use client";

import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpFromLine,
  Briefcase,
  FileText,
  PiggyBank,
  QrCode,
  Send,
  Store,
  TrendingUp,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { useOptionalAccount } from "@/components/account/account-provider";
import { useT } from "@/components/locale-provider";
import { checkoutEnabled } from "@/lib/checkout/flag";
import { rampEntryEnabled } from "@/lib/ramp/flag";
import { cn } from "@/lib/utils";

/**
 * Overview, Invoices, Request, Swap and Send are not in the sidebar. This
 * board is how you reach them.
 */
const actions: Array<{
  businessOnly?: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
}> = [
  { href: "/deposit", icon: ArrowDownToLine, label: "Deposit" },
  ...(rampEntryEnabled ? [{ href: "/withdraw", icon: ArrowUpFromLine, label: "Withdraw" }] : []),
  { href: "/send", icon: Send, label: "Send Payment" },
  { href: "/pay", icon: QrCode, label: "Request Payment" },
  { href: "/swap", icon: ArrowDownUp, label: "Swap" },
  { href: "/business", icon: Briefcase, label: "Overview", businessOnly: true },
  {
    href: "/business/invoices",
    icon: FileText,
    label: "Invoices",
    businessOnly: true,
  },
  ...(checkoutEnabled
    ? [{ businessOnly: true, href: "/business/checkout", icon: Store, label: "Checkout" }]
    : []),
  { href: "/circle", icon: UsersRound, label: "Circle" },
  { href: "/save", icon: PiggyBank, label: "Save" },
  { href: "/earn", icon: TrendingUp, label: "Invest" },
];

export function QuickActions({
  className,
}: {
  className?: string;
}) {
  const t = useT();
  const accountContext = useOptionalAccount();
  const hasBusinessAccess = Boolean(accountContext?.isBusiness);
  const visibleActions = actions.filter(
    (action) => !action.businessOnly || hasBusinessAccess,
  );
  const labels: Record<string, string> = {
    "/deposit": "Deposit",
    "/withdraw": "Withdraw",
    "/send": t("dashboard.sendPayment"),
    "/business": t("nav.overview"),
    "/business/invoices": t("nav.invoices"),
    "/business/checkout": t("nav.checkout"),
    "/circle": t("nav.circle"),
    "/save": t("nav.save"),
    "/earn": t("nav.earn"),
    "/pay": t("dashboard.requestPayment"),
    "/swap": t("nav.swap"),
  };

  return (
    <section
      aria-label="Services"
      className={cn("quick-actions-board", className)}
    >
      <p className="quick-actions-board-title">Services</p>

      <div className="quick-actions-grid">
        {visibleActions.map((action, index) => {
          const Icon = action.icon;
          return (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              key={action.href}
              transition={{ delay: index * 0.05, duration: 0.35 }}
            >
              <Link className="quick-action-card" href={action.href}>
                <Icon className="h-4 w-4" />
                <span>{labels[action.href] ?? action.label}</span>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}