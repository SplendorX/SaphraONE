"use client";

import { bulkFeeSummary, usesLegacyPayrollFee } from "@/lib/fees";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";

import { useAccountContext } from "@/components/account/account-provider";
import { useWorkspace } from "@/components/business/workspace-provider";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StyledSelect } from "@/components/ui/styled-select";
import { PayrollFormSheet } from "@/components/payroll/payroll-form-sheet";
import { PayrollAutopayApproval } from "@/components/payroll/payroll-autopay-approval";
import {
  createPayrollScheduleClient,
  fetchPayrollGroups,
  fetchPayrollSchedules,
  deletePayrollScheduleClient,
  pausePayrollScheduleClient,
  resumePayrollScheduleClient,
} from "@/lib/payroll/client";
import type { PaymentFrequency, PayrollGroupRecord, PayrollScheduleRecord } from "@/lib/payroll/types";

import "../payroll.css";

export default function PayrollSchedulesPage() {
  const { ownerWallet, circleSocialUuid } = useAccountContext();
  const { workspace } = useWorkspace();
  const [schedules, setSchedules] = useState<PayrollScheduleRecord[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [groups, setGroups] = useState<PayrollGroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [frequency, setFrequency] = useState<PaymentFrequency>("MONTHLY");
  const [groupId, setGroupId] = useState<string>("");
  const [dayOfMonth, setDayOfMonth] = useState<number>(28);
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    if (!ownerWallet) return;
    setLoading(true);
    try {
      const [schedulesData, groupsData] = await Promise.all([
        fetchPayrollSchedules(ownerWallet, circleSocialUuid ?? undefined, workspace?.id),
        fetchPayrollGroups(ownerWallet, circleSocialUuid ?? undefined, workspace?.id),
      ]);
      setSchedules(schedulesData);
      setGroups(groupsData);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load schedules.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [ownerWallet, circleSocialUuid, workspace?.id]);

  async function handleToggleSchedule(schedule: PayrollScheduleRecord) {
    if (!ownerWallet) return;
    try {
      if (schedule.is_active) {
        await pausePayrollScheduleClient(ownerWallet, schedule.id, circleSocialUuid ?? undefined, workspace?.id);
      } else {
        await resumePayrollScheduleClient(ownerWallet, schedule.id, circleSocialUuid ?? undefined, workspace?.id);
      }
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update schedule.");
    }
  }

  // Two taps: the first arms the button, the second deletes.
  async function handleDeleteSchedule(id: string) {
    if (!ownerWallet) return;
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      await deletePayrollScheduleClient(ownerWallet, id, circleSocialUuid ?? undefined, workspace?.id);
      setSchedules((current) => current.filter((item) => item.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule.");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  async function handleCreateSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!ownerWallet) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPayrollScheduleClient(
        ownerWallet,
        {
          frequency,
          payrollGroupId: groupId || null,
          scheduleConfig: {
            day_of_month: Number(dayOfMonth),
          },
        },
        circleSocialUuid ?? undefined,
        workspace?.id,
      );
      setIsModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create schedule.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        // The page draws its own bar with a back button.
        hideHeader
        subtitle="Automated recurring payroll cadence."
        title="Payroll Schedules"
      >
        <div className="pr-page">
          <header className="pr-bar">
            <Link aria-label="Back to payroll" className="pr-round" href="/business/payroll">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="pr-title">Schedules</h1>
            <button
              aria-label="Create schedule"
              className="pr-round is-primary"
              onClick={() => setIsModalOpen(true)}
              title="Create schedule"
              type="button"
            >
              <Plus className="h-5 w-5" />
            </button>
          </header>

          <PayrollAutopayApproval
            circleSocialUuid={circleSocialUuid}
            ownerWallet={ownerWallet}
            workspaceId={workspace?.id}
          />

          {error ? (
            <div className="pr-alert" role="alert">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
            </div>
          ) : null}

          <p className="pr-note">
            <Clock className="h-4 w-4 shrink-0" />
            Schedules create each payroll run for you on time. Every run includes a service fee of{" "}
            {bulkFeeSummary(usesLegacyPayrollFee())}, shown on the run before you approve it.
          </p>

          <section className="pr-card">
            <div className="pr-card-head">
              <div>
                <h2>Your schedules</h2>
                <p>{schedules.filter((s) => s.is_active).length} active</p>
              </div>
              <span className="pr-count">{schedules.length}</span>
            </div>

            {loading ? (
              <p className="pr-empty">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading schedules…
              </p>
            ) : schedules.length === 0 ? (
              <div className="pr-empty is-first">
                <span aria-hidden className="pr-empty-icon">
                  <Calendar className="h-7 w-7" />
                </span>
                <p className="pr-empty-title">No schedules yet</p>
                <p>Set up a monthly, biweekly or weekly schedule and draft payroll runs are created for your team automatically.</p>
                <Button className="mt-2 h-11 rounded-xl" onClick={() => setIsModalOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Create schedule
                </Button>
              </div>
            ) : (
              <ul className="pr-runs">
                {schedules.map((sched) => {
                  const group = groups.find((g) => g.id === sched.payroll_group_id);
                  return (
                    <li className="pr-member" key={sched.id}>
                      <div className="pr-run">
                        <span className={sched.is_active ? "pr-avatar" : "pr-avatar is-muted"}>
                          <Calendar className="h-5 w-5" />
                        </span>
                        <span className="pr-run-main">
                          <span className="pr-run-title">{group ? group.name : "Entire team"}</span>
                          <span className="pr-run-sub">
                            {sched.frequency.charAt(0)}
                            {sched.frequency.slice(1).toLowerCase()} ·{" "}
                            {sched.frequency === "MONTHLY"
                              ? `day ${sched.schedule_config?.day_of_month ?? 28} of the month`
                              : "every Friday"}
                          </span>
                        </span>
                        <span className="pr-run-side">
                          <span className="pr-run-sub">Next run</span>
                          <span className="pr-run-amount">
                            {sched.next_run_at
                              ? new Date(sched.next_run_at).toLocaleDateString(undefined, {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })
                              : "Not scheduled"}
                          </span>
                        </span>
                      </div>
                      <div className="pr-member-foot">
                        <span className={sched.is_active ? "pr-state is-on" : "pr-state"}>
                          {sched.is_active ? "Active" : "Paused"}
                        </span>
                        <span className="pr-member-actions">
                          <button onClick={() => void handleToggleSchedule(sched)} type="button">
                            {sched.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            {sched.is_active ? "Pause" : "Resume"}
                          </button>
                          <button
                            className={confirmDeleteId === sched.id ? "is-danger is-armed" : "is-danger"}
                            disabled={deletingId === sched.id}
                            onBlur={() => setConfirmDeleteId((current) => (current === sched.id ? null : current))}
                            onClick={() => void handleDeleteSchedule(sched.id)}
                            type="button"
                          >
                            {deletingId === sched.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            {confirmDeleteId === sched.id ? "Confirm delete" : "Delete"}
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <PayrollFormSheet onClose={() => setIsModalOpen(false)} open={isModalOpen} title="Create payroll schedule">
          <form className="pr-form" onSubmit={handleCreateSchedule}>
            <div className="pr-field">
              <span>Frequency *</span>
              <div className="pr-segment" role="group" aria-label="Frequency">
                {(
                  [
                    ["MONTHLY", "Monthly"],
                    ["BIWEEKLY", "Biweekly"],
                    ["WEEKLY", "Weekly"],
                  ] as const
                ).map(([value, label]) => (
                  <button aria-pressed={frequency === value} key={value} onClick={() => setFrequency(value)} type="button">
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pr-field">
              <span>Apply to</span>
              <StyledSelect
                ariaLabel="Apply to group"
                onChange={(val) => setGroupId(val)}
                options={[
                  { label: "Entire team (all active members)", value: "" },
                  ...groups.map((g) => ({ label: g.name, value: g.id })),
                ]}
                value={groupId}
              />
            </div>

            {frequency === "MONTHLY" ? (
              <label className="pr-field">
                <span>Day of the month (1–31)</span>
                <Input
                  inputMode="numeric"
                  max={31}
                  min={1}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  type="number"
                  value={dayOfMonth}
                />
              </label>
            ) : null}

            <div className="pr-form-actions">
              <Button className="h-12 w-full rounded-xl font-bold" disabled={submitting} type="submit">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? "Saving…" : "Create schedule"}
              </Button>
              <Button className="h-11 w-full rounded-xl" onClick={() => setIsModalOpen(false)} type="button" variant="ghost">
                Cancel
              </Button>
            </div>
          </form>
        </PayrollFormSheet>
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
