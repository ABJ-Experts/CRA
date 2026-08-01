import type { ReactNode } from "react";
import { Sidebar } from "../_components/sidebar/sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
