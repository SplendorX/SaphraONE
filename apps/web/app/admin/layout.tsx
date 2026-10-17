import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Admin | SaphraONE",
};

/** Every admin tool, in one frame with one sign-in. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
