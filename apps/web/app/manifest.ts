import type { MetadataRoute } from "next";

import { checkoutEnabled } from "@/lib/checkout/flag";

const shortcutIcon = [{ sizes: "192x192", src: "/icons/icon-192.png" }];

/**
 * Makes SaphraONE installable: "Add to Home Screen" on iPhone and Android,
 * "Install app" in Chrome and Edge on desktop. It opens in its own window,
 * without browser bars, straight into the dashboard.
 *
 * On Windows the installed app draws its own title bar (window controls
 * overlay, styled in components/layout/windows-shell.css), the shortcuts
 * below become the taskbar icon's jump list, opening it again focuses the
 * window already open, and Edge can pin it to its sidebar.
 */
export default function manifest(): MetadataRoute.Manifest {
  const manifest = {
    background_color: "#080609",
    categories: ["finance", "business", "productivity"],
    description: "Send, request, swap and save USDC and EURC — payments that settle in seconds.",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    // Edge's sidebar: the phone layout, pinned beside any site.
    edge_side_panel: { preferred_width: 420 },
    icons: [
      { purpose: "any", sizes: "192x192", src: "/icons/icon-192.png", type: "image/png" },
      { purpose: "any", sizes: "512x512", src: "/icons/icon-512.png", type: "image/png" },
      { purpose: "maskable", sizes: "192x192", src: "/icons/maskable-192.png", type: "image/png" },
      { purpose: "maskable", sizes: "512x512", src: "/icons/maskable-512.png", type: "image/png" },
    ],
    id: "/",
    launch_handler: { client_mode: ["focus-existing", "auto"] },
    name: "SaphraONE",
    orientation: "any",
    scope: "/",
    short_name: "SaphraONE",
    // Long-press the app icon (Android) or right-click it on the Windows
    // taskbar to jump straight in.
    shortcuts: [
      { name: "Send", short_name: "Send", url: "/send", icons: shortcutIcon },
      { name: "Request a payment", short_name: "Request", url: "/pay", icons: shortcutIcon },
      { name: "Add money", short_name: "Add money", url: "/deposit", icons: shortcutIcon },
      { name: "Swap", short_name: "Swap", url: "/swap", icons: shortcutIcon },
      { name: "Save", short_name: "Save", url: "/save", icons: shortcutIcon },
      { name: "Insights", short_name: "Insights", url: "/insights", icons: shortcutIcon },
      ...(checkoutEnabled
        ? [{ name: "Get paid", short_name: "Get paid", url: "/business/checkout", icons: shortcutIcon }]
        : []),
    ],
    start_url: "/dashboard?source=app",
    theme_color: "#080609",
  } satisfies MetadataRoute.Manifest & { edge_side_panel: { preferred_width: number } };
  return manifest;
}
