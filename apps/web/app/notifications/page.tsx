import { NotificationsBell } from "@/components/notifications-bell";
import { PlatformAccessGate } from "@/components/platform-access-gate";
import { PlatformProfileControls } from "@/components/platform-profile-controls";
import { PlatformChrome } from "@/components/layout/platform-chrome";

import "./notifications.css";

export const metadata = {
  title: "Notifications — SaphraONE",
};

/** Where the bell leads on phones; desktop opens the same list as a popover. */
export default function Notifications() {
  return (
    <PlatformAccessGate>
      <PlatformChrome
        actions={<PlatformProfileControls />}
        // The page draws its own header; skip the frame's to avoid a second title.
        hideHeader
        subtitle="Payments, requests, and savings"
        title="Notifications"
      >
        <NotificationsBell variant="page" />
      </PlatformChrome>
    </PlatformAccessGate>
  );
}
