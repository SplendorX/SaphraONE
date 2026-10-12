"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  MessageCircle,
  Inbox,
  Loader2,
  MessageSquareText,
  Search,
  SendHorizontal,
  ShieldAlert,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useOptionalAccount } from "@/components/account/account-provider";
import { useBusinessActor } from "@/components/business/use-business-actor";
import { usePlatformAccess } from "@/components/platform-access-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listSupportTickets,
  openSupportTicket,
  readSupportThread,
  replyToSupport,
  supportChangedEvent,
  type SupportTicketSummary,
  type SupportThreadMessage,
} from "@/lib/support/client";
import {
  supportArticles,
  supportCategories,
  type SupportArticle,
  type SupportCategory,
} from "@/lib/support/knowledge";
import { replyTo, suggestedArticles } from "@/lib/support/match";
import { cn } from "@/lib/utils";

type ChatEntry =
  | { id: string; from: "customer"; text: string }
  | { id: string; from: "assistant"; kind: "text"; text: string }
  | { id: string; from: "assistant"; kind: "answer"; article: SupportArticle; related: SupportArticle[]; urgent: boolean }
  | { id: string; from: "assistant"; kind: "suggest"; articles: SupportArticle[] }
  | { id: string; from: "assistant"; kind: "handoff"; urgent: boolean };

type View =
  | { name: "home" }
  | { name: "chat" }
  | { name: "topics" }
  | { name: "category"; category: SupportCategory }
  | { name: "handoff"; urgent: boolean }
  | { name: "sent"; reference: string; urgent: boolean }
  | { name: "requests" }
  | { name: "thread"; id: string };

type ServiceStatus = { status: "operational" | "degraded"; checkedAt: string; issues: string[] };

/** The live status card's data; null when it can't be read. */
async function fetchServiceStatus(): Promise<ServiceStatus | null> {
  try {
    const response = await fetch("/api/support/status");
    if (!response.ok) return null;
    return (await response.json()) as ServiceStatus;
  } catch {
    return null;
  }
}

function formatStatusTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "just now"
    : date.toLocaleString(undefined, { day: "numeric", hour: "2-digit", minute: "2-digit", month: "short" });
}

const statusLabel: Record<SupportTicketSummary["status"], string> = {
  open: "Open",
  resolved: "Resolved",
  waiting_on_customer: "Replied",
};

