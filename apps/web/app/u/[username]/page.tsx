"use client";

import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Globe,
  Mail,
  MapPin,
  Phone,
  Tag,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { PlatformBrand } from "@/components/brand/platform-brand";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/verified-badge";
import { fetchDirectoryProfile } from "@/lib/business/client";
import type { PublicProfile } from "@/lib/business/types";
import { countryFlag, findCountry } from "@/lib/countries";

function memberSinceLabel(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : `Member since ${date.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;
}

function websiteHref(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function Detail({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="public-profile-detail">
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 break-words">{children}</span>
    </li>
  );
}

/**
 * A SaphraONE public profile. Businesses show how to reach them; a person's
 * page shows only their country and join date, never email or phone.
 */
export default function PublicProfilePage() {
  const router = useRouter();
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? "").replace(/^@/, "").replace(/\.one$/i, "");
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;
    void fetchDirectoryProfile(username)
      .then((payload) => setProfile(payload.profile))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Profile was not found."),
      );
  }, [username]);

  // Back to wherever the visitor came from; a shared link opened fresh has
  // no history, so it goes home instead.
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  const isBusiness = profile?.kind === "business";
  const country = findCountry(profile?.country);
  const since = memberSinceLabel(profile?.memberSince);

  return (
    <main className="public-profile">
      <header className="public-profile-top">
        <button className="public-profile-back" onClick={goBack} type="button">
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <Link aria-label="SaphraONE home" href="/">
          <PlatformBrand />
        </Link>
      </header>

      {error ? (
        <section className="public-profile-card">
          <h1 className="public-profile-name">Profile not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No SaphraONE account uses @{username}. Check the spelling and try again.
          </p>
        </section>
      ) : !profile ? (
        <section aria-busy className="public-profile-card">
          <div className="public-profile-avatar animate-pulse" />
          <div className="mt-5 h-8 w-48 animate-pulse rounded-lg bg-muted" />
          <div className="mt-3 h-4 w-28 animate-pulse rounded bg-muted" />
        </section>
      ) : (
        <section className="public-profile-card">
          <div className="public-profile-avatar">
            {profile.avatarUrl ? (
              <img alt="" className="h-full w-full object-cover" src={profile.avatarUrl} />
            ) : isBusiness ? (
              <Building2 className="h-8 w-8" />
            ) : (
              <UserRound className="h-8 w-8" />
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="public-profile-kind">
              {isBusiness ? <Building2 className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
              {isBusiness ? "Business" : "Personal"}
            </span>
            <VerifiedBadge hit={profile} withLabel />
          </div>

          <h1 className="public-profile-name">
            {profile.displayName}
            <VerifiedBadge hit={profile} />
          </h1>
          <p className="public-profile-handle">{profile.username}.one</p>

          {profile.bio ? <p className="public-profile-bio">{profile.bio}</p> : null}

          <ul className="public-profile-details">
            {isBusiness && profile.category ? <Detail icon={Tag}>{profile.category}</Detail> : null}
            {isBusiness && profile.website ? (
              <Detail icon={Globe}>
                <a href={websiteHref(profile.website)} rel="noopener noreferrer" target="_blank">
                  {profile.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                </a>
              </Detail>
            ) : null}
            {isBusiness && profile.contactEmail ? (
              <Detail icon={Mail}>
                <a href={`mailto:${profile.contactEmail}`}>{profile.contactEmail}</a>
              </Detail>
            ) : null}
            {isBusiness && profile.phone ? (
              <Detail icon={Phone}>
                <a href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}>{profile.phone}</a>
              </Detail>
            ) : null}
            {profile.country ? (
              <Detail icon={MapPin}>
                {country ? `${countryFlag(country.code)} ${country.name}` : profile.country}
              </Detail>
            ) : null}
            {since ? <Detail icon={CalendarDays}>{since}</Detail> : null}
          </ul>

          <div className="public-profile-actions">
            <Button asChild>
              <Link href={`/send?to=@${encodeURIComponent(profile.username)}`}>
                Pay {isBusiness ? profile.displayName : `${profile.username}.one`}
              </Link>
            </Button>
            {isBusiness ? (
              profile.contactEmail ? (
                <Button asChild variant="outline">
                  <a href={`mailto:${profile.contactEmail}`}>
                    <Mail className="h-4 w-4" />
                    Email
                  </a>
                </Button>
              ) : null
            ) : (
              <Button asChild variant="outline">
                <Link href={`/pay?username=${encodeURIComponent(profile.username)}`}>Request</Link>
              </Button>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
