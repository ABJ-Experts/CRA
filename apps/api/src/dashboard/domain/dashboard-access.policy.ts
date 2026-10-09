import type { PermissionSet } from "@repo/contracts/permissions";
import { hasPermission } from "@repo/contracts/permissions";

/** Source gates are computed before any aggregate is requested. */
export function dashboardSourceAccess(permissions: PermissionSet) {
  const dashboard = hasPermission(permissions, "can_view_dashboards");
  const products = dashboard && hasPermission(permissions, "can_view_products");
  const findings = products && hasPermission(permissions, "can_view_findings");
  const sboms = products && hasPermission(permissions, "can_view_sboms");
  return {
    products,
    findings,
    obligations: findings,
    sbomCoverage: sboms,
    readiness:
      products && hasPermission(permissions, "can_view_technical_files"),
    ingestion: sboms,
    feeds: dashboard && hasPermission(permissions, "can_view_findings"),
  } as const;
}
