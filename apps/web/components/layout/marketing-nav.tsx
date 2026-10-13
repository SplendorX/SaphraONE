"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { PlatformWordmark } from "@/components/brand/platform-wordmark";
import { InstagramLogoLink, XLogoLink } from "@/components/brand/x-logo-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { LaunchAppLink } from "@/components/landing/launch-app-link";
import { useT } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

export function MarketingNav() {
  const pathname = usePathname();
  const t = useT();
  // Section links; on another page they lead back to that section of the landing page.
  const anchor = (id: string) => (pathname === "/" ? `#${id}` : `/#${id}`);
  const marketingLinks = [
    { href: anchor("products"), label: t("landing.home.navPlatform") },
    { href: anchor("allie"), label: t("landing.home.navAllie") },
    { href: anchor("business"), label: t("landing.home.navBusiness") },
    { href: anchor("security"), label: t("landing.home.navSecurity") },
    { href: anchor("faq"), label: t("landing.home.navFaq") },
  ];

  return (
    <header className="marketing-nav">
      <div className="marketing-nav-inner">
        <Link className="marketing-brand" href="/">
          <PlatformWordmark />
        </Link>

        <nav aria-label="Marketing" className="hidden items-center gap-1 md:flex">
          {marketingLinks.map((link) => (
            <Link
              className={cn(
                "marketing-nav-link rounded-lg px-3 py-2 text-sm font-medium transition",
                pathname === link.href
                  ? "marketing-nav-link-active"
                  : undefined,
              )}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <XLogoLink />
          <InstagramLogoLink />
          {/* Phones: no room in the top bar; the theme stays in Settings. */}
          <span className="hidden sm:inline-flex">
            <ThemeToggle />
          </span>
          <LaunchAppLink className="hero-launch-btn marketing-nav-launch">
            {t("common.openSaphra")}
            <ArrowRight className="h-4 w-4" />
          </LaunchAppLink>
        </div>
      </div>
    </header>
  );
}
