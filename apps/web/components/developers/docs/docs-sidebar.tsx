"use client";

import { ChevronDown, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { docEntries, docGroups, docHref } from "@/components/developers/docs/nav";
import { Badge } from "@/components/developers/docs/blocks";
import { PortalLink, usePortal } from "@/components/developers/portal/portal-context";
import { cn } from "@/lib/utils";

/** The docs navigation: grouped pages with a filter box. A disclosure on phones. */
export function DocsSidebar() {
  const { base } = usePortal();
  const pathname = usePathname() ?? "";
  const inner = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return docEntries;
    return docEntries.filter((entry) => {
      const haystack = `${entry.title} ${entry.description} ${entry.keywords ?? ""}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [query]);

  const current = docEntries.find((entry) => docHref(entry.slug) === inner);

  return (
    <aside className="dp-docs-sidebar" data-open={open || undefined}>
      <button
        aria-expanded={open}
        className="dp-docs-sidebar-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span>{current?.title ?? "Documentation"}</span>
        <ChevronDown aria-hidden className="h-4 w-4" />
      </button>
      <div className="dp-docs-sidebar-body">
        <label className="dp-docs-search">
          <Search aria-hidden className="h-4 w-4" />
          <input
            aria-label="Search the docs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search docs"
            type="search"
            value={query}
          />
        </label>
        {docGroups.map((group) => {
          const entries = visible.filter((entry) => entry.group === group);
          if (entries.length === 0) return null;
          return (
            <div className="dp-docs-group" key={group}>
              <p className="dp-docs-group-title">{group}</p>
              <ul>
                {entries.map((entry) => {
                  const href = docHref(entry.slug);
                  return (
                    <li key={entry.slug}>
                      <PortalLink
                        aria-current={href === inner ? "page" : undefined}
                        className={cn("dp-docs-link", href === inner && "dp-docs-link-active")}
                        href={href}
                        onClick={() => setOpen(false)}
                      >
                        {entry.title}
                        {entry.soon ? <Badge tone="soon">Soon</Badge> : null}
                      </PortalLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {visible.length === 0 ? <p className="dp-muted px-2 text-sm">No pages match “{query}”.</p> : null}
      </div>
    </aside>
  );
}
