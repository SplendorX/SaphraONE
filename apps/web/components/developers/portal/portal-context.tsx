"use client";

import Link from "next/link";
import { type ComponentProps, createContext, type ReactNode, useContext } from "react";

import {
  apiBaseUrl,
  type DeveloperMode,
  developerMode,
  developerUrls,
  keyPrefixFor,
} from "@/lib/developers/site";

type PortalContextValue = {
  /** "" on the portal's own host, "/developers" on the app's. */
  base: string;
  mode: DeveloperMode;
};

const PortalContext = createContext<PortalContextValue>({ base: "/developers", mode: developerMode() });

export function PortalProvider({ base, children }: { base: string; children: ReactNode }) {
  return <PortalContext.Provider value={{ base, mode: developerMode() }}>{children}</PortalContext.Provider>;
}

export function usePortal() {
  const { base, mode } = useContext(PortalContext);
  return {
    apiBase: apiBaseUrl(mode),
    base,
    /** A portal path ("/docs/quickstart") as this host serves it. */
    href: (path: string) => portalPath(base, path),
    keyPrefix: keyPrefixFor(mode),
    mode,
    urls: developerUrls(mode),
  };
}

export function portalPath(base: string, path: string) {
  if (path === "/") return base || "/";
  return `${base}${path}`;
}

/** A link to a portal page, right on either host. */
export function PortalLink({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const { base } = useContext(PortalContext);
  const external = /^https?:\/\//.test(href) || href.startsWith("#");
  return <Link href={external ? href : portalPath(base, href)} {...props} />;
}
