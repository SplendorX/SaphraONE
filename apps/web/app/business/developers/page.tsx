"use client";

import { DevelopersHub } from "@/components/developers/developers-hub";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformProfileControls } from "@/components/platform-profile-controls";

export default function DevelopersPage() {
  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        // The hub draws its own bar with a back button.
        hideHeader
        subtitle="Accept payments on your website with the Checkout API"
        title="Developers"
      >
        <DevelopersHub />
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
