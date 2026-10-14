"use client";

import { Loader2, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAdmin } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Ticket = {
  id: string;
  reference: string;
  subject: string;
  category: string;
  priority: "normal" | "high" | "urgent";
  status: "open" | "waiting_on_customer" | "resolved";
  createdAt: string;
  lastMessageAt: string;
  email: string | null;
  wallet: string | null;
  pagePath: string | null;
};

type Message = { id: string; sender: "customer" | "agent" | "assistant" | "system"; body: string; createdAt: string };

const statuses = [
  { id: "open", label: "Open" },
  { id: "waiting_on_customer", label: "Replied" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
] as const;

/** The support team's inbox: requests the help assistant handed to a person. */
export default function SupportAdminPage() {
  const { adminFetch } = useAdmin();
  const [status, setStatus] = useState<(typeof statuses)[number]["id"]>("open");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<{ ticket: Ticket; messages: Message[] } | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await adminFetch(path, init);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Request failed.");
      return payload;
    },
    [adminFetch],
  );

  const loadQueue = useCallback(
    async (nextStatus = status) => {
      setError(null);
      try {
        setTickets((await call(`/api/admin/support?status=${nextStatus}`)).tickets);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the queue.");
      }
    },
    [call, status],
  );

  // Opens on the queue, and follows the status chosen above it.
  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!selected) return;
    void call(`/api/admin/support/${selected}`)
      .then(setThread)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load the request."));
  }, [call, selected]);

  async function update(body: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      setThread(await call(`/api/admin/support/${selected}`, { body: JSON.stringify(body), method: "POST" }));
      if (body.body) setReply("");
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="max-w-6xl space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Admin</p>
        <h1 className="mt-1 font-heading text-3xl">Support inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Requests the help assistant couldn&rsquo;t answer. Urgent ones — possible lost funds or account access —
          are listed first. Never ask a customer for a seed phrase or private key.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1 rounded-full border border-border p-1">
          {statuses.map((option) => (
            <button
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold",
                status === option.id ? "bg-foreground text-background" : "text-muted-foreground",
              )}
              key={option.id}
              onClick={() => setStatus(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button className="h-11" onClick={() => void loadQueue()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="max-h-[70vh] divide-y divide-border overflow-y-auto rounded-2xl border border-border">
          {tickets?.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nothing here.</p>
          ) : null}
          {tickets?.map((ticket) => (
            <button
              className={cn(
                "block w-full px-4 py-3 text-left transition hover:bg-muted/60",
                selected === ticket.id && "bg-muted",
              )}
              key={ticket.id}
              onClick={() => setSelected(ticket.id)}
              type="button"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{ticket.reference}</span>
                {ticket.priority !== "normal" ? (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase",
                      ticket.priority === "urgent" ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700",
                    )}
                  >
                    {ticket.priority}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-sm font-medium">{ticket.subject}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {ticket.category} · {new Date(ticket.lastMessageAt).toLocaleString()}
              </p>
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-border p-4 sm:p-5">
          {!thread ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {tickets ? "Pick a request." : "Load the queue to start."}
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-heading text-lg font-semibold">{thread.ticket.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {thread.ticket.reference} · {thread.ticket.email ?? "signed in"}
                    {thread.ticket.wallet ? ` · ${thread.ticket.wallet}` : ""}
                    {thread.ticket.pagePath ? ` · from ${thread.ticket.pagePath}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {thread.ticket.status !== "resolved" ? (
                    <Button disabled={busy} onClick={() => void update({ status: "resolved" })} size="sm" variant="outline">
                      Resolve
                    </Button>
                  ) : (
                    <Button disabled={busy} onClick={() => void update({ status: "open" })} size="sm" variant="outline">
                      Reopen
                    </Button>
                  )}
                  {thread.ticket.priority !== "urgent" ? (
                    <Button disabled={busy} onClick={() => void update({ priority: "urgent" })} size="sm" variant="ghost">
                      Mark urgent
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="max-h-[50vh] space-y-2.5 overflow-y-auto">
                {thread.messages.map((message) => (
                  <div
                    className={cn(
                      "rounded-xl px-3.5 py-2 text-sm",
                      message.sender === "customer" && "bg-muted",
                      message.sender === "agent" && "ml-8 border border-primary/20 bg-primary/5",
                      message.sender === "assistant" && "border border-dashed border-border text-muted-foreground",
                      message.sender === "system" && "text-center text-xs text-muted-foreground",
                    )}
                    key={message.id}
                  >
                    {message.sender !== "system" ? (
                      <p className="mb-0.5 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                        {message.sender === "agent" ? "You" : message.sender} · {new Date(message.createdAt).toLocaleString()}
                      </p>
                    ) : null}
                    <p className="whitespace-pre-line">{message.body}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <textarea
                  className="min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
                  maxLength={4000}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Reply to the customer…"
                  value={reply}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    disabled={busy || !reply.trim()}
                    onClick={() => void update({ body: reply, status: "resolved" })}
                    variant="outline"
                  >
                    Reply &amp; resolve
                  </Button>
                  <Button disabled={busy || !reply.trim()} onClick={() => void update({ body: reply })}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send reply
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
