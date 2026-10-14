"use client";

import { ArrowUpRight, Check, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Submission = {
  id: string;
  wallet_address: string;
  business_name: string;
  country_code: string;
  id_type: string;
  id_number: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  method: "AUTOMATIC" | "MANUAL";
  source: string | null;
  registry_name: string | null;
  registry_status: string | null;
  note: string | null;
  reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  lookup: { label: string; url: string } | null;
};

const idTypeLabel: Record<string, string> = {
  LEI: "LEI",
  REGISTRATION: "Registration no.",
  TAX: "Tax ID",
  VAT: "VAT no.",
};

/**
 * The manual half of business verification: submissions no free official
 * register could settle — countries without one, name mismatches, a
 * register that was down, or a number already used by another business.
 */
export default function BusinessVerificationsAdminPage() {
  const { adminFetch } = useAdmin();
  const [view, setView] = useState<"PENDING" | "ALL">("PENDING");
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<string | null>(null);

  async function load(nextView = view) {
    setLoading(true);
    setError(null);
    try {
      const response = await adminFetch(`/api/admin/business-verifications?status=${nextView}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Could not load submissions.");
      setSubmissions(payload.submissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load submissions.");
    } finally {
      setLoading(false);
    }
  }

  // Opens on the submissions waiting for review.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    setDeciding(id);
    setError(null);
    try {
      const response = await adminFetch(`/api/admin/business-verifications/${id}`, {
        body: JSON.stringify({ decision, reason: reasons[id] ?? "" }),
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Could not save the decision.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the decision.");
    } finally {
      setDeciding(null);
    }
  }

  return (
    <main className="max-w-5xl space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Admin</p>
        <h1 className="mt-1 font-heading text-3xl">Business verifications</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Submissions an official register couldn&rsquo;t settle automatically. Check the number on the
          country&rsquo;s official register, then approve or reject with a reason the business will see.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-full border border-border p-1">
          {(["PENDING", "ALL"] as const).map((option) => (
            <button
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                view === option ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
              key={option}
              onClick={() => {
                setView(option);
                void load(option);
              }}
              type="button"
            >
              {option === "PENDING" ? "Needs review" : "Recent"}
            </button>
          ))}
        </div>
        <Button className="h-11" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {submissions && submissions.length === 0 ? (
        <p className="rounded-2xl border border-border p-6 text-center text-sm text-muted-foreground">
          {view === "PENDING" ? "Nothing waiting for review." : "No submissions yet."}
        </p>
      ) : null}

      <div className="space-y-3">
        {submissions?.map((submission) => (
          <article className="rounded-2xl border border-border p-4 sm:p-5" key={submission.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-heading text-lg font-semibold">{submission.business_name}</p>
                <p className="font-mono text-xs text-muted-foreground">{submission.wallet_address}</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
                {submission.status.toLowerCase()} · {submission.method.toLowerCase()}
              </span>
            </div>

            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Country</dt>
                <dd className="font-medium">{submission.country_code}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{idTypeLabel[submission.id_type] ?? submission.id_type}</dt>
                <dd className="font-mono font-medium">{submission.id_number}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted</dt>
                <dd className="font-medium">{new Date(submission.created_at).toLocaleString()}</dd>
              </div>
            </dl>

            {submission.note || submission.registry_name ? (
              <div className="mt-3 rounded-xl bg-muted/50 p-3 text-sm">
                {submission.note ? <p>{submission.note}</p> : null}
                {submission.registry_name ? (
                  <p className="mt-1 text-muted-foreground">
                    {submission.source}: “{submission.registry_name}”
                    {submission.registry_status ? ` (${submission.registry_status})` : ""}
                  </p>
                ) : null}
              </div>
            ) : null}

            {submission.reason ? (
              <p className="mt-3 text-sm text-muted-foreground">Reason given: {submission.reason}</p>
            ) : null}

            {submission.status === "PENDING" ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {submission.lookup ? (
                  <a
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    href={submission.lookup.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {submission.lookup.label}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                <Input
                  className="h-10 min-w-56 flex-1"
                  onChange={(event) => setReasons((current) => ({ ...current, [submission.id]: event.target.value }))}
                  placeholder="Reason (required to reject)"
                  value={reasons[submission.id] ?? ""}
                />
                <Button
                  disabled={deciding === submission.id}
                  onClick={() => void decide(submission.id, "APPROVED")}
                >
                  <Check className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  disabled={deciding === submission.id || !(reasons[submission.id] ?? "").trim()}
                  onClick={() => void decide(submission.id, "REJECTED")}
                  variant="outline"
                >
                  <X className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </main>
  );
}
