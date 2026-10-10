"use client";

import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

export type HubSection = {
  /** Also the URL hash when `syncHash` is on, so deep links keep working. */
  id: string;
  group: string;
  /** A Lucide icon, or any node (e.g. an avatar). */
  icon: LucideIcon | ReactNode;
  title: string;
  blurb: string;
  /** Shown at the end of the list item: a count, a status. */
  badge?: ReactNode;
  /** A list item that navigates away instead of opening a panel. */
  href?: string;
  /** The panel body. Omit to render the hub's `children` for this section. */
  render?: () => ReactNode;
};

