import { dashboardSourceAccess } from "./dashboard-access.policy";
import type { PermissionSet } from "@repo/contracts/permissions";

describe("dashboard source policy", () => {
  const permissions = (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, true])) as PermissionSet;
  it("withholds all aggregates without dashboard access", () => {
    expect(
      Object.values(
        dashboardSourceAccess(
          permissions(["can_view_products", "can_view_findings"]),
        ),
      ),
    ).toEqual([false, false, false, false, false, false, false]);
  });
  it("requires product access before any product-linked source", () => {
    expect(
      dashboardSourceAccess(
        permissions([
          "can_view_dashboards",
          "can_view_findings",
          "can_view_sboms",
          "can_view_technical_files",
        ]),
      ),
    ).toEqual({
      products: false,
      findings: false,
      obligations: false,
      sbomCoverage: false,
      readiness: false,
      ingestion: false,
      feeds: true,
    });
  });
  it("leaves linked readiness dependency authorization with its source projection", () => {
    const keys = [
      "can_view_dashboards",
      "can_view_products",
      "can_view_findings",
      "can_view_sboms",
      "can_view_technical_files",
    ];
    expect(dashboardSourceAccess(permissions(keys)).readiness).toBe(true);
    expect(
      dashboardSourceAccess(
        permissions(keys.filter((key) => key !== "can_view_findings")),
      ).readiness,
    ).toBe(true);
  });
  it("reporting uses findings permission rather than reporting permission", () => {
    expect(
      dashboardSourceAccess(
        permissions([
          "can_view_dashboards",
          "can_view_products",
          "can_view_reporting",
        ]),
      ).obligations,
    ).toBe(false);
    expect(
      dashboardSourceAccess(
        permissions([
          "can_view_dashboards",
          "can_view_products",
          "can_view_findings",
        ]),
      ).obligations,
    ).toBe(true);
  });
});
