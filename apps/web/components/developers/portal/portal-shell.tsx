"use client";

import { ArrowRight, ArrowUpRight, FlaskConical, Loader2, LogOut, Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { useDisconnect } from "wagmi";

import { useAccountContext } from "@/components/account/account-provider";
import { PlatformLogoMark } from "@/components/brand/platform-logo-mark";
import { PlatformWordmark } from "@/components/brand/platform-wordmark";
import { ModeToggle } from "@/components/developers/portal/mode-toggle";
import { PortalLink, usePortal } from "@/components/developers/portal/portal-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOutForAppLock } from "@/lib/app-lock/client";
import { cn } from "@/lib/utils";

import "./portal.css";
import "../../layout/windows-surfaces.css";

const navItems = [
  { href: "/docs", label: "Docs", match: (path: string) => path.startsWith("/docs") && !path.startsWith("/docs/api") },
  { href: "/docs/api", label: "API reference", match: (path: string) => path.startsWith("/docs/api") },
  { href: "/docs/business-guide", label: "For business", match: (path: string) => path === "/docs/business-guide" },
  { href: "/console", label: "Console", match: (path: string) => path.startsWith("/console") },
];

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "/";
}

/** Header, sandbox banner and footer of the developer portal. */
export function PortalShell({ children }: { children: ReactNode }) {
  const { base, mode } = usePortal();
  const pathname = usePathname() ?? "/";
  const inner = base && pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;
  const [menuOpen, setMenuOpen] = useState(false);
  const { account, ownerWallet } = useAccountContext();
  const { disconnect } = useDisconnect();
  const signedIn = Boolean(account || ownerWallet);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // The same full sign-out as the app; it lands on "/", the portal's home here.
  function signOut() {
    setSigningOut(true);
    void signOutForAppLock(disconnect);
  }

  const signOutIcon = signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />;

  return (
    <div className="win-surface dp-root" data-mode={mode}>
      {mode === "sandbox" ? (
        <div className="dp-sandbox-banner" role="status">
          <FlaskConical aria-hidden className="h-3.5 w-3.5" />
          <span>
            <strong>Sandbox.</strong> Test keys, Arc testnet and test USDC. No real money moves here.
          </span>
        </div>
      ) : null}

      <header className="dp-header">
        <div className="dp-header-inner">
          <PortalLink className="dp-brand" href="/">
            <PlatformLogoMark className="dp-brand-mark" />
            <PlatformWordmark className="dp-brand-name" />
            <span className="dp-brand-tag">Developers</span>
          </PortalLink>

          <nav aria-label="Developer portal" className="dp-nav">
            {navItems.map((item) => (
              <PortalLink
                className={cn("dp-nav-link", item.match(inner) && "dp-nav-link-active")}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </PortalLink>
            ))}
          </nav>

          <div className="dp-header-actions">
            <ModeToggle />
            <span className="dp-hide-sm">
              <ThemeToggle />
            </span>
            <PortalLink className="dp-btn dp-btn-primary dp-hide-sm" href="/console">
              {signedIn ? "Console" : "Get API keys"}
              <ArrowRight className="h-4 w-4" />
            </PortalLink>
            {signedIn ? (
              <button
                className="dp-btn dp-btn-ghost dp-hide-sm"
                disabled={signingOut}
                onClick={signOut}
                type="button"
              >
                {signOutIcon}
                Sign out
              </button>
            ) : null}
            <button
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="dp-menu-button"
              onClick={() => setMenuOpen((open) => !open)}
              type="button"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav aria-label="Developer portal" className="dp-mobile-nav">
            {navItems.map((item) => (
              <PortalLink
                className={cn("dp-nav-link", item.match(inner) && "dp-nav-link-active")}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </PortalLink>
            ))}
            <div className="dp-mobile-nav-row">
              <ThemeToggle />
              <a className="dp-nav-link" href={appUrl()}>
                Open SaphraONE
              </a>
            </div>
            {signedIn ? (
              <button className="dp-nav-link dp-nav-signout" disabled={signingOut} onClick={signOut} type="button">
                {signOutIcon}
                Sign out
              </button>
            ) : null}
          </nav>
        ) : null}
      </header>

      <div className="dp-main">{children}</div>

      <footer className="dp-footer">
        <div className="dp-footer-inner">
          <div className="dp-footer-brand">
            <span className="dp-brand">
              <PlatformLogoMark className="dp-brand-mark" />
              <PlatformWordmark className="dp-brand-name" />
              <span className="dp-brand-tag">Developers</span>
            </span>
            <p>Stablecoin checkout for websites and platforms. USDC on Arc, settled to your wallet in under a second.</p>
          </div>
          <div className="dp-footer-col">
            <p className="dp-footer-heading">Build</p>
            <PortalLink href="/docs/quickstart">Quickstart</PortalLink>
            <PortalLink href="/docs/accept-a-payment">Accept a payment</PortalLink>
            <PortalLink href="/docs/api">API reference</PortalLink>
            <a href="/openapi/checkout-v1.json">OpenAPI spec</a>
          </div>
          <div className="dp-footer-col">
            <p className="dp-footer-heading">Operate</p>
            <PortalLink href="/docs/sandbox-and-live">Sandbox and live</PortalLink>
            <PortalLink href="/docs/going-live">Going live</PortalLink>
            <PortalLink href="/docs/security">Security</PortalLink>
            <PortalLink href="/docs/changelog">Changelog</PortalLink>
          </div>
          <div className="dp-footer-col">
            <p className="dp-footer-heading">SaphraONE</p>
            <a href={appUrl()}>
              Open the app <ArrowUpRight aria-hidden className="inline h-3.5 w-3.5" />
            </a>
            <PortalLink href="/docs/business-guide">For business</PortalLink>
            <a href="https://x.com/saphraone" rel="noreferrer" target="_blank">
              X / Twitter
            </a>
          </div>
        </div>
        <p className="dp-footer-legal">
          © {new Date().getFullYear()} SaphraONE. SaphraONE is non-custodial: payments go straight to the
          merchant&rsquo;s wallet.
        </p>
      </footer>
    </div>
  );
}
