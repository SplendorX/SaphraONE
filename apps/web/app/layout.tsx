import { arcChain } from "@/lib/chains";
import "./globals.css";
import "./bubble.css";
import "./app-chrome.css";
import "@/components/layout/page-title.css";

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { Providers } from "@/app/providers";
import { AppLockGate } from "@/components/app-lock/app-lock-gate";
import { TxApprovalSheet } from "@/components/tx-approval/tx-approval-sheet";
import { SplashScreen } from "@/components/splash-screen";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Self-hosted (latin, variable weight) rather than next/font/google: Next's
// Google loader chokes on Google's newer multi-parameter font URLs ("queries
// have exactly one entry"), and local files also make builds network-free.
const manrope = localFont({
  display: "swap",
  src: [{ path: "./fonts/manrope-latin-variable.woff2", style: "normal", weight: "400 800" }],
  variable: "--font-manrope",
});

const sora = localFont({
  display: "swap",
  src: [{ path: "./fonts/sora-latin-variable.woff2", style: "normal", weight: "400 700" }],
  variable: "--font-sora",
});

const instrumentSerif = localFont({
  display: "swap",
  src: [{ path: "./fonts/instrument-serif-latin-400.woff2", style: "normal", weight: "400" }],
  variable: "--font-display",
});

const siteTitle = "SaphraONE | Powering possibilities with USDC";
const siteDescription =
  `Money movement infrastructure for the internet. Send, batch, request, swap, and settle stablecoins on ${arcChain.name}.`;
const brandMark = "/brand/saphra-mark.png";
const shareTitle = "SaphraONE | One account. One identity. Anywhere.";
const shareDescription =
  "Send, save and get paid in USDC with your ONE ID: a name, not a number. Settles on Arc in under a second.";
// Versioned so apps that cache link previews fetch the new banner.
const shareImage = "/og/saphra-share.jpg?v=1";

function getSiteUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) {
    return `https://${vercelHost}`;
  }

  return "http://localhost:3000";
}

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: siteTitle,
  description: siteDescription,
  applicationName: "SaphraONE",
  // iPhone and iPad: "Add to Home Screen" opens SaphraONE as its own app.
  // The home-screen icon is /icons/apple-touch-icon.png, set in icons below.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SaphraONE",
  },
  formatDetection: { telephone: false },
  icons: {
    // Full-bleed: iOS fills transparent corners with black.
    apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
    icon: [{ url: brandMark, type: "image/png", sizes: "32x32" }],
    shortcut: brandMark,
  },
  // What a shared link shows (WhatsApp, X, Telegram, iMessage, Slack…): the
  // banner, made from the brand (public/og/saphra-share.jpg, 1200×630).
  openGraph: {
    description: shareDescription,
    images: [
      {
        alt: shareTitle,
        height: 630,
        type: "image/jpeg",
        url: shareImage,
        width: 1200,
      },
    ],
    siteName: "SaphraONE",
    title: shareTitle,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    description: shareDescription,
    images: [{ alt: shareTitle, url: shareImage }],
    title: shareTitle,
  },
};

/** Browser and status-bar colour, matching the app's light and dark surfaces. */
export const viewport: Viewport = {
  themeColor: [
    { color: "#ffffff", media: "(prefers-color-scheme: light)" },
    { color: "#080609", media: "(prefers-color-scheme: dark)" },
  ],
};

const themeInitScript = `(function(){try{var pref=localStorage.getItem("saphra.theme")||"dark";var resolved=pref;if(pref==="system"){resolved=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}var dark=resolved==="dark";document.documentElement.dataset.theme=dark?"dark":"light";document.documentElement.dataset.themePref=pref;document.documentElement.style.colorScheme=dark?"dark":"light";document.documentElement.classList.toggle("dark",dark);var surface=localStorage.getItem("saphra.light-surface");document.documentElement.dataset.lightSurface=surface==="cream"?"cream":"glass";var loc=localStorage.getItem("saphra.locale");var locales=["en","es","fr","de","pt","ar","zh","ja","ko"];if(loc&&locales.indexOf(loc)!==-1){document.documentElement.lang=loc;document.documentElement.dir=loc==="ar"?"rtl":"ltr";}}catch(error){document.documentElement.classList.add("dark");document.documentElement.dataset.theme="dark";document.documentElement.style.colorScheme="dark";document.documentElement.dataset.lightSurface="glass";}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const headersList = await headers();
  const cookies = headersList.get("cookie");

  return (
    <html
      className={cn(manrope.variable, sora.variable, instrumentSerif.variable, "dark")}
      data-scroll-behavior="smooth"
      data-theme="dark"
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
          id="saphra-theme-init"
        />
        <SplashScreen />
        <TooltipProvider>
          <Providers cookies={cookies}>
            <AppLockGate>{children}</AppLockGate>
            <TxApprovalSheet />
          </Providers>
          <Toaster position="top-right" richColors />
        </TooltipProvider>
      </body>
    </html>
  );
}