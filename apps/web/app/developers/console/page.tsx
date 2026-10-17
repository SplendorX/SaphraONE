import type { Metadata } from "next";
import { Suspense } from "react";

import { DeveloperConsole } from "@/components/developers/portal/developer-console";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Console",
};

export default function DeveloperConsolePage() {
  return (
    <Suspense>
      <DeveloperConsole />
    </Suspense>
  );
}
