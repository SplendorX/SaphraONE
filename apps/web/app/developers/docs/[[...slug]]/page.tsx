import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { docContext } from "@/components/developers/docs/context";
import { docEntry, docHref, docNeighbours } from "@/components/developers/docs/nav";
import { docComponents } from "@/components/developers/docs/registry";
import { PortalLink } from "@/components/developers/portal/portal-context";

type PageProps = { params: Promise<{ slug?: string[] }> };

function slugOf(parts: string[] | undefined) {
  return (parts ?? []).join("/").toLowerCase();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const entry = docEntry(slugOf((await params).slug));
  if (!entry) return { title: "Not found" };
  return {
    description: entry.description,
    title: entry.slug ? entry.title : "Documentation",
  };
}

export default async function DocPage({ params }: PageProps) {
  const slug = slugOf((await params).slug);
  const entry = docEntry(slug);
  const Content = docComponents[slug];
  if (!entry || !Content) notFound();
  const { next, previous } = docNeighbours(slug);

  return (
    <article className="dp-doc">
      <p className="dp-doc-eyebrow">{entry.group}</p>
      <h1 className="dp-doc-title">{entry.slug ? entry.title : "SaphraONE Checkout API"}</h1>
      <div className="dp-prose">
        <Content ctx={docContext()} />
      </div>
      <nav aria-label="More docs" className="dp-pager">
        {previous ? (
          <PortalLink className="dp-pager-link" href={docHref(previous.slug)}>
            <span className="dp-pager-label">
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> Previous
            </span>
            <span className="dp-pager-title">{previous.title}</span>
          </PortalLink>
        ) : (
          <span />
        )}
        {next ? (
          <PortalLink className="dp-pager-link dp-pager-next" href={docHref(next.slug)}>
            <span className="dp-pager-label">
              Next <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </span>
            <span className="dp-pager-title">{next.title}</span>
          </PortalLink>
        ) : null}
      </nav>
    </article>
  );
}
