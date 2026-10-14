"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  UserRound,
  Users,
} from "lucide-react";

import { useAccountContext } from "@/components/account/account-provider";
import { useWorkspace } from "@/components/business/workspace-provider";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { Button } from "@/components/ui/button";
import {
  AddTeamMemberModal,
  type TeamMemberPrefill,
} from "@/components/payroll/add-team-member-modal";
import { PayrollStatusBadge } from "@/components/payroll/payroll-status-badge";
import {
  archiveTeamMemberClient,
  fetchTeamMembers,
  pauseTeamMemberClient,
  reactivateTeamMemberClient,
} from "@/lib/payroll/client";
import type { TeamMemberRecord } from "@/lib/payroll/types";

import "../payroll.css";

export default function TeamManagementPage() {
  const { ownerWallet, circleSocialUuid } = useAccountContext();
  const { workspace } = useWorkspace();
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<TeamMemberPrefill | undefined>(undefined);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMembers() {
    if (!ownerWallet) return;
    setLoading(true);
    try {
      const data = await fetchTeamMembers(
        ownerWallet,
        { includeArchived: true },
        circleSocialUuid ?? undefined,
        workspace?.id,
      );
      setMembers(data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load team members.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMembers();
  }, [ownerWallet, circleSocialUuid, workspace?.id]);

  // ALLIE hands off here with ?add=1&name=…&amount=…: open the form filled in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("add") !== "1") return;
    const type = params.get("type");
    const frequency = params.get("frequency");
    setPrefill({
      fullName: params.get("name") ?? undefined,
      role: params.get("role") ?? undefined,
      memberType: type === "CONTRACTOR" || type === "EMPLOYEE" ? type : undefined,
      saphraUsername: params.get("username") ?? undefined,
      walletAddress: params.get("wallet") ?? undefined,
      amount: params.get("amount") ?? undefined,
      frequency:
        frequency === "WEEKLY" || frequency === "BIWEEKLY" || frequency === "MONTHLY"
          ? frequency
          : undefined,
    });
    setIsAddModalOpen(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function handleTogglePause(member: TeamMemberRecord) {
    if (!ownerWallet) return;
    setActionLoading(member.id);
    try {
      if (member.status === "ACTIVE") {
        await pauseTeamMemberClient(ownerWallet, member.id, circleSocialUuid ?? undefined, workspace?.id);
      } else if (member.status === "PAUSED") {
        await reactivateTeamMemberClient(ownerWallet, member.id, circleSocialUuid ?? undefined, workspace?.id);
      }
      await loadMembers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to toggle status.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleArchive(member: TeamMemberRecord) {
    if (!ownerWallet) return;
    if (!confirm(`Are you sure you want to archive ${member.full_name}? They will be excluded from future payroll runs, but history is retained.`)) {
      return;
    }
    setActionLoading(member.id);
    try {
      await archiveTeamMemberClient(ownerWallet, member.id, circleSocialUuid ?? undefined, workspace?.id);
      await loadMembers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to archive member.");
    } finally {
      setActionLoading(null);
    }
  }

  const filteredMembers = members.filter((m) => {
    if (statusFilter !== "ALL" && m.status !== statusFilter) return false;
    if (typeFilter !== "ALL" && m.member_type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = m.full_name.toLowerCase().includes(q);
      const matchRole = m.role?.toLowerCase().includes(q);
      const matchUser = m.swiftpay_username?.toLowerCase().includes(q);
      const matchAddr = m.wallet_address.toLowerCase().includes(q);
      if (!matchName && !matchRole && !matchUser && !matchAddr) return false;
    }
    return true;
  });

  const filtering = Boolean(search.trim()) || statusFilter !== "ALL" || typeFilter !== "ALL";
  const statusCounts = {
    ACTIVE: members.filter((m) => m.status === "ACTIVE").length,
    ARCHIVED: members.filter((m) => m.status === "ARCHIVED").length,
    PAUSED: members.filter((m) => m.status === "PAUSED").length,
  };

  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        // The page draws its own bar with a back button.
        hideHeader
        subtitle="Manage employees, contractors, and payment setups."
        title="Team Members"
      >
        <div className="pr-page">
          <header className="pr-bar">
            <Link aria-label="Back to payroll" className="pr-round" href="/business/payroll">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="pr-title">Team</h1>
            <button
              aria-label="Add team member"
              className="pr-round is-primary"
              onClick={() => setIsAddModalOpen(true)}
              title="Add team member"
              type="button"
            >
              <Plus className="h-5 w-5" />
            </button>
          </header>

          {error ? (
            <div className="pr-alert" role="alert">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          ) : null}

          <label className="pr-search">
            <Search className="h-4 w-4 shrink-0" />
            <input
              aria-label="Search team members"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role, handle or wallet"
              type="search"
              value={search}
            />
          </label>

          <div className="pr-chips" role="group" aria-label="Filter by status">
            {(
              [
                ["ALL", "All", members.length],
                ["ACTIVE", "Active", statusCounts.ACTIVE],
                ["PAUSED", "Paused", statusCounts.PAUSED],
                ["ARCHIVED", "Archived", statusCounts.ARCHIVED],
              ] as const
            ).map(([value, label, count]) => (
              <button
                aria-pressed={statusFilter === value}
                className="pr-chip"
                key={value}
                onClick={() => setStatusFilter(value)}
                type="button"
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
            <span aria-hidden className="pr-chips-divider" />
            {(
              [
                ["ALL", "Everyone"],
                ["EMPLOYEE", "Employees"],
                ["CONTRACTOR", "Contractors"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={typeFilter === value}
                className="pr-chip"
                key={`type-${value}`}
                onClick={() => setTypeFilter(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <section className="pr-card">
            {loading ? (
              <p className="pr-empty">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading team members…
              </p>
            ) : filteredMembers.length === 0 ? (
              <div className="pr-empty is-first">
                <span aria-hidden className="pr-empty-icon">
                  <Users className="h-7 w-7" />
                </span>
                <p className="pr-empty-title">{filtering ? "No matching team members" : "Build your payroll team"}</p>
                <p>
                  {filtering
                    ? "Try a different search or filter."
                    : "Add employees or contractors to start paying them through payroll."}
                </p>
                {filtering ? null : (
                  <Button className="mt-2 h-11 rounded-xl" onClick={() => setIsAddModalOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Add team member
                  </Button>
                )}
              </div>
            ) : (
              <ul className="pr-runs">
                {filteredMembers.map((member) => (
                  <li className="pr-member" key={member.id}>
                    <Link className="pr-run" href={`/business/payroll/team/${member.id}`}>
                      <span className="pr-avatar">
                        <UserRound className="h-5 w-5" />
                      </span>
                      <span className="pr-run-main">
                        <span className="pr-run-title">{member.full_name}</span>
                        <span className="pr-run-sub">
                          {member.role || (member.member_type === "CONTRACTOR" ? "Contractor" : "Employee")} ·{" "}
                          {member.payment_destination_type === "SWIFTPAY_USER" && member.swiftpay_username
                            ? `${member.swiftpay_username}.one`
                            : `${member.wallet_address.slice(0, 6)}…${member.wallet_address.slice(-4)}`}
                        </span>
                      </span>
                      <span className="pr-run-side">
                        <span className="pr-run-amount">
                          {member.default_payment_amount} {member.preferred_asset}
                        </span>
                        <span className="pr-run-sub">
                          {member.payment_frequency.charAt(0)}
                          {member.payment_frequency.slice(1).toLowerCase()}
                        </span>
                      </span>
                    </Link>
                    <div className="pr-member-foot">
                      <PayrollStatusBadge className="pr-run-badge" status={member.status} />
                      {member.status !== "ARCHIVED" ? (
                        <span className="pr-member-actions">
                          <button
                            disabled={actionLoading === member.id}
                            onClick={() => void handleTogglePause(member)}
                            type="button"
                          >
                            {member.status === "ACTIVE" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            {member.status === "ACTIVE" ? "Pause" : "Reactivate"}
                          </button>
                          <button
                            disabled={actionLoading === member.id}
                            onClick={() => void handleArchive(member)}
                            type="button"
                          >
                            <Archive className="h-3.5 w-3.5" />
                            Archive
                          </button>
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {ownerWallet ? (
          <AddTeamMemberModal
            // Remount when ALLIE's details arrive: the form reads them once.
            key={prefill ? "prefilled" : "blank"}
            initial={prefill}
            isOpen={isAddModalOpen}
            onClose={() => {
              setIsAddModalOpen(false);
              setPrefill(undefined);
            }}
            ownerWallet={ownerWallet}
            circleSocialUuid={circleSocialUuid ?? undefined}
            onCreated={() => void loadMembers()}
          />
        ) : null}
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