let entryCounter = 0;
const nextId = () => `e${(entryCounter += 1)}`;

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** An answer from the help library, laid out to be acted on. */
function AnswerCard({
  entry,
  onFeedback,
  onOpenArticle,
  onNavigate,
}: {
  entry: Extract<ChatEntry, { kind: "answer" }>;
  onFeedback: (helpful: boolean) => void;
  onOpenArticle: (article: SupportArticle) => void;
  onNavigate?: () => void;
}) {
  const [voted, setVoted] = useState<boolean | null>(null);
  const { article } = entry;

  return (
    <div className="w-full space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      {entry.urgent ? (
        <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This may put your money or account at risk. Follow these steps, then tell our team.</span>
        </div>
      ) : null}
      <p className="font-heading text-[0.95rem] font-semibold">{article.title}</p>
      <p className="text-sm leading-relaxed text-foreground/85">{article.answer}</p>
      {article.steps ? (
        <ol className="space-y-1.5 text-sm">
          {article.steps.map((step, index) => (
            <li className="flex gap-2.5" key={step}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[0.68rem] font-bold text-primary">
                {index + 1}
              </span>
              <span className="text-foreground/85">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {article.links?.length ? (
        <div className="flex flex-wrap gap-2">
          {article.links.map((link) => (
            <Button asChild key={link.href} size="sm" variant="outline">
              <Link href={link.href} onClick={onNavigate}>
                {link.label}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {voted === null ? (
          <>
            <span className="text-xs text-muted-foreground">Did this help?</span>
            <div className="flex gap-1.5">
              <Button
                onClick={() => {
                  setVoted(true);
                  onFeedback(true);
                }}
                size="sm"
                variant="ghost"
              >
                <ThumbsUp className="h-3.5 w-3.5" />
                Yes
              </Button>
              <Button
                onClick={() => {
                  setVoted(false);
                  onFeedback(false);
                }}
                size="sm"
                variant="ghost"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
                No
              </Button>
            </div>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {voted ? "Glad that helped." : "Thanks — let's get you to a person."}
          </span>
        )}
      </div>

      {entry.related.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">Related</p>
          {entry.related.map((related) => (
            <button
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
              key={related.id}
              onClick={() => onOpenArticle(related)}
              type="button"
            >
              {related.title}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ArticleList({ articles, onOpen }: { articles: SupportArticle[]; onOpen: (article: SupportArticle) => void }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {articles.map((article) => (
        <button
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition hover:bg-muted/60"
          key={article.id}
          onClick={() => onOpen(article)}
          type="button"
        >
          <span className="font-medium">{article.title}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

/**
 * SaphraONE Support: instant answers from the help library, and a person when
 * those run out. Used in the help panel (a bottom sheet on phones, a side
 * panel on desktop), on /support, and from the lock screen as a guest.
 */
export function SupportCenter({
  guest = false,
  initialView = "home",
  onClose,
  onNavigate,
  variant = "panel",
}: {
  /** Where it opens: the home, straight into the chat, the FAQ topics, or your requests. */
  initialView?: "home" | "chat" | "topics" | "requests";
  /** Treat the visitor as signed out (the lock screen: the account is locked). */
  guest?: boolean;
  /** Shows a close button in the header. */
  onClose?: () => void;
  onNavigate?: () => void;
  variant?: "panel" | "page";
}) {
  const pathname = usePathname() ?? "/";
  const access = usePlatformAccess();
  const actor = useBusinessActor();
  const account = useOptionalAccount()?.account ?? null;
  const signedIn = !guest && access === "allowed" && Boolean(actor.ownerWallet);
  const identity = useMemo(
    () => (signedIn ? { circleSocialUuid: actor.circleSocialUuid, ownerWallet: actor.ownerWallet } : {}),
    [actor.circleSocialUuid, actor.ownerWallet, signedIn],
  );
  const firstName = signedIn
    ? account?.display_name?.trim().split(/\s+/)[0] || account?.username || null
    : null;

  const [view, setView] = useState<View>({ name: initialView } as View);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadTickets = useCallback(async () => {
    try {
      setTickets(await listSupportTickets(identity));
    } catch {
      // Support storage not set up yet (or the app is locked): the help library still works.
    }
  }, [identity]);

  useEffect(() => {
    void loadTickets();
    window.addEventListener(supportChangedEvent, loadTickets);
    return () => window.removeEventListener(supportChangedEvent, loadTickets);
  }, [loadTickets]);

  useEffect(() => {
    let cancelled = false;
    void fetchServiceStatus().then((next) => {
      if (cancelled) return;
      setStatus(next);
      setStatusChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view.name === "chat") {
      scrollRef.current?.scrollTo({ behavior: "smooth", top: scrollRef.current.scrollHeight });
    } else {
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }, [entries, view]);

  const suggestions = useMemo(() => suggestedArticles(pathname), [pathname]);
  const unread = tickets.filter((ticket) => ticket.unread).length;

  function push(...next: ChatEntry[]) {
    setEntries((current) => [...current, ...next]);
    setView({ name: "chat" });
  }

  function answerWith(article: SupportArticle, asked?: string) {
    const related = supportArticles
      .filter((candidate) => candidate.category === article.category && candidate.id !== article.id)
      .slice(0, 2);
    push(
      ...(asked ? [{ from: "customer" as const, id: nextId(), text: asked }] : []),
      { article, from: "assistant", id: nextId(), kind: "answer", related, urgent: Boolean(article.urgent) },
    );
  }

  function ask(question: string) {
    const text = question.trim();
    if (!text) return;
    const reply = replyTo(text, pathname);
    const customer: ChatEntry = { from: "customer", id: nextId(), text };

    if (reply.kind === "greeting") {
      push(customer, {
        from: "assistant",
        id: nextId(),
        kind: "text",
        text: "Hi! What can I help you with? Ask in your own words, or pick a topic.",
      });
    } else if (reply.kind === "thanks") {
      push(customer, { from: "assistant", id: nextId(), kind: "text", text: "Happy to help. Anything else?" });
    } else if (reply.kind === "answer") {
      push(customer, {
        article: reply.article,
        from: "assistant",
        id: nextId(),
        kind: "answer",
        related: reply.related,
        urgent: reply.urgent,
      });
      if (reply.urgent) push({ from: "assistant", id: nextId(), kind: "handoff", urgent: true });
    } else if (reply.kind === "suggest") {
      push(customer, { articles: reply.articles, from: "assistant", id: nextId(), kind: "suggest" });
    } else {
      push(customer, { from: "assistant", id: nextId(), kind: "handoff", urgent: reply.kind === "human" && reply.urgent });
    }
  }

  function submitDraft(event: FormEvent) {
    event.preventDefault();
    const question = draft;
    setDraft("");
    ask(question);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const question = search;
    setSearch("");
    ask(question);
  }

  const transcript = entries.flatMap((entry): { sender: "customer" | "assistant"; body: string }[] =>
    entry.from === "customer"
      ? [{ body: entry.text, sender: "customer" as const }]
      : entry.kind === "answer"
        ? [{ body: `Suggested: ${entry.article.title}`, sender: "assistant" as const }]
        : entry.kind === "text"
          ? [{ body: entry.text, sender: "assistant" as const }]
          : [],
  );
  const lastQuestion = [...entries].reverse().find((entry) => entry.from === "customer") as
    | Extract<ChatEntry, { from: "customer" }>
    | undefined;

  const closeButton = onClose ? (
    <button
      aria-label="Close support"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/30 transition hover:bg-white/25"
      onClick={onClose}
      type="button"
    >
      <X className="h-5 w-5" />
    </button>
  ) : null;

  const shellClass = cn("support-shell flex min-h-0 flex-col", variant === "panel" ? "h-full" : "min-h-[70vh]");

  // Home: greeting, inbox, live status, message us, search.
  if (view.name === "home") {
    return (
      <div className={shellClass}>
        <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
          <div className="support-home-hero px-5 pb-24 pt-6 text-white">
            <div className="flex items-start justify-between gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="SaphraONE" className="h-10 w-10 rounded-xl" height={40} src="/icons/icon-192.png" width={40} />
              {closeButton}
            </div>
            <p className="mt-7 font-heading text-[1.7rem] font-bold leading-tight tracking-tight">
              Hi {firstName ?? "there"} <span aria-hidden="true">👋</span>
              <br />
              How can we help?
            </p>
          </div>

          <div className="-mt-16 space-y-3 px-4 pb-6">
            <div className="support-card divide-y divide-border">
              <button
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                onClick={() => {
                  void loadTickets();
                  setView({ name: "requests" });
                }}
                type="button"
              >
                <span className="font-semibold">Messages</span>
                {unread > 0 ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1.5 text-[0.7rem] font-bold text-white">
                    {unread}
                  </span>
                ) : tickets.length > 0 ? (
                  <span className="text-xs font-medium text-muted-foreground">{tickets.length}</span>
                ) : (
                  <Inbox className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              <button
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                onClick={() => setView({ name: "topics" })}
                type="button"
              >
                <span className="font-semibold">Help</span>
                <CircleHelp className="h-5 w-5 text-primary" />
              </button>
            </div>

            <div className="support-card flex items-center gap-3 px-4 py-4">
              {!statusChecked ? (
                <Loader2 className="h-6 w-6 shrink-0 animate-spin text-muted-foreground" />
              ) : status?.status === "operational" ? (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
              ) : (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-500 text-white">
                  <AlertTriangle className="h-4 w-4" />
                </span>
              )}
              <div className="min-w-0">
                <p className="font-semibold">
                  {!statusChecked
                    ? "Checking status…"
                    : status?.status === "operational"
                      ? "Status: All systems operational"
                      : status
                        ? "Status: Some services are slow"
                        : "Status: Couldn't check right now"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {status?.status === "degraded" && status.issues[0]
                    ? status.issues[0]
                    : status
                      ? `Updated ${formatStatusTime(status.checkedAt)}`
                      : statusChecked
                        ? "If something isn't working, send us a message."
                        : "One moment"}
                </p>
              </div>
            </div>

            <button
              className="support-card flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
              onClick={() => setView({ name: "handoff", urgent: false })}
              type="button"
            >
              <span className="min-w-0">
                <span className="block font-semibold">Send us a message</span>
                <span className="block text-sm text-muted-foreground">We usually reply within one business day</span>
              </span>
              <SendHorizontal className="h-5 w-5 shrink-0 fill-primary text-primary" />
            </button>

            <div className="support-card p-2">
              <form className="relative" onSubmit={submitSearch}>
                <Input
                  aria-label="Search for help"
                  className="h-12 rounded-xl border-0 bg-muted/70 pl-3.5 pr-11 font-semibold shadow-none placeholder:text-foreground/80 focus-visible:ring-1"
                  maxLength={500}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search for help"
                  value={search}
                />
                <button
                  aria-label="Search"
                  className="absolute inset-y-0 right-1 grid w-10 place-items-center text-primary"
                  type="submit"
                >
                  <Search className="h-4 w-4" />
                </button>
              </form>
              <div className="mt-1">
                {suggestions.map((article) => (
                  <button
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-3 text-left text-[0.95rem] transition hover:bg-muted/60"
                    key={article.id}
                    onClick={() => answerWith(article, article.title)}
                    type="button"
                  >
                    <span>{article.title}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                ))}
              </div>
            </div>

            <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[0.7rem] text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              SaphraONE will never ask for your seed phrase, PIN or private key.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Inner views: a compact purple bar with back and close.
  const titles: Partial<Record<View["name"], string>> = {
    category:
      view.name === "category"
        ? supportCategories.find((category) => category.id === view.category)?.label
        : undefined,
    chat: "Help",
    requests: "Messages",
    sent: "Message sent",
    topics: "Help topics",
  };
  // The message form and a thread carry their own back links.
  const showBack = view.name !== "handoff" && view.name !== "thread";

  return (
    <div className={shellClass}>
      <div className="support-bar flex items-center gap-2 px-3 py-3 text-white">
        {showBack ? (
          <button
            aria-label="Back"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full transition hover:bg-white/15"
            onClick={() => setView(view.name === "category" ? { name: "topics" } : { name: "home" })}
            type="button"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <p className="min-w-0 flex-1 truncate font-heading text-lg font-semibold">
          {titles[view.name] ?? "Support"}
        </p>
        {closeButton}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" ref={scrollRef}>
        {view.name === "topics" ? (
          <div className="support-card divide-y divide-border">
            {supportCategories.map((category) => (
              <button
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left font-medium transition hover:bg-muted/60"
                key={category.id}
                onClick={() => setView({ category: category.id, name: "category" })}
                type="button"
              >
                {category.label}
                <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
              </button>
            ))}
          </div>
        ) : null}

        {view.name === "category" ? (
          <ArticleList
            articles={supportArticles.filter((article) => article.category === view.category)}
            onOpen={(article) => answerWith(article, article.title)}
          />
        ) : null}

        {view.name === "chat"
          ? entries.map((entry) =>
              entry.from === "customer" ? (
                <div className="flex justify-end" key={entry.id}>
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {entry.text}
                  </p>
                </div>
              ) : entry.kind === "text" ? (
                <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm" key={entry.id}>
                  {entry.text}
                </p>
              ) : entry.kind === "answer" ? (
                <AnswerCard
                  entry={entry}
                  key={entry.id}
                  onFeedback={(helpful) => {
                    if (!helpful) push({ from: "assistant", id: nextId(), kind: "handoff", urgent: entry.urgent });
                  }}
                  onNavigate={onNavigate}
                  onOpenArticle={(article) => answerWith(article, article.title)}
                />
              ) : entry.kind === "suggest" ? (
                <div className="space-y-2" key={entry.id}>
                  <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 text-sm">
                    Did you mean one of these?
                  </p>
                  <ArticleList articles={entry.articles} onOpen={(article) => answerWith(article)} />
                  <button
                    className="text-xs font-semibold text-primary hover:underline"
                    onClick={() => push({ from: "assistant", id: nextId(), kind: "handoff", urgent: false })}
                    type="button"
                  >
                    None of these — talk to a person
                  </button>
                </div>
              ) : (
                <div
                  className={cn(
                    "space-y-3 rounded-2xl border p-4",
                    entry.urgent ? "border-destructive/40 bg-destructive/5" : "border-border bg-card",
                  )}
                  key={entry.id}
                >
                  <div className="flex gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <MessageCircle className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">
                        {entry.urgent ? "Let's get this to our team now" : "Talk to the SaphraONE team"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {entry.urgent
                          ? "Urgent requests are answered first."
                          : "We'll read this conversation, so you won't need to repeat yourself."}
                      </p>
                    </div>
                  </div>
                  <Button className="w-full" onClick={() => setView({ name: "handoff", urgent: entry.urgent })}>
                    <MessageSquareText className="h-4 w-4" />
                    Message support
                  </Button>
                </div>
              ),
            )
          : null}

        {view.name === "handoff" ? (
          <HandoffForm
            defaultMessage={lastQuestion?.text ?? ""}
            identity={identity}
            onBack={() => setView(entries.length > 0 ? { name: "chat" } : { name: "home" })}
            onSent={(reference, urgent) => {
              void loadTickets();
              setView({ name: "sent", reference, urgent });
            }}
            pagePath={pathname}
            signedIn={signedIn}
            transcript={transcript}
            urgent={view.urgent}
          />
        ) : null}

        {view.name === "sent" ? (
          <div className="space-y-4 pt-6 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-600">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <div>
              <p className="font-heading text-xl font-semibold">Message sent</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your reference is <span className="font-mono font-semibold text-foreground">{view.reference}</span>.{" "}
                {view.urgent ? "It's marked urgent and will be answered first." : "We usually reply within one business day."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Replies appear under Messages.</p>
            </div>
            <Button onClick={() => setView({ name: "requests" })} variant="outline">
              <Inbox className="h-4 w-4" />
              View messages
            </Button>
          </div>
        ) : null}

        {view.name === "requests" ? (
          tickets.length === 0 ? (
            <div className="space-y-3 pt-8 text-center text-sm text-muted-foreground">
              <Inbox className="mx-auto h-8 w-8" />
              <p>No messages yet. Ask a question, and if it needs a person we&rsquo;ll take it from there.</p>
              <Button onClick={() => setView({ name: "handoff", urgent: false })} variant="outline">
                <MessageSquareText className="h-4 w-4" />
                Send us a message
              </Button>
            </div>
          ) : (
            <div className="support-card divide-y divide-border">
              {tickets.map((ticket) => (
                <button
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted/60"
                  key={ticket.id}
                  onClick={() => setView({ id: ticket.id, name: "thread" })}
                  type="button"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {ticket.unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" /> : null}
                      <span className="truncate">{ticket.subject}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ticket.reference} · {timeAgo(ticket.lastMessageAt)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
                      ticket.status === "resolved"
                        ? "bg-muted text-muted-foreground"
                        : ticket.status === "waiting_on_customer"
                          ? "bg-primary/10 text-primary"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {statusLabel[ticket.status]}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : null}

        {view.name === "thread" ? (
          <TicketThread id={view.id} identity={identity} onBack={() => setView({ name: "requests" })} onChange={loadTickets} />
        ) : null}
      </div>

      {view.name === "chat" ? (
        <form className="border-t border-border bg-background/80 p-3" onSubmit={submitDraft}>
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-1.5 focus-within:border-primary/50">
            <Input
              aria-label="Ask a question"
              className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              maxLength={500}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask a question…"
              value={draft}
            />
            <Button aria-label="Ask" className="h-8 w-8 shrink-0 rounded-full" disabled={!draft.trim()} size="icon" type="submit">
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[0.68rem] text-muted-foreground">
            SaphraONE will never ask for your seed phrase or private key.
          </p>
        </form>
      ) : null}
    </div>
  );
}

function HandoffForm({
  defaultMessage,
  identity,
  onBack,
  onSent,
  pagePath,
  signedIn,
  transcript,
  urgent,
}: {
  defaultMessage: string;
  identity: { ownerWallet?: string | null; circleSocialUuid?: string | null };
  onBack: () => void;
  onSent: (reference: string, urgent: boolean) => void;
  pagePath: string;
  signedIn: boolean;
  transcript: { sender: "customer" | "assistant"; body: string }[];
  urgent: boolean;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await openSupportTicket({
        ...identity,
        email: signedIn ? undefined : email,
        message,
        pagePath,
        subject: message.split("\n")[0].slice(0, 80),
        transcript,
      });
      onSent(created.reference, created.urgent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your message couldn't be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <button
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <div>
        <p className="font-heading text-xl font-semibold">Message support</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {signedIn
            ? "We'll reply here, under My requests."
            : "You're not signed in, so add an email — replies also appear here, on this device."}
        </p>
      </div>
      {urgent ? (
        <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Marked urgent. Never share your seed phrase or private key — not even with us.
        </div>
      ) : null}
      {!signedIn ? (
        <label className="block text-sm font-medium">
          Email
          <Input
            autoComplete="email"
            className="mt-2 h-11"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </label>
      ) : null}
      <label className="block text-sm font-medium">
        What&rsquo;s going on?
        <textarea
          className="mt-2 min-h-32 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          maxLength={4000}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Include what you were doing, the amount and any transaction link."
          required
          value={message}
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button className="h-11 w-full" disabled={busy || message.trim().length < 5}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareText className="h-4 w-4" />}
        Send to support
      </Button>
    </form>
  );
}

function TicketThread({
  id,
  identity,
  onBack,
  onChange,
}: {
  id: string;
  identity: { ownerWallet?: string | null; circleSocialUuid?: string | null };
  onBack: () => void;
  onChange: () => void;
}) {
  const [thread, setThread] = useState<{ ticket: SupportTicketSummary; messages: SupportThreadMessage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setThread(await readSupportThread(id, identity));
      setError(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "This request couldn't be loaded.");
    }
  }, [id, identity, onChange]);

  // New replies show up while the thread is open.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try {
      setThread(await replyToSupport(id, reply, identity));
      setReply("");
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your reply couldn't be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
        My requests
      </button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!thread ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </p>
      ) : (
        <>
          {/* The subject is the first message, shown just below — so the
              heading names the topic and where the request stands instead. */}
          <div className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <MessageSquareText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-heading text-base font-semibold">
                  {supportCategories.find((category) => category.id === thread.ticket.category)?.label ?? "General question"}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{thread.ticket.reference}</span> · opened {timeAgo(thread.ticket.createdAt)}
                </p>
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-semibold",
                thread.ticket.status === "resolved"
                  ? "bg-muted text-muted-foreground"
                  : thread.ticket.status === "waiting_on_customer"
                    ? "bg-primary/10 text-primary"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
              )}
            >
              {thread.ticket.status === "open" ? "Waiting for support" : statusLabel[thread.ticket.status]}
            </span>
          </div>
          <div className="space-y-2.5">
            {thread.messages.map((message) =>
              message.sender === "system" ? (
                <p className="text-center text-xs text-muted-foreground" key={message.id}>
                  {message.body}
                </p>
              ) : (
                <div className={cn("flex", message.sender === "customer" ? "justify-end" : "justify-start")} key={message.id}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm",
                      message.sender === "customer"
                        ? "rounded-br-md bg-primary text-primary-foreground"
                        : message.sender === "agent"
                          ? "rounded-bl-md border border-primary/20 bg-primary/5"
                          : "rounded-bl-md bg-muted text-muted-foreground",
                    )}
                  >
                    {message.sender === "agent" ? (
                      <p className="mb-0.5 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-primary">SaphraONE team</p>
                    ) : null}
                    <p className="whitespace-pre-line">{message.body}</p>
                    <p className="mt-1 text-[0.65rem] opacity-70">{timeAgo(message.createdAt)}</p>
                  </div>
                </div>
              ),
            )}
          </div>
          <form className="space-y-2" onSubmit={send}>
            <textarea
              className="min-h-20 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              maxLength={4000}
              onChange={(event) => setReply(event.target.value)}
              placeholder={thread.ticket.status === "resolved" ? "Reply to reopen this request…" : "Write a reply…"}
              value={reply}
            />
            <Button className="w-full" disabled={busy || !reply.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send reply
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

