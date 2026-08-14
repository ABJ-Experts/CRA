import type { ReactNode } from "react";

import { Sidebar } from "../_components/sidebar/sidebar";
import { DashboardOnboardingGate } from "../dashboard/_components/dashboard-onboarding-gate";
import { DashboardTopNav } from "../dashboard/_components/dashboard-top-nav";
import { OrganizationThemeProvider } from "../dashboard/organization-theme-provider";

/** Shared authenticated workspace frame for dashboard and customer routes. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <OrganizationThemeProvider>
      <div className="flex min-h-dvh bg-canvas">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardTopNav />
          <main className="min-w-0 flex-1">
            <DashboardOnboardingGate>{children}</DashboardOnboardingGate>
          </main>
        </div>
      </div>
    </OrganizationThemeProvider>
  );
}
