"use client";

import { usePathname } from "next/navigation";

import { usePortal } from "@/components/developers/portal/portal-context";
import { type DeveloperMode, developerUrls } from "@/lib/developers/site";

const labels: Record<DeveloperMode, string> = { live: "Live", sandbox: "Sandbox" };

/**
 * Sandbox ⇄ Live. Each mode is its own deployment (testnet or mainnet, with
 * its own database), so switching opens the same page on the other portal.
 */
export function ModeToggle() {
  const { base, mode } = usePortal();
  const pathname = usePathname() ?? "/";
  // The page within the portal, whichever host it is on.
  const inner = base && pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;

  return (
    <div aria-label="Environment" className="dp-mode-toggle" data-mode={mode} role="group">
      {(["sandbox", "live"] as const).map((option) => {
        const active = option === mode;
        return (
          <a
            aria-current={active ? "true" : undefined}
            className="dp-mode-option"
            data-active={active || undefined}
            data-option={option}
            href={active ? undefined : `${developerUrls(option).portal}${inner === "/" ? "" : inner}`}
            key={option}
            title={
              active
                ? `You are in ${labels[option].toLowerCase()} mode`
                : `Switch to ${labels[option].toLowerCase()} mode`
            }
          >
            <span aria-hidden className="dp-mode-dot" />
            {labels[option]}
          </a>
        );
      })}
    </div>
  );
}
