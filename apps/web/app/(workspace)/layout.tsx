import type { ReactNode } from "react";

import { SessionProvider } from "../_providers/session-provider";
import { WorkspaceShell } from "./workspace-shell";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </SessionProvider>
  );
}
