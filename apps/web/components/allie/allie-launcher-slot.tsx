"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { isAllieHiddenPath } from "@/components/allie/allie-visibility";
import { hasSignedInCookie } from "@/lib/app-lock/client";

const AllieLauncher = dynamic(
  () => import("@/components/allie/AllieLauncher").then((m) => m.AllieLauncher),
  { ssr: false },
);

/**
 * Where ALLIE's launcher goes. Its code loads only on pages where it can
 * show and for someone signed in, so the landing page, sign-in and other
 * public pages don't download it at all.
 */
export function AllieLauncherSlot() {
  const pathname = usePathname() ?? "/";
  const [signedIn, setSignedIn] = useState(false);

  // Read after mount (the cookie isn't there on the server); again when the
  // route changes, which is what signing in or out does.
  useEffect(() => {
    setSignedIn(hasSignedInCookie());
  }, [pathname]);

  if (!signedIn || isAllieHiddenPath(pathname)) return null;
  return <AllieLauncher />;
}
