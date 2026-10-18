"use client";

import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Subject = "PERSON" | "BUSINESS";

type Attempt = { step: string; result: string; reason_code: string | null; created_at: string };

type Review = {
  wallet: string;
  status: string;
  tier: number;
  idType: string | null;
  idLast4: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  hasIdentity: boolean;
  flags: Record<string, unknown>;
  updatedAt: string;
  attempts: Attempt[];
};

type BusinessReview = {
  wallet: string;
  status: string;
  level: string;
  companyType: string | null;
  rcNumber: string | null;
  companyName: string | null;
  cacStatus: string | null;
  tinLast4: string | null;
  directorMatch: { name?: string; role?: string | null } | null;
  flags: Record<string, unknown>;
  documents: { name: string; type: string; size: number; uploadedAt: string; url: string | null }[];
  updatedAt: string;
  attempts: Attempt[];
};

export default function KycAdminPage() {
  const { adminFetch } = useAdmin();
  const [subject, setSubject] = useState<Subject>("PERSON");
  const [view, setView] = useState<"MANUAL_REVIEW" | "ALL">("MANUAL_REVIEW");
  const [profiles, setProfiles] = useState<Review[] | null>(null);
  const [businesses, setBusinesses] = useState<BusinessReview[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<string | null>(null);

  async function load(nextView = view, nextSubject = subject) {
    setLoading(true);
    setError(null);
    try {
      const response = await adminFetch(`/api/admin/kyc?status=${nextView}&subject=${nextSubject}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Could not load reviews.");
      if (nextSubject === "BUSINESS") setBusinesses(payload.businesses);
      else setProfiles(payload.profiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reviews.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(wallet: string, decision: "APPROVED" | "REJECTED") {
    setDeciding(wallet);
    setError(null);
    try {
      const response = await adminFetch(`/api/admin/kyc/${encodeURIComponent(wallet)}`, {
        body: JSON.stringify({ decision, reason: reasons[wallet] ?? "", subject }),
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

  function decisionControls(wallet: string, approveLabel: string) {
    return (
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Input
          className="max-w-sm"
          onChange={(event) => setReasons((current) => ({ ...current, [wallet]: event.target.value }))}
          placeholder="Reason if rejecting"
          value={reasons[wallet] ?? ""}
        />
        <Button disabled={deciding === wallet} onClick={() => void decide(wallet, "APPROVED")} type="button">
          <Check className="h-4 w-4" /> {approveLabel}
        </Button>
        <Button disabled={deciding === wallet} onClick={() => void decide(wallet, "REJECTED")} type="button" variant="outline">
          <X className="h-4 w-4" /> Reject
        </Button>
      </div>
    );
  }

  function attemptsList(attempts: Attempt[]) {
    if (!attempts.length) return null;
    return (
      <ul className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
        {attempts.slice(0, 8).map((attempt) => (
          <li key={`${attempt.created_at}-${attempt.step}`}>
            {attempt.created_at.slice(0, 16).replace("T", " ")} · {attempt.step} · {attempt.result}
            {attempt.reason_code ? ` · ${attempt.reason_code}` : ""}
          </li>
        ))}
      </ul>
    );
  }

  const rows = subject === "BUSINESS" ? businesses : profiles;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Identity</p>
          <h1 className="mt-1 font-heading text-3xl">{subject === "BUSINESS" ? "Business KYB" : "Personal KYC"}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["PERSON", "BUSINESS"] as const).map((next) => (
            <Button
              key={next}
              onClick={() => { setSubject(next); void load(view, next); }}
              type="button"
              variant={subject === next ? "default" : "outline"}
            >
              {next === "PERSON" ? "Personal" : "Business"}
            </Button>
          ))}
          <Button onClick={() => { setView("MANUAL_REVIEW"); void load("MANUAL_REVIEW"); }} type="button" variant={view === "MANUAL_REVIEW" ? "default" : "outline"}>
            Needs review
          </Button>
          <Button onClick={() => { setView("ALL"); void load("ALL"); }} type="button" variant={view === "ALL" ? "default" : "outline"}>
            All
          </Button>
          <Button onClick={() => void load()} type="button" variant="outline">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </header>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ul className="space-y-3">
        {subject === "PERSON"
          ? (profiles ?? []).map((row) => (
              <li className="rounded-2xl border border-border p-4 text-sm" key={row.wallet}>
                <p className="font-medium">
                  {row.hasIdentity ? `${row.firstName} ${row.lastName} · ${row.idType} ****${row.idLast4}` : "No confirmed identity"} · {row.status}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{row.wallet}</p>
                {attemptsList(row.attempts)}
                {row.status === "MANUAL_REVIEW" ? (
                  <>
                    {!row.hasIdentity ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        No lookup has passed yet. Allowing a retry reopens the self-serve check; it does not verify the user.
                      </p>
                    ) : null}
                    {decisionControls(row.wallet, row.hasIdentity ? "Approve" : "Allow retry")}
                  </>
                ) : null}
              </li>
            ))
          : (businesses ?? []).map((row) => (
              <li className="rounded-2xl border border-border p-4 text-sm" key={row.wallet}>
                <p className="font-medium">
                  {row.companyName ?? "Unnamed"} · {row.companyType} {row.rcNumber} · {row.status}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  CAC {row.cacStatus ?? "unknown"} · level {row.level}
                  {row.tinLast4 ? ` · TIN ****${row.tinLast4}` : ""}
                  {row.directorMatch?.name ? ` · director ${row.directorMatch.name}` : " · no director matched the owner"}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{row.wallet}</p>
                {row.documents.length ? (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {row.documents.map((doc) => (
                      <li key={`${doc.uploadedAt}-${doc.name}`}>
                        {doc.url ? (
                          <a className="underline" href={doc.url} rel="noreferrer" target="_blank">
                            {doc.name}
                          </a>
                        ) : (
                          doc.name
                        )}{" "}
                        <span className="text-muted-foreground">· {Math.ceil(doc.size / 1024)} KB · link expires in 10 min</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {attemptsList(row.attempts)}
                {row.status === "MANUAL_REVIEW" ? decisionControls(row.wallet, "Approve") : null}
              </li>
            ))}
      </ul>
      {rows?.length === 0 ? <p className="text-sm text-muted-foreground">Nothing in this view.</p> : null}
    </div>
  );
}
