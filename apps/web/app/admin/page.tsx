"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { useAdmin } from "@/components/admin/admin-shell";
import { adminTools } from "@/lib/admin/tools";

/** The admin platform's home: every tool this person can open. */
export default function AdminOverviewPage() {
  const { actor, can } = useAdmin();
  const tools = adminTools.filter(
    (tool) => can(tool.id) && (!("ownerOnly" in tool) || actor.role === "owner"),
  );

  return (
    <div>
      <div className="adm-page-head">
        <div>
          <h1 className="adm-title">{actor.via === "key" ? "Welcome back" : `Welcome, ${actor.label}`}</h1>
          <p className="adm-subtitle">
            {actor.role === "owner"
              ? "You have every tool, and decide who else gets which on Team & access."
              : "These are the tools you've been given. Ask an owner if you need another."}
          </p>
        </div>
      </div>

      <div className="adm-grid adm-grid-2">
        {tools.map((tool) => (
          <Link className="adm-card group block transition hover:border-primary/40" href={tool.href} key={tool.id}>
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">{tool.label}</p>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
          </Link>
        ))}
      </div>

      {actor.role === "owner" && actor.via === "key" ? (
        <p className="adm-note mt-6">
          Tip: add yourself on Team &amp; access as an owner, then you can sign in with your own
          SaphraONE account instead of the owner key.
        </p>
      ) : null}
    </div>
  );
}
