"use client";

import { PlatformChrome } from "@/components/layout/platform-chrome";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { WithdrawHub } from "@/components/withdraw/withdraw-hub";

export default function WithdrawPage() {
  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        // The hub draws its own bar with a back button.
        hideHeader
        subtitle="Send USDC to your bank as Naira"
        title="Withdraw"
      >
        <WithdrawHub />
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
