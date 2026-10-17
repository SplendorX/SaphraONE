"use client";

import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Coins,
  FileClock,
  Gift,
  Handshake,
  KeyRound,
  LayoutGrid,
  LifeBuoy,
  Loader2,
  LogOut,
  Megaphone,
  ReceiptText,
  ShieldCheck,
  UserRoundSearch,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  actorCan,
  adminToolForPath,
  adminTools,
  type AdminActor,
  type AdminToolId,
} from "@/lib/admin/tools";
import { cn } from "@/lib/utils";

import "./admin.css";

// The same key the older admin pages read (components/admin/use-admin-key.ts).
const ownerKeyStorage = "saphra.admin-key";

const toolIcons: Record<AdminToolId, LucideIcon> = {
  audit: FileClock,
  campaigns: Megaphone,
  earn: Coins,
  partners: Handshake,
  rewards: Gift,
  support: LifeBuoy,
  team: UsersRound,
  traction: BarChart3,
  transactions: ReceiptText,
  users: UserRoundSearch,
  verifications: BadgeCheck,
};

type AdminContextValue = {
  actor: AdminActor;
  /** fetch for the admin API: adds the owner key when that's how they signed in. */
  adminFetch: (input: string, init?: RequestInit) => Promise<Response>;
  can: (tool: AdminToolId) => boolean;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin is only available inside the admin platform.");
  return value;
}

function readOwnerKey() {
  try {
    return window.sessionStorage.getItem(ownerKeyStorage) ?? "";
  } catch {
    return "";
  }
}

function withKey(init: RequestInit | undefined, key: string): RequestInit {
  const headers = new Headers(init?.headers);
  if (key) headers.set("authorization", `Bearer ${key}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return { cache: "no-store", credentials: "include", ...init, headers };
}

/**
 * The admin platform: one place for every tool, at /admin on the app's own
 * domain. The owner signs in with the owner key (ADMIN_SECRET); the team
 * signs in with their own SaphraONE account and sees only the tools they were
 * given on Team & access. The server checks the same thing on every call.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [actor, setActor] = useState<AdminActor | null>(null);
  const [state, setState] = useState<"checking" | "signed-out" | "ready">("checking");
  const [ownerKey, setOwnerKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (key: string) => {
    setState("checking");
    try {
      const response = await fetch("/api/admin/me", withKey(undefined, key));
      if (response.ok) {
        const { actor: next } = (await response.json()) as { actor: AdminActor };
        setActor(next);
        setState("ready");
        setError(null);
        return true;
      }
      setActor(null);
      setState("signed-out");
      return false;
    } catch {
      setActor(null);
      setState("signed-out");
      setError("Couldn't reach the server. Try again.");
      return false;
    }
  }, []);

  useEffect(() => {
    const key = readOwnerKey();
    setOwnerKey(key);
    void check(key);
  }, [check]);

  async function signInWithKey(key: string) {
    const trimmed = key.trim();
    if (!trimmed) return;
    if (await check(trimmed)) {
      try {
        window.sessionStorage.setItem(ownerKeyStorage, trimmed);
      } catch {}
      setOwnerKey(trimmed);
    } else {
      setError("That key wasn't accepted.");
    }
  }

  function signOut() {
    try {
      window.sessionStorage.removeItem(ownerKeyStorage);
    } catch {}
    setOwnerKey("");
    void check("");
  }

  const value = useMemo<AdminContextValue | null>(
    () =>
      actor
        ? {
            actor,
            adminFetch: (input, init) => fetch(input, withKey(init, ownerKey)),
            can: (tool) => actorCan(actor, tool),
          }
        : null,
    [actor, ownerKey],
  );

  if (state === "checking" && !actor) {
    return (
      <div className="adm-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!actor || !value) {
    return <AdminSignIn error={error} onKey={(key) => void signInWithKey(key)} />;
  }

  const visible = adminTools.filter((tool) => actorCan(actor, tool.id) && (!("ownerOnly" in tool) || actor.role === "owner"));
  const current = adminToolForPath(pathname ?? "/admin");
  const allowed = !current || visible.some((tool) => tool.id === current);

  return (
    <AdminContext.Provider value={value}>
      <div className="adm-shell">
        <aside className="adm-side">
          <Link className="adm-brand" href="/admin">
            <ShieldCheck className="h-5 w-5" />
            <span>SaphraONE Admin</span>
          </Link>
          <nav className="adm-nav" aria-label="Admin tools">
            <AdminNavLink active={pathname === "/admin"} href="/admin" icon={LayoutGrid} label="Overview" />
            {visible.map((tool) => (
              <AdminNavLink
                active={current === tool.id}
                href={tool.href}
                icon={toolIcons[tool.id]}
                key={tool.id}
                label={tool.label}
              />
            ))}
          </nav>
          <div className="adm-who">
            <p className="adm-who-name">{actor.label}</p>
            <p className="adm-who-role">
              {actor.role === "owner" ? "Owner" : "Team member"} ·{" "}
              {actor.via === "key" ? "owner key" : "SaphraONE account"}
            </p>
            <div className="adm-who-actions">
              <Link className="adm-who-link" href="/dashboard">
                <ArrowLeft className="h-3.5 w-3.5" />
                App
              </Link>
              {actor.via === "key" ? (
                <button className="adm-who-link" onClick={signOut} type="button">
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              ) : null}
            </div>
          </div>
        </aside>
        <main className="adm-main">
          {allowed ? (
            children
          ) : (
            <div className="adm-card adm-denied">
              <KeyRound className="h-6 w-6 text-muted-foreground" />
              <h1>You don&apos;t have access to this tool</h1>
              <p>Ask an owner to add it to your access on Team &amp; access.</p>
            </div>
          )}
        </main>
      </div>
    </AdminContext.Provider>
  );
}

function AdminNavLink({
  active,
  href,
  icon: Icon,
  label,
}: {
  active: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link aria-current={active ? "page" : undefined} className={cn("adm-nav-link", active && "is-active")} href={href}>
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  );
}

function AdminSignIn({ error, onKey }: { error: string | null; onKey: (key: string) => void }) {
  const [key, setKey] = useState("");
  return (
    <div className="adm-center">
      <div className="adm-card adm-signin">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <h1>SaphraONE Admin</h1>
        <p>
          Team members: sign in to SaphraONE with your own account. If an owner has added you, your
          tools appear here.
        </p>
        <Button asChild className="w-full">
          <Link href="/sign-in?next=/admin">Sign in with SaphraONE</Link>
        </Button>
        <div className="adm-divider">
          <span>or, for the owner</span>
        </div>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onKey(key);
          }}
        >
          <Input
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
            placeholder="Owner key"
            type="password"
            value={key}
          />
          <Button disabled={!key.trim()} type="submit" variant="outline">
            <KeyRound className="h-4 w-4" />
            Use the owner key
          </Button>
        </form>
        {error ? <p className="adm-error">{error}</p> : null}
        <p className="adm-fine">
          Signed in already but still seeing this? Your account isn&apos;t on the admin team yet.
        </p>
      </div>
    </div>
  );
}

/** A tool page's title, with its actions (Refresh…) on the right. */
export function AdminPageHeader({
  actions,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="adm-page-head">
      <div>
        <h1 className="adm-title">{title}</h1>
        {subtitle ? <p className="adm-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
