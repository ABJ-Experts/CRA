import type { ReactNode } from "react";
import { Sidebar } from "../_components/sidebar/sidebar";
import { DashboardTopNav } from "./_components/dashboard-top-nav";
import { DashboardOnboardingGate } from "./_components/dashboard-onboarding-gate";

/**
 * The shell every dashboard and table screen sits in, matching the frames:
 * a 270px sidebar (66px collapsed) beside a 64px top bar over the body.
 *
 * `min-h-dvh` with no fixed height, so a page holds the viewport when it is
 * short and grows when it is not. That is the same rule the auth screens use;
 * the Crypto frame is 1938 tall and must scroll rather than be clipped.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopNav />
        <main className="min-w-0 flex-1">
          <DashboardOnboardingGate>{children}</DashboardOnboardingGate>
        </main>
      </div>
    </div>
  );
}
