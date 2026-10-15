"use client";

import { Loader2, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assignableTools } from "@/lib/admin/tools";
import { cn } from "@/lib/utils";

type Member = {
  created_at: string;
  disabled: boolean;
  label: string | null;
  role: "member" | "owner";
  tools: string[];
  wallet_address: string;
};

/** Tick boxes for the tools a member gets. */
function ToolPicker({ onChange, value }: { onChange: (tools: string[]) => void; value: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {assignableTools.map((tool) => {
        const on = value.includes(tool.id);
        return (
          <button
            aria-pressed={on}
            className={cn("adm-chip transition", on ? "is-good" : "opacity-70 hover:opacity-100")}
            key={tool.id}
            onClick={() => onChange(on ? value.filter((id) => id !== tool.id) : [...value, tool.id])}
            title={tool.description}
            type="button"
          >
            {on ? "✓ " : ""}
            {tool.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdminTeamPage() {
  const { actor, adminFetch } = useAdmin();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  const [tools, setTools] = useState<string[]>(["support"]);
  const [adding, setAdding] = useState(false);

  const call = useCallback(
    async (method: string, body?: Record<string, unknown>) => {
      const response = await adminFetch("/api/admin/team", {
        body: body ? JSON.stringify(body) : undefined,
        method,
      });
      const payload = (await response.json()) as { members?: Member[]; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Something went wrong.");
      return payload;
    },
    [adminFetch],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers((await call("GET")).members ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load the team.");
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    }
  }

  async function add() {
    setAdding(true);
    await run(() => call("POST", { identifier, role, tools }));
    setAdding(false);
    setIdentifier("");
  }

  return (
    <div>
      <div className="adm-page-head">
        <div>
          <h1 className="adm-title">Team &amp; access</h1>
          <p className="adm-subtitle">
            Add people by their One ID. They sign in at /admin with their own SaphraONE account and
            see only the tools ticked here. Owners get everything, including this page.
          </p>
        </div>
      </div>

      <div className="adm-card mb-5 grid gap-3">
        <p className="font-semibold">Add someone</p>
        <div className="flex flex-wrap gap-2">
          <Input
            className="h-10 w-64"
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="amara.one or 0x…"
            value={identifier}
          />
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {(["member", "owner"] as const).map((value) => (
              <button
                className={cn(
                  "rounded-md px-3 text-sm font-semibold",
                  role === value ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
                key={value}
                onClick={() => setRole(value)}
                type="button"
              >
                {value === "owner" ? "Owner" : "Member"}
              </button>
            ))}
          </div>
        </div>
        {role === "member" ? <ToolPicker onChange={setTools} value={tools} /> : (
          <p className="adm-note">Owners can open every tool and manage the team.</p>
        )}
        <div>
          <Button disabled={adding || !identifier.trim() || (role === "member" && tools.length === 0)} onClick={() => void add()}>
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Add to the team
          </Button>
        </div>
      </div>

      {error ? <p className="adm-error mb-3">{error}</p> : null}

      <div className="grid gap-3">
        {loading ? (
          <div className="adm-card adm-empty">
            <Loader2 className="mx-auto h-4 w-4 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="adm-card adm-empty">
            No one yet. {actor.via === "key" ? "Start by adding yourself as an owner." : ""}
          </div>
        ) : (
          members.map((member) => (
            <MemberCard
              isSelf={member.wallet_address === actor.id}
              key={member.wallet_address}
              member={member}
              onRemove={() => void run(() => call("DELETE", { wallet: member.wallet_address }))}
              onUpdate={(changes) => void run(() => call("PATCH", { wallet: member.wallet_address, ...changes }))}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MemberCard({
  isSelf,
  member,
  onRemove,
  onUpdate,
}: {
  isSelf: boolean;
  member: Member;
  onRemove: () => void;
  onUpdate: (changes: Record<string, unknown>) => void;
}) {
  const [tools, setTools] = useState(member.tools ?? []);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const changed = [...tools].sort().join() !== [...(member.tools ?? [])].sort().join();

  return (
    <div className={cn("adm-card grid gap-3", member.disabled && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {member.label ?? member.wallet_address}
            {isSelf ? <span className="adm-note"> (you)</span> : null}
          </p>
          <p className="adm-mono text-muted-foreground">{member.wallet_address}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={member.role === "owner" ? "adm-chip is-good" : "adm-chip"}>
            {member.role === "owner" ? "Owner" : "Member"}
          </span>
          {member.disabled ? <span className="adm-chip is-warn">Disabled</span> : null}
        </div>
      </div>

      {member.role === "member" ? <ToolPicker onChange={setTools} value={tools} /> : null}

      <div className="flex flex-wrap gap-2">
        {member.role === "member" && changed ? (
          <Button onClick={() => onUpdate({ tools })} size="sm">
            Save access
          </Button>
        ) : null}
        <Button
          onClick={() => onUpdate({ role: member.role === "owner" ? "member" : "owner" })}
          size="sm"
          variant="outline"
        >
          {member.role === "owner" ? "Make member" : "Make owner"}
        </Button>
        <Button onClick={() => onUpdate({ disabled: !member.disabled })} size="sm" variant="outline">
          {member.disabled ? "Enable" : "Disable"}
        </Button>
        {confirmRemove ? (
          <>
            <Button onClick={onRemove} size="sm" variant="destructive">
              Remove for good
            </Button>
            <Button onClick={() => setConfirmRemove(false)} size="sm" variant="ghost">
              Cancel
            </Button>
          </>
        ) : (
          <Button onClick={() => setConfirmRemove(true)} size="sm" variant="ghost">
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
