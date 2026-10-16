"use client";

import { arcExplorerUrl } from "@/lib/chains";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  UserRound,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Wallet,
} from "lucide-react";

import { useAccountContext } from "@/components/account/account-provider";
import { useWorkspace } from "@/components/business/workspace-provider";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { Button } from "@/components/ui/button";
import { PayrollStatusBadge } from "@/components/payroll/payroll-status-badge";
import {
  archiveTeamMemberClient,
  fetchTeamMember,
  pauseTeamMemberClient,
  reactivateTeamMemberClient,
} from "@/lib/payroll/client";
import type { TeamMemberRecord } from "@/lib/payroll/types";


export default function TeamMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { ownerWallet, circleSocialUuid } = useAccountContext();
  const { workspace } = useWorkspace();
  const [member, setMember] = useState<TeamMemberRecord | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    if (!ownerWallet) return;
    setLoading(true);
    try {
      const data = await fetchTeamMember(ownerWallet, id, circleSocialUuid ?? undefined, workspace?.id);
      setMember(data.member);
      setHistory(data.history);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load team member.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [ownerWallet, id, circleSocialUuid, workspace?.id]);

  async function handleTogglePause() {
    if (!ownerWallet || !member) return;
    setActionLoading(true);
    try {
      if (member.status === "ACTIVE") {
        await pauseTeamMemberClient(ownerWallet, member.id, circleSocialUuid ?? undefined, workspace?.id);
      } else if (member.status === "PAUSED") {
        await reactivateTeamMemberClient(ownerWallet, member.id, circleSocialUuid ?? undefined, workspace?.id);
      }
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleArchive() {
    if (!ownerWallet || !member) return;
    if (!confirm("Are you sure you want to archive this member?")) return;
    setActionLoading(true);
    try {
      await archiveTeamMemberClient(ownerWallet, member.id, circleSocialUuid ?? undefined, workspace?.id);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to archive member.");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        subtitle="View profile, compensation setup, and payment history."
        title="Team Member"
      >
        <div className="mb-4">
          <Button asChild size="sm" variant="ghost">
            <Link href="/business/payroll/team">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to Team
            </Link>
          </Button>
        </div>

        {error ? (
          <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            Loading profile…
          </div>
        ) : !member ? (
          <div className="section-panel p-8 text-center">
            <p className="text-muted-foreground">Team member not found.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Section 14: Profile Header Card */}
            <div className="section-panel p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center font-heading text-2xl font-bold">
                    {member.full_name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-heading text-2xl font-bold">{member.full_name}</h2>
                      <PayrollStatusBadge status={member.status} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {member.role || "No role specified"} · {member.member_type}
                      {member.email ? ` · ${member.email}` : ""}
                    </p>
                  </div>
                </div>

                {member.status !== "ARCHIVED" ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTogglePause()}
                      disabled={actionLoading}
                    >
                      {member.status === "ACTIVE" ? (
                        <>
                          <Pause className="h-4 w-4 mr-1.5" />
                          Pause Member
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-1.5" />
                          Reactivate
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleArchive()}
                      disabled={actionLoading}
                    >
                      <Archive className="h-4 w-4 mr-1.5" />
                      Archive
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* Detail Specifications */}
              <div className="grid gap-4 sm:grid-cols-3 mt-6 pt-6 border-t border-border">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    Payment Setup
                  </span>
                  <p className="mt-1 font-heading text-xl font-bold">
                    {member.default_payment_amount} {member.preferred_asset}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {member.payment_frequency.toLowerCase()} schedule
                  </p>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    Payment Destination
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    {member.payment_destination_type === "SWIFTPAY_USER" ? (
                      <>
                        <UserRound className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-foreground">
                          @{member.swiftpay_username}
                        </span>
                      </>
                    ) : (
                      <>
                        <Wallet className="h-4 w-4 text-primary" />
                        <span className="font-mono text-xs font-semibold">
                          {member.wallet_address.slice(0, 10)}…{member.wallet_address.slice(-6)}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">
                    {member.wallet_address}
                  </p>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    Added To Payroll
                  </span>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {new Date(member.created_at).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                  {member.archived_at ? (
                    <p className="text-xs text-destructive mt-0.5">
                      Archived on {new Date(member.archived_at).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Section 15: Team Member Payment History */}
            <section className="section-panel p-6">
              <h3 className="font-heading text-lg font-bold mb-4">Payment History</h3>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No payment records found for this team member yet.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {history.map((record: any) => (
                    <div
                      key={record.id}
                      className="flex flex-wrap items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {record.payroll_runs?.name || "Payroll"}
                          </span>
                          <PayrollStatusBadge status={record.status} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Base: {record.base_amount} {record.asset}
                          {Number(record.adjustment_amount) !== 0 ? ` · Adj: ${record.adjustment_amount}` : ""}
                          {" · "}
                          {new Date(record.created_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-heading font-semibold text-foreground">
                            {record.total_amount} {record.asset}
                          </p>
                          {record.blockchain_tx_hash ? (
                            <a
                              href={`${arcExplorerUrl}/tx/${record.blockchain_tx_hash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center text-xs text-primary hover:underline"
                            >
                              Tx Hash <ExternalLink className="h-3 w-3 ml-0.5" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
