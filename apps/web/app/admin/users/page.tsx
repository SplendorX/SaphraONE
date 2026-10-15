"use client";

import { Loader2, Lock, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { OneIdInput } from "@/components/one-id-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UserRow = {
  accountType: string | null;
  contactEmail: string | null;
  createdAt: string | null;
  displayName: string | null;
  oneId: string | null;
  onboarded: boolean;
  wallet: string;
};

type UserDetail = UserRow & {
  authProvider: string | null;
  business: Record<string, unknown> | null;
  country: string | null;
  phone: string | null;
  recentTransactions: Array<{
    amount: number;
    amount_usd: number;
    occurred_at: string;
    source: string;
    token: string;
    tx_hash: string;
  }> | null;
  security: { appLock: boolean; twoFactor: boolean };
};

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function day(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
}

export default function AdminUsersPage() {
  const { adminFetch } = useAdmin();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      adminFetch(`/api/admin/users?q=${encodeURIComponent(query.trim())}`)
        .then(async (response) => {
          const body = (await response.json()) as { message?: string; users?: UserRow[] };
          if (cancelled) return;
          if (!response.ok) throw new Error(body.message ?? "Couldn't search.");
          setUsers(body.users ?? []);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "Couldn't search.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [adminFetch, query]);

  const open = useCallback(
    async (wallet: string) => {
      setDetailLoading(true);
      try {
        const response = await adminFetch(`/api/admin/users?wallet=${encodeURIComponent(wallet)}`);
        const body = (await response.json()) as { message?: string; user?: UserDetail };
        if (!response.ok || !body.user) throw new Error(body.message ?? "Couldn't load that account.");
        setSelected(body.user);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Couldn't load that account.");
      } finally {
        setDetailLoading(false);
      }
    },
    [adminFetch],
  );

  return (
    <div>
      <div className="adm-page-head">
        <div>
          <h1 className="adm-title">Users</h1>
          <p className="adm-subtitle">
            Find an account by ONE ID, name, email or wallet. ONE IDs and emails are locked for
            customers; change them here when they ask.
          </p>
        </div>
      </div>

      <div className="relative mb-4 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-11 pl-9"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="amara.one, Amara Obi, amara@email.com or 0x…"
          value={query}
        />
      </div>
      {error ? <p className="adm-error mb-3">{error}</p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>ONE ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Type</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  className="is-clickable"
                  key={user.wallet}
                  onClick={() => void open(user.wallet)}
                >
                  <td className="font-semibold">{user.oneId ?? shortWallet(user.wallet)}</td>
                  <td>{user.displayName ?? "—"}</td>
                  <td>{user.contactEmail ?? "—"}</td>
                  <td>
                    <span className="adm-chip">
                      {user.onboarded ? (user.accountType === "BUSINESS" ? "Business" : "Personal") : "Not set up"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{day(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? (
            <p className="adm-empty">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </p>
          ) : users.length === 0 ? (
            <p className="adm-empty">No accounts match.</p>
          ) : null}
        </div>

        <div>
          {detailLoading ? (
            <div className="adm-card adm-empty">
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            </div>
          ) : selected ? (
            <UserPanel onChanged={setSelected} user={selected} />
          ) : (
            <div className="adm-card adm-empty">Choose an account to see it here.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserPanel({ onChanged, user }: { onChanged: (user: UserDetail) => void; user: UserDetail }) {
  const rows: Array<[string, string]> = [
    ["ONE ID", user.oneId ?? "—"],
    ["Name", user.displayName ?? "—"],
    ["Email", user.contactEmail ?? "—"],
    ["Phone", user.phone ?? "—"],
    ["Country", user.country ?? "—"],
    ["Signed in with", user.authProvider ?? "—"],
    ["Joined", day(user.createdAt)],
  ];
  const businessName = typeof user.business?.business_name === "string" ? user.business.business_name : null;

  return (
    <div className="grid gap-4">
      <div className="adm-card">
        <p className="text-lg font-semibold">{user.displayName ?? user.oneId ?? shortWallet(user.wallet)}</p>
        <p className="adm-mono mt-1 break-all text-muted-foreground">{user.wallet}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={user.security.appLock ? "adm-chip is-good" : "adm-chip"}>
            <Lock className="h-3 w-3" /> Payment PIN {user.security.appLock ? "set" : "not set"}
          </span>
          <span className={user.security.twoFactor ? "adm-chip is-good" : "adm-chip"}>
            <ShieldCheck className="h-3 w-3" /> 2FA {user.security.twoFactor ? "on" : "off"}
          </span>
          {businessName ? <span className="adm-chip">Business · {businessName}</span> : null}
        </div>
        <dl className="mt-4 grid gap-2 text-sm">
          {rows.map(([label, value]) => (
            <div className="flex justify-between gap-3" key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ChangeOneId onChanged={onChanged} user={user} />
      <ChangeEmail onChanged={onChanged} user={user} />

      <div className="adm-card">
        <p className="font-semibold">Recent transactions</p>
        {user.recentTransactions === null ? (
          <p className="adm-note mt-2">The transaction ledger isn&apos;t set up yet (transaction-ledger.sql).</p>
        ) : user.recentTransactions.length === 0 ? (
          <p className="adm-note mt-2">None recorded yet.</p>
        ) : (
          <ul className="mt-2 grid gap-2 text-sm">
            {user.recentTransactions.map((tx) => (
              <li className="flex justify-between gap-3" key={tx.tx_hash}>
                <span>
                  <span className="adm-chip">{tx.source}</span>{" "}
                  <span className="text-muted-foreground">{day(tx.occurred_at)}</span>
                </span>
                <span className="adm-num font-semibold">
                  {Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {tx.token}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A change only the team makes: typed, explained, then confirmed. */
function useChange(user: UserDetail, onChanged: (user: UserDetail) => void) {
  const { adminFetch } = useAdmin();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);

  async function submit(body: Record<string, unknown>, done: (result: Record<string, unknown>) => string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await adminFetch("/api/admin/users", {
        body: JSON.stringify({ ...body, reason, wallet: user.wallet }),
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string; result?: Record<string, unknown>; user?: UserDetail };
      if (!response.ok || !payload.user) throw new Error(payload.message ?? "The change couldn't be made.");
      onChanged(payload.user);
      setMessage({ text: done(payload.result ?? {}), tone: "ok" });
      setReason("");
      setConfirming(false);
      return true;
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "The change couldn't be made.", tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, confirming, message, reason, setConfirming, setReason, submit };
}

function ChangeOneId({ onChanged, user }: { onChanged: (user: UserDetail) => void; user: UserDetail }) {
  const [oneId, setOneId] = useState("");
  const change = useChange(user, onChanged);
  const ready = oneId.trim().length >= 3 && change.reason.trim().length >= 4;

  return (
    <div className="adm-card grid gap-3">
      <div>
        <p className="font-semibold">Change ONE ID</p>
        <p className="adm-note">
          The old ONE ID is held for this account for 12 months, so no one else can take it and
          receive their payments.
        </p>
      </div>
      <OneIdInput onValueChange={setOneId} placeholder="newname" value={oneId} />
      <Input onChange={(event) => change.setReason(event.target.value)} placeholder="Why (e.g. support request SP-1234)" value={change.reason} />
      {change.confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={change.busy}
            onClick={() =>
              void change
                .submit({ action: "change-one-id", oneId }, (result) => {
                  const notes = Array.isArray(result.notes) ? (result.notes as string[]) : [];
                  return [`Now ${String(result.next)}.`, ...notes].join(" ");
                })
                .then((ok) => ok && setOneId(""))
            }
          >
            {change.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm: {user.oneId ?? "no ONE ID"} → {oneId}.one
          </Button>
          <Button onClick={() => change.setConfirming(false)} variant="ghost">
            Cancel
          </Button>
        </div>
      ) : (
        <Button disabled={!ready} onClick={() => change.setConfirming(true)} variant="outline">
          Change ONE ID…
        </Button>
      )}
      {change.message ? (
        <p className={change.message.tone === "error" ? "adm-error" : "text-sm text-emerald-600 dark:text-emerald-400"}>
          {change.message.text}
        </p>
      ) : null}
    </div>
  );
}

function ChangeEmail({ onChanged, user }: { onChanged: (user: UserDetail) => void; user: UserDetail }) {
  const [email, setEmail] = useState("");
  const change = useChange(user, onChanged);
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && change.reason.trim().length >= 4;

  return (
    <div className="adm-card grid gap-3">
      <div>
        <p className="font-semibold">Change account email</p>
        <p className="adm-note">Where SaphraONE reaches this person. It doesn&apos;t change how they sign in.</p>
      </div>
      <Input inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="new@email.com" type="email" value={email} />
      <Input onChange={(event) => change.setReason(event.target.value)} placeholder="Why (e.g. support request SP-1234)" value={change.reason} />
      {change.confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={change.busy}
            onClick={() =>
              void change
                .submit({ action: "change-email", email }, (result) => `Now ${String(result.next)}.`)
                .then((ok) => ok && setEmail(""))
            }
          >
            {change.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Confirm: {user.contactEmail ?? "no email"} → {email.trim().toLowerCase()}
          </Button>
          <Button onClick={() => change.setConfirming(false)} variant="ghost">
            Cancel
          </Button>
        </div>
      ) : (
        <Button disabled={!ready} onClick={() => change.setConfirming(true)} variant="outline">
          Change email…
        </Button>
      )}
      {change.message ? (
        <p className={change.message.tone === "error" ? "adm-error" : "text-sm text-emerald-600 dark:text-emerald-400"}>
          {change.message.text}
        </p>
      ) : null}
    </div>
  );
}
