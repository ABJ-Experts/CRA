"use client";

import { BreadcrumbItem, Breadcrumbs } from "@repo/ui/breadcrumbs";
import { TopNav, TopNavTitle } from "@repo/ui/app-shell";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useSession } from "../../_providers/session-provider";
import { useNotificationUnreadCountQuery } from "../../_features/notifications/notifications.queries";
import { ReportingDeadlineHeaderIndicator } from "../../_features/reporting/reporting-deadline-header-indicator";

/**
 * Route-aware TopNav content.
 *
 * The frames show two different left-hand treatments and they are not
 * decorative: dashboards greet the user (`cbNJ4`, "Welcome, Robert Fox" over
 * "Overview your store"), tables show a breadcrumb trail (`lOiVA`,
 * "Tables > Basic Tables"). This picks the right one per route so neither
 * page has to render its own bar.
 */

const DASHBOARDS: Record<string, { title: string; subtitle: string }> = {
  "/dashboard/ecommerce": {
    title: "Welcome, Robert Fox",
    subtitle: "Overview your store",
  },
  "/dashboard/analytics": {
    title: "Analytics",
    subtitle: "Traffic, sources and engagement",
  },
  "/dashboard/crypto": {
    title: "Crypto",
    subtitle: "Markets, portfolio and activity",
  },
  "/dashboard/project": {
    title: "Project Manager",
    subtitle: "Delivery across every workstream",
  },
};

const TABLES: Record<string, string> = {
  "/dashboard/tables/basic": "Basic Tables",
  "/dashboard/tables/striped": "Striped Tables",
  "/dashboard/tables/bordered": "Bordered Tables",
  "/dashboard/tables/splitted": "Splitted Tables",
};

/** Turns an unmapped path into a readable label, e.g. `file-manager` -> `File Manager`. */
function titleise(segment: string) {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function DashboardTopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const unread = useNotificationUnreadCountQuery();

  const { session } = useSession();
  const liveDashboard =
    pathname === "/dashboard" || /^\/products\/[^/]+\/posture$/.test(pathname);
  const identity = session?.user;
  const liveName = identity
    ? [identity.firstName, identity.lastName].filter(Boolean).join(" ") ||
      identity.username ||
      identity.email
    : "Account";
  const dashboard =
    pathname === "/dashboard"
      ? { title: "CRA Sentinel", subtitle: "Product security operations" }
      : DASHBOARDS[pathname];
  const table = TABLES[pathname];

  let left = null;
  if (dashboard) {
    left = (
      <TopNavTitle title={dashboard.title} subtitle={dashboard.subtitle} />
    );
  } else if (table) {
    left = (
      <Breadcrumbs>
        <BreadcrumbItem asChild>
          <Link href="/dashboard/tables/basic">Tables</Link>
        </BreadcrumbItem>
        <BreadcrumbItem current>{table}</BreadcrumbItem>
      </Breadcrumbs>
    );
  } else {
    /* Everything else is a placeholder section; a breadcrumb still orients
     * the user rather than leaving the bar empty. */
    const last = pathname.split("/").filter(Boolean).at(-1) ?? "Dashboard";
    left = (
      <Breadcrumbs>
        <BreadcrumbItem asChild>
          <Link href="/dashboard">Dashboard</Link>
        </BreadcrumbItem>
        <BreadcrumbItem current>{titleise(last)}</BreadcrumbItem>
      </Breadcrumbs>
    );
  }

  return (
    <TopNav
      user={{ name: liveDashboard ? liveName : "Ada Foster" }}
      centre={liveDashboard ? undefined : <ReportingDeadlineHeaderIndicator />}
      notificationCount={unread.isError ? undefined : unread.data?.count}
      onNotificationsClick={() => router.push("/notifications")}
      className="max-lg:pl-20"
    >
      {left}
    </TopNav>
  );
}
