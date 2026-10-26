import type { Metadata } from "next";
import { headers } from "next/headers";

import { CorporateHome } from "@/components/company/corporate-home";
import { LandingPage } from "@/components/landing/landing-page";

function isCorporateHost(host: string) {
  const hostname = host.split(",")[0]?.trim().toLowerCase().replace(/:\\d+$/, "");
  return hostname === "saphra.one" || hostname === "www.saphra.one";
}

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";

  if (isCorporateHost(host)) {
    return {
      description:
        "SaphraONE is building a more open, useful way for people, businesses, and builders to move value.",
      title: "SaphraONE | Move value with more possibility",
    };
  }

  return {};
}

export default async function Home() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";

  if (isCorporateHost(host)) {
    return <CorporateHome />;
  }

  return <LandingPage />;
}
