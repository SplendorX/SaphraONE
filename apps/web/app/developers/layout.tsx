import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { PortalProvider } from "@/components/developers/portal/portal-context";
import { PortalShell } from "@/components/developers/portal/portal-shell";
import { developerSurfaceFor, developerUrls, requestHost } from "@/lib/developers/site";

const description =
  "Accept USDC on your website with the SaphraONE Checkout API: a hosted payment page, sandbox and live modes, and payments settled to your wallet on Arc in under a second.";

export const metadata: Metadata = {
  description,
  // Links and previews point at the portal's own domain.
  metadataBase: new URL(developerUrls().portal),
  openGraph: { description, siteName: "SaphraONE Developers", title: "SaphraONE Developers" },
  title: { default: "SaphraONE Developers | Checkout API", template: "%s | SaphraONE Developers" },
};

export default async function DevelopersLayout({ children }: { children: ReactNode }) {
  // On developers.saphra.one these pages sit at the root; on the app, under /developers.
  const onPortalHost = developerSurfaceFor(requestHost(await headers())) === "portal";
  return (
    <PortalProvider base={onPortalHost ? "" : "/developers"}>
      <PortalShell>{children}</PortalShell>
    </PortalProvider>
  );
}
