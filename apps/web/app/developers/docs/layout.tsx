import type { ReactNode } from "react";

import { DocsSidebar } from "@/components/developers/docs/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="dp-docs">
      <DocsSidebar />
      <div className="dp-docs-content">{children}</div>
    </div>
  );
}
