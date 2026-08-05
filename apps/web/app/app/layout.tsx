import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { readSession } from "../../lib/session";
import { AppSidebar } from "./_components/app-sidebar";
import { AppTopBar } from "./_components/app-top-bar";

/**
 * Shell for the real product, mirroring the template's DashboardLayout so both
 * halves of the app feel like one product: 270px sidebar (66px collapsed)
 * beside a 64px top bar over the body.
 *
 * The auth guard lives HERE rather than in each page. A page-level check is one
 * `readSession()` call away from being forgotten on a new screen, and the
 * failure mode of forgetting it is an unauthenticated render — the exact thing
 * the httpOnly cookie exists to prevent.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await readSession();
  if (!session) redirect("/sign-in");
  /* Signed in but no tenant chosen: every API call would 401 with "No active
   * organisation context", which looks like a broken app rather than a missing
   * step. select-organisation is outside this layout so it can render without
   * one. */
  if (!session.organisationId) redirect("/select-organisation");

  return (
    <div className="flex min-h-dvh bg-canvas">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
