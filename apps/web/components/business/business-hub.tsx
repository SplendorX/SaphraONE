"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Check,
  Loader2,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useWorkspace } from "@/components/business/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UsernameField } from "@/components/username-field";
import {
  createBusinessPayment,
  createBusinessRequest,
  decideBusinessPayment,
  fetchBusinessRequests,
  fetchWorkspaceDetail,
  updateBusinessProfileClient,
  updateBusinessSettingsClient,
} from "@/lib/business/client";
import { formatUsd, greetingForHour } from "@/lib/business/money";
import { hasPermission } from "@/lib/business/permissions";
import type {
  BusinessAsset,
  BusinessPaymentRecord,
  BusinessPaymentRequestRecord,
  BusinessPermission,
  BusinessProfileRecord,
  WorkspaceSettingsRecord,
} from "@/lib/business/types";
import { cn } from "@/lib/utils";

type Tab =
  | "overview"
  | "payments"
  | "send"
  | "request"
  | "profile"
  | "settings"
  | "approvals";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "payments", label: "Payments" },
  { id: "send", label: "Send" },
  { id: "request", label: "Request" },
  { id: "approvals", label: "Approvals" },
  { id: "profile", label: "Profile" },
  { id: "settings", label: "Settings" },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function statusLabel(payment: BusinessPaymentRecord) {
  if (payment.approval_status === "PENDING_APPROVAL") return "Needs approval";
  if (payment.approval_status === "PARTIALLY_APPROVED") return "Partially approved";
  if (payment.approval_status === "REJECTED") return "Rejected";
  if (payment.transaction_status === "AUTHORIZATION_REQUIRED") return "Authorization required";
  if (payment.transaction_status === "SUBMITTED") return "Processing";
  if (payment.transaction_status === "COMPLETED") return "Completed";
  if (payment.transaction_status === "FAILED") return "Failed";
  if (payment.transaction_status === "CANCELLED") return "Cancelled";
  return payment.transaction_status;
}

