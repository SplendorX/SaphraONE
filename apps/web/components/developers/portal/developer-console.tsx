"use client";

import {
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  Copy,
  Globe,
  KeyRound,
  LayoutDashboard,
  Loader2,
  ShieldAlert,
  Webhook,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";

import { useAccountContext } from "@/components/account/account-provider";
import { OnlinePaymentsPanel } from "@/components/checkout/online-payments-panel";
import { Badge } from "@/components/developers/docs/blocks";
import { DevelopersHub } from "@/components/developers/developers-hub";
import { PortalLink, usePortal } from "@/components/developers/portal/portal-context";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import type { MerchantAuth } from "@/lib/checkout/client";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";

const tabs = [
  { icon: LayoutDashboard, id: "overview", label: "Overview" },
  { icon: KeyRound, id: "keys", label: "API keys" },
  { icon: Globe, id: "payments", label: "Payments" },
  { icon: Webhook, id: "webhooks", label: "Webhooks" },
] as const;

type TabId = (typeof tabs)[number]["id"];

function appUrl(path: string) {
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ?? "";
  return `${app}${path}`;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy. Select and copy it instead.");
  }
}

/** The signed-in side of the portal: keys, payments and setup for this environment. */
export function DeveloperConsole() {
  return (
    <PlatformAccessGate>
      <ConsoleBody />
    </PlatformAccessGate>
  );
}

function ConsoleBody() {
  const params = useSearchParams();
  const requested = params?.get("tab");
  const tab: TabId = tabs.some((item) => item.id === requested) ? (requested as TabId) : "overview";
  const { apiBase, keyPrefix, mode } = usePortal();
  const {
    account,
    circleSocialUuid: accountSocialUuid,
    isBusiness,
    loading,
    ownerWallet,
    profile,
  } = useAccountContext();
  const { address, circleSocialUuid: walletSocialUuid } = usePlatformWallet();
  const wallet = (ownerWallet || address)?.toLowerCase() ?? null;
  const business = Boolean(isBusiness || account?.account_type === "BUSINESS");
  const auth = useMemo<MerchantAuth | null>(
    () =>
      wallet
        ? { circleSocialUuid: accountSocialUuid || walletSocialUuid || undefined, ownerWallet: wallet }
        : null,
    [accountSocialUuid, wallet, walletSocialUuid],
  );
  const verification = profile?.verification_status ?? "UNVERIFIED";

  return (
    <div className="dp-console">
      <header className="dp-console-head">
        <div>
          <p className="dp-eyebrow">Console · {mode === "live" ? "Live" : "Sandbox"}</p>
          <h1>{profile?.business_name || account?.display_name || "Developer console"}</h1>
        </div>
        <span className="dp-env-pill" data-mode={mode}>
          {mode === "live" ? "Live mode" : "Sandbox mode"}
        </span>
      </header>

      <nav aria-label="Console" className="dp-console-tabs">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <PortalLink
              aria-current={item.id === tab ? "page" : undefined}
              className={cn("dp-console-tab", item.id === tab && "dp-console-tab-active")}
              href={item.id === "overview" ? "/console" : `/console?tab=${item.id}`}
              key={item.id}
              scroll={false}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {item.label}
            </PortalLink>
          );
        })}
      </nav>

      {loading && !account ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !business ? (
        <section className="dp-panel">
          <h2>The Checkout API is for Business accounts</h2>
          <p className="dp-muted">
            Upgrade this SaphraONE account to Business to create API keys. Your personal balance and history stay as
            they are.
          </p>
          <a className="dp-btn dp-btn-primary" href={appUrl("/settings#account-type")}>
            Upgrade to Business <ArrowUpRight className="h-4 w-4" />
          </a>
        </section>
      ) : tab === "keys" ? (
        <div className="dp-console-embed">
          <DevelopersHub variant="portal" />
        </div>
      ) : tab === "payments" ? (
        <div className="dp-console-embed ck-page">
          <OnlinePaymentsPanel auth={auth} showDevelopersLink={false} />
        </div>
      ) : tab === "webhooks" ? (
        <section className="dp-panel">
          <h2>
            Webhooks <Badge tone="soon">In development</Badge>
          </h2>
          <p className="dp-muted">
            Signed notifications for completed, paid and expired sessions are coming. Until then, confirm payments by
            retrieving the session and run a short reconcile job.
          </p>
          <PortalLink className="dp-text-link" href="/docs/fulfil-orders#reconcile">
            How to reconcile <ArrowUpRight className="h-4 w-4" />
          </PortalLink>
        </section>
      ) : (
        <div className="dp-console-grid">
          <section className="dp-panel">
            <h2>Your setup</h2>
            <dl className="dp-kv">
              <div>
                <dt>API base URL</dt>
                <dd>
                  <code>{apiBase}</code>
                  <button aria-label="Copy base URL" className="dp-icon-button" onClick={() => void copy(apiBase, "Base URL")} type="button">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </dd>
              </div>
              <div>
                <dt>Key type</dt>
                <dd>
                  <code>{keyPrefix}…</code>
                </dd>
              </div>
              <div>
                <dt>Business wallet</dt>
                <dd>
                  <code className="dp-truncate">{wallet ?? "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Verification</dt>
                <dd>
                  {verification === "VERIFIED" ? (
                    <span className="dp-status" data-tone="ok">
                      <BadgeCheck className="h-3.5 w-3.5" /> Verified
                    </span>
                  ) : (
                    <span className="dp-status" data-tone="warn">
                      <ShieldAlert className="h-3.5 w-3.5" /> {verification === "PENDING" ? "In review" : "Not verified"}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            {mode === "live" && verification !== "VERIFIED" ? (
              <p className="dp-note">
                Live keys need a verified business.{" "}
                <a href={appUrl("/settings")}>Start verification in SaphraONE</a>. Meanwhile, build in the sandbox.
              </p>
            ) : null}
          </section>

          <section className="dp-panel">
            <h2>Next steps</h2>
            <ol className="dp-next-steps">
              <li>
                <PortalLink href="/console?tab=keys">Create a {mode === "live" ? "live" : "test"} secret key</PortalLink>
              </li>
              <li>
                <PortalLink href="/docs/quickstart">Create your first session</PortalLink>
              </li>
              <li>
                <PortalLink href="/docs/accept-a-payment">Wire it into your checkout</PortalLink>
              </li>
              <li>
                <PortalLink href={mode === "live" ? "/docs/fulfil-orders" : "/docs/going-live"}>
                  {mode === "live" ? "Fulfil orders reliably" : "Work through the go-live checklist"}
                </PortalLink>
              </li>
            </ol>
          </section>

          <section className="dp-panel dp-panel-wide">
            <h2>Resources</h2>
            <div className="dp-resource-row">
              <PortalLink className="dp-resource" href="/docs/api/checkout-sessions">
                <BookOpen className="h-4 w-4" /> Checkout Sessions reference
              </PortalLink>
              <PortalLink className="dp-resource" href="/docs/api/errors">
                <ShieldAlert className="h-4 w-4" /> Error codes
              </PortalLink>
              <a className="dp-resource" href="/openapi/checkout-v1.json">
                <Globe className="h-4 w-4" /> OpenAPI spec
              </a>
              <a className="dp-resource" href={appUrl("/business/checkout?tab=online")}>
                <ArrowUpRight className="h-4 w-4" /> Online payments in SaphraONE
              </a>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
