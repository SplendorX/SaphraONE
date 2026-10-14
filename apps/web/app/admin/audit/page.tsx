"use client";

import { Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";

type Entry = {
  action: string;
  actor: string;
  actor_label: string | null;
  created_at: string;
  details: Record<string, unknown>;
  id: number;
  target: string | null;
  tool: string;
};

const actionLabels: Record<string, string> = {
  "add-member": "Added to the team",
  "adjust-points": "Adjusted ONE Points",
  "decide-verification": "Decided a business verification",
  "change-email": "Changed account email",
  "change-one-id": "Changed ONE ID",
  "remove-member": "Removed from the team",
  "update-member": "Changed team access",
};

/** The parts of an entry's details worth reading at a glance. */
function describe(entry: Entry) {
  const d = entry.details ?? {};
  const parts: string[] = [];
  if (d.previous !== undefined || d.next !== undefined) parts.push(`${String(d.previous ?? "—")} → ${String(d.next ?? "—")}`);
  if (Array.isArray(d.tools) && d.tools.length) parts.push(`tools: ${d.tools.join(", ")}`);
  if (typeof d.points === "number") parts.push(`${d.points > 0 ? "+" : ""}${d.points} points`);
  if (typeof d.decision === "string") parts.push(d.decision.toLowerCase());
  if (typeof d.role === "string") parts.push(`role: ${d.role}`);
  if (typeof d.disabled === "boolean") parts.push(d.disabled ? "disabled" : "enabled");
  if (typeof d.reason === "string") parts.push(`why: ${d.reason}`);
  if (Array.isArray(d.notes)) parts.push(...(d.notes as string[]));
  return parts.join(" · ");
}

export default function AdminAuditPage() {
  const { adminFetch } = useAdmin();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminFetch(`/api/admin/audit${target ? `?target=${encodeURIComponent(target)}` : ""}`);
      const body = (await response.json()) as { entries?: Entry[]; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Couldn't load the audit log.");
      setEntries(body.entries ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load the audit log.");
    } finally {
      setLoading(false);
    }
  }, [adminFetch, target]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="adm-page-head">
        <div>
          <h1 className="adm-title">Audit log</h1>
          <p className="adm-subtitle">Every change made from the admin platform: who, what, to whom and why.</p>
        </div>
        <Button disabled={loading} onClick={() => void load()} variant="outline">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {target ? (
        <button className="adm-chip mb-3" onClick={() => setTarget(null)} type="button">
          Only {target.slice(0, 6)}…{target.slice(-4)} <X className="h-3 w-3" />
        </button>
      ) : null}
      {error ? <p className="adm-error mb-3">{error}</p> : null}

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Account</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap">
                  {new Date(entry.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td>{entry.actor_label ?? entry.actor}</td>
                <td>
                  <span className="font-semibold">{actionLabels[entry.action] ?? entry.action}</span>
                  <span className="adm-note block">{entry.tool}</span>
                </td>
                <td>
                  {entry.target ? (
                    <button className="adm-mono text-primary hover:underline" onClick={() => setTarget(entry.target)} type="button">
                      {entry.target.slice(0, 6)}…{entry.target.slice(-4)}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-md">{describe(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && entries.length === 0 ? (
          <p className="adm-empty">
            <Loader2 className="mx-auto h-4 w-4 animate-spin" />
          </p>
        ) : !loading && entries.length === 0 ? (
          <p className="adm-empty">No changes recorded yet.</p>
        ) : null}
      </div>
    </div>
  );
}