export function BusinessHub() {
  const { circleSocialUuid, loading: workspaceLoading, ownerWallet, profile, workspace, workspaces } =
    useWorkspace();
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof fetchWorkspaceDetail>
  > | null>(null);
  const [hideBalances, setHideBalances] = useState(false);

  const load = useCallback(async () => {
    if (!ownerWallet || !workspace || workspace.kind !== "business") return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchWorkspaceDetail(
        ownerWallet,
        workspace.id,
        circleSocialUuid,
      );
      setDetail(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [circleSocialUuid, ownerWallet, workspace]);

  useEffect(() => {
    void load();
  }, [load, range]);

  useEffect(() => {
    setHideBalances(localStorage.getItem("saphra.hideBalances") === "1");
  }, []);

  const can = useCallback(
    (permission: BusinessPermission) => {
      if (!detail?.member) return false;
      return hasPermission(detail.member.role, permission);
    },
    [detail],
  );

  if (workspaceLoading) {
    return (
      <div className="section-panel p-8 text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  if (!workspace || workspace.kind !== "business") {
    const personal = workspaces.find((item) => item.kind === "individual");
    return (
      <div className="section-panel p-8">
        <h2 className="font-heading text-2xl">Create a business workspace</h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Keep personal and business money in separate contexts. You can create a
          business without leaving your personal account.
        </p>
        <div className="mt-6 flex gap-3">
          <Button asChild>
            <Link href="/onboarding">Create a business</Link>
          </Button>
          {personal ? (
            <Button asChild variant="outline">
              <Link href="/dashboard">Go to personal dashboard</Link>
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const name = profile?.display_name?.split(" ")[0] ?? "there";
  const greeting = greetingForHour(new Date().getHours(), name);
  const money = detail?.analytics;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{greeting}</p>
          <h2 className="font-heading text-3xl">{workspace.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace.username ? `@${workspace.username}` : "Business workspace"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/send">Send</Link>
          </Button>
          <Button onClick={() => setTab("request")} variant="outline">
            Request
          </Button>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map((item) => (
          <button
            className={cn(
              "rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition",
              tab === item.id
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            key={item.id}
            onClick={() => setTab(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium">Couldn’t load this workspace</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <button className="mt-2 text-sm underline" onClick={() => void load()} type="button">
            View details / retry
          </button>
        </div>
      ) : null}

      {tab === "overview" ? (
        <OverviewPanel
          hideBalances={hideBalances}
          loading={loading}
          money={money}
          onHide={() => {
            const next = !hideBalances;
            setHideBalances(next);
            localStorage.setItem("saphra.hideBalances", next ? "1" : "0");
          }}
          onRange={setRange}
          onTab={setTab}
          payments={detail?.payments ?? []}
          range={range}
          workspaceName={workspace.name}
        />
      ) : null}

      {tab === "payments" || tab === "approvals" ? (
        <PaymentsPanel
          canApprove={can("payments.approve")}
          circleSocialUuid={circleSocialUuid}
          needsApprovalOnly={tab === "approvals"}
          onChanged={() => void load()}
          ownerWallet={ownerWallet}
          payments={detail?.payments ?? []}
          workspaceId={workspace.id}
        />
      ) : null}

      {tab === "send" ? (
        <SendPanel
          canCreate={can("payments.create")}
          circleSocialUuid={circleSocialUuid}
          ownerWallet={ownerWallet}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
        />
      ) : null}

      {tab === "request" ? (
        <RequestPanel
          canCreate={can("requests.create")}
          circleSocialUuid={circleSocialUuid}
          ownerWallet={ownerWallet}
          username={workspace.username}
          workspaceId={workspace.id}
        />
      ) : null}

      {tab === "profile" ? (
        <ProfilePanel
          canEdit={can("profile.edit")}
          circleSocialUuid={circleSocialUuid}
          ownerWallet={ownerWallet}
          profile={detail?.profile ?? null}
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          workspaceUsername={workspace.username}
        />
      ) : null}

      {tab === "settings" ? (
        <SettingsPanel
          canManage={can("settings.manage")}
          circleSocialUuid={circleSocialUuid}
          ownerWallet={ownerWallet}
          settings={detail?.settings ?? null}
          workspaceId={workspace.id}
        />
      ) : null}
    </div>
  );
}

function OverviewPanel({
  hideBalances,
  loading,
  money,
  onHide,
  onRange,
  onTab,
  payments,
  range,
  workspaceName,
}: {
  hideBalances: boolean;
  loading: boolean;
  money?: {
    moneyReceived: number;
    moneySent: number;
    netFlow: number;
    transactionCount: number;
  };
  onHide: () => void;
  onRange: (value: number) => void;
  onTab: (tab: Tab) => void;
  payments: BusinessPaymentRecord[];
  range: number;
  workspaceName: string;
}) {
  const recent = payments.slice(0, 6);
  return (
    <div className="space-y-6">
      <section className="section-panel p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Business balance</p>
            {loading ? (
              <p className="mt-3 text-muted-foreground">Loading balance…</p>
            ) : (
              <p className="biz-balance mt-2">
                {hideBalances ? "••••••" : formatUsd(money?.netFlow ?? 0)}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Net activity · last {range} days · {workspaceName}
            </p>
          </div>
          <Button onClick={onHide} size="sm" variant="ghost">
            {hideBalances ? "Show" : "Hide"} balances
          </Button>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-4">
          {[
            ["Received", money?.moneyReceived ?? 0],
            ["Sent", money?.moneySent ?? 0],
            ["Net flow", money?.netFlow ?? 0],
            ["Payments", money?.transactionCount ?? 0],
          ].map(([label, value]) => (
            <div className="rounded-2xl border border-border px-4 py-3" key={String(label)}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-medium">
                {loading
                  ? "—"
                  : hideBalances && label !== "Payments"
                    ? "••••"
                    : label === "Payments"
                      ? value
                      : formatUsd(Number(value))}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          {[7, 30, 90, 365].map((item) => (
            <button
              className={cn(
                "rounded-full px-3 py-1 text-xs",
                range === item ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
              key={item}
              onClick={() => onRange(item)}
              type="button"
            >
              {item === 365 ? "1Y" : `${item}D`}
            </button>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/send">
              <Send className="h-4 w-4" /> Send money
            </Link>
          </Button>
          <Button onClick={() => onTab("request")} variant="outline">
            Request payment
          </Button>
          <Button onClick={() => onTab("payments")} variant="outline">
            View transactions
          </Button>
        </div>
      </section>

      <section className="section-panel p-6">
        <h3 className="font-heading text-lg">Recent activity</h3>
        {recent.length === 0 ? (
          <div className="py-10 text-center">
            <p className="font-medium">Your business activity will appear here</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Once you send or receive your first payment, you’ll see it here.
            </p>
            <Button className="mt-4" onClick={() => onTab("send")}>
              Make a payment
            </Button>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {recent.map((item) => (
              <li className="flex items-center justify-between gap-3 py-3" key={item.id}>
                <div className="flex items-center gap-3">
                  {item.direction === "incoming" ? (
                    <ArrowDownLeft className="h-4 w-4 text-success" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {item.direction === "incoming" ? "Payment received" : "Payment sent"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.counterparty_name || item.counterparty_username || "Counterparty"} ·{" "}
                      {statusLabel(item)}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-medium">
                  {item.direction === "incoming" ? "+" : "−"}
                  {hideBalances ? "••••" : formatUsd(item.amount_display)} {item.asset}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PaymentsPanel({
  canApprove,
  circleSocialUuid,
  needsApprovalOnly,
  onChanged,
  ownerWallet,
  payments,
  workspaceId,
}: {
  canApprove: boolean;
  circleSocialUuid?: string;
  needsApprovalOnly: boolean;
  onChanged: () => void;
  ownerWallet: string | null;
  payments: BusinessPaymentRecord[];
  workspaceId: string;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = payments.filter((item) => {
    if (needsApprovalOnly) {
      return (
        item.approval_status === "PENDING_APPROVAL" ||
        item.approval_status === "PARTIALLY_APPROVED"
      );
    }
    if (!query.trim()) return true;
    const hay = [
      item.counterparty_name,
      item.counterparty_username,
      item.memo,
      item.asset,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(query.trim().toLowerCase());
  });

  async function decide(id: string, decision: "approved" | "rejected") {
    if (!ownerWallet) return;
    setBusyId(id);
    setError(null);
    try {
      await decideBusinessPayment(
        ownerWallet,
        workspaceId,
        id,
        decision,
        circleSocialUuid,
      );
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="section-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-heading text-lg">
          {needsApprovalOnly ? "Approvals" : "Payments"}
        </h3>
        {!needsApprovalOnly ? (
          <Input
            className="max-w-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search transactions..."
            value={query}
          />
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {needsApprovalOnly
            ? "Nothing needs your approval."
            : "No payments match this view."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((item) => (
            <li className="flex flex-wrap items-center justify-between gap-3 py-4" key={item.id}>
              <div>
                <p className="text-sm font-medium">
                  {item.direction === "outgoing" ? "To" : "From"}{" "}
                  {item.counterparty_username
                    ? `@${item.counterparty_username}`
                    : item.counterparty_name || "recipient"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {statusLabel(item)} · {item.asset} · {item.network.toUpperCase()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium">
                  {formatUsd(item.amount_display)} {item.asset}
                </p>
                {canApprove &&
                (item.approval_status === "PENDING_APPROVAL" ||
                  item.approval_status === "PARTIALLY_APPROVED") ? (
                  <>
                    <Button
                      disabled={busyId === item.id}
                      onClick={() => void decide(item.id, "rejected")}
                      size="sm"
                      variant="outline"
                    >
                      Reject
                    </Button>
                    <Button
                      disabled={busyId === item.id}
                      onClick={() => void decide(item.id, "approved")}
                      size="sm"
                    >
                      Approve
                    </Button>
                  </>
                ) : null}
                {item.transaction_status === "AUTHORIZATION_REQUIRED" && ownerWallet ? (
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/send?to=${encodeURIComponent(
                        item.counterparty_username
                          ? `@${item.counterparty_username}`
                          : item.counterparty_wallet ?? "",
                      )}&amount=${encodeURIComponent(item.amount_display)}&token=${item.asset}&businessPayment=${item.id}&workspace=${workspaceId}`}
                    >
                      Send from business
                    </Link>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SendPanel({
  canCreate,
  circleSocialUuid,
  ownerWallet,
  workspaceId,
  workspaceName,
}: {
  canCreate: boolean;
  circleSocialUuid?: string;
  ownerWallet: string | null;
  workspaceId: string;
  workspaceName: string;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<BusinessAsset>("USDC");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<BusinessPaymentRecord | null>(null);

  async function submit() {
    if (!ownerWallet) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createBusinessPayment(
        ownerWallet,
        workspaceId,
        { amount, asset, memo, recipient },
        circleSocialUuid,
      );
      setPayment(result.payment);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) {
    return (
      <p className="section-panel p-6 text-sm text-muted-foreground">
        You don’t have permission to send from this business.
      </p>
    );
  }

  return (
    <section className="section-panel max-w-xl p-6">
      <h3 className="font-heading text-lg">Send money</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Payments leave {workspaceName} from its own Circle SCA wallet. Use the
        same Send flow as personal — the workspace switcher keeps you on this
        business identity.
      </p>
      <Button asChild className="mt-4">
        <Link href="/send">Send with the business wallet</Link>
      </Button>
      <div className="mt-6 block text-sm font-medium">
        <span className="mb-2 block">Recipient</span>
        <UsernameField allowAddress id="business-recipient" onChange={setRecipient} value={recipient} />
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
        <label className="text-sm font-medium">
          Amount
          <Input
            className="mt-2"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            value={amount}
          />
        </label>
        <label className="text-sm font-medium">
          Asset
          <select
            className="mt-2 h-9 rounded-lg border border-input bg-background px-2 text-sm"
            onChange={(event) => setAsset(event.target.value as BusinessAsset)}
            value={asset}
          >
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </label>
      </div>
      <label className="mt-4 block text-sm font-medium">
        Memo
        <Input
          className="mt-2"
          onChange={(event) => setMemo(event.target.value)}
          placeholder="Optional"
          value={memo}
        />
      </label>
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {payment ? (
        <div className="mt-4 rounded-2xl border border-border px-4 py-3 text-sm">
          <p className="font-medium">
            {payment.approval_status === "PENDING_APPROVAL"
              ? "Approval requested"
              : "Ready to authorize"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {formatUsd(payment.amount_display)} {payment.asset} · {statusLabel(payment)}
          </p>
          {payment.transaction_status === "AUTHORIZATION_REQUIRED" ||
          payment.approval_status === "NOT_REQUIRED" ? (
            <Button asChild className="mt-3">
              <Link
                href={`/send?to=${encodeURIComponent(recipient)}&amount=${encodeURIComponent(amount)}&token=${asset}&businessPayment=${payment.id}&workspace=${workspaceId}`}
              >
                Continue on Send
              </Link>
            </Button>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Approvers can release this from Overview, then send from the business wallet.
            </p>
          )}
        </div>
      ) : null}
      <Button className="mt-6" disabled={busy || !recipient || !amount} onClick={() => void submit()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? "Creating" : "Review payment"}
      </Button>
    </section>
  );
}

function RequestPanel({
  canCreate,
  circleSocialUuid,
  ownerWallet,
  username,
  workspaceId,
}: {
  canCreate: boolean;
  circleSocialUuid?: string;
  ownerWallet: string | null;
  username: string | null;
  workspaceId: string;
}) {
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState<BusinessAsset>("USDC");
  const [memo, setMemo] = useState("");
  const [created, setCreated] = useState<BusinessPaymentRequestRecord | null>(null);
  const [requests, setRequests] = useState<BusinessPaymentRequestRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ownerWallet) return;
    void fetchBusinessRequests(ownerWallet, workspaceId, circleSocialUuid)
      .then((payload) => setRequests(payload.requests))
      .catch(() => undefined);
  }, [circleSocialUuid, ownerWallet, workspaceId]);

  async function submit() {
    if (!ownerWallet) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createBusinessRequest(
        ownerWallet,
        workspaceId,
        { amount, asset, memo },
        circleSocialUuid,
      );
      setCreated(result.request);
      setRequests((current) => [result.request, ...current]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const sharePath = created
    ? `/u/${username ?? "pay"}?request=${created.id}`
    : username
      ? `/u/${username}`
      : "/pay";

  return (
    <section className="section-panel max-w-xl p-6">
      <h3 className="font-heading text-lg">Request payment</h3>
      {!canCreate ? (
        <p className="mt-3 text-sm text-muted-foreground">
          You can view requests, but creating them needs extra permission.
        </p>
      ) : (
        <>
          <label className="mt-6 block text-sm font-medium">
            Amount
            <Input
              className="mt-2"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="1250"
              value={amount}
            />
          </label>
          <div className="mt-4 flex gap-3">
            <select
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
              onChange={(event) => setAsset(event.target.value as BusinessAsset)}
              value={asset}
            >
              <option value="USDC">USDC</option>
              <option value="EURC">EURC</option>
            </select>
            <Input
              onChange={(event) => setMemo(event.target.value)}
              placeholder="Website development"
              value={memo}
            />
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          <Button className="mt-5" disabled={busy} onClick={() => void submit()}>
            Create request
          </Button>
        </>
      )}
      {created ? (
        <div className="mt-5 rounded-2xl border border-border px-4 py-3 text-sm">
          <p className="font-medium">Payment request created</p>
          <p className="mt-1 text-muted-foreground">
            {created.amount_display} {created.asset}
            {username ? ` · Pay @${username}` : ""}
          </p>
          <Button asChild className="mt-3" variant="outline">
            <Link href={sharePath}>Share</Link>
          </Button>
        </div>
      ) : null}
      <ul className="mt-6 space-y-2 text-sm">
        {requests.map((item) => (
          <li className="rounded-xl border border-border px-3 py-2" key={item.id}>
            {item.amount_display ?? "Open amount"} {item.asset} · {item.status}
            {item.memo ? ` · ${item.memo}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfilePanel({
  canEdit,
  circleSocialUuid,
  ownerWallet,
  profile,
  workspaceId,
  workspaceName,
  workspaceUsername,
}: {
  canEdit: boolean;
  circleSocialUuid?: string;
  ownerWallet: string | null;
  profile: BusinessProfileRecord | null;
  workspaceId: string;
  workspaceName: string;
  workspaceUsername: string | null;
}) {
  const [name, setName] = useState(workspaceName);
  const [username, setUsername] = useState(workspaceUsername ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [website, setWebsite] = useState(profile?.website ?? "");
  const [category, setCategory] = useState(profile?.category ?? "");
  const [logoUrl, setLogoUrl] = useState(profile?.logo_url ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!ownerWallet) return;
    setBusy(true);
    setError(null);
    try {
      await updateBusinessProfileClient(
        ownerWallet,
        workspaceId,
        { category, description, logoUrl: logoUrl || null, name, username, website },
        circleSocialUuid,
      );
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="section-panel p-6">
        <h3 className="font-heading text-lg">Business profile</h3>
        <label className="mt-6 block text-sm font-medium">
          Logo
          <Input
            accept="image/jpeg,image/png,image/webp"
            className="mt-2"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setLogoUrl(String(reader.result ?? ""));
              reader.readAsDataURL(file);
            }}
            type="file"
          />
        </label>
        {logoUrl ? (
          <img alt="" className="mt-3 h-16 w-16 rounded-2xl object-cover" src={logoUrl} />
        ) : null}
        <label className="mt-6 block text-sm font-medium">
          Business name
          <Input className="mt-2" onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Username
          <Input
            className="mt-2"
            onChange={(event) => setUsername(event.target.value)}
            value={username}
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Description
          <textarea
            className="mt-2 min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
            maxLength={280}
            onChange={(event) => setDescription(event.target.value.slice(0, 280))}
            value={description}
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Website
          <Input
            className="mt-2"
            onChange={(event) => setWebsite(event.target.value)}
            value={website}
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Category
          <Input
            className="mt-2"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          />
        </label>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        {canEdit ? (
          <Button className="mt-5" disabled={busy} onClick={() => void save()}>
            {saved ? <Check className="h-4 w-4" /> : null}
            Save changes
          </Button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Read-only for your role.</p>
        )}
      </section>
      <aside className="section-panel p-6">
        <p className="text-xs font-medium text-muted-foreground">Public profile preview</p>
        <div className="mt-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-muted text-primary">
          {logoUrl ? (
            <img alt="" className="h-full w-full object-cover" src={logoUrl} />
          ) : (
            <Building2 className="h-6 w-6" />
          )}
        </div>
        <h4 className="mt-4 font-heading text-xl">{name || workspaceName}</h4>
        <p className="text-sm text-muted-foreground">
          @{username || workspaceUsername}
        </p>
        {profile?.verification_status === "VERIFIED" ? (
          <p className="mt-2 text-xs font-medium">Verified Business</p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Complete verification</p>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          {description || "Payments infrastructure for modern businesses."}
        </p>
        <div className="mt-4 flex gap-2">
          <Button asChild size="sm">
            <Link href={`/u/${username || workspaceUsername || ""}`}>Pay</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/u/${username || workspaceUsername || ""}`}>Request</Link>
          </Button>
        </div>
      </aside>
    </div>
  );
}

function SettingsPanel({
  canManage,
  circleSocialUuid,
  ownerWallet,
  settings,
  workspaceId,
}: {
  canManage: boolean;
  circleSocialUuid?: string;
  ownerWallet: string | null;
  settings: WorkspaceSettingsRecord | null;
  workspaceId: string;
}) {
  const [maxMembers, setMaxMembers] = useState(String(settings?.max_members ?? 100));
  const [saved, setSaved] = useState(false);

  return (
    <section className="section-panel max-w-xl p-6">
      <h3 className="font-heading text-lg">Approvals</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Payments under $1,000 need no extra approval. $1,000–$10,000 need 1
        approver. Above $10,000 need 2 approvers.
      </p>
      <label className="mt-6 block text-sm font-medium">
        Maximum team size
        <Input
          className="mt-2 max-w-[10rem]"
          onChange={(event) => setMaxMembers(event.target.value)}
          value={maxMembers}
        />
      </label>
      {canManage ? (
        <Button
          className="mt-5"
          onClick={() => {
            if (!ownerWallet) return;
            void updateBusinessSettingsClient(
              ownerWallet,
              workspaceId,
              { maxMembers: Number(maxMembers) },
              circleSocialUuid,
            ).then(() => setSaved(true));
          }}
        >
          {saved ? "Saved" : "Save settings"}
        </Button>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Only owners and admins can change this.</p>
      )}
    </section>
  );
}
