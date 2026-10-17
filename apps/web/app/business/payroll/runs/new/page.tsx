"use client";

import { arcChain } from "@/lib/chains";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Loader2,
  Minus,
  Plus,
  Send,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

import { useAccountContext } from "@/components/account/account-provider";
import { useWorkspace } from "@/components/business/workspace-provider";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  calculateItemAmounts,
  calculateRunTotals,
} from "@/lib/payroll/calculation-service";
import {
  createPayrollRunClient,
  fetchPayrollGroups,
  fetchTeamMembers,
} from "@/lib/payroll/client";
import type {
  PayrollAdjustmentType,
  PayrollGroupRecord,
  TeamMemberRecord,
} from "@/lib/payroll/types";

import "../../payroll.css";

type ItemDraft = {
  teamMemberId: string;
  fullName: string;
  role: string | null;
  paymentDestinationType: string;
  saphraUsername: string | null;
  walletAddress: string;
  baseAmount: string;
  adjustments: Array<{
    type: PayrollAdjustmentType;
    amount: string;
    reason?: string | null;
  }>;
};

export default function NewPayrollRunPage() {
  const router = useRouter();
  const { ownerWallet, circleSocialUuid } = useAccountContext();
  const { workspace } = useWorkspace();
  const [name, setName] = useState(() => {
    const d = new Date();
    return `${d.toLocaleString("default", { month: "long" })} ${d.getFullYear()} Payroll`;
  });

  const [groups, setGroups] = useState<PayrollGroupRecord[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [allMembers, setAllMembers] = useState<TeamMemberRecord[]>([]);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load groups and active team members
  useEffect(() => {
    if (!ownerWallet) return;
    setLoading(true);
    Promise.all([
      fetchPayrollGroups(ownerWallet, circleSocialUuid ?? undefined, workspace?.id),
      fetchTeamMembers(ownerWallet, { status: "ACTIVE" }, circleSocialUuid ?? undefined, workspace?.id),
    ])
      .then(([groupsData, membersData]) => {
        setGroups(groupsData);
        setAllMembers(membersData);
        initItems(membersData);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load team data.");
      })
      .finally(() => setLoading(false));
  }, [ownerWallet, circleSocialUuid, workspace?.id]);

  // ALLIE hands off with ?group=<id> ("pay the engineering team"): select it
  // once groups and members have loaded.
  const [linkedGroupId] = useState(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("group"),
  );
  const [linkedGroupApplied, setLinkedGroupApplied] = useState(false);
  useEffect(() => {
    if (!linkedGroupId || linkedGroupApplied || loading) return;
    setLinkedGroupApplied(true);
    if (groups.some((group) => group.id === linkedGroupId)) {
      handleGroupChange(linkedGroupId);
    }
  }, [groups, linkedGroupApplied, linkedGroupId, loading]);

  function initItems(membersList: TeamMemberRecord[], groupId?: string) {
    let filtered = membersList;
    if (groupId) {
      const g = groups.find((grp) => grp.id === groupId);
      if (g?.member_ids) {
        const idSet = new Set(g.member_ids);
        filtered = membersList.filter((m) => idSet.has(m.id));
      }
    }

    setItems(
      filtered.map((m) => ({
        teamMemberId: m.id,
        fullName: m.full_name,
        role: m.role,
        paymentDestinationType: m.payment_destination_type,
        saphraUsername: m.swiftpay_username,
        walletAddress: m.wallet_address,
        baseAmount: m.default_payment_amount || "0",
        adjustments: [],
      })),
    );
  }

  function handleGroupChange(newGroupId: string) {
    setSelectedGroupId(newGroupId);
    initItems(allMembers, newGroupId || undefined);
  }

  function updateBaseAmount(index: number, amount: string) {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], baseAmount: amount };
      return next;
    });
  }

  function addAdjustment(index: number, type: PayrollAdjustmentType) {
    setItems((prev) => {
      const next = [...prev];
      const item = next[index];
      next[index] = {
        ...item,
        adjustments: [
          ...item.adjustments,
          { type, amount: "100", reason: type === "BONUS" ? "Performance bonus" : "Adjustment" },
        ],
      };
      return next;
    });
  }

  function updateAdjustment(itemIndex: number, adjIndex: number, patch: { amount?: string; reason?: string }) {
    setItems((prev) => {
      const next = [...prev];
      const item = next[itemIndex];
      const newAdjs = [...item.adjustments];
      newAdjs[adjIndex] = { ...newAdjs[adjIndex], ...patch };
      next[itemIndex] = { ...item, adjustments: newAdjs };
      return next;
    });
  }

  function removeAdjustment(itemIndex: number, adjIndex: number) {
    setItems((prev) => {
      const next = [...prev];
      const item = next[itemIndex];
      next[itemIndex] = {
        ...item,
        adjustments: item.adjustments.filter((_, i) => i !== adjIndex),
      };
      return next;
    });
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // Real-time server-matching calculations
  const totals = useMemo(() => {
    const calculatedItems = items.map((it) =>
      calculateItemAmounts(it.baseAmount, it.adjustments, "USDC"),
    );
    const runTotals = calculateRunTotals(
      calculatedItems.map((ci) => ({ totalAmount: ci.totalAmount })),
      "USDC",
    );
    return {
      calculatedItems,
      ...runTotals,
    };
  }, [items]);

  async function handleSubmit() {
    if (!ownerWallet || items.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const run = await createPayrollRunClient(
        ownerWallet,
        {
          name: name.trim() || "Payroll Run",
          source: "MANUAL",
          asset: "USDC",
          payrollGroupId: selectedGroupId || null,
          items: items.map((it) => ({
            teamMemberId: it.teamMemberId,
            recipientName: it.fullName,
            recipientDestination: it.walletAddress,
            recipientUsername: it.saphraUsername,
            baseAmount: it.baseAmount,
            adjustments: it.adjustments,
          })),
        },
        circleSocialUuid ?? undefined,
        workspace?.id,
      );
      router.push(`/business/payroll/runs/${run.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create payroll run.");
      setSubmitting(false);
    }
  }

  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        // The page draws its own bar with a back button.
        hideHeader
        subtitle="Configure recipient payments and adjustments for review."
        title="Create Payroll Run"
      >
        <div className="pr-page is-narrow">
          <header className="pr-bar">
            <Link aria-label="Back to payroll" className="pr-round" href="/business/payroll">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="pr-title">Run payroll</h1>
            <span />
          </header>

          {error ? (
            <div className="pr-alert" role="alert">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          ) : null}

          {/* What this run will take */}
          <section className="pr-hero">
            <span aria-hidden className="pr-hero-glow" />
            <div className="pr-hero-top">
              <span className="pr-hero-eyebrow">
                <Banknote className="h-4 w-4" />
                Total required
              </span>
              <span className="pr-hero-pill">USDC · {arcChain.name}</span>
            </div>
            <p className="pr-hero-amount">
              {totals.totalRequired} <span>USDC</span>
            </p>
            <div className="pr-hero-chips">
              <span>
                <Users className="h-3.5 w-3.5" />
                {totals.recipientCount} recipients
              </span>
              <span>Payout {totals.totalAmount}</span>
              <span>Fee (1%) {totals.totalFees}</span>
            </div>
          </section>

          {/* Run details */}
          <section className="pr-card pr-pad">
            <h2 className="pr-section-title">Run details</h2>
            <label className="pr-field">
              <span>Name *</span>
              <Input
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. September 2026 Payroll"
                required
                value={name}
              />
            </label>
            <div className="pr-field">
              <span>Who&apos;s paid</span>
              <div className="pr-chips is-wrap" role="radiogroup" aria-label="Who's paid">
                <button
                  aria-pressed={selectedGroupId === ""}
                  className="pr-chip"
                  onClick={() => handleGroupChange("")}
                  type="button"
                >
                  Whole team
                  <span>{allMembers.length}</span>
                </button>
                {groups.map((g) => (
                  <button
                    aria-pressed={selectedGroupId === g.id}
                    className="pr-chip"
                    key={g.id}
                    onClick={() => handleGroupChange(g.id)}
                    type="button"
                  >
                    {g.name}
                    <span>{g.members_count ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Recipients */}
          <section className="pr-card">
            <div className="pr-card-head">
              <div>
                <h2>Recipients</h2>
                <p>Set each payout, add a bonus or a deduction</p>
              </div>
              <span className="pr-count">{items.length}</span>
            </div>

            {loading ? (
              <p className="pr-empty">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading eligible team members…
              </p>
            ) : items.length === 0 ? (
              <div className="pr-empty is-first">
                <span aria-hidden className="pr-empty-icon">
                  <Users className="h-7 w-7" />
                </span>
                <p className="pr-empty-title">No one to pay here</p>
                <p>No active team members in this selection.</p>
                <Button asChild className="mt-2 h-11" variant="outline">
                  <Link href="/business/payroll/team">Manage team</Link>
                </Button>
              </div>
            ) : (
              <ul className="pr-runs">
                {items.map((item, index) => {
                  const ci = totals.calculatedItems[index];
                  return (
                    <li className="pr-recipient" key={item.teamMemberId}>
                      <div className="pr-recipient-top">
                        <span className="pr-avatar">
                          <UserRound className="h-5 w-5" />
                        </span>
                        <span className="pr-run-main">
                          <span className="pr-run-title">{item.fullName}</span>
                          <span className="pr-run-sub">
                            {item.role ? `${item.role} · ` : ""}
                            {item.paymentDestinationType === "SWIFTPAY_USER"
                              ? `${item.saphraUsername}.one`
                              : `${item.walletAddress.slice(0, 6)}…${item.walletAddress.slice(-4)}`}
                          </span>
                        </span>
                        <button
                          aria-label={`Remove ${item.fullName} from this run`}
                          className="pr-icon-button is-danger"
                          onClick={() => removeItem(index)}
                          title="Remove from this run"
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <label className="pr-amount">
                        <span>Base pay</span>
                        <Input
                          inputMode="decimal"
                          onChange={(e) => updateBaseAmount(index, e.target.value)}
                          step="any"
                          type="number"
                          value={item.baseAmount}
                        />
                        <em>USDC</em>
                      </label>

                      {item.adjustments.length > 0 ? (
                        <ul className="pr-adjustments">
                          {item.adjustments.map((adj, adjIdx) => (
                            <li key={adjIdx}>
                              <span className="pr-adj-type" data-type={adj.type}>
                                {adj.type === "BONUS" ? "Bonus" : adj.type === "DEDUCTION" ? "Deduction" : adj.type.toLowerCase()}
                              </span>
                              <Input
                                aria-label="Adjustment amount"
                                className="pr-adj-amount"
                                inputMode="decimal"
                                onChange={(e) => updateAdjustment(index, adjIdx, { amount: e.target.value })}
                                step="any"
                                type="number"
                                value={adj.amount}
                              />
                              <Input
                                aria-label="Reason"
                                className="pr-adj-reason"
                                onChange={(e) => updateAdjustment(index, adjIdx, { reason: e.target.value })}
                                placeholder="Reason (e.g. Q3 performance)"
                                value={adj.reason || ""}
                              />
                              <button
                                aria-label="Remove adjustment"
                                className="pr-icon-button is-danger"
                                onClick={() => removeAdjustment(index, adjIdx)}
                                type="button"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <div className="pr-recipient-foot">
                        <span className="pr-member-actions">
                          <button onClick={() => addAdjustment(index, "BONUS")} type="button">
                            <Plus className="h-3.5 w-3.5" /> Bonus
                          </button>
                          <button onClick={() => addAdjustment(index, "DEDUCTION")} type="button">
                            <Minus className="h-3.5 w-3.5" /> Deduction
                          </button>
                        </span>
                        <span className="pr-payout">
                          Payout <strong>{ci ? ci.totalAmount : item.baseAmount} USDC</strong>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="pr-dock">
            <div className="min-w-0">
              <p className="pr-dock-total">{totals.totalRequired} USDC</p>
              <p className="pr-dock-sub">
                {totals.recipientCount} {totals.recipientCount === 1 ? "person" : "people"} · fee included · you review
                before paying
              </p>
            </div>
            <Button className="pr-dock-cta" disabled={items.length === 0 || submitting} onClick={handleSubmit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? "Creating…" : "Proceed to review"}
            </Button>
          </div>
        </div>
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
