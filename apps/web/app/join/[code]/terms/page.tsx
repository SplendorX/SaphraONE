import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PlatformBrand } from "@/components/brand/platform-brand";
import { loadPublicOffer, standardTerms } from "@/lib/partners/offer-view";

type TermsPageProps = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: TermsPageProps): Promise<Metadata> {
  const offer = await loadPublicOffer((await params).code);
  return {
    robots: { follow: false, index: false },
    title: offer ? `Offer terms: ${offer.title}` : "SaphraONE",
  };
}

/** Plain paragraphs and "- " lists, which is all an offer's terms use. */
function TermsText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim());
        if (lines.every((line) => /^[-*]\s+/.test(line))) {
          return (
            <ul className="list-disc space-y-1.5 pl-5" key={index}>
              {lines.map((line, item) => (
                <li key={item}>{line.replace(/^[-*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{lines.join(" ")}</p>;
      })}
    </>
  );
}

export default async function OfferTermsPage({ params }: TermsPageProps) {
  const offer = await loadPublicOffer((await params).code);
  if (!offer) notFound();
  const ends = offer.endsAt
    ? new Date(offer.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between">
          <Link aria-label="SaphraONE home" href="/">
            <PlatformBrand />
          </Link>
          <Link className="text-sm font-semibold text-primary" href={`/join/${offer.code}`}>
            Back to the offer
          </Link>
        </header>

        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Offer terms</p>
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{offer.title}</h1>
          <p className="text-sm text-muted-foreground">
            With {offer.partner.displayName}
            {ends ? ` · new signups until ${ends}` : ""}
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-bold">The welcome package</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {offer.perks.map((perk) => (
              <li key={perk.kind}>{perk.summary}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold">Rules</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {standardTerms(offer).map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>

        {offer.termsMd ? (
          <section className="space-y-3 text-sm text-muted-foreground">
            <h2 className="text-base font-bold text-foreground">This offer</h2>
            <TermsText text={offer.termsMd} />
          </section>
        ) : null}

        <p className="border-t border-border/50 pt-4 text-xs text-muted-foreground">
          {offer.partner.displayName} is a SaphraONE partner and may be paid for sharing this link.
        </p>
      </div>
    </main>
  );
}
